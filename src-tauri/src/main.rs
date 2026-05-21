use base64::{engine::general_purpose, Engine as _};
use serde::{Deserialize, Serialize};
use notify::{Config, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Mutex;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::{AppHandle, Emitter, Manager};
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

    fs::write(&absolute, "").map_err(|error| error.to_string())?;

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

    if should_convert_tiff_asset(&payload.file_name, payload.mime_type.as_deref()) {
        return save_tiff_asset_as_png(&root, &assets_dir, &payload);
    }

    let clean_name = unique_asset_name(&assets_dir, &payload.file_name, payload.mime_type.as_deref());
    let path = assets_dir.join(clean_name);
    fs::write(&path, payload.bytes).map_err(|error| error.to_string())?;
    relative_asset_path(&root, &path)
}

#[tauri::command]
fn save_clipboard_image_asset(workspace: String) -> Result<String, String> {
    let root = safe_workspace(&workspace)?;
    let assets_dir = root.join(".assets");
    fs::create_dir_all(&assets_dir).map_err(|error| error.to_string())?;

    save_macos_clipboard_png(&root, &assets_dir).or_else(|_| save_macos_clipboard_tiff(&root, &assets_dir))
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
    Ok(format!("data:{mime};base64,{}", general_purpose::STANDARD.encode(bytes)))
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
    fs::create_dir_all(root.join(".lumen")).map_err(|error| error.to_string())
}

#[tauri::command]
fn watch_workspace(app: AppHandle, state: tauri::State<WatchState>, workspace: String) -> Result<(), String> {
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
            let Ok(event) = result else { return; };
            if !matches!(event.kind, EventKind::Create(_) | EventKind::Modify(_) | EventKind::Remove(_)) {
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
        note_positions: serde_json::Map::new(),
        bookmarks: Vec::new(),
        bookmarks_expanded: true,
        expanded_folders: serde_json::Map::new(),
        appearance: None,
    }
}

fn default_true() -> bool {
    true
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

fn is_hidden_entry(path: &Path) -> bool {
    path.file_name()
        .and_then(|name| name.to_str())
        .map(|name| name.starts_with('.'))
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

fn save_tiff_asset_as_png(root: &Path, assets_dir: &Path, payload: &SaveAssetPayload) -> Result<String, String> {
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

fn convert_tiff_file_to_png(root: &Path, assets_dir: &Path, temp_path: &Path) -> Result<String, String> {
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
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        .menu(|handle| {
            let settings = MenuItem::with_id(handle, "open_settings", "Settings...", true, Some("Cmd+,"))?;
            // Custom Quit so Cmd+Q closes the window (firing CloseRequested in JS)
            // instead of calling app.exit() directly, which would skip the
            // frontend's metadata-flush handler.
            let quit_item = MenuItem::with_id(handle, "request_quit", "Quit Lumen Notes", true, Some("Cmd+Q"))?;
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
                            &quit_item,
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
            match event.id().as_ref() {
                "open_settings" => {
                    let _ = app.emit("open-settings", ());
                }
                "request_quit" => {
                    if let Some(win) = app.get_webview_window("main") {
                        let _ = win.close();
                    }
                }
                _ => {}
            }
        })
        .invoke_handler(tauri::generate_handler![
            ensure_workspace,
            watch_workspace,
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
            save_asset,
            save_clipboard_image_asset,
            read_asset_data_url,
            reveal_path
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

fn main() {
    run();
}
