use crate::link_index::{
    ensure_note_id_in_content, forget_path_from_index, forget_subtree_from_index, move_index_path,
    parse_links_for_note, read_link_index_file, reindex_note_after_save, repair_inbound_links,
    repair_subtree_paths, set_note_id_in_content, unique_note_relative,
    update_index_links_for_source, write_folder_sidecar, write_link_index_file, FolderRecord,
    FolderSidecar, NoteRecord,
};
use crate::note_history::{create_note_version_snapshot, note_history_reason, NoteSnapshotMode};
use crate::notebook_paths::{
    is_hidden_entry, normalize_relative, note_title_from_path, relative_path, validate_note_title,
};
use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};
use uuid::Uuid;
use walkdir::WalkDir;

#[derive(Debug, Serialize)]
pub struct NoteEntry {
    pub path: String,
    pub title: String,
    pub parent_path: String,
    pub updated_at: Option<u64>,
}

#[derive(Debug, Serialize)]
pub struct FolderEntry {
    pub path: String,
    pub name: String,
    pub parent_path: String,
}

pub fn list_notes(root: &Path) -> Result<Vec<NoteEntry>, String> {
    let mut notes = Vec::new();

    for entry in WalkDir::new(root)
        .into_iter()
        .filter_entry(|entry| !is_hidden_entry(entry.path()))
    {
        let entry = entry.map_err(|error| error.to_string())?;
        let path = entry.path();

        if !path.is_file() || path.extension().and_then(|ext| ext.to_str()) != Some("md") {
            continue;
        }

        let relative = relative_path(root, path)?;
        let parent_path = parent_path_for(&relative);
        let title = path
            .file_stem()
            .and_then(|name| name.to_str())
            .unwrap_or("Untitled")
            .to_string();
        let updated_at = fs::metadata(path)
            .and_then(|metadata| metadata.modified())
            .ok()
            .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|duration| duration.as_secs());

        notes.push(NoteEntry {
            path: relative,
            title,
            parent_path,
            updated_at,
        });
    }

    notes.sort_by(|a, b| a.path.cmp(&b.path));
    Ok(notes)
}

pub fn list_folders(root: &Path) -> Result<Vec<FolderEntry>, String> {
    let mut folders = vec![FolderEntry {
        path: String::new(),
        name: root
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("Notebook")
            .to_string(),
        parent_path: String::new(),
    }];

    if !root.exists() {
        return Ok(folders);
    }

    for entry in WalkDir::new(root)
        .min_depth(1)
        .into_iter()
        .filter_entry(|entry| !is_hidden_entry(entry.path()))
    {
        let entry = entry.map_err(|error| error.to_string())?;
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }

        let relative = relative_path(root, path)?;
        let parent_path = parent_path_for(&relative);
        let name = path
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("Untitled")
            .to_string();

        folders.push(FolderEntry {
            path: relative,
            name,
            parent_path,
        });
    }

    folders.sort_by(|a, b| a.path.cmp(&b.path));
    Ok(folders)
}

pub fn read_note(root: &Path, path: &str) -> Result<String, String> {
    fs::read_to_string(note_path(root, path)?).map_err(|error| error.to_string())
}

pub fn save_note(root: &Path, path: &str, content: &str) -> Result<String, String> {
    let note_path = note_path(root, path)?;
    if let Some(parent) = note_path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    let (_id, content_with_id, _mutated) = ensure_note_id_in_content(content);
    if let Ok(existing) = fs::read_to_string(&note_path) {
        let reason = note_history_reason(&existing, &content_with_id);
        let _ = create_note_version_snapshot(
            root,
            path,
            &existing,
            &content_with_id,
            &reason,
            NoteSnapshotMode::Throttled,
        );
    }
    fs::write(&note_path, &content_with_id).map_err(|error| error.to_string())?;
    let _ = reindex_note_after_save(root, path);
    Ok(content_with_id)
}

pub fn create_note(root: &Path, parent_path: &str, title: &str) -> Result<NoteEntry, String> {
    validate_note_title(title)?;
    let file_name = title.trim();
    let parent = normalize_relative(parent_path)?;
    let relative = if parent.as_os_str().is_empty() {
        PathBuf::from(format!("{file_name}.md"))
    } else {
        parent.join(format!("{file_name}.md"))
    };
    let absolute = root.join(&relative);

    if let Some(parent) = absolute.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }

    if absolute.exists() {
        return Err("A note with that title already exists in this folder.".to_string());
    }

    let new_id = Uuid::new_v4().to_string();
    let initial_content = format!("---\nid: {new_id}\n---\n\n");
    fs::write(&absolute, &initial_content).map_err(|error| error.to_string())?;

    let path = relative.to_string_lossy().replace('\\', "/");
    let mut index = read_link_index_file(root);
    index.notes_by_id.insert(
        new_id.clone(),
        NoteRecord {
            id: new_id.clone(),
            path: path.clone(),
            title: note_title_from_path(&path),
        },
    );
    index.path_to_id.insert(path.clone(), new_id);
    let _ = write_link_index_file(root, &index);

    Ok(NoteEntry {
        path: path.clone(),
        title: title.to_string(),
        parent_path: parent_path_for(&path),
        updated_at: None,
    })
}

pub fn duplicate_note(root: &Path, path: &str) -> Result<NoteEntry, String> {
    let source_relative = normalize_relative(path)?;
    let source_path = root.join(&source_relative);
    if !source_path.exists() {
        return Err("The note could not be found.".to_string());
    }

    let parent = source_relative
        .parent()
        .map(PathBuf::from)
        .unwrap_or_default();
    let source_stem = source_relative
        .file_stem()
        .and_then(|name| name.to_str())
        .unwrap_or("Untitled");
    let copy_stem = format!("Copy of {source_stem}");
    let new_relative = unique_note_relative(root, &parent, &copy_stem);
    let new_path = root.join(&new_relative);
    if let Some(parent) = new_path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }

    let source_content = fs::read_to_string(&source_path).map_err(|error| error.to_string())?;
    let new_id = Uuid::new_v4().to_string();
    let duplicate_content = set_note_id_in_content(&source_content, &new_id);
    fs::write(&new_path, &duplicate_content).map_err(|error| error.to_string())?;

    let path = new_relative.to_string_lossy().replace('\\', "/");
    let title = note_title_from_path(&path);
    let mut index = read_link_index_file(root);
    index.notes_by_id.insert(
        new_id.clone(),
        NoteRecord {
            id: new_id.clone(),
            path: path.clone(),
            title: title.clone(),
        },
    );
    index.path_to_id.insert(path.clone(), new_id.clone());
    let refs = parse_links_for_note(&new_id, &duplicate_content, &index);
    update_index_links_for_source(&mut index, &new_id, refs);
    let _ = write_link_index_file(root, &index);

    Ok(NoteEntry {
        path: path.clone(),
        title,
        parent_path: parent_path_for(&path),
        updated_at: None,
    })
}

pub fn rename_note(root: &Path, path: &str, title: &str) -> Result<NoteEntry, String> {
    validate_note_title(title)?;
    let old_path = note_path(root, path)?;
    let parent = Path::new(path)
        .parent()
        .map(PathBuf::from)
        .unwrap_or_default();
    let new_relative = if parent.as_os_str().is_empty() {
        PathBuf::from(format!("{}.md", title.trim()))
    } else {
        parent.join(format!("{}.md", title.trim()))
    };
    let new_path = root.join(&new_relative);

    let new_rel_str = new_relative.to_string_lossy().replace('\\', "/");
    let old_rel_str = path.to_string();

    if old_path != new_path {
        if new_path.exists() {
            return Err("A note with that title already exists in this folder.".to_string());
        }
        fs::rename(&old_path, &new_path).map_err(|error| error.to_string())?;

        let mut index = read_link_index_file(root);
        if let Some(id) = index.path_to_id.get(&old_rel_str).cloned() {
            move_index_path(&mut index, &old_rel_str, &new_rel_str, &id, "note");
            let _ = repair_inbound_links(root, &mut index, &id, &old_rel_str, &new_rel_str);
            let _ = write_link_index_file(root, &index);
        }
    }

    Ok(NoteEntry {
        path: new_rel_str.clone(),
        title: title.trim().to_string(),
        parent_path: parent_path_for(&new_rel_str),
        updated_at: None,
    })
}

pub fn create_folder(root: &Path, parent_path: &str, name: &str) -> Result<FolderEntry, String> {
    validate_note_title(name)?;
    let parent = normalize_relative(parent_path)?;
    let relative = if parent.as_os_str().is_empty() {
        PathBuf::from(name.trim())
    } else {
        parent.join(name.trim())
    };
    let absolute = root.join(&relative);
    if absolute.exists() {
        return Err("A folder with that name already exists here.".to_string());
    }
    fs::create_dir_all(&absolute).map_err(|error| error.to_string())?;
    let path = relative.to_string_lossy().replace('\\', "/");

    let folder_id = Uuid::new_v4().to_string();
    let _ = write_folder_sidecar(
        root,
        &path,
        &FolderSidecar {
            id: folder_id.clone(),
        },
    );
    let mut index = read_link_index_file(root);
    index.folders_by_id.insert(
        folder_id.clone(),
        FolderRecord {
            id: folder_id.clone(),
            path: path.clone(),
        },
    );
    index.path_to_id.insert(path.clone(), folder_id);
    let _ = write_link_index_file(root, &index);

    Ok(FolderEntry {
        path: path.clone(),
        name: name.trim().to_string(),
        parent_path: parent_path_for(&path),
    })
}

pub fn rename_folder(root: &Path, path: &str, name: &str) -> Result<FolderEntry, String> {
    validate_note_title(name)?;
    let old_relative = normalize_relative(path)?;
    if old_relative.as_os_str().is_empty() {
        return Err("The notebook root cannot be renamed.".to_string());
    }

    let parent = Path::new(path)
        .parent()
        .map(PathBuf::from)
        .unwrap_or_default();
    let new_relative = if parent.as_os_str().is_empty() {
        PathBuf::from(name.trim())
    } else {
        parent.join(name.trim())
    };
    let old_path = root.join(&old_relative);
    let new_path = root.join(&new_relative);

    let old_rel_str = path.to_string();
    let new_rel_str = new_relative.to_string_lossy().replace('\\', "/");

    if old_path != new_path {
        if new_path.exists() {
            return Err("A folder with that name already exists here.".to_string());
        }
        fs::rename(&old_path, &new_path).map_err(|error| error.to_string())?;

        let mut index = read_link_index_file(root);
        repair_subtree_paths(root, &mut index, &old_rel_str, &new_rel_str)?;
        let _ = write_link_index_file(root, &index);
    }

    Ok(FolderEntry {
        path: new_rel_str.clone(),
        name: name.trim().to_string(),
        parent_path: parent_path_for(&new_rel_str),
    })
}

pub fn move_note(root: &Path, path: &str, target_parent_path: &str) -> Result<NoteEntry, String> {
    let old_relative = normalize_relative(path)?;
    let target_parent = normalize_relative(target_parent_path)?;
    let file_name = old_relative
        .file_name()
        .ok_or_else(|| "Invalid note path.".to_string())?;
    let initial_new_relative = if target_parent.as_os_str().is_empty() {
        PathBuf::from(file_name)
    } else {
        target_parent.join(file_name)
    };
    let old_path = root.join(&old_relative);
    let new_relative = if old_relative == initial_new_relative {
        initial_new_relative
    } else {
        let initial_new_path = root.join(&initial_new_relative);
        if initial_new_path.exists() {
            let stem = old_relative
                .file_stem()
                .and_then(|name| name.to_str())
                .unwrap_or("Untitled");
            unique_note_relative(root, &target_parent, stem)
        } else {
            initial_new_relative
        }
    };
    let new_path = root.join(&new_relative);

    let old_rel_str = path.to_string();
    let new_rel_str = new_relative.to_string_lossy().replace('\\', "/");

    if old_path != new_path {
        if let Some(parent) = new_path.parent() {
            fs::create_dir_all(parent).map_err(|error| error.to_string())?;
        }
        fs::rename(&old_path, &new_path).map_err(|error| error.to_string())?;

        let mut index = read_link_index_file(root);
        if let Some(id) = index.path_to_id.get(&old_rel_str).cloned() {
            move_index_path(&mut index, &old_rel_str, &new_rel_str, &id, "note");
            let _ = repair_inbound_links(root, &mut index, &id, &old_rel_str, &new_rel_str);
            let _ = write_link_index_file(root, &index);
        }
    }

    let title = note_title_from_path(&new_rel_str);
    Ok(NoteEntry {
        path: new_rel_str.clone(),
        title,
        parent_path: parent_path_for(&new_rel_str),
        updated_at: None,
    })
}

pub fn move_folder(
    root: &Path,
    path: &str,
    target_parent_path: &str,
) -> Result<FolderEntry, String> {
    let old_relative = normalize_relative(path)?;
    let target_parent = normalize_relative(target_parent_path)?;
    if old_relative.as_os_str().is_empty() {
        return Err("The notebook root cannot be moved.".to_string());
    }
    if target_parent == old_relative || target_parent.starts_with(&old_relative) {
        return Err("A folder cannot be moved inside itself.".to_string());
    }

    let name = old_relative
        .file_name()
        .ok_or_else(|| "Invalid folder path.".to_string())?;
    let new_relative = if target_parent.as_os_str().is_empty() {
        PathBuf::from(name)
    } else {
        target_parent.join(name)
    };
    let old_path = root.join(&old_relative);
    let new_path = root.join(&new_relative);

    let old_rel_str = path.to_string();
    let new_rel_str = new_relative.to_string_lossy().replace('\\', "/");

    if old_path != new_path {
        if new_path.exists() {
            return Err("A folder with that name already exists in the target folder.".to_string());
        }
        if let Some(parent) = new_path.parent() {
            fs::create_dir_all(parent).map_err(|error| error.to_string())?;
        }
        fs::rename(&old_path, &new_path).map_err(|error| error.to_string())?;

        let mut index = read_link_index_file(root);
        repair_subtree_paths(root, &mut index, &old_rel_str, &new_rel_str)?;
        let _ = write_link_index_file(root, &index);
    }

    Ok(FolderEntry {
        path: new_rel_str.clone(),
        name: name.to_string_lossy().to_string(),
        parent_path: parent_path_for(&new_rel_str),
    })
}

pub fn delete_note(root: &Path, path: &str) -> Result<(), String> {
    let path_abs = note_path(root, path)?;
    if path_abs.exists() {
        fs::remove_file(path_abs).map_err(|error| error.to_string())?;
    }
    let mut index = read_link_index_file(root);
    forget_path_from_index(&mut index, path);
    let _ = write_link_index_file(root, &index);
    Ok(())
}

pub fn delete_folder(root: &Path, path: &str) -> Result<(), String> {
    let relative = normalize_relative(path)?;
    if relative.as_os_str().is_empty() {
        return Err("The notebook root cannot be deleted.".to_string());
    }
    let path_abs = root.join(relative);
    if path_abs.exists() {
        fs::remove_dir_all(path_abs).map_err(|error| error.to_string())?;
    }
    let mut index = read_link_index_file(root);
    forget_subtree_from_index(&mut index, path);
    let _ = write_link_index_file(root, &index);
    Ok(())
}

fn note_path(root: &Path, relative: &str) -> Result<PathBuf, String> {
    let relative = normalize_relative(relative)?;
    let path = root.join(relative);
    if !path.starts_with(root) {
        return Err("Path escapes workspace.".to_string());
    }
    Ok(path)
}

fn parent_path_for(path: &str) -> String {
    Path::new(path)
        .parent()
        .map(|parent| parent.to_string_lossy().replace('\\', "/"))
        .unwrap_or_default()
}
