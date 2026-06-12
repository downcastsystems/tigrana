use base64::{engine::general_purpose, Engine as _};
use fs2::FileExt;
mod link_index;
mod note_history;
mod notebook_paths;
use link_index::{
    ensure_note_id_in_content, forget_path_from_index, forget_subtree_from_index, link_index_path,
    move_index_path, parse_links_for_note, read_frontmatter_field, read_link_index_file,
    rebuild_index_for_root, reindex_note_after_save, repair_inbound_links, repair_subtree_paths,
    set_note_id_in_content, split_frontmatter, unique_note_relative, update_index_links_for_source,
    write_folder_sidecar, write_link_index_file, FolderRecord, FolderSidecar, LinkIndex,
    NoteRecord,
};
use note_history::{
    create_note_version_snapshot, list_note_versions as list_note_versions_for_note,
    note_history_reason, read_note_version as read_note_version_content,
    restore_note_version as restore_note_version_content, NoteSnapshotMode, NoteVersionEntry,
};
use notebook_paths::{
    app_dir, is_hidden_entry, metadata_path, normalize_relative, note_title_from_path,
    safe_note_path, safe_workspace, slugify, validate_note_title,
};
use notify::{Config, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::fs::{self, File, OpenOptions};
use std::hash::{Hash, Hasher};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Mutex;
use std::{collections::hash_map::DefaultHasher, process};
use tauri::menu::{AboutMetadataBuilder, Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::{AppHandle, Emitter, Manager, WebviewWindow, WindowEvent, Wry};
use tauri_plugin_dialog::DialogExt;
use time::macros::format_description;
use time::OffsetDateTime;
use uuid::Uuid;
use walkdir::WalkDir;

#[derive(Debug, Serialize)]
struct NoteEntry {
    path: String,
    title: String,
    parent_path: String,
    updated_at: Option<u64>,
}

#[derive(Debug, Serialize)]
struct FolderEntry {
    path: String,
    name: String,
    parent_path: String,
}

#[derive(Debug, Deserialize)]
struct SaveNotePayload {
    workspace: String,
    path: String,
    content: String,
}

#[derive(Debug, Deserialize)]
struct NoteEditLockPayload {
    workspace: String,
    path: String,
    window_label: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct NoteEditLockResult {
    acquired: bool,
    owner: Option<NoteEditLockOwner>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct NoteEditLockOwner {
    window_label: String,
    pid: u32,
    acquired_at: u64,
    workspace: String,
    path: String,
}

#[derive(Debug, Deserialize)]
struct CreateNotePayload {
    workspace: String,
    parent_path: String,
    title: String,
}

#[derive(Debug, Deserialize)]
struct DuplicateNotePayload {
    workspace: String,
    path: String,
}

#[derive(Debug, Deserialize)]
struct RenameNotePayload {
    workspace: String,
    path: String,
    title: String,
}

#[derive(Debug, Deserialize)]
struct FolderPayload {
    workspace: String,
    parent_path: String,
    name: String,
}

#[derive(Debug, Deserialize)]
struct RenameFolderPayload {
    workspace: String,
    path: String,
    name: String,
}

#[derive(Debug, Deserialize)]
struct MovePathPayload {
    workspace: String,
    path: String,
    target_parent_path: String,
}

#[derive(Debug, Deserialize)]
struct DeletePathPayload {
    workspace: String,
    path: String,
}

#[derive(Debug, Deserialize)]
struct TrashIdPayload {
    workspace: String,
    id: String,
}

#[derive(Debug, Deserialize)]
struct NoteVersionPayload {
    workspace: String,
    path: String,
    id: String,
}

#[derive(Debug, Deserialize)]
struct NoteVersionsPayload {
    workspace: String,
    path: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct EnsureIdentityPayload {
    workspace: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct TrashEntry {
    id: String,
    kind: String,
    original_path: String,
    display_name: String,
    trash_name: String,
    deleted_at: u64,
}

#[derive(Debug, Serialize, Deserialize, Default)]
struct TrashIndex {
    #[serde(default)]
    entries: Vec<TrashEntry>,
}

#[derive(Debug, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct AppPreferences {
    last_workspace: Option<String>,
}

#[derive(Debug, Deserialize)]
struct SaveAssetPayload {
    workspace: String,
    file_name: String,
    mime_type: Option<String>,
    bytes: Vec<u8>,
}

#[derive(Debug, Deserialize)]
struct RevealPathPayload {
    workspace: String,
    path: String,
    kind: String,
}

#[derive(Debug, Serialize, Clone)]
struct NoteChangedPayload {
    workspace: String,
    path: String,
}

#[derive(Default)]
struct WatchState {
    watchers: Mutex<HashMap<String, RecommendedWatcher>>,
}

#[derive(Debug, Clone)]
struct NotebookWindow {
    label: String,
    workspace: String,
    name: String,
}

#[derive(Default)]
struct NotebookWindowState {
    windows: Mutex<HashMap<String, NotebookWindow>>,
}

struct NoteEditLock {
    workspace: String,
    path: String,
    window_label: String,
    _file: File,
}

#[derive(Default)]
struct NoteEditLockState {
    locks: Mutex<HashMap<String, NoteEditLock>>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WorkspaceMetadata {
    #[serde(default)]
    folder_order: serde_json::Map<String, serde_json::Value>,
    #[serde(default)]
    note_order: serde_json::Map<String, serde_json::Value>,
    #[serde(default)]
    pinned_notes: serde_json::Map<String, serde_json::Value>,
    #[serde(default)]
    folder_icons: serde_json::Map<String, serde_json::Value>,
    #[serde(default)]
    folder_colors: serde_json::Map<String, serde_json::Value>,
    #[serde(default)]
    note_icons: serde_json::Map<String, serde_json::Value>,
    #[serde(default)]
    note_positions: serde_json::Map<String, serde_json::Value>,
    #[serde(default)]
    bookmarks: Vec<serde_json::Value>,
    #[serde(default = "default_true")]
    bookmarks_expanded: bool,
    #[serde(default)]
    expanded_folders: serde_json::Map<String, serde_json::Value>,
    #[serde(default)]
    welcome_note_added: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    appearance: Option<serde_json::Value>,
}

#[tauri::command]
fn list_notes(workspace: String) -> Result<Vec<NoteEntry>, String> {
    let root = safe_workspace(&workspace)?;
    let mut notes = Vec::new();

    for entry in WalkDir::new(&root)
        .into_iter()
        .filter_entry(|entry| !is_hidden_entry(entry.path()))
    {
        let entry = entry.map_err(|error| error.to_string())?;
        let path = entry.path();

        if !path.is_file() || path.extension().and_then(|ext| ext.to_str()) != Some("md") {
            continue;
        }

        let relative = path
            .strip_prefix(&root)
            .map_err(|error| error.to_string())?
            .to_string_lossy()
            .replace('\\', "/");
        let parent_path = Path::new(&relative)
            .parent()
            .map(|parent| parent.to_string_lossy().replace('\\', "/"))
            .unwrap_or_default();
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

#[tauri::command]
fn list_folders(workspace: String) -> Result<Vec<FolderEntry>, String> {
    let root = safe_workspace(&workspace)?;
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

    for entry in WalkDir::new(&root)
        .min_depth(1)
        .into_iter()
        .filter_entry(|entry| !is_hidden_entry(entry.path()))
    {
        let entry = entry.map_err(|error| error.to_string())?;
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }

        let relative = path
            .strip_prefix(&root)
            .map_err(|error| error.to_string())?
            .to_string_lossy()
            .replace('\\', "/");
        let parent_path = Path::new(&relative)
            .parent()
            .map(|parent| parent.to_string_lossy().replace('\\', "/"))
            .unwrap_or_default();
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

#[tauri::command]
fn read_note(workspace: String, path: String) -> Result<String, String> {
    let note_path = safe_note_path(&workspace, &path)?;
    fs::read_to_string(note_path).map_err(|error| error.to_string())
}

#[tauri::command]
fn save_note(payload: SaveNotePayload) -> Result<String, String> {
    let root = safe_workspace(&payload.workspace)?;
    let note_path = safe_note_path(&payload.workspace, &payload.path)?;
    if let Some(parent) = note_path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    // Make sure the note carries an id in its frontmatter.
    let (_id, content_with_id, _mutated) = ensure_note_id_in_content(&payload.content);
    if let Ok(existing) = fs::read_to_string(&note_path) {
        let reason = note_history_reason(&existing, &content_with_id);
        let _ = create_note_version_snapshot(
            &root,
            &payload.path,
            &existing,
            &content_with_id,
            &reason,
            NoteSnapshotMode::Throttled,
        );
    }
    fs::write(&note_path, &content_with_id).map_err(|error| error.to_string())?;
    let _ = reindex_note_after_save(&root, &payload.path);
    // Return what was actually written so the frontend can tell its own write
    // apart from genuine external changes (Rust may have normalized line
    // endings or added an id frontmatter).
    Ok(content_with_id)
}

#[tauri::command]
fn create_note(payload: CreateNotePayload) -> Result<NoteEntry, String> {
    let root = safe_workspace(&payload.workspace)?;
    validate_note_title(&payload.title)?;
    let file_name = payload.title.trim();
    let parent = normalize_relative(&payload.parent_path)?;
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

    // New notes are born with a stable id in their frontmatter.
    let new_id = Uuid::new_v4().to_string();
    let initial_content = format!("---\nid: {new_id}\n---\n\n");
    fs::write(&absolute, &initial_content).map_err(|error| error.to_string())?;

    let path = relative.to_string_lossy().replace('\\', "/");
    // Register the note in the link index.
    let mut index = read_link_index_file(&root);
    index.notes_by_id.insert(
        new_id.clone(),
        NoteRecord {
            id: new_id.clone(),
            path: path.clone(),
            title: note_title_from_path(&path),
        },
    );
    index.path_to_id.insert(path.clone(), new_id);
    let _ = write_link_index_file(&root, &index);

    Ok(NoteEntry {
        path: path.clone(),
        title: payload.title,
        parent_path: Path::new(&path)
            .parent()
            .map(|parent| parent.to_string_lossy().replace('\\', "/"))
            .unwrap_or_default(),
        updated_at: None,
    })
}

#[tauri::command]
fn duplicate_note(payload: DuplicateNotePayload) -> Result<NoteEntry, String> {
    let root = safe_workspace(&payload.workspace)?;
    let source_relative = normalize_relative(&payload.path)?;
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
    let new_relative = unique_note_relative(&root, &parent, &copy_stem);
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
    let mut index = read_link_index_file(&root);
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
    let _ = write_link_index_file(&root, &index);

    Ok(NoteEntry {
        path: path.clone(),
        title,
        parent_path: Path::new(&path)
            .parent()
            .map(|parent| parent.to_string_lossy().replace('\\', "/"))
            .unwrap_or_default(),
        updated_at: None,
    })
}

#[tauri::command]
fn rename_note(payload: RenameNotePayload) -> Result<NoteEntry, String> {
    validate_note_title(&payload.title)?;
    let root = safe_workspace(&payload.workspace)?;
    let old_path = safe_note_path(&payload.workspace, &payload.path)?;
    let parent = Path::new(&payload.path)
        .parent()
        .map(PathBuf::from)
        .unwrap_or_default();
    let new_relative = if parent.as_os_str().is_empty() {
        PathBuf::from(format!("{}.md", payload.title.trim()))
    } else {
        parent.join(format!("{}.md", payload.title.trim()))
    };
    let new_path = root.join(&new_relative);

    let new_rel_str = new_relative.to_string_lossy().replace('\\', "/");
    let old_rel_str = payload.path.clone();

    if old_path != new_path {
        if new_path.exists() {
            return Err("A note with that title already exists in this folder.".to_string());
        }
        fs::rename(&old_path, &new_path).map_err(|error| error.to_string())?;

        // Repair inbound links and update the index.
        let mut index = read_link_index_file(&root);
        if let Some(id) = index.path_to_id.get(&old_rel_str).cloned() {
            move_index_path(&mut index, &old_rel_str, &new_rel_str, &id, "note");
            let _ = repair_inbound_links(&root, &mut index, &id, &old_rel_str, &new_rel_str);
            let _ = write_link_index_file(&root, &index);
        }
    }

    let path = new_rel_str;
    Ok(NoteEntry {
        path: path.clone(),
        title: payload.title.trim().to_string(),
        parent_path: Path::new(&path)
            .parent()
            .map(|parent| parent.to_string_lossy().replace('\\', "/"))
            .unwrap_or_default(),
        updated_at: None,
    })
}

#[tauri::command]
fn create_folder(payload: FolderPayload) -> Result<FolderEntry, String> {
    validate_note_title(&payload.name)?;
    let root = safe_workspace(&payload.workspace)?;
    let parent = normalize_relative(&payload.parent_path)?;
    let relative = if parent.as_os_str().is_empty() {
        PathBuf::from(payload.name.trim())
    } else {
        parent.join(payload.name.trim())
    };
    let absolute = root.join(&relative);
    if absolute.exists() {
        return Err("A folder with that name already exists here.".to_string());
    }
    fs::create_dir_all(&absolute).map_err(|error| error.to_string())?;
    let path = relative.to_string_lossy().replace('\\', "/");

    // Mint folder id, write sidecar, register in index.
    let folder_id = Uuid::new_v4().to_string();
    let _ = write_folder_sidecar(
        &root,
        &path,
        &FolderSidecar {
            id: folder_id.clone(),
        },
    );
    let mut index = read_link_index_file(&root);
    index.folders_by_id.insert(
        folder_id.clone(),
        FolderRecord {
            id: folder_id.clone(),
            path: path.clone(),
        },
    );
    index.path_to_id.insert(path.clone(), folder_id);
    let _ = write_link_index_file(&root, &index);

    Ok(FolderEntry {
        path: path.clone(),
        name: payload.name.trim().to_string(),
        parent_path: Path::new(&path)
            .parent()
            .map(|parent| parent.to_string_lossy().replace('\\', "/"))
            .unwrap_or_default(),
    })
}

#[tauri::command]
fn rename_folder(payload: RenameFolderPayload) -> Result<FolderEntry, String> {
    validate_note_title(&payload.name)?;
    let root = safe_workspace(&payload.workspace)?;
    let old_relative = normalize_relative(&payload.path)?;
    if old_relative.as_os_str().is_empty() {
        return Err("The notebook root cannot be renamed.".to_string());
    }

    let parent = Path::new(&payload.path)
        .parent()
        .map(PathBuf::from)
        .unwrap_or_default();
    let new_relative = if parent.as_os_str().is_empty() {
        PathBuf::from(payload.name.trim())
    } else {
        parent.join(payload.name.trim())
    };
    let old_path = root.join(&old_relative);
    let new_path = root.join(&new_relative);

    let old_rel_str = payload.path.clone();
    let new_rel_str = new_relative.to_string_lossy().replace('\\', "/");

    if old_path != new_path {
        if new_path.exists() {
            return Err("A folder with that name already exists here.".to_string());
        }
        fs::rename(&old_path, &new_path).map_err(|error| error.to_string())?;

        // Folder rename moves every contained note and subfolder transitively.
        let mut index = read_link_index_file(&root);
        repair_subtree_paths(&root, &mut index, &old_rel_str, &new_rel_str)?;
        let _ = write_link_index_file(&root, &index);
    }

    let path = new_rel_str;
    Ok(FolderEntry {
        path: path.clone(),
        name: payload.name.trim().to_string(),
        parent_path: Path::new(&path)
            .parent()
            .map(|parent| parent.to_string_lossy().replace('\\', "/"))
            .unwrap_or_default(),
    })
}

#[tauri::command]
fn move_note(payload: MovePathPayload) -> Result<NoteEntry, String> {
    let root = safe_workspace(&payload.workspace)?;
    let old_relative = normalize_relative(&payload.path)?;
    let target_parent = normalize_relative(&payload.target_parent_path)?;
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
            unique_note_relative(&root, &target_parent, stem)
        } else {
            initial_new_relative
        }
    };
    let new_path = root.join(&new_relative);

    let old_rel_str = payload.path.clone();
    let new_rel_str = new_relative.to_string_lossy().replace('\\', "/");

    if old_path != new_path {
        if let Some(parent) = new_path.parent() {
            fs::create_dir_all(parent).map_err(|error| error.to_string())?;
        }
        fs::rename(&old_path, &new_path).map_err(|error| error.to_string())?;

        let mut index = read_link_index_file(&root);
        if let Some(id) = index.path_to_id.get(&old_rel_str).cloned() {
            move_index_path(&mut index, &old_rel_str, &new_rel_str, &id, "note");
            let _ = repair_inbound_links(&root, &mut index, &id, &old_rel_str, &new_rel_str);
            let _ = write_link_index_file(&root, &index);
        }
    }

    let path = new_rel_str;
    let title = Path::new(&path)
        .file_stem()
        .and_then(|name| name.to_str())
        .unwrap_or("Untitled")
        .to_string();
    Ok(NoteEntry {
        path: path.clone(),
        title,
        parent_path: Path::new(&path)
            .parent()
            .map(|parent| parent.to_string_lossy().replace('\\', "/"))
            .unwrap_or_default(),
        updated_at: None,
    })
}

#[tauri::command]
fn move_folder(payload: MovePathPayload) -> Result<FolderEntry, String> {
    let root = safe_workspace(&payload.workspace)?;
    let old_relative = normalize_relative(&payload.path)?;
    let target_parent = normalize_relative(&payload.target_parent_path)?;
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

    let old_rel_str = payload.path.clone();
    let new_rel_str = new_relative.to_string_lossy().replace('\\', "/");

    if old_path != new_path {
        if new_path.exists() {
            return Err("A folder with that name already exists in the target folder.".to_string());
        }
        if let Some(parent) = new_path.parent() {
            fs::create_dir_all(parent).map_err(|error| error.to_string())?;
        }
        fs::rename(&old_path, &new_path).map_err(|error| error.to_string())?;

        let mut index = read_link_index_file(&root);
        repair_subtree_paths(&root, &mut index, &old_rel_str, &new_rel_str)?;
        let _ = write_link_index_file(&root, &index);
    }

    let path = new_rel_str;
    Ok(FolderEntry {
        path: path.clone(),
        name: name.to_string_lossy().to_string(),
        parent_path: Path::new(&path)
            .parent()
            .map(|parent| parent.to_string_lossy().replace('\\', "/"))
            .unwrap_or_default(),
    })
}

#[tauri::command]
fn delete_note(payload: DeletePathPayload) -> Result<(), String> {
    let root = safe_workspace(&payload.workspace)?;
    let path = safe_note_path(&payload.workspace, &payload.path)?;
    if path.exists() {
        fs::remove_file(path).map_err(|error| error.to_string())?;
    }
    let mut index = read_link_index_file(&root);
    forget_path_from_index(&mut index, &payload.path);
    let _ = write_link_index_file(&root, &index);
    Ok(())
}

#[tauri::command]
fn delete_folder(payload: DeletePathPayload) -> Result<(), String> {
    let root = safe_workspace(&payload.workspace)?;
    let relative = normalize_relative(&payload.path)?;
    if relative.as_os_str().is_empty() {
        return Err("The notebook root cannot be deleted.".to_string());
    }
    let path = root.join(relative);
    if path.exists() {
        fs::remove_dir_all(path).map_err(|error| error.to_string())?;
    }
    let mut index = read_link_index_file(&root);
    forget_subtree_from_index(&mut index, &payload.path);
    let _ = write_link_index_file(&root, &index);
    Ok(())
}

// ---------- Identity + link index ----------
#[tauri::command]
fn ensure_workspace_identity(payload: EnsureIdentityPayload) -> Result<(), String> {
    let root = safe_workspace(&payload.workspace)?;
    fs::create_dir_all(app_dir(&root)).map_err(|error| error.to_string())?;
    let _ = rebuild_index_for_root(&root)?;
    Ok(())
}

#[tauri::command]
fn read_link_index(workspace: String) -> Result<LinkIndex, String> {
    let root = safe_workspace(&workspace)?;
    let path = link_index_path(&root);
    if !path.exists() {
        return rebuild_index_for_root(&root);
    }
    Ok(read_link_index_file(&root))
}

#[tauri::command]
fn rebuild_link_index(workspace: String) -> Result<LinkIndex, String> {
    let root = safe_workspace(&workspace)?;
    rebuild_index_for_root(&root)
}

// ---------- Note Version History ----------

#[tauri::command]
fn list_note_versions(payload: NoteVersionsPayload) -> Result<Vec<NoteVersionEntry>, String> {
    let root = safe_workspace(&payload.workspace)?;
    let note_path = safe_note_path(&payload.workspace, &payload.path)?;
    list_note_versions_for_note(&root, &payload.path, &note_path)
}

#[tauri::command]
fn read_note_version(payload: NoteVersionPayload) -> Result<String, String> {
    let root = safe_workspace(&payload.workspace)?;
    read_note_version_content(&root, &payload.id)
}

#[tauri::command]
fn restore_note_version(payload: NoteVersionPayload) -> Result<String, String> {
    let root = safe_workspace(&payload.workspace)?;
    let note_path = safe_note_path(&payload.workspace, &payload.path)?;
    restore_note_version_content(&root, &payload.path, &note_path, &payload.id)
}

// ---------- Recently Deleted (trash) ----------

const TRASH_RETENTION_DAYS: u64 = 30;

fn trash_root(workspace: &Path) -> PathBuf {
    app_dir(workspace).join("trash")
}

fn trash_items_dir(workspace: &Path) -> PathBuf {
    trash_root(workspace).join("items")
}

fn trash_index_path(workspace: &Path) -> PathBuf {
    trash_root(workspace).join("index.json")
}

fn read_trash_index(workspace: &Path) -> Result<TrashIndex, String> {
    let path = trash_index_path(workspace);
    if !path.exists() {
        return Ok(TrashIndex::default());
    }
    let bytes = fs::read(&path).map_err(|error| error.to_string())?;
    if bytes.is_empty() {
        return Ok(TrashIndex::default());
    }
    serde_json::from_slice::<TrashIndex>(&bytes).map_err(|error| error.to_string())
}

fn write_trash_index(workspace: &Path, index: &TrashIndex) -> Result<(), String> {
    let root = trash_root(workspace);
    fs::create_dir_all(&root).map_err(|error| error.to_string())?;
    let json = serde_json::to_vec_pretty(index).map_err(|error| error.to_string())?;
    fs::write(trash_index_path(workspace), json).map_err(|error| error.to_string())
}

fn now_millis() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn date_suffix_from_millis(millis: u64) -> String {
    let secs = (millis / 1000) as i64;
    let datetime = OffsetDateTime::from_unix_timestamp(secs).unwrap_or(OffsetDateTime::UNIX_EPOCH);
    let fmt = format_description!("[year]-[month]-[day]");
    datetime
        .format(&fmt)
        .unwrap_or_else(|_| "unknown-date".to_string())
}

fn generate_trash_id() -> String {
    let now = now_millis();
    let mut state: u64 = now;
    state ^= state << 13;
    state ^= state >> 7;
    state ^= state << 17;
    format!("{}-{:08x}", now, (state & 0xffff_ffff) as u32)
}

fn split_basename(name: &str) -> (String, String) {
    if let Some(idx) = name.rfind('.') {
        if idx > 0 {
            return (name[..idx].to_string(), name[idx..].to_string());
        }
    }
    (name.to_string(), String::new())
}

fn unique_name_in_dir(dir: &Path, desired: &str, date_label: &str) -> String {
    let target = dir.join(desired);
    if !target.exists() {
        return desired.to_string();
    }
    let (stem, ext) = split_basename(desired);
    let with_date = format!("{stem} (deleted {date_label}){ext}");
    if !dir.join(&with_date).exists() {
        return with_date;
    }
    let mut counter = 2u32;
    loop {
        let candidate = format!("{stem} (deleted {date_label} {counter}){ext}");
        if !dir.join(&candidate).exists() {
            return candidate;
        }
        counter += 1;
        if counter > 9999 {
            return format!("{stem} (deleted {date_label} {}){ext}", generate_trash_id());
        }
    }
}

fn trash_item(workspace: &str, relative_path: &str, kind: &str) -> Result<TrashEntry, String> {
    let root = safe_workspace(workspace)?;
    let relative = normalize_relative(relative_path)?;
    if relative.as_os_str().is_empty() {
        return Err("The notebook root cannot be deleted.".to_string());
    }
    let source = root.join(&relative);
    if !source.exists() {
        return Err("That item no longer exists.".to_string());
    }

    let items_dir = trash_items_dir(&root);
    fs::create_dir_all(&items_dir).map_err(|error| error.to_string())?;

    let display_name = relative
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("item")
        .to_string();
    let deleted_at = now_millis();
    let date_label = date_suffix_from_millis(deleted_at);
    let trash_name = unique_name_in_dir(&items_dir, &display_name, &date_label);
    let target = items_dir.join(&trash_name);
    fs::rename(&source, &target).map_err(|error| error.to_string())?;

    let entry = TrashEntry {
        id: generate_trash_id(),
        kind: kind.to_string(),
        original_path: relative_path.to_string(),
        display_name,
        trash_name,
        deleted_at,
    };

    let mut index = read_trash_index(&root).unwrap_or_default();
    index.entries.push(entry.clone());
    write_trash_index(&root, &index)?;
    Ok(entry)
}

#[tauri::command]
fn trash_note(payload: DeletePathPayload) -> Result<TrashEntry, String> {
    trash_item(&payload.workspace, &payload.path, "note")
}

#[tauri::command]
fn trash_folder(payload: DeletePathPayload) -> Result<TrashEntry, String> {
    trash_item(&payload.workspace, &payload.path, "folder")
}

#[tauri::command]
fn list_trash(workspace: String) -> Result<Vec<TrashEntry>, String> {
    let root = safe_workspace(&workspace)?;
    let index = read_trash_index(&root).unwrap_or_default();
    Ok(index.entries)
}

#[tauri::command]
fn restore_trash(payload: TrashIdPayload) -> Result<String, String> {
    let root = safe_workspace(&payload.workspace)?;
    let mut index = read_trash_index(&root).unwrap_or_default();
    let pos = index
        .entries
        .iter()
        .position(|entry| entry.id == payload.id)
        .ok_or_else(|| "Trash entry not found.".to_string())?;
    let entry = index.entries[pos].clone();

    let items_dir = trash_items_dir(&root);
    let source = items_dir.join(&entry.trash_name);
    if !source.exists() {
        index.entries.remove(pos);
        write_trash_index(&root, &index)?;
        return Err("That deleted item is missing from the trash.".to_string());
    }

    let original_rel = normalize_relative(&entry.original_path)?;
    let parent_rel = original_rel.parent().map(PathBuf::from).unwrap_or_default();
    let parent_abs = root.join(&parent_rel);
    if !parent_abs.starts_with(&root) {
        return Err("Restore target escapes the notebook.".to_string());
    }
    fs::create_dir_all(&parent_abs).map_err(|error| error.to_string())?;

    let desired_name = original_rel
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or(&entry.display_name)
        .to_string();
    let date_label = date_suffix_from_millis(entry.deleted_at);
    let final_name = unique_name_in_dir(&parent_abs, &desired_name, &date_label);
    let target = parent_abs.join(&final_name);
    fs::rename(&source, &target).map_err(|error| error.to_string())?;

    index.entries.remove(pos);
    write_trash_index(&root, &index)?;

    let restored = target
        .strip_prefix(&root)
        .map(|p| p.to_string_lossy().replace('\\', "/"))
        .unwrap_or_else(|_| entry.original_path.clone());
    Ok(restored)
}

#[tauri::command]
fn purge_trash(payload: TrashIdPayload) -> Result<(), String> {
    let root = safe_workspace(&payload.workspace)?;
    let mut index = read_trash_index(&root).unwrap_or_default();
    let pos = index
        .entries
        .iter()
        .position(|entry| entry.id == payload.id)
        .ok_or_else(|| "Trash entry not found.".to_string())?;
    let entry = index.entries.remove(pos);

    let target = trash_items_dir(&root).join(&entry.trash_name);
    if target.exists() {
        if target.is_dir() {
            fs::remove_dir_all(&target).map_err(|error| error.to_string())?;
        } else {
            fs::remove_file(&target).map_err(|error| error.to_string())?;
        }
    }
    write_trash_index(&root, &index)?;
    Ok(())
}

#[tauri::command]
fn purge_trash_all(workspace: String) -> Result<(), String> {
    let root = safe_workspace(&workspace)?;
    let items_dir = trash_items_dir(&root);
    if items_dir.exists() {
        fs::remove_dir_all(&items_dir).map_err(|error| error.to_string())?;
    }
    write_trash_index(&root, &TrashIndex::default())?;
    Ok(())
}

#[tauri::command]
fn cleanup_trash(workspace: String) -> Result<u32, String> {
    let root = safe_workspace(&workspace)?;
    let mut index = read_trash_index(&root).unwrap_or_default();
    let cutoff_millis = now_millis().saturating_sub(TRASH_RETENTION_DAYS * 24 * 60 * 60 * 1000);
    let items_dir = trash_items_dir(&root);

    let mut purged: u32 = 0;
    index.entries.retain(|entry| {
        if entry.deleted_at < cutoff_millis {
            let target = items_dir.join(&entry.trash_name);
            if target.exists() {
                let _ = if target.is_dir() {
                    fs::remove_dir_all(&target)
                } else {
                    fs::remove_file(&target)
                };
            }
            purged += 1;
            false
        } else {
            true
        }
    });
    write_trash_index(&root, &index)?;
    Ok(purged)
}

#[tauri::command]
fn save_asset(payload: SaveAssetPayload) -> Result<String, String> {
    let root = safe_workspace(&payload.workspace)?;
    let assets_dir = root.join(".assets");
    fs::create_dir_all(&assets_dir).map_err(|error| error.to_string())?;

    if should_convert_tiff_asset(&payload.file_name, payload.mime_type.as_deref()) {
        return save_tiff_asset_as_png(&root, &assets_dir, &payload);
    }

    let clean_name = unique_asset_name(
        &assets_dir,
        &payload.file_name,
        payload.mime_type.as_deref(),
    );
    let path = assets_dir.join(clean_name);
    fs::write(&path, payload.bytes).map_err(|error| error.to_string())?;
    relative_asset_path(&root, &path)
}

#[tauri::command]
fn save_clipboard_image_asset(workspace: String) -> Result<String, String> {
    let root = safe_workspace(&workspace)?;
    let assets_dir = root.join(".assets");
    fs::create_dir_all(&assets_dir).map_err(|error| error.to_string())?;

    save_macos_clipboard_png(&root, &assets_dir)
        .or_else(|_| save_macos_clipboard_tiff(&root, &assets_dir))
}

#[tauri::command]
fn read_asset_data_url(workspace: String, path: String) -> Result<String, String> {
    let root = safe_workspace(&workspace)?;
    let relative = normalize_relative(&path)?;
    let asset_path = root.join(relative);
    if !asset_path.starts_with(&root) {
        return Err("Path escapes workspace.".to_string());
    }
    if !asset_path.exists() {
        return Err("Asset does not exist.".to_string());
    }
    let bytes = fs::read(&asset_path).map_err(|error| error.to_string())?;
    let mime = mime_type_for_asset(&asset_path);
    Ok(format!(
        "data:{mime};base64,{}",
        general_purpose::STANDARD.encode(bytes)
    ))
}

#[tauri::command]
fn open_external(url: String) -> Result<(), String> {
    if url.is_empty() {
        return Err("URL is empty.".to_string());
    }
    let lower = url.to_lowercase();
    let allowed = [
        "http://", "https://", "mailto:", "tel:", "ftp://", "ftps://",
    ];
    if !allowed.iter().any(|prefix| lower.starts_with(prefix)) {
        return Err("Unsupported URL scheme.".to_string());
    }

    #[cfg(target_os = "macos")]
    let mut command = Command::new("open");
    #[cfg(target_os = "windows")]
    let mut command = {
        let mut c = Command::new("cmd");
        c.args(["/C", "start", ""]);
        c
    };
    #[cfg(target_os = "linux")]
    let mut command = Command::new("xdg-open");

    command
        .arg(&url)
        .status()
        .map_err(|error| error.to_string())
        .and_then(|status| {
            if status.success() {
                Ok(())
            } else {
                Err("The system could not open that URL.".to_string())
            }
        })
}

#[tauri::command]
fn reveal_path(payload: RevealPathPayload) -> Result<(), String> {
    let root = safe_workspace(&payload.workspace)?;
    let target = match payload.kind.as_str() {
        "note" => safe_note_path(&payload.workspace, &payload.path)?,
        "folder" => {
            let relative = normalize_relative(&payload.path)?;
            let folder_path = root.join(relative);
            if !folder_path.starts_with(&root) {
                return Err("Path escapes workspace.".to_string());
            }
            folder_path
        }
        _ => return Err("Unsupported reveal target.".to_string()),
    };

    if !target.exists() {
        return Err("That file or folder no longer exists.".to_string());
    }

    reveal_in_file_manager(&target)
}

#[tauri::command]
fn ensure_workspace(workspace: String) -> Result<(), String> {
    let root = safe_workspace(&workspace)?;
    fs::create_dir_all(app_dir(&root)).map_err(|error| error.to_string())
}

#[tauri::command]
fn watch_workspace(
    app: AppHandle,
    state: tauri::State<WatchState>,
    workspace: String,
) -> Result<(), String> {
    let root = safe_workspace(&workspace)?;
    fs::create_dir_all(&root).map_err(|error| error.to_string())?;

    let mut watchers = state.watchers.lock().map_err(|error| error.to_string())?;
    if watchers.contains_key(&workspace) {
        return Ok(());
    }

    let watch_root = root.clone();
    let event_workspace = workspace.clone();
    let event_app = app.clone();
    let mut watcher = RecommendedWatcher::new(
        move |result: notify::Result<notify::Event>| {
            let Ok(event) = result else {
                return;
            };
            if !matches!(
                event.kind,
                EventKind::Create(_) | EventKind::Modify(_) | EventKind::Remove(_)
            ) {
                return;
            }
            for path in event.paths {
                if path.extension().and_then(|ext| ext.to_str()) != Some("md") {
                    continue;
                }
                if is_hidden_entry(&path) {
                    continue;
                }
                let Ok(relative) = path.strip_prefix(&watch_root) else {
                    continue;
                };
                let payload = NoteChangedPayload {
                    workspace: event_workspace.clone(),
                    path: relative.to_string_lossy().replace('\\', "/"),
                };
                let _ = event_app.emit("note-changed", payload);
            }
        },
        Config::default(),
    )
    .map_err(|error| error.to_string())?;

    watcher
        .watch(&root, RecursiveMode::Recursive)
        .map_err(|error| error.to_string())?;
    watchers.insert(workspace, watcher);
    Ok(())
}

#[tauri::command]
fn read_workspace_metadata(workspace: String) -> Result<WorkspaceMetadata, String> {
    let root = safe_workspace(&workspace)?;
    let path = metadata_path(&root);
    if !path.exists() {
        return Ok(default_workspace_metadata());
    }

    let contents = fs::read_to_string(path).map_err(|error| error.to_string())?;
    serde_json::from_str(&contents).map_err(|error| error.to_string())
}

#[tauri::command]
fn write_workspace_metadata(workspace: String, metadata: WorkspaceMetadata) -> Result<(), String> {
    let root = safe_workspace(&workspace)?;
    let app_metadata_dir = app_dir(&root);
    fs::create_dir_all(&app_metadata_dir).map_err(|error| error.to_string())?;
    let contents = serde_json::to_string_pretty(&metadata).map_err(|error| error.to_string())?;
    fs::write(
        app_metadata_dir.join("metadata.json"),
        format!("{contents}\n"),
    )
    .map_err(|error| error.to_string())
}

fn app_preferences_path(app: &AppHandle) -> Result<PathBuf, String> {
    let config_dir = app
        .path()
        .app_config_dir()
        .map_err(|error| error.to_string())?;
    Ok(config_dir.join("preferences.json"))
}

#[tauri::command]
fn read_app_preferences(app: AppHandle) -> Result<AppPreferences, String> {
    let path = app_preferences_path(&app)?;
    if !path.exists() {
        return Ok(AppPreferences::default());
    }

    let contents = fs::read_to_string(path).map_err(|error| error.to_string())?;
    serde_json::from_str(&contents).map_err(|error| error.to_string())
}

#[tauri::command]
fn write_app_preferences(app: AppHandle, preferences: AppPreferences) -> Result<(), String> {
    let path = app_preferences_path(&app)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    let contents = serde_json::to_string_pretty(&preferences).map_err(|error| error.to_string())?;
    fs::write(path, format!("{contents}\n")).map_err(|error| error.to_string())
}

#[tauri::command]
fn register_notebook_window(
    app: AppHandle,
    state: tauri::State<NotebookWindowState>,
    label: String,
    workspace: String,
) -> Result<(), String> {
    let name = Path::new(&workspace)
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("Notebook")
        .to_string();
    {
        let mut windows = state.windows.lock().map_err(|error| error.to_string())?;
        windows.insert(
            label.clone(),
            NotebookWindow {
                label,
                workspace,
                name,
            },
        );
    }
    rebuild_app_menu(&app, &state)
}

#[tauri::command]
fn unregister_notebook_window(
    app: AppHandle,
    state: tauri::State<NotebookWindowState>,
    label: String,
) -> Result<(), String> {
    {
        let mut windows = state.windows.lock().map_err(|error| error.to_string())?;
        windows.remove(&label);
    }
    rebuild_app_menu(&app, &state)
}

#[tauri::command]
fn focus_notebook_window(
    app: AppHandle,
    state: tauri::State<NotebookWindowState>,
    workspace: String,
) -> Result<bool, String> {
    let label = {
        let windows = state.windows.lock().map_err(|error| error.to_string())?;
        windows
            .values()
            .find(|window| window.workspace == workspace)
            .map(|window| window.label.clone())
    };

    let Some(label) = label else {
        return Ok(false);
    };

    let Some(win) = app.get_webview_window(&label) else {
        return Ok(false);
    };

    win.show().map_err(|error| error.to_string())?;
    win.set_focus().map_err(|error| error.to_string())?;
    Ok(true)
}

#[tauri::command]
fn acquire_note_edit_lock(
    state: tauri::State<NoteEditLockState>,
    payload: NoteEditLockPayload,
) -> Result<NoteEditLockResult, String> {
    let root = safe_workspace(&payload.workspace)?;
    let note_path = safe_note_path(&payload.workspace, &payload.path)?;
    let lock_key = note_edit_lock_key(&root, &payload.path, &note_path);
    let lock_id = note_edit_lock_id(&payload.workspace, &lock_key);

    {
        let mut locks = state.locks.lock().map_err(|error| error.to_string())?;
        if let Some(existing) = locks.get(&lock_id) {
            if existing.window_label == payload.window_label {
                return Ok(NoteEditLockResult {
                    acquired: true,
                    owner: None,
                });
            }
            return Ok(NoteEditLockResult {
                acquired: false,
                owner: Some(NoteEditLockOwner {
                    window_label: existing.window_label.clone(),
                    pid: process::id(),
                    acquired_at: 0,
                    workspace: existing.workspace.clone(),
                    path: existing.path.clone(),
                }),
            });
        }

        locks.retain(|id, lock| lock.window_label != payload.window_label || id == &lock_id);
    }

    let lock_path = note_edit_lock_path(&root, &lock_key)?;
    if let Some(parent) = lock_path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    let mut file = OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .open(&lock_path)
        .map_err(|error| error.to_string())?;

    if file.try_lock_exclusive().is_err() {
        let owner = read_note_edit_lock_owner(&lock_path);
        return Ok(NoteEditLockResult {
            acquired: false,
            owner,
        });
    }

    let owner = NoteEditLockOwner {
        window_label: payload.window_label.clone(),
        pid: process::id(),
        acquired_at: OffsetDateTime::now_utc().unix_timestamp().max(0) as u64,
        workspace: payload.workspace.clone(),
        path: payload.path.clone(),
    };
    let metadata = serde_json::to_string_pretty(&owner).map_err(|error| error.to_string())?;
    file.set_len(0).map_err(|error| error.to_string())?;
    file.write_all(format!("{metadata}\n").as_bytes())
        .map_err(|error| error.to_string())?;

    let mut locks = state.locks.lock().map_err(|error| error.to_string())?;
    locks.insert(
        lock_id,
        NoteEditLock {
            workspace: payload.workspace,
            path: payload.path,
            window_label: payload.window_label,
            _file: file,
        },
    );

    Ok(NoteEditLockResult {
        acquired: true,
        owner: None,
    })
}

#[tauri::command]
fn release_note_edit_lock(
    state: tauri::State<NoteEditLockState>,
    payload: NoteEditLockPayload,
) -> Result<(), String> {
    let root = safe_workspace(&payload.workspace)?;
    let note_path = safe_note_path(&payload.workspace, &payload.path)?;
    let lock_key = note_edit_lock_key(&root, &payload.path, &note_path);
    let lock_id = note_edit_lock_id(&payload.workspace, &lock_key);

    let mut locks = state.locks.lock().map_err(|error| error.to_string())?;
    if locks
        .get(&lock_id)
        .is_some_and(|lock| lock.window_label == payload.window_label)
    {
        locks.remove(&lock_id);
    }
    Ok(())
}

fn release_note_edit_locks_for_window(state: &NoteEditLockState, window_label: &str) {
    if let Ok(mut locks) = state.locks.lock() {
        locks.retain(|_, lock| lock.window_label != window_label);
    }
}

fn note_edit_lock_id(workspace: &str, lock_key: &str) -> String {
    format!("{workspace}\0{lock_key}")
}

fn note_edit_lock_key(root: &Path, rel: &str, note_path: &Path) -> String {
    let index = read_link_index_file(root);
    if let Some(id) = index.path_to_id.get(rel) {
        return format!("note-{}", sanitize_lock_key(id));
    }

    if let Ok(content) = fs::read_to_string(note_path) {
        let (frontmatter, _, has_frontmatter) = split_frontmatter(&content);
        if has_frontmatter {
            if let Some(id) = read_frontmatter_field(&frontmatter, "id") {
                return format!("note-{}", sanitize_lock_key(&id));
            }
        }
    }

    let mut hasher = DefaultHasher::new();
    rel.hash(&mut hasher);
    format!("path-{:x}", hasher.finish())
}

fn note_edit_lock_path(root: &Path, lock_key: &str) -> Result<PathBuf, String> {
    Ok(app_dir(root)
        .join("locks")
        .join("notes")
        .join(format!("{lock_key}.lock")))
}

fn sanitize_lock_key(value: &str) -> String {
    value
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' {
                ch
            } else {
                '_'
            }
        })
        .collect()
}

fn read_note_edit_lock_owner(path: &Path) -> Option<NoteEditLockOwner> {
    fs::read_to_string(path)
        .ok()
        .and_then(|content| serde_json::from_str::<NoteEditLockOwner>(&content).ok())
}

fn default_workspace_metadata() -> WorkspaceMetadata {
    WorkspaceMetadata {
        folder_order: serde_json::Map::new(),
        note_order: serde_json::Map::new(),
        pinned_notes: serde_json::Map::new(),
        folder_icons: serde_json::Map::new(),
        folder_colors: serde_json::Map::new(),
        note_icons: serde_json::Map::new(),
        note_positions: serde_json::Map::new(),
        bookmarks: Vec::new(),
        bookmarks_expanded: true,
        expanded_folders: serde_json::Map::new(),
        welcome_note_added: false,
        appearance: None,
    }
}

fn default_true() -> bool {
    true
}

fn unique_asset_name(assets_dir: &Path, file_name: &str, mime_type: Option<&str>) -> String {
    let original = Path::new(file_name);
    let extension = original
        .extension()
        .and_then(|ext| ext.to_str())
        .filter(|ext| !ext.is_empty())
        .map(|ext| ext.to_string())
        .or_else(|| asset_extension_for_mime(mime_type))
        .unwrap_or_else(|| "png".to_string());
    let stem = original
        .file_stem()
        .and_then(|stem| stem.to_str())
        .map(slugify)
        .unwrap_or_else(|| "pasted-image".to_string());
    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or(0);
    let mut candidate = format!("{stem}-{timestamp}.{extension}");
    let mut index = 2;
    while assets_dir.join(&candidate).exists() {
        candidate = format!("{stem}-{timestamp}-{index}.{extension}");
        index += 1;
    }
    candidate
}

fn should_convert_tiff_asset(file_name: &str, mime_type: Option<&str>) -> bool {
    let has_tiff_mime = matches!(mime_type.unwrap_or_default(), "image/tiff" | "image/tif");
    let has_tiff_extension = Path::new(file_name)
        .extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| matches!(ext.to_ascii_lowercase().as_str(), "tif" | "tiff"))
        .unwrap_or(false);
    cfg!(target_os = "macos") && (has_tiff_mime || has_tiff_extension)
}

fn save_tiff_asset_as_png(
    root: &Path,
    assets_dir: &Path,
    payload: &SaveAssetPayload,
) -> Result<String, String> {
    let temp_name = unique_asset_name(assets_dir, &payload.file_name, payload.mime_type.as_deref());
    let temp_path = assets_dir.join(temp_name);
    fs::write(&temp_path, &payload.bytes).map_err(|error| error.to_string())?;

    convert_tiff_file_to_png(root, assets_dir, &temp_path)
}

fn save_macos_clipboard_png(root: &Path, assets_dir: &Path) -> Result<String, String> {
    let png_name = unique_asset_name(assets_dir, "pasted-image.png", Some("image/png"));
    let png_path = assets_dir.join(png_name);
    let script = r#"on run argv
  set outputPath to item 1 of argv
  set imageData to the clipboard as «class PNGf»
  set fileRef to open for access (POSIX file outputPath) with write permission
  set eof fileRef to 0
  write imageData to fileRef
  close access fileRef
end run"#;
    let output = Command::new("osascript")
        .arg("-e")
        .arg(script)
        .arg(&png_path)
        .output()
        .map_err(|error| error.to_string())?;

    if !output.status.success() || !png_path.exists() {
        let _ = fs::remove_file(&png_path);
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
    }

    relative_asset_path(root, &png_path)
}

fn save_macos_clipboard_tiff(root: &Path, assets_dir: &Path) -> Result<String, String> {
    let temp_name = unique_asset_name(assets_dir, "pasted-image.tiff", Some("image/tiff"));
    let temp_path = assets_dir.join(temp_name);
    let script = r#"on run argv
  set outputPath to item 1 of argv
  set imageData to the clipboard as TIFF picture
  set fileRef to open for access (POSIX file outputPath) with write permission
  set eof fileRef to 0
  write imageData to fileRef
  close access fileRef
end run"#;
    let output = Command::new("osascript")
        .arg("-e")
        .arg(script)
        .arg(&temp_path)
        .output()
        .map_err(|error| error.to_string())?;

    if !output.status.success() || !temp_path.exists() {
        let _ = fs::remove_file(&temp_path);
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
    }

    convert_tiff_file_to_png(root, assets_dir, &temp_path)
}

fn convert_tiff_file_to_png(
    root: &Path,
    assets_dir: &Path,
    temp_path: &Path,
) -> Result<String, String> {
    let png_name = unique_asset_name(assets_dir, "pasted-image.png", Some("image/png"));
    let png_path = assets_dir.join(png_name);
    let output = Command::new("sips")
        .args(["-s", "format", "png"])
        .arg(&temp_path)
        .arg("--out")
        .arg(&png_path)
        .output()
        .map_err(|error| {
            let _ = fs::remove_file(temp_path);
            error.to_string()
        })?;

    let _ = fs::remove_file(temp_path);

    if !output.status.success() {
        let _ = fs::remove_file(&png_path);
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
    }

    relative_asset_path(root, &png_path)
}

fn relative_asset_path(root: &Path, path: &Path) -> Result<String, String> {
    Ok(path
        .strip_prefix(root)
        .map_err(|error| error.to_string())?
        .to_string_lossy()
        .replace('\\', "/"))
}

fn asset_extension_for_mime(mime_type: Option<&str>) -> Option<String> {
    match mime_type.unwrap_or_default() {
        "image/jpeg" => Some("jpg".to_string()),
        "image/png" => Some("png".to_string()),
        "image/gif" => Some("gif".to_string()),
        "image/webp" => Some("webp".to_string()),
        "image/svg+xml" => Some("svg".to_string()),
        value if value.starts_with("image/") => value
            .split('/')
            .nth(1)
            .filter(|ext| !ext.is_empty())
            .map(|ext| ext.replace('+', "-")),
        _ => None,
    }
}

fn mime_type_for_asset(path: &Path) -> &'static str {
    match path
        .extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| ext.to_ascii_lowercase())
        .as_deref()
    {
        Some("jpg") | Some("jpeg") => "image/jpeg",
        Some("gif") => "image/gif",
        Some("webp") => "image/webp",
        Some("svg") => "image/svg+xml",
        Some("tif") | Some("tiff") => "image/tiff",
        _ => "image/png",
    }
}

fn build_app_menu(
    handle: &AppHandle,
    notebook_windows: &[NotebookWindow],
) -> tauri::Result<Menu<tauri::Wry>> {
    let about = PredefinedMenuItem::about(
        handle,
        Some("About Tigrana"),
        Some(
            AboutMetadataBuilder::new()
                .name(Some("Tigrana"))
                .version(Some(handle.package_info().version.to_string()))
                .comments(Some("A simple, beautiful, file-native desktop notes app."))
                .build(),
        ),
    )?;
    let settings = MenuItem::with_id(handle, "open_settings", "Settings...", true, Some("Cmd+,"))?;
    // Custom Quit so Cmd+Q closes the window (firing CloseRequested in JS)
    // instead of calling app.exit() directly, which would skip the
    // frontend's metadata-flush handler.
    let quit_item = MenuItem::with_id(handle, "request_quit", "Quit Tigrana", true, Some("Cmd+Q"))?;
    let recently_deleted = MenuItem::with_id(
        handle,
        "open_recently_deleted",
        "Recently Deleted",
        true,
        None::<&str>,
    )?;
    let open_notebook = MenuItem::with_id(
        handle,
        "open_notebook",
        "Open Notebook...",
        true,
        Some("Cmd+O"),
    )?;
    let manage_notebooks = MenuItem::with_id(
        handle,
        "manage_notebooks",
        "Manage Notebooks...",
        true,
        None::<&str>,
    )?;

    let open_notebooks = Submenu::new(handle, "Open Notebooks", true)?;
    if notebook_windows.is_empty() {
        let empty = MenuItem::with_id(
            handle,
            "open_notebooks_empty",
            "No Open Notebooks",
            false,
            None::<&str>,
        )?;
        open_notebooks.append(&empty)?;
    } else {
        for notebook in notebook_windows {
            let title = format!("{} ({})", notebook.name, notebook.workspace);
            let item = MenuItem::with_id(
                handle,
                format!("focus_notebook_window:{}", notebook.label),
                title,
                true,
                None::<&str>,
            )?;
            open_notebooks.append(&item)?;
        }
    }

    let tigrana_menu = Submenu::with_items(
        handle,
        "Tigrana",
        true,
        &[
            &about,
            &PredefinedMenuItem::separator(handle)?,
            &settings,
            &PredefinedMenuItem::separator(handle)?,
            &PredefinedMenuItem::services(handle, None)?,
            &PredefinedMenuItem::separator(handle)?,
            &PredefinedMenuItem::hide(handle, None)?,
            &PredefinedMenuItem::hide_others(handle, None)?,
            &PredefinedMenuItem::separator(handle)?,
            &quit_item,
        ],
    )?;
    let file_menu = Submenu::with_items(
        handle,
        "File",
        true,
        &[
            &open_notebook,
            &manage_notebooks,
            &PredefinedMenuItem::separator(handle)?,
            &PredefinedMenuItem::close_window(handle, None)?,
        ],
    )?;
    let edit_menu = Submenu::with_items(
        handle,
        "Edit",
        true,
        &[
            &PredefinedMenuItem::undo(handle, None)?,
            &PredefinedMenuItem::redo(handle, None)?,
            &PredefinedMenuItem::separator(handle)?,
            &PredefinedMenuItem::cut(handle, None)?,
            &PredefinedMenuItem::copy(handle, None)?,
            &PredefinedMenuItem::paste(handle, None)?,
            &PredefinedMenuItem::select_all(handle, None)?,
        ],
    )?;
    let view_menu = Submenu::with_items(
        handle,
        "View",
        true,
        &[
            &PredefinedMenuItem::fullscreen(handle, None)?,
            &PredefinedMenuItem::separator(handle)?,
            &recently_deleted,
        ],
    )?;
    let window_menu = Submenu::with_items(
        handle,
        "Window",
        true,
        &[
            &PredefinedMenuItem::minimize(handle, None)?,
            &PredefinedMenuItem::maximize(handle, None)?,
            &PredefinedMenuItem::separator(handle)?,
            &PredefinedMenuItem::close_window(handle, None)?,
            &PredefinedMenuItem::separator(handle)?,
            &open_notebooks,
        ],
    )?;

    Menu::with_items(
        handle,
        &[
            &tigrana_menu,
            &file_menu,
            &edit_menu,
            &view_menu,
            &window_menu,
        ],
    )
}

fn rebuild_app_menu(app: &AppHandle, state: &NotebookWindowState) -> Result<(), String> {
    let live_labels: HashSet<String> = app.webview_windows().keys().cloned().collect();
    let mut notebooks = {
        let mut windows = state.windows.lock().map_err(|error| error.to_string())?;
        windows.retain(|label, _| live_labels.contains(label));
        windows.values().cloned().collect::<Vec<_>>()
    };
    notebooks.sort_by(|a, b| a.name.cmp(&b.name).then(a.workspace.cmp(&b.workspace)));
    let menu = build_app_menu(app, &notebooks).map_err(|error| error.to_string())?;
    app.set_menu(menu)
        .map(|_| ())
        .map_err(|error| error.to_string())
}

fn emit_menu_action(app: &AppHandle, event: &str) {
    if let Some(window) = active_menu_window(app) {
        let _ = window.emit(event, ());
        return;
    }
    let _ = app.emit(event, ());
}

fn active_menu_window(app: &AppHandle) -> Option<WebviewWindow<Wry>> {
    let windows = app.webview_windows();
    windows
        .values()
        .find(|window| window.is_focused().unwrap_or(false))
        .cloned()
        .or_else(|| windows.values().next().cloned())
}

fn dispatch_frontend_menu_action(
    window: &WebviewWindow<Wry>,
    event: &str,
    detail: serde_json::Value,
) {
    let event_json =
        serde_json::to_string(event).unwrap_or_else(|_| "\"tigrana-menu-action\"".to_string());
    let detail_json = serde_json::to_string(&detail).unwrap_or_else(|_| "null".to_string());
    let script = format!(
        "window.dispatchEvent(new CustomEvent({event_json}, {{ detail: {detail_json} }}));"
    );
    let _ = window.eval(script);
}

fn open_notebook_from_menu(app: &AppHandle) {
    let Some(window) = active_menu_window(app) else {
        return;
    };
    let dialog_window = window.clone();
    app.dialog()
        .file()
        .set_parent(&dialog_window)
        .set_title("Open notebook")
        .pick_folder(move |folder| {
            let Some(folder) = folder else {
                return;
            };
            let Ok(path) = folder.into_path() else {
                return;
            };
            dispatch_frontend_menu_action(
                &window,
                "tigrana-open-notebook",
                serde_json::Value::String(path.to_string_lossy().to_string()),
            );
        });
}

fn manage_notebooks_from_menu(app: &AppHandle) {
    if let Some(window) = active_menu_window(app) {
        dispatch_frontend_menu_action(&window, "tigrana-manage-notebooks", serde_json::Value::Null);
    }
}

fn reveal_in_file_manager(path: &Path) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .arg("-R")
            .arg(path)
            .status()
            .map_err(|error| error.to_string())
            .and_then(|status| {
                if status.success() {
                    Ok(())
                } else {
                    Err("Finder could not reveal that item.".to_string())
                }
            })
    }

    #[cfg(target_os = "windows")]
    {
        Command::new("explorer")
            .arg(format!("/select,{}", path.to_string_lossy()))
            .status()
            .map_err(|error| error.to_string())
            .and_then(|status| {
                if status.success() {
                    Ok(())
                } else {
                    Err("File Explorer could not reveal that item.".to_string())
                }
            })
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    {
        let target = if path.is_dir() {
            path
        } else {
            path.parent().unwrap_or(path)
        };
        Command::new("xdg-open")
            .arg(target)
            .status()
            .map_err(|error| error.to_string())
            .and_then(|status| {
                if status.success() {
                    Ok(())
                } else {
                    Err("The file manager could not open that location.".to_string())
                }
            })
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(WatchState::default())
        .manage(NotebookWindowState::default())
        .manage(NoteEditLockState::default())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        .menu(|handle| build_app_menu(handle, &[]))
        .on_window_event(|window, event| {
            if !matches!(event, WindowEvent::Destroyed) {
                return;
            }
            let app = window.app_handle();
            let state = app.state::<NotebookWindowState>();
            if let Ok(mut windows) = state.windows.lock() {
                windows.remove(window.label());
            }
            let _ = rebuild_app_menu(app, &state);
            let lock_state = app.state::<NoteEditLockState>();
            release_note_edit_locks_for_window(&lock_state, window.label());
        })
        .on_menu_event(|app, event| match event.id().as_ref() {
            "open_settings" => {
                emit_menu_action(app, "open-settings");
            }
            "open_notebook" => {
                open_notebook_from_menu(app);
            }
            "manage_notebooks" => {
                manage_notebooks_from_menu(app);
            }
            "open_recently_deleted" => {
                emit_menu_action(app, "open-recently-deleted");
            }
            "request_quit" => {
                let labels: Vec<String> = app.webview_windows().keys().cloned().collect();
                for label in labels {
                    if let Some(win) = app.get_webview_window(&label) {
                        let _ = win.close();
                    }
                }
            }
            id if id.starts_with("focus_notebook_window:") => {
                let label = id.trim_start_matches("focus_notebook_window:");
                if let Some(win) = app.get_webview_window(label) {
                    let _ = win.show();
                    let _ = win.set_focus();
                }
            }
            _ => {}
        })
        .invoke_handler(tauri::generate_handler![
            ensure_workspace,
            watch_workspace,
            list_folders,
            list_notes,
            read_note,
            save_note,
            acquire_note_edit_lock,
            release_note_edit_lock,
            create_note,
            duplicate_note,
            rename_note,
            create_folder,
            rename_folder,
            move_note,
            move_folder,
            delete_note,
            delete_folder,
            trash_note,
            trash_folder,
            list_trash,
            restore_trash,
            purge_trash,
            purge_trash_all,
            cleanup_trash,
            list_note_versions,
            read_note_version,
            restore_note_version,
            read_workspace_metadata,
            write_workspace_metadata,
            register_notebook_window,
            unregister_notebook_window,
            focus_notebook_window,
            read_app_preferences,
            write_app_preferences,
            ensure_workspace_identity,
            read_link_index,
            rebuild_link_index,
            save_asset,
            save_clipboard_image_asset,
            read_asset_data_url,
            reveal_path,
            open_external
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

fn main() {
    run();
}
