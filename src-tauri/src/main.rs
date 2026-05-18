use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::Emitter;
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
struct CreateNotePayload {
    workspace: String,
    parent_path: String,
    title: String,
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
struct SaveAssetPayload {
    workspace: String,
    file_name: String,
    bytes: Vec<u8>,
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
}

#[tauri::command]
fn list_notes(workspace: String) -> Result<Vec<NoteEntry>, String> {
    let root = safe_workspace(&workspace)?;
    let mut notes = Vec::new();

    for entry in WalkDir::new(&root)
        .into_iter()
        .filter_entry(|entry| !is_hidden_app_dir(entry.path()))
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
        .filter_entry(|entry| !is_hidden_app_dir(entry.path()))
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
fn save_note(payload: SaveNotePayload) -> Result<(), String> {
    let note_path = safe_note_path(&payload.workspace, &payload.path)?;
    if let Some(parent) = note_path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    fs::write(note_path, payload.content).map_err(|error| error.to_string())
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

    fs::write(&absolute, format!("# {}\n\n", payload.title.trim())).map_err(|error| error.to_string())?;

    let path = relative.to_string_lossy().replace('\\', "/");
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

    if old_path != new_path {
        if new_path.exists() {
            return Err("A note with that title already exists in this folder.".to_string());
        }
        fs::rename(&old_path, &new_path).map_err(|error| error.to_string())?;
    }

    let path = new_relative.to_string_lossy().replace('\\', "/");
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

    if old_path != new_path {
        if new_path.exists() {
            return Err("A folder with that name already exists here.".to_string());
        }
        fs::rename(&old_path, &new_path).map_err(|error| error.to_string())?;
    }

    let path = new_relative.to_string_lossy().replace('\\', "/");
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
    let new_relative = if target_parent.as_os_str().is_empty() {
        PathBuf::from(file_name)
    } else {
        target_parent.join(file_name)
    };
    let old_path = root.join(&old_relative);
    let new_path = root.join(&new_relative);

    if old_path != new_path {
        if new_path.exists() {
            return Err("A note with that title already exists in the target folder.".to_string());
        }
        if let Some(parent) = new_path.parent() {
            fs::create_dir_all(parent).map_err(|error| error.to_string())?;
        }
        fs::rename(&old_path, &new_path).map_err(|error| error.to_string())?;
    }

    let path = new_relative.to_string_lossy().replace('\\', "/");
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

    if old_path != new_path {
        if new_path.exists() {
            return Err("A folder with that name already exists in the target folder.".to_string());
        }
        if let Some(parent) = new_path.parent() {
            fs::create_dir_all(parent).map_err(|error| error.to_string())?;
        }
        fs::rename(&old_path, &new_path).map_err(|error| error.to_string())?;
    }

    let path = new_relative.to_string_lossy().replace('\\', "/");
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
    let path = safe_note_path(&payload.workspace, &payload.path)?;
    if path.exists() {
        fs::remove_file(path).map_err(|error| error.to_string())?;
    }
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
    Ok(())
}

#[tauri::command]
fn save_asset(payload: SaveAssetPayload) -> Result<String, String> {
    let root = safe_workspace(&payload.workspace)?;
    let assets_dir = root.join(".assets");
    fs::create_dir_all(&assets_dir).map_err(|error| error.to_string())?;
    let clean_name = slugify_asset_name(&payload.file_name);
    let path = assets_dir.join(clean_name);
    fs::write(&path, payload.bytes).map_err(|error| error.to_string())?;
    let relative = path
        .strip_prefix(root)
        .map_err(|error| error.to_string())?
        .to_string_lossy()
        .replace('\\', "/");
    Ok(relative)
}

#[tauri::command]
fn ensure_workspace(workspace: String) -> Result<(), String> {
    let root = safe_workspace(&workspace)?;
    fs::create_dir_all(root.join(".lumen")).map_err(|error| error.to_string())
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
    let lumen_dir = root.join(".lumen");
    fs::create_dir_all(&lumen_dir).map_err(|error| error.to_string())?;
    let contents = serde_json::to_string_pretty(&metadata).map_err(|error| error.to_string())?;
    fs::write(lumen_dir.join("metadata.json"), format!("{contents}\n")).map_err(|error| error.to_string())
}

fn safe_workspace(workspace: &str) -> Result<PathBuf, String> {
    let path = PathBuf::from(workspace);
    if !path.is_absolute() {
        return Err("Workspace path must be absolute.".to_string());
    }
    Ok(path)
}

fn metadata_path(root: &Path) -> PathBuf {
    root.join(".lumen").join("metadata.json")
}

fn default_workspace_metadata() -> WorkspaceMetadata {
    WorkspaceMetadata {
        folder_order: serde_json::Map::new(),
        note_order: serde_json::Map::new(),
        pinned_notes: serde_json::Map::new(),
        folder_icons: serde_json::Map::new(),
        folder_colors: serde_json::Map::new(),
        note_icons: serde_json::Map::new(),
    }
}

fn safe_note_path(workspace: &str, relative: &str) -> Result<PathBuf, String> {
    let root = safe_workspace(workspace)?;
    let relative = normalize_relative(relative)?;
    let path = root.join(relative);
    if !path.starts_with(&root) {
        return Err("Path escapes workspace.".to_string());
    }
    Ok(path)
}

fn normalize_relative(value: &str) -> Result<PathBuf, String> {
    let path = PathBuf::from(value);
    if path.is_absolute() || value.contains("..") {
        return Err("Only relative paths inside the workspace are allowed.".to_string());
    }
    Ok(path)
}

fn is_hidden_app_dir(path: &Path) -> bool {
    path.file_name()
        .and_then(|name| name.to_str())
        .map(|name| name == ".lumen" || name == ".assets")
        .unwrap_or(false)
}

fn slugify(title: &str) -> String {
    let slug = title
        .trim()
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' || ch == ' ' {
                ch
            } else {
                '-'
            }
        })
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");

    if slug.is_empty() {
        "Untitled".to_string()
    } else {
        slug
    }
}

fn validate_note_title(title: &str) -> Result<(), String> {
    let trimmed = title.trim();
    if trimmed.is_empty() {
        return Err("Add a title before saving this note.".to_string());
    }

    let invalid = ['/', '\\', ':', '*', '?', '"', '<', '>', '|'];
    if trimmed.contains(invalid) {
        return Err("Note titles cannot contain / \\ : * ? \" < > |".to_string());
    }

    if trimmed == "." || trimmed == ".." {
        return Err("That title is reserved by the filesystem.".to_string());
    }

    Ok(())
}

fn slugify_asset_name(file_name: &str) -> String {
    let stem = slugify(file_name.trim_end_matches(".png"));
    format!("{stem}.png")
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        .menu(|handle| {
            let settings = MenuItem::with_id(handle, "open_settings", "Settings...", true, Some("Cmd+,"))?;
            Menu::with_items(
                handle,
                &[
                    &Submenu::with_items(
                        handle,
                        "Lumen Notes",
                        true,
                        &[
                            &PredefinedMenuItem::about(handle, None, None)?,
                            &PredefinedMenuItem::separator(handle)?,
                            &settings,
                            &PredefinedMenuItem::separator(handle)?,
                            &PredefinedMenuItem::services(handle, None)?,
                            &PredefinedMenuItem::separator(handle)?,
                            &PredefinedMenuItem::hide(handle, None)?,
                            &PredefinedMenuItem::hide_others(handle, None)?,
                            &PredefinedMenuItem::separator(handle)?,
                            &PredefinedMenuItem::quit(handle, None)?,
                        ],
                    )?,
                    &Submenu::with_items(handle, "File", true, &[&PredefinedMenuItem::close_window(handle, None)?])?,
                    &Submenu::with_items(
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
                    )?,
                    &Submenu::with_items(handle, "View", true, &[&PredefinedMenuItem::fullscreen(handle, None)?])?,
                    &Submenu::with_items(
                        handle,
                        "Window",
                        true,
                        &[
                            &PredefinedMenuItem::minimize(handle, None)?,
                            &PredefinedMenuItem::maximize(handle, None)?,
                            &PredefinedMenuItem::separator(handle)?,
                            &PredefinedMenuItem::close_window(handle, None)?,
                        ],
                    )?,
                ],
            )
        })
        .on_menu_event(|app, event| {
            if event.id().as_ref() == "open_settings" {
                let _ = app.emit("open-settings", ());
            }
        })
        .invoke_handler(tauri::generate_handler![
            ensure_workspace,
            list_folders,
            list_notes,
            read_note,
            save_note,
            create_note,
            rename_note,
            create_folder,
            rename_folder,
            move_note,
            move_folder,
            delete_note,
            delete_folder,
            read_workspace_metadata,
            write_workspace_metadata,
            save_asset
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

fn main() {
    run();
}
