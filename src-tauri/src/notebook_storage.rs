use crate::link_index::{
    ensure_note_id_in_content_with_preferred, forget_path_from_index, forget_subtree_from_index,
    move_index_path, parse_links_for_note, plan_inbound_link_repairs, plan_subtree_path_repairs,
    read_frontmatter_field, read_link_index_file, rebuild_index_for_root, reindex_note_after_save,
    set_tigrana_managed_fields_in_content, split_frontmatter, unique_note_relative,
    update_index_links_for_source, write_folder_sidecar, write_link_index_file, FolderRecord,
    FolderSidecar, LinkIndex, NoteContentMutation, NoteRecord,
};
use crate::note_history::{
    create_note_version_snapshot, earliest_note_history_times, note_history_reason,
    NoteSnapshotMode,
};
use crate::notebook_metadata::{
    read_workspace_metadata, repair_folder_path, repair_note_path, write_workspace_metadata,
    FolderPlacement, FolderSiblingPlacement, WorkspaceMetadata,
};
use crate::notebook_paths::{
    is_hidden_entry, normalize_relative, note_title_from_path, relative_path, validate_note_title,
};
use serde::Serialize;
use std::collections::{BTreeMap, HashMap};
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use time::{format_description::well_known::Rfc3339, OffsetDateTime};
use uuid::Uuid;
use walkdir::WalkDir;

#[derive(Debug, Serialize)]
pub struct NoteEntry {
    pub path: String,
    pub title: String,
    pub parent_path: String,
    pub created_at: Option<u64>,
    pub updated_at: Option<u64>,
}

#[derive(Debug, Serialize)]
pub struct FolderEntry {
    pub path: String,
    pub name: String,
    pub parent_path: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NotebookSnapshot {
    pub folders: Vec<FolderEntry>,
    pub notes: Vec<NoteEntry>,
    pub contents: BTreeMap<String, String>,
    pub link_index: Option<LinkIndex>,
}

pub fn read_notebook_snapshot(root: &Path) -> Result<NotebookSnapshot, String> {
    // Identity/index maintenance is best-effort during reads. A read-only or
    // temporarily full Notebook must remain openable even when its cache
    // cannot be refreshed.
    let link_index = rebuild_index_for_root(root).ok();
    let folders = list_folders(root)?;
    let notes = list_notes(root)?;
    let mut contents = BTreeMap::new();
    for note in &notes {
        contents.insert(note.path.clone(), read_note(root, &note.path)?);
    }
    Ok(NotebookSnapshot {
        folders,
        notes,
        contents,
        link_index,
    })
}

pub fn list_notes(root: &Path) -> Result<Vec<NoteEntry>, String> {
    let mut notes = Vec::new();
    let link_index = read_link_index_file(root);
    let metadata = read_workspace_metadata(root).unwrap_or_default();
    let mut history_created_at = None;

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
        let raw = fs::read_to_string(path)
            .map_err(|error| format!("Failed to read Note {relative}: {error}"))?;
        let preferred_id = link_index.path_to_id.get(&relative).cloned();
        let (note_id, content_with_id, id_was_added) =
            ensure_note_id_in_content_with_preferred(&raw, preferred_id);
        let (file_created_at, updated_at) = note_file_times(path);
        let legacy_created_at = metadata
            .note_created_at
            .get(&note_id)
            .and_then(|value| value.as_u64());
        let created_at = portable_created_at_from_content(&content_with_id)
            .or(legacy_created_at)
            .or_else(|| {
                let history =
                    history_created_at.get_or_insert_with(|| earliest_note_history_times(root));
                earliest_created_at(
                    file_created_at,
                    updated_at,
                    history
                        .get(&note_id)
                        .copied()
                        .or_else(|| history.get(&relative).copied()),
                    earliest_metadata_note_evidence(&metadata, &relative),
                )
            });
        if let Some(created_at_value) = created_at {
            if let Some(created_at_text) = format_created_at(created_at_value) {
                let migrated = set_tigrana_managed_fields_in_content(
                    &content_with_id,
                    &note_id,
                    &created_at_text,
                );
                if migrated != raw {
                    // Opening a Notebook is a read operation. Migration is useful,
                    // but a read-only Note must remain openable when it cannot persist.
                    if write_migration_preserving_modified_time(path, &migrated).is_ok()
                        && id_was_added
                    {
                        let _ = reindex_note_after_save(root, &relative);
                    }
                }
            }
        }

        notes.push(NoteEntry {
            path: relative,
            title,
            parent_path,
            created_at,
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
    if !note_path.is_file() {
        return Err("The Note no longer exists at that path.".to_string());
    }
    let existing = fs::read_to_string(&note_path)
        .map_err(|error| format!("Failed to read Note before saving: {error}"))?;
    let preferred_id = note_id_from_content(&existing)
        .or_else(|| read_link_index_file(root).path_to_id.get(path).cloned());
    let (note_id, content_with_id, _) =
        ensure_note_id_in_content_with_preferred(content, preferred_id);
    let created_at = portable_created_at_from_content(&content_with_id)
        .or_else(|| portable_created_at_from_content(&existing))
        .or_else(|| recover_note_created_at(root, path, &note_path, &note_id))
        .unwrap_or_else(now_seconds);
    let created_at_text = format_created_at(created_at)
        .ok_or_else(|| "The Note creation timestamp is out of range.".to_string())?;
    let managed_content =
        set_tigrana_managed_fields_in_content(&content_with_id, &note_id, &created_at_text);
    {
        let reason = note_history_reason(&existing, &managed_content);
        let _ = create_note_version_snapshot(
            root,
            path,
            &existing,
            &managed_content,
            &reason,
            NoteSnapshotMode::Throttled,
        );
    }
    write_note_content_atomic(&note_path, &managed_content)?;
    let _ = reindex_note_after_save(root, path);
    Ok(managed_content)
}

pub fn create_note(root: &Path, parent_path: &str, title: &str) -> Result<NoteEntry, String> {
    create_note_with_content(root, parent_path, title, "")
}

pub fn create_note_with_content(
    root: &Path,
    parent_path: &str,
    title: &str,
    body: &str,
) -> Result<NoteEntry, String> {
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

    let new_id = Uuid::new_v4().to_string();
    let created_at = now_seconds();
    let created_at_text = format_created_at(created_at)
        .ok_or_else(|| "The Note creation timestamp is out of range.".to_string())?;
    let initial_content = set_tigrana_managed_fields_in_content(body, &new_id, &created_at_text);
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&absolute)
        .map_err(|error| {
            if error.kind() == std::io::ErrorKind::AlreadyExists {
                "A note with that title already exists in this folder.".to_string()
            } else {
                error.to_string()
            }
        })?;
    if let Err(error) = file.write_all(initial_content.as_bytes()) {
        drop(file);
        let _ = fs::remove_file(&absolute);
        return Err(error.to_string());
    }

    let path = relative.to_string_lossy().replace('\\', "/");
    let updated_at = note_file_times(&absolute).1;
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
        created_at: Some(created_at),
        updated_at,
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
    let created_at = now_seconds();
    let created_at_text = format_created_at(created_at)
        .ok_or_else(|| "The Note creation timestamp is out of range.".to_string())?;
    let duplicate_content =
        set_tigrana_managed_fields_in_content(&source_content, &new_id, &created_at_text);
    fs::write(&new_path, &duplicate_content).map_err(|error| error.to_string())?;

    let path = new_relative.to_string_lossy().replace('\\', "/");
    let title = note_title_from_path(&path);
    let updated_at = note_file_times(&new_path).1;
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
        created_at: Some(created_at),
        updated_at,
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
        let original_index = complete_index_for_path(root, &old_rel_str)?;
        let original_metadata = read_workspace_metadata(root)?;
        let id = original_index
            .path_to_id
            .get(&old_rel_str)
            .cloned()
            .ok_or_else(|| "The Note is missing its stable identity.".to_string())?;
        fs::rename(&old_path, &new_path).map_err(|error| error.to_string())?;

        let mut next_index = original_index.clone();
        move_index_path(&mut next_index, &old_rel_str, &new_rel_str, &id, "note");
        let mut content_mutations = HashMap::new();
        if let Err(error) = plan_inbound_link_repairs(
            root,
            &mut next_index,
            &id,
            &old_rel_str,
            &new_rel_str,
            &mut content_mutations,
        ) {
            return rollback_uncommitted_path(&old_path, &new_path, error);
        }
        let mut next_metadata = original_metadata.clone();
        repair_note_path(
            &mut next_metadata,
            &old_rel_str,
            &new_rel_str,
            &parent_path_for(&old_rel_str),
            &parent_path_for(&new_rel_str),
        );
        commit_path_mutation(
            root,
            &old_path,
            &new_path,
            &original_index,
            &next_index,
            &original_metadata,
            &next_metadata,
            &content_mutations,
        )?;
    }

    let (_, updated_at) = note_file_times(&new_path);
    let created_at = note_created_at_for_path(root, &new_rel_str, &new_path);
    Ok(NoteEntry {
        path: new_rel_str.clone(),
        title: title.trim().to_string(),
        parent_path: parent_path_for(&new_rel_str),
        created_at,
        updated_at,
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
        let original_index = complete_index_for_path(root, &old_rel_str)?;
        let original_metadata = read_workspace_metadata(root)?;
        fs::rename(&old_path, &new_path).map_err(|error| error.to_string())?;

        let mut next_index = original_index.clone();
        let mut content_mutations = HashMap::new();
        if let Err(error) = plan_subtree_path_repairs(
            root,
            &mut next_index,
            &old_rel_str,
            &new_rel_str,
            &mut content_mutations,
        ) {
            return rollback_uncommitted_path(&old_path, &new_path, error);
        }
        let mut next_metadata = original_metadata.clone();
        repair_folder_path(
            &mut next_metadata,
            &old_rel_str,
            &new_rel_str,
            &parent_path_for(&old_rel_str),
            &parent_path_for(&new_rel_str),
            None,
        );
        commit_path_mutation(
            root,
            &old_path,
            &new_path,
            &original_index,
            &next_index,
            &original_metadata,
            &next_metadata,
            &content_mutations,
        )?;
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
        let original_index = complete_index_for_path(root, &old_rel_str)?;
        let original_metadata = read_workspace_metadata(root)?;
        let id = original_index
            .path_to_id
            .get(&old_rel_str)
            .cloned()
            .ok_or_else(|| "The Note is missing its stable identity.".to_string())?;
        fs::rename(&old_path, &new_path).map_err(|error| error.to_string())?;

        let mut next_index = original_index.clone();
        move_index_path(&mut next_index, &old_rel_str, &new_rel_str, &id, "note");
        let mut content_mutations = HashMap::new();
        if let Err(error) = plan_inbound_link_repairs(
            root,
            &mut next_index,
            &id,
            &old_rel_str,
            &new_rel_str,
            &mut content_mutations,
        ) {
            return rollback_uncommitted_path(&old_path, &new_path, error);
        }
        let mut next_metadata = original_metadata.clone();
        repair_note_path(
            &mut next_metadata,
            &old_rel_str,
            &new_rel_str,
            &parent_path_for(&old_rel_str),
            &parent_path_for(&new_rel_str),
        );
        commit_path_mutation(
            root,
            &old_path,
            &new_path,
            &original_index,
            &next_index,
            &original_metadata,
            &next_metadata,
            &content_mutations,
        )?;
    }

    let title = note_title_from_path(&new_rel_str);
    let (_, updated_at) = note_file_times(&new_path);
    let created_at = note_created_at_for_path(root, &new_rel_str, &new_path);
    Ok(NoteEntry {
        path: new_rel_str.clone(),
        title,
        parent_path: parent_path_for(&new_rel_str),
        created_at,
        updated_at,
    })
}

pub fn move_folder(
    root: &Path,
    path: &str,
    target_parent_path: &str,
    sibling_target_path: Option<&str>,
    sibling_placement: Option<FolderPlacement>,
) -> Result<FolderEntry, String> {
    let old_relative = normalize_relative(path)?;
    let target_parent = normalize_relative(target_parent_path)?;
    if old_relative.as_os_str().is_empty() {
        return Err("The notebook root cannot be moved.".to_string());
    }
    if target_parent == old_relative || target_parent.starts_with(&old_relative) {
        return Err("A folder cannot be moved inside itself.".to_string());
    }
    let sibling_placement = match (sibling_target_path, sibling_placement) {
        (None, None) => None,
        (Some(target_path), Some(placement)) => {
            let target = normalize_relative(target_path)?;
            let target_path = target.to_string_lossy().replace('\\', "/");
            if parent_path_for(&target_path) != target_parent_path {
                return Err(
                    "The sibling placement target must be in the destination folder.".to_string(),
                );
            }
            if !root.join(&target).is_dir() {
                return Err("The sibling placement target does not exist.".to_string());
            }
            Some((target_path, placement))
        }
        _ => return Err("Folder sibling placement is incomplete.".to_string()),
    };

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
        let original_index = complete_index_for_path(root, &old_rel_str)?;
        let original_metadata = read_workspace_metadata(root)?;
        fs::rename(&old_path, &new_path).map_err(|error| error.to_string())?;

        let mut next_index = original_index.clone();
        let mut content_mutations = HashMap::new();
        if let Err(error) = plan_subtree_path_repairs(
            root,
            &mut next_index,
            &old_rel_str,
            &new_rel_str,
            &mut content_mutations,
        ) {
            return rollback_uncommitted_path(&old_path, &new_path, error);
        }
        let mut next_metadata = original_metadata.clone();
        repair_folder_path(
            &mut next_metadata,
            &old_rel_str,
            &new_rel_str,
            &parent_path_for(&old_rel_str),
            &parent_path_for(&new_rel_str),
            sibling_placement
                .as_ref()
                .map(|(target_path, placement)| FolderSiblingPlacement {
                    target_path,
                    placement: *placement,
                }),
        );
        commit_path_mutation(
            root,
            &old_path,
            &new_path,
            &original_index,
            &next_index,
            &original_metadata,
            &next_metadata,
            &content_mutations,
        )?;
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

fn complete_index_for_path(root: &Path, path: &str) -> Result<LinkIndex, String> {
    let index = read_link_index_file(root);
    if index.path_to_id.contains_key(path) {
        return Ok(index);
    }
    let rebuilt = rebuild_index_for_root(root)?;
    if rebuilt.path_to_id.contains_key(path) {
        Ok(rebuilt)
    } else {
        Err(format!(
            "The Notebook path '{path}' is missing its stable identity."
        ))
    }
}

#[allow(clippy::too_many_arguments)]
fn commit_path_mutation(
    root: &Path,
    old_path: &Path,
    new_path: &Path,
    original_index: &LinkIndex,
    next_index: &LinkIndex,
    original_metadata: &WorkspaceMetadata,
    next_metadata: &WorkspaceMetadata,
    content_mutations: &HashMap<String, NoteContentMutation>,
) -> Result<(), String> {
    let commit_result = (|| {
        for mutation in content_mutations.values() {
            write_note_content_atomic(&root.join(&mutation.path), &mutation.updated)?;
        }
        write_link_index_file(root, next_index)?;
        write_workspace_metadata(root, next_metadata)
    })();

    if let Err(error) = commit_result {
        return rollback_path_mutation(
            root,
            old_path,
            new_path,
            original_index,
            original_metadata,
            content_mutations,
            error,
        );
    }
    Ok(())
}

fn rollback_uncommitted_path<T>(
    old_path: &Path,
    new_path: &Path,
    original_error: String,
) -> Result<T, String> {
    match fs::rename(new_path, old_path) {
        Ok(()) => Err(format!("Notebook path mutation was rolled back: {original_error}")),
        Err(rollback_error) => Err(format!(
            "Notebook path mutation needs recovery: {original_error}; could not restore the original path: {rollback_error}"
        )),
    }
}

fn rollback_path_mutation(
    root: &Path,
    old_path: &Path,
    new_path: &Path,
    original_index: &LinkIndex,
    original_metadata: &WorkspaceMetadata,
    content_mutations: &HashMap<String, NoteContentMutation>,
    original_error: String,
) -> Result<(), String> {
    let mut rollback_errors = Vec::new();
    for mutation in content_mutations.values() {
        if let Err(error) =
            write_note_content_atomic(&root.join(&mutation.path), &mutation.original)
        {
            rollback_errors.push(format!("restore {}: {error}", mutation.path));
        }
    }
    if let Err(error) = fs::rename(new_path, old_path) {
        rollback_errors.push(format!("restore path: {error}"));
    }
    if let Err(error) = write_link_index_file(root, original_index) {
        rollback_errors.push(format!("restore Link index: {error}"));
    }
    if let Err(error) = write_workspace_metadata(root, original_metadata) {
        rollback_errors.push(format!("restore Notebook metadata: {error}"));
    }

    if rollback_errors.is_empty() {
        Err(format!(
            "Notebook path mutation was rolled back: {original_error}"
        ))
    } else {
        Err(format!(
            "Notebook path mutation needs recovery: {original_error}; {}",
            rollback_errors.join("; ")
        ))
    }
}

fn write_note_content_atomic(path: &Path, content: &str) -> Result<(), String> {
    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("note.md");
    let temp_path = path.with_file_name(format!(".{file_name}.tmp-{}", Uuid::new_v4()));
    fs::write(&temp_path, content).map_err(|error| error.to_string())?;
    fs::rename(&temp_path, path).map_err(|error| {
        let _ = fs::remove_file(&temp_path);
        error.to_string()
    })
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

fn note_file_times(path: &Path) -> (Option<u64>, Option<u64>) {
    let Ok(metadata) = fs::metadata(path) else {
        return (None, None);
    };
    let to_unix_seconds = |time: Result<std::time::SystemTime, std::io::Error>| {
        time.ok()
            .and_then(|value| value.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|duration| duration.as_secs())
    };
    (
        to_unix_seconds(metadata.created()),
        to_unix_seconds(metadata.modified()),
    )
}

fn note_id_from_content(content: &str) -> Option<String> {
    read_frontmatter_field(&split_frontmatter(content).0, "id")
}

fn parse_created_at(value: &str) -> Option<u64> {
    let unquoted = value
        .trim()
        .trim_matches(|character| character == '"' || character == '\'');
    let timestamp = OffsetDateTime::parse(unquoted, &Rfc3339)
        .ok()?
        .unix_timestamp();
    u64::try_from(timestamp).ok()
}

fn format_created_at(seconds: u64) -> Option<String> {
    let timestamp = i64::try_from(seconds).ok()?;
    OffsetDateTime::from_unix_timestamp(timestamp)
        .ok()?
        .format(&Rfc3339)
        .ok()
}

fn portable_created_at_from_content(content: &str) -> Option<u64> {
    let frontmatter = split_frontmatter(content).0;
    parse_created_at(&read_frontmatter_field(&frontmatter, "created_at")?)
}

fn now_seconds() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or(0)
}

fn earliest_created_at(
    file_created_at: Option<u64>,
    file_updated_at: Option<u64>,
    history_created_at: Option<u64>,
    metadata_evidence_at: Option<u64>,
) -> Option<u64> {
    [
        file_created_at,
        file_updated_at,
        history_created_at,
        metadata_evidence_at,
    ]
    .into_iter()
    .flatten()
    .min()
}

fn earliest_metadata_note_evidence(metadata: &WorkspaceMetadata, relative: &str) -> Option<u64> {
    let last_opened_at = metadata
        .note_positions
        .get(relative)
        .and_then(|position| position.get("lastOpenedAt"))
        .and_then(|value| value.as_u64())
        .map(|milliseconds| milliseconds / 1000);
    let bookmark_created_at = metadata
        .bookmarks
        .iter()
        .filter(|bookmark| bookmark.get("kind").and_then(|value| value.as_str()) == Some("note"))
        .filter(|bookmark| bookmark.get("path").and_then(|value| value.as_str()) == Some(relative))
        .filter_map(|bookmark| bookmark.get("createdAt").and_then(|value| value.as_u64()))
        .map(|milliseconds| milliseconds / 1000)
        .min();
    [last_opened_at, bookmark_created_at]
        .into_iter()
        .flatten()
        .min()
}

fn recover_note_created_at(root: &Path, relative: &str, path: &Path, note_id: &str) -> Option<u64> {
    let metadata = read_workspace_metadata(root).unwrap_or_default();
    if let Some(created_at) = metadata
        .note_created_at
        .get(note_id)
        .and_then(|value| value.as_u64())
    {
        return Some(created_at);
    }
    let (file_created_at, file_updated_at) = note_file_times(path);
    let history = earliest_note_history_times(root);
    earliest_created_at(
        file_created_at,
        file_updated_at,
        history
            .get(note_id)
            .copied()
            .or_else(|| history.get(relative).copied()),
        earliest_metadata_note_evidence(&metadata, relative),
    )
}

fn write_migration_preserving_modified_time(path: &Path, content: &str) -> Result<(), String> {
    let modified_at = fs::metadata(path)
        .and_then(|metadata| metadata.modified())
        .map_err(|error| error.to_string())?;
    fs::write(path, content).map_err(|error| error.to_string())?;
    filetime::set_file_mtime(path, filetime::FileTime::from_system_time(modified_at))
        .map_err(|error| error.to_string())
}

fn note_created_at_for_path(root: &Path, relative: &str, path: &Path) -> Option<u64> {
    let content = fs::read_to_string(path).ok()?;
    let note_id = note_id_from_content(&content)
        .or_else(|| read_link_index_file(root).path_to_id.get(relative).cloned())?;
    portable_created_at_from_content(&content)
        .or_else(|| recover_note_created_at(root, relative, path, &note_id))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::link_index::{read_frontmatter_field, split_frontmatter};
    use serde_json::json;

    struct TestNotebook(PathBuf);

    impl TestNotebook {
        fn new() -> Self {
            let path =
                std::env::temp_dir().join(format!("tigrana-path-mutation-{}", Uuid::new_v4()));
            fs::create_dir_all(&path).unwrap();
            Self(path)
        }
    }

    impl Drop for TestNotebook {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    fn write_note(root: &Path, path: &str, id: &str, body: &str) {
        let absolute = root.join(path);
        fs::create_dir_all(absolute.parent().unwrap()).unwrap();
        fs::write(absolute, format!("---\nid: {id}\n---\n\n{body}\n")).unwrap();
    }

    fn note_id(root: &Path, path: &str) -> String {
        let content = fs::read_to_string(root.join(path)).unwrap();
        read_frontmatter_field(&split_frontmatter(&content).0, "id").unwrap()
    }

    #[test]
    fn renaming_a_note_commits_links_index_metadata_and_identity_together() {
        let notebook = TestNotebook::new();
        let root = &notebook.0;
        write_note(root, "Notes/Target.md", "target-id", "# Target");
        write_note(
            root,
            "Source.md",
            "source-id",
            "Read [Target](Notes/Target.md).",
        );
        rebuild_index_for_root(root).unwrap();

        let metadata: WorkspaceMetadata = serde_json::from_value(json!({
            "noteOrder": { "Notes": ["Notes/Target.md"] },
            "pinnedNotes": { "Notes/Target.md": true },
            "noteIcons": { "Notes/Target.md": "lucide:FileText" },
            "notePositions": {
                "Notes/Target.md": { "path": "Notes/Target.md", "lastOpenedAt": 1, "scrollTop": 2, "contentLength": 3 }
            },
            "bookmarks": [{ "id": "target", "kind": "note", "path": "Notes/Target.md", "createdAt": 1 }]
        })).unwrap();
        write_workspace_metadata(root, &metadata).unwrap();

        let renamed = rename_note(root, "Notes/Target.md", "Renamed").unwrap();

        assert_eq!(renamed.path, "Notes/Renamed.md");
        assert!(!root.join("Notes/Target.md").exists());
        assert_eq!(note_id(root, "Notes/Renamed.md"), "target-id");
        assert!(fs::read_to_string(root.join("Source.md"))
            .unwrap()
            .contains("[Target](Notes/Renamed.md)"));

        let index = read_link_index_file(root);
        assert_eq!(
            index.path_to_id.get("Notes/Renamed.md").map(String::as_str),
            Some("target-id")
        );
        assert!(!index.path_to_id.contains_key("Notes/Target.md"));

        let persisted = serde_json::to_value(read_workspace_metadata(root).unwrap()).unwrap();
        assert_eq!(persisted["noteOrder"]["Notes"], json!(["Notes/Renamed.md"]));
        assert_eq!(persisted["pinnedNotes"]["Notes/Renamed.md"], json!(true));
        assert_eq!(
            persisted["notePositions"]["Notes/Renamed.md"]["path"],
            json!("Notes/Renamed.md")
        );
        assert_eq!(persisted["bookmarks"][0]["path"], json!("Notes/Renamed.md"));
    }

    #[test]
    fn moving_a_folder_commits_descendants_links_metadata_and_stable_ids_together() {
        let notebook = TestNotebook::new();
        let root = &notebook.0;
        fs::create_dir_all(root.join("Archive/Epilogue")).unwrap();
        write_note(root, "Book/Part/Scene.md", "scene-id", "# Scene");
        write_note(
            root,
            "References.md",
            "references-id",
            "Open [Part](Book/Part) and [Scene](Book/Part/Scene.md).",
        );
        rebuild_index_for_root(root).unwrap();
        let folder_sidecar =
            fs::read_to_string(root.join("Book/Part/.tigrana/folder.json")).unwrap();

        let metadata: WorkspaceMetadata = serde_json::from_value(json!({
            "folderOrder": {
                "Book": ["Book/Part"],
                "Book/Part": [],
                "Archive": ["Archive/Epilogue"]
            },
            "noteOrder": { "Book/Part": ["Book/Part/Scene.md"] },
            "folderIcons": { "Book/Part": "lucide:BookOpen" },
            "noteIcons": { "Book/Part/Scene.md": "lucide:FileText" },
            "expandedFolders": { "Book/Part": true },
            "bookmarks": [
                { "id": "part", "kind": "folder", "path": "Book/Part", "createdAt": 1 },
                { "id": "scene", "kind": "note", "path": "Book/Part/Scene.md", "createdAt": 2 }
            ]
        }))
        .unwrap();
        write_workspace_metadata(root, &metadata).unwrap();

        let moved = move_folder(
            root,
            "Book/Part",
            "Archive",
            Some("Archive/Epilogue"),
            Some(FolderPlacement::Before),
        )
        .unwrap();

        assert_eq!(moved.path, "Archive/Part");
        assert!(!root.join("Book/Part").exists());
        assert_eq!(note_id(root, "Archive/Part/Scene.md"), "scene-id");
        assert_eq!(
            fs::read_to_string(root.join("Archive/Part/.tigrana/folder.json")).unwrap(),
            folder_sidecar,
        );
        let references = fs::read_to_string(root.join("References.md")).unwrap();
        assert!(references.contains("[Part](Archive/Part)"));
        assert!(references.contains("[Scene](Archive/Part/Scene.md)"));

        let index = read_link_index_file(root);
        assert_eq!(
            index
                .path_to_id
                .get("Archive/Part/Scene.md")
                .map(String::as_str),
            Some("scene-id")
        );
        assert!(!index.path_to_id.contains_key("Book/Part/Scene.md"));

        let persisted = serde_json::to_value(read_workspace_metadata(root).unwrap()).unwrap();
        assert_eq!(
            persisted["folderOrder"]["Archive"],
            json!(["Archive/Part", "Archive/Epilogue"])
        );
        assert_eq!(
            persisted["noteOrder"]["Archive/Part"],
            json!(["Archive/Part/Scene.md"])
        );
        assert_eq!(
            persisted["folderIcons"]["Archive/Part"],
            json!("lucide:BookOpen")
        );
        assert_eq!(
            persisted["bookmarks"][1]["path"],
            json!("Archive/Part/Scene.md")
        );
    }

    #[test]
    fn stale_save_after_move_does_not_recreate_the_old_note_path() {
        let notebook = TestNotebook::new();
        let root = &notebook.0;
        fs::create_dir_all(root.join("Archive")).unwrap();
        write_note(root, "Draft.md", "draft-id", "original");
        rebuild_index_for_root(root).unwrap();

        move_note(root, "Draft.md", "Archive").unwrap();
        let result = save_note(
            root,
            "Draft.md",
            "---\nid: draft-id\n---\n\nstale content\n",
        );

        assert!(result.is_err());
        assert!(!root.join("Draft.md").exists());
        assert!(fs::read_to_string(root.join("Archive/Draft.md"))
            .unwrap()
            .contains("original"));
        let index = read_link_index_file(root);
        assert!(!index.path_to_id.contains_key("Draft.md"));
        assert_eq!(
            index.path_to_id.get("Archive/Draft.md").map(String::as_str),
            Some("draft-id")
        );
    }

    #[test]
    fn stale_save_after_delete_does_not_restore_the_deleted_note() {
        let notebook = TestNotebook::new();
        let root = &notebook.0;
        write_note(root, "Draft.md", "draft-id", "original");
        rebuild_index_for_root(root).unwrap();

        delete_note(root, "Draft.md").unwrap();
        let result = save_note(
            root,
            "Draft.md",
            "---\nid: draft-id\n---\n\nstale content\n",
        );

        assert!(result.is_err());
        assert!(!root.join("Draft.md").exists());
        assert!(!read_link_index_file(root)
            .path_to_id
            .contains_key("Draft.md"));
    }

    #[test]
    fn notebook_snapshot_keeps_paths_contents_and_link_index_together() {
        let notebook = TestNotebook::new();
        let root = &notebook.0;
        write_note(
            root,
            "Book/Scene.md",
            "scene-id",
            "Read [Notes](../Notes.md).",
        );
        write_note(root, "Notes.md", "notes-id", "# Notes");

        let before = read_notebook_snapshot(root).unwrap();
        let before_paths = before
            .notes
            .iter()
            .map(|note| note.path.as_str())
            .collect::<Vec<_>>();
        assert_eq!(before_paths, vec!["Book/Scene.md", "Notes.md"]);
        assert_eq!(
            before.contents.keys().cloned().collect::<Vec<_>>(),
            vec!["Book/Scene.md", "Notes.md"]
        );
        assert_eq!(
            before
                .link_index
                .as_ref()
                .unwrap()
                .notes_by_id
                .get("scene-id")
                .map(|note| note.path.as_str()),
            Some("Book/Scene.md")
        );

        let moved = move_note(root, "Book/Scene.md", "").unwrap();
        let after = read_notebook_snapshot(root).unwrap();
        assert_eq!(moved.path, "Scene.md");
        assert!(!after.contents.contains_key("Book/Scene.md"));
        assert!(after.contents.contains_key("Scene.md"));
        assert!(!after
            .link_index
            .as_ref()
            .unwrap()
            .path_to_id
            .contains_key("Book/Scene.md"));
        assert_eq!(
            after
                .link_index
                .as_ref()
                .unwrap()
                .path_to_id
                .get("Scene.md")
                .map(String::as_str),
            Some("scene-id")
        );
    }

    #[test]
    fn notebook_snapshot_remains_readable_when_the_link_index_cannot_be_written() {
        let notebook = TestNotebook::new();
        let root = &notebook.0;
        write_note(root, "Readable.md", "readable-id", "Still readable");
        fs::write(root.join(".tigrana"), "not a directory").unwrap();

        let snapshot = read_notebook_snapshot(root).unwrap();

        assert_eq!(snapshot.notes.len(), 1);
        assert!(snapshot.contents["Readable.md"].contains("Still readable"));
        assert!(snapshot.link_index.is_none());
    }

    #[test]
    fn note_creation_can_commit_identity_and_initial_body_together() {
        let notebook = TestNotebook::new();
        let root = &notebook.0;

        let created = create_note_with_content(root, "", "Welcome", "Welcome body\n").unwrap();
        let content = read_note(root, &created.path).unwrap();

        assert!(content.starts_with(
            "---\n# Tigrana-managed fields.\n# Changing id or created_at can break links and creation history.\nid: "
        ));
        assert!(content.ends_with("Welcome body\n"));
        let frontmatter = split_frontmatter(&content).0;
        assert_eq!(
            read_frontmatter_field(&frontmatter, "created_at")
                .as_deref()
                .and_then(parse_created_at),
            created.created_at
        );
        assert!(created.updated_at.is_some());
        assert!(serde_json::to_value(&created)
            .unwrap()
            .get("created_at")
            .is_some());
        assert!(create_note_with_content(root, "", "Welcome", "replacement").is_err());
        assert_eq!(read_note(root, &created.path).unwrap(), content);
    }

    #[test]
    fn atomic_saves_do_not_replace_the_note_creation_timestamp() {
        let notebook = TestNotebook::new();
        let root = &notebook.0;
        write_note(root, "Dated.md", "dated-id", "Before");
        let Some(created_before_save) = note_file_times(&root.join("Dated.md")).0 else {
            return;
        };

        std::thread::sleep(std::time::Duration::from_millis(1_100));
        save_note(root, "Dated.md", "---\nid: dated-id\n---\n\nAfter\n").unwrap();

        let listed = list_notes(root).unwrap();
        assert_eq!(listed[0].created_at, Some(created_before_save));
        assert_ne!(listed[0].created_at, listed[0].updated_at);
    }

    #[test]
    fn existing_notes_backfill_creation_from_their_earliest_history() {
        let notebook = TestNotebook::new();
        let root = &notebook.0;
        let before = "---\nid: dated-id\n---\n\nBefore\n";
        let after = "---\nid: dated-id\n---\n\nAfter\n";
        write_note(root, "Dated.md", "dated-id", "Before");
        create_note_version_snapshot(
            root,
            "Dated.md",
            before,
            after,
            "save",
            NoteSnapshotMode::Force,
        )
        .unwrap();
        let history_path = root.join(".tigrana/history/notes/index.json");
        let mut history: serde_json::Value =
            serde_json::from_str(&fs::read_to_string(&history_path).unwrap()).unwrap();
        let historical_created_at_ms = 1_700_000_000_000_u64;
        history["entries"][0]["createdAt"] = serde_json::Value::from(historical_created_at_ms);
        fs::write(&history_path, serde_json::to_vec_pretty(&history).unwrap()).unwrap();
        write_note_content_atomic(&root.join("Dated.md"), after).unwrap();

        let listed = list_notes(root).unwrap();
        let migrated_content = fs::read_to_string(root.join("Dated.md")).unwrap();
        let migrated_created_at =
            read_frontmatter_field(&split_frontmatter(&migrated_content).0, "created_at")
                .and_then(|value| parse_created_at(&value));

        assert_eq!(listed[0].created_at, Some(historical_created_at_ms / 1000));
        assert_eq!(migrated_created_at, Some(historical_created_at_ms / 1000));
        assert!(migrated_content.contains("# Tigrana-managed fields."));
    }

    #[test]
    fn opening_headerless_markdown_adds_portable_metadata_without_changing_the_body() {
        let notebook = TestNotebook::new();
        let root = &notebook.0;
        let body = "# Plain Markdown\n\nNothing app-specific here.\n";
        fs::write(root.join("Plain.md"), body).unwrap();

        let snapshot = read_notebook_snapshot(root).unwrap();
        let migrated = &snapshot.contents["Plain.md"];

        assert!(migrated.contains("# Tigrana-managed fields."));
        assert!(read_frontmatter_field(&split_frontmatter(migrated).0, "id").is_some());
        assert!(portable_created_at_from_content(migrated).is_some());
        assert!(migrated.ends_with(body));
    }

    #[test]
    fn listing_a_new_headerless_note_keeps_its_minted_identity_in_the_link_index() {
        let notebook = TestNotebook::new();
        let root = &notebook.0;
        fs::write(root.join("New.md"), "New body.\n").unwrap();

        list_notes(root).unwrap();

        let content = fs::read_to_string(root.join("New.md")).unwrap();
        let id = read_frontmatter_field(&split_frontmatter(&content).0, "id").unwrap();
        assert_eq!(
            read_link_index_file(root)
                .path_to_id
                .get("New.md")
                .map(String::as_str),
            Some(id.as_str())
        );
    }

    #[test]
    fn portable_metadata_migration_preserves_the_note_modification_time() {
        let notebook = TestNotebook::new();
        let root = &notebook.0;
        let path = root.join("Older.md");
        fs::write(&path, "An older Note.\n").unwrap();
        let original_modified_at = fs::metadata(&path).unwrap().modified().unwrap();

        let snapshot = read_notebook_snapshot(root).unwrap();

        assert!(snapshot.contents["Older.md"].contains("created_at:"));
        assert_eq!(
            fs::metadata(&path).unwrap().modified().unwrap(),
            original_modified_at
        );
        assert_eq!(
            snapshot.notes[0].updated_at,
            original_modified_at
                .duration_since(std::time::UNIX_EPOCH)
                .ok()
                .map(|duration| duration.as_secs())
        );
    }

    #[cfg(unix)]
    #[test]
    fn read_only_headerless_notes_remain_openable_without_migration() {
        use std::os::unix::fs::PermissionsExt;

        let notebook = TestNotebook::new();
        let root = &notebook.0;
        let path = root.join("Read Only.md");
        let body = "This Note can be read but not changed.\n";
        fs::write(&path, body).unwrap();
        fs::set_permissions(&path, fs::Permissions::from_mode(0o444)).unwrap();

        let snapshot = read_notebook_snapshot(root).unwrap();

        assert_eq!(snapshot.contents["Read Only.md"], body);
        assert_eq!(fs::read_to_string(&path).unwrap(), body);
    }

    #[test]
    fn failed_note_reads_never_replace_the_original_bytes() {
        let notebook = TestNotebook::new();
        let root = &notebook.0;
        let path = root.join("Binary.md");
        let original = b"valid prefix\xff\xfevalid suffix\n";
        fs::write(&path, original).unwrap();

        assert!(read_notebook_snapshot(root).is_err());
        assert_eq!(fs::read(&path).unwrap(), original);
        assert!(save_note(root, "Binary.md", "replacement").is_err());
        assert_eq!(fs::read(&path).unwrap(), original);
    }

    #[test]
    fn portable_metadata_preserves_unrelated_yaml_in_imported_notes() {
        let notebook = TestNotebook::new();
        let root = &notebook.0;
        let markdown = "---\nauthor:\n  id: external-author-id\nstatus: draft\n---\n\nBody\n";
        fs::write(root.join("Frontmatter.md"), markdown).unwrap();

        let snapshot = read_notebook_snapshot(root).unwrap();
        let migrated = &snapshot.contents["Frontmatter.md"];
        let tigrana_id = read_frontmatter_field(&split_frontmatter(migrated).0, "id").unwrap();

        assert!(migrated.contains("author:\n  id: external-author-id\nstatus: draft"));
        assert_ne!(tigrana_id, "external-author-id");
        assert!(migrated.ends_with("\nBody\n"));
        assert!(portable_created_at_from_content(migrated).is_some());
    }

    #[test]
    fn portable_creation_timestamp_follows_a_markdown_file_to_another_notebook() {
        let source = TestNotebook::new();
        let destination = TestNotebook::new();
        let created = create_note_with_content(&source.0, "", "Portable", "Body\n").unwrap();
        fs::copy(
            source.0.join(&created.path),
            destination.0.join("Portable.md"),
        )
        .unwrap();

        let copied = read_notebook_snapshot(&destination.0).unwrap();

        assert_eq!(copied.notes[0].created_at, created.created_at);
        assert!(copied.contents["Portable.md"].contains("created_at:"));
    }

    #[test]
    fn history_creation_recovery_covers_multiple_notes_from_one_index() {
        let notebook = TestNotebook::new();
        let root = &notebook.0;
        for (path, id) in [("First.md", "first-id"), ("Second.md", "second-id")] {
            let before = format!("---\nid: {id}\n---\n\nBefore\n");
            let after = format!("---\nid: {id}\n---\n\nAfter\n");
            fs::write(root.join(path), &before).unwrap();
            create_note_version_snapshot(
                root,
                path,
                &before,
                &after,
                "save",
                NoteSnapshotMode::Force,
            )
            .unwrap();
            fs::write(root.join(path), after).unwrap();
        }
        let history_path = root.join(".tigrana/history/notes/index.json");
        let mut history: serde_json::Value =
            serde_json::from_str(&fs::read_to_string(&history_path).unwrap()).unwrap();
        for entry in history["entries"].as_array_mut().unwrap() {
            let created_at = match entry["noteId"].as_str() {
                Some("first-id") => 1_600_000_000_000_u64,
                Some("second-id") => 1_500_000_000_000_u64,
                note_id => panic!("unexpected history Note id: {note_id:?}"),
            };
            entry["createdAt"] = serde_json::Value::from(created_at);
        }
        fs::write(&history_path, serde_json::to_vec_pretty(&history).unwrap()).unwrap();

        let listed = list_notes(root).unwrap();
        let recovered = listed
            .iter()
            .map(|note| (note.path.as_str(), note.created_at))
            .collect::<HashMap<_, _>>();

        assert_eq!(recovered["First.md"], Some(1_600_000_000));
        assert_eq!(recovered["Second.md"], Some(1_500_000_000));
    }
}
