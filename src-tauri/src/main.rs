use fs2::FileExt;
mod assets;
mod link_index;
mod note_history;
mod notebook_metadata;
mod notebook_paths;
mod notebook_storage;
mod trash;
use assets::{
    read_asset_data_url as read_asset_data_url_for_notebook, save_asset as save_asset_for_notebook,
    save_clipboard_image_asset as save_clipboard_image_asset_for_notebook, SaveAssetPayload,
};
use link_index::{
    link_index_path, read_frontmatter_field, read_link_index_file, rebuild_index_for_root,
    split_frontmatter, LinkIndex,
};
use note_history::{
    list_note_versions as list_note_versions_for_note,
    read_note_version as read_note_version_content,
    restore_note_version as restore_note_version_content, NoteVersionEntry,
};
use notebook_metadata::{
    read_workspace_metadata as read_metadata_for_notebook,
    write_workspace_metadata as write_metadata_for_notebook, FolderPlacement, WorkspaceMetadata,
};
use notebook_paths::{
    app_dir, is_hidden_entry, normalize_relative, safe_note_path, safe_workspace,
};
use notebook_storage::{
    create_folder as create_folder_in_notebook, create_note as create_note_in_notebook,
    delete_folder as delete_folder_from_notebook, delete_note as delete_note_from_notebook,
    duplicate_note as duplicate_note_in_notebook, list_folders as list_folders_in_notebook,
    list_notes as list_notes_in_notebook, move_folder as move_folder_in_notebook,
    move_note as move_note_in_notebook, read_note as read_note_from_notebook,
    rename_folder as rename_folder_in_notebook, rename_note as rename_note_in_notebook,
    save_note as save_note_to_notebook, FolderEntry, NoteEntry,
};
use notify::{Config, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::fs::{self, File, OpenOptions};
use std::hash::{Hash, Hasher};
use std::io::{Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Mutex;
use std::{collections::hash_map::DefaultHasher, process};
use tauri::menu::{
    AboutMetadataBuilder, CheckMenuItem, Menu, MenuItem, PredefinedMenuItem, Submenu,
};
use tauri::{AppHandle, Emitter, Manager, WebviewWindow, WindowEvent, Wry};
use tauri_plugin_dialog::DialogExt;
use time::OffsetDateTime;
use trash::{
    cleanup_trash as cleanup_trash_for_notebook, list_trash as list_trash_for_notebook,
    purge_trash as purge_trash_entry, purge_trash_all as purge_all_trash_for_notebook,
    restore_trash as restore_trash_entry, trash_item, TrashEntry,
};

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
    sibling_target_path: Option<String>,
    sibling_placement: Option<String>,
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

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AppPreferences {
    last_workspace: Option<String>,
    #[serde(default = "default_true")]
    spellcheck_enabled: bool,
}

impl Default for AppPreferences {
    fn default() -> Self {
        Self {
            last_workspace: None,
            spellcheck_enabled: true,
        }
    }
}

#[derive(Debug, Deserialize)]
struct RevealPathPayload {
    workspace: String,
    path: String,
    kind: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WriteExportTextPayload {
    path: String,
    contents: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct AppMenuState {
    has_workspace: bool,
    has_open_note: bool,
    active_note_editable: bool,
    has_unsaved_changes: bool,
    raw_markdown_visible: bool,
    left_visible: bool,
    outline_visible: bool,
    spellcheck_enabled: bool,
    editor_width_mode: String,
    note_alignment: String,
}

impl Default for AppMenuState {
    fn default() -> Self {
        Self {
            has_workspace: false,
            has_open_note: false,
            active_note_editable: false,
            has_unsaved_changes: false,
            raw_markdown_visible: false,
            left_visible: true,
            outline_visible: true,
            spellcheck_enabled: true,
            editor_width_mode: "comfortable".to_string(),
            note_alignment: "left".to_string(),
        }
    }
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
    menu_states: Mutex<HashMap<String, AppMenuState>>,
}

struct NoteEditLock {
    workspace: String,
    path: String,
    window_label: String,
    acquired_at: u64,
    file: File,
}

#[derive(Default)]
struct NoteEditLockState {
    locks: Mutex<HashMap<String, NoteEditLock>>,
}

#[tauri::command]
fn list_notes(workspace: String) -> Result<Vec<NoteEntry>, String> {
    let root = safe_workspace(&workspace)?;
    list_notes_in_notebook(&root)
}

#[tauri::command]
fn list_folders(workspace: String) -> Result<Vec<FolderEntry>, String> {
    let root = safe_workspace(&workspace)?;
    list_folders_in_notebook(&root)
}

#[tauri::command]
async fn read_note(workspace: String, path: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let root = safe_workspace(&workspace)?;
        read_note_from_notebook(&root, &path)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn save_note(payload: SaveNotePayload) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let root = safe_workspace(&payload.workspace)?;
        save_note_to_notebook(&root, &payload.path, &payload.content)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
fn create_note(payload: CreateNotePayload) -> Result<NoteEntry, String> {
    let root = safe_workspace(&payload.workspace)?;
    create_note_in_notebook(&root, &payload.parent_path, &payload.title)
}

#[tauri::command]
fn duplicate_note(payload: DuplicateNotePayload) -> Result<NoteEntry, String> {
    let root = safe_workspace(&payload.workspace)?;
    duplicate_note_in_notebook(&root, &payload.path)
}

#[tauri::command]
fn rename_note(
    state: tauri::State<NoteEditLockState>,
    payload: RenameNotePayload,
) -> Result<NoteEntry, String> {
    let root = safe_workspace(&payload.workspace)?;
    let renamed = rename_note_in_notebook(&root, &payload.path, &payload.title)?;
    repair_note_edit_lock_paths(
        &state,
        &payload.workspace,
        &payload.path,
        &renamed.path,
        false,
    );
    Ok(renamed)
}

#[tauri::command]
fn create_folder(payload: FolderPayload) -> Result<FolderEntry, String> {
    let root = safe_workspace(&payload.workspace)?;
    create_folder_in_notebook(&root, &payload.parent_path, &payload.name)
}

#[tauri::command]
fn rename_folder(
    state: tauri::State<NoteEditLockState>,
    payload: RenameFolderPayload,
) -> Result<FolderEntry, String> {
    let root = safe_workspace(&payload.workspace)?;
    let renamed = rename_folder_in_notebook(&root, &payload.path, &payload.name)?;
    repair_note_edit_lock_paths(
        &state,
        &payload.workspace,
        &payload.path,
        &renamed.path,
        true,
    );
    Ok(renamed)
}

#[tauri::command]
fn move_note(
    state: tauri::State<NoteEditLockState>,
    payload: MovePathPayload,
) -> Result<NoteEntry, String> {
    let root = safe_workspace(&payload.workspace)?;
    let moved = move_note_in_notebook(&root, &payload.path, &payload.target_parent_path)?;
    repair_note_edit_lock_paths(
        &state,
        &payload.workspace,
        &payload.path,
        &moved.path,
        false,
    );
    Ok(moved)
}

#[tauri::command]
fn move_folder(
    state: tauri::State<NoteEditLockState>,
    payload: MovePathPayload,
) -> Result<FolderEntry, String> {
    let root = safe_workspace(&payload.workspace)?;
    let sibling_placement = match payload.sibling_placement.as_deref() {
        None => None,
        Some("before") => Some(FolderPlacement::Before),
        Some("after") => Some(FolderPlacement::After),
        Some(_) => return Err("Folder sibling placement must be before or after.".to_string()),
    };
    let moved = move_folder_in_notebook(
        &root,
        &payload.path,
        &payload.target_parent_path,
        payload.sibling_target_path.as_deref(),
        sibling_placement,
    )?;
    repair_note_edit_lock_paths(&state, &payload.workspace, &payload.path, &moved.path, true);
    Ok(moved)
}

#[tauri::command]
fn delete_note(payload: DeletePathPayload) -> Result<(), String> {
    let root = safe_workspace(&payload.workspace)?;
    delete_note_from_notebook(&root, &payload.path)
}

#[tauri::command]
fn delete_folder(payload: DeletePathPayload) -> Result<(), String> {
    let root = safe_workspace(&payload.workspace)?;
    delete_folder_from_notebook(&root, &payload.path)
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
async fn read_link_index(workspace: String) -> Result<LinkIndex, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let root = safe_workspace(&workspace)?;
        let path = link_index_path(&root);
        if !path.exists() {
            return rebuild_index_for_root(&root);
        }
        Ok(read_link_index_file(&root))
    })
    .await
    .map_err(|error| error.to_string())?
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

#[tauri::command]
fn trash_note(payload: DeletePathPayload) -> Result<TrashEntry, String> {
    let root = safe_workspace(&payload.workspace)?;
    trash_item(&root, &payload.path, "note")
}

#[tauri::command]
fn trash_folder(payload: DeletePathPayload) -> Result<TrashEntry, String> {
    let root = safe_workspace(&payload.workspace)?;
    trash_item(&root, &payload.path, "folder")
}

#[tauri::command]
fn list_trash(workspace: String) -> Result<Vec<TrashEntry>, String> {
    let root = safe_workspace(&workspace)?;
    Ok(list_trash_for_notebook(&root))
}

#[tauri::command]
fn restore_trash(payload: TrashIdPayload) -> Result<String, String> {
    let root = safe_workspace(&payload.workspace)?;
    restore_trash_entry(&root, &payload.id)
}

#[tauri::command]
fn purge_trash(payload: TrashIdPayload) -> Result<(), String> {
    let root = safe_workspace(&payload.workspace)?;
    purge_trash_entry(&root, &payload.id)
}

#[tauri::command]
fn purge_trash_all(workspace: String) -> Result<(), String> {
    let root = safe_workspace(&workspace)?;
    purge_all_trash_for_notebook(&root)
}

#[tauri::command]
fn cleanup_trash(workspace: String) -> Result<u32, String> {
    let root = safe_workspace(&workspace)?;
    cleanup_trash_for_notebook(&root)
}

#[tauri::command]
fn save_asset(payload: SaveAssetPayload) -> Result<String, String> {
    let root = safe_workspace(&payload.workspace)?;
    save_asset_for_notebook(&root, payload)
}

#[tauri::command]
fn save_clipboard_image_asset(workspace: String) -> Result<String, String> {
    let root = safe_workspace(&workspace)?;
    save_clipboard_image_asset_for_notebook(&root)
}

#[tauri::command]
fn read_asset_data_url(workspace: String, path: String) -> Result<String, String> {
    let root = safe_workspace(&workspace)?;
    read_asset_data_url_for_notebook(&root, &path)
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
    read_metadata_for_notebook(&root)
}

#[tauri::command]
async fn write_workspace_metadata(
    workspace: String,
    metadata: WorkspaceMetadata,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let root = safe_workspace(&workspace)?;
        write_metadata_for_notebook(&root, &metadata)
    })
    .await
    .map_err(|error| error.to_string())?
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
                label: label.clone(),
                workspace,
                name,
            },
        );
    }
    {
        let mut menu_states = state
            .menu_states
            .lock()
            .map_err(|error| error.to_string())?;
        menu_states.entry(label).or_default().has_workspace = true;
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
    {
        let mut menu_states = state
            .menu_states
            .lock()
            .map_err(|error| error.to_string())?;
        menu_states.remove(&label);
    }
    rebuild_app_menu(&app, &state)
}

#[tauri::command]
fn update_app_menu_state(
    app: AppHandle,
    notebook_state: tauri::State<NotebookWindowState>,
    label: String,
    state: AppMenuState,
) -> Result<(), String> {
    {
        let mut menu_states = notebook_state
            .menu_states
            .lock()
            .map_err(|error| error.to_string())?;
        menu_states.insert(label, state);
    }
    rebuild_app_menu(&app, &notebook_state)
}

#[tauri::command]
fn write_export_text_file(payload: WriteExportTextPayload) -> Result<(), String> {
    fs::write(payload.path, payload.contents).map_err(|error| error.to_string())
}

#[tauri::command]
fn print_current_webview(app: AppHandle) -> Result<(), String> {
    let Some(window) = active_menu_window(&app) else {
        return Err("No active window to print.".to_string());
    };
    window.print().map_err(|error| error.to_string())
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
            acquired_at: owner.acquired_at,
            file,
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

fn repair_note_edit_lock_paths(
    state: &NoteEditLockState,
    workspace: &str,
    old_path: &str,
    new_path: &str,
    include_descendants: bool,
) {
    let Ok(mut locks) = state.locks.lock() else {
        return;
    };
    for lock in locks.values_mut() {
        if lock.workspace != workspace {
            continue;
        }
        let next_path = if lock.path == old_path {
            Some(new_path.to_string())
        } else if include_descendants {
            lock.path
                .strip_prefix(&format!("{old_path}/"))
                .map(|suffix| format!("{new_path}/{suffix}"))
        } else {
            None
        };
        let Some(next_path) = next_path else {
            continue;
        };
        lock.path = next_path.clone();
        let owner = NoteEditLockOwner {
            window_label: lock.window_label.clone(),
            pid: process::id(),
            acquired_at: lock.acquired_at,
            workspace: lock.workspace.clone(),
            path: next_path,
        };
        let Ok(metadata) = serde_json::to_string_pretty(&owner) else {
            continue;
        };
        if lock.file.set_len(0).is_ok() && lock.file.seek(SeekFrom::Start(0)).is_ok() {
            let _ = lock.file.write_all(format!("{metadata}\n").as_bytes());
        }
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

fn default_true() -> bool {
    true
}

fn read_note_edit_lock_owner(path: &Path) -> Option<NoteEditLockOwner> {
    fs::read_to_string(path)
        .ok()
        .and_then(|content| serde_json::from_str::<NoteEditLockOwner>(&content).ok())
}

fn build_app_menu(
    handle: &AppHandle,
    notebook_windows: &[NotebookWindow],
    state: &AppMenuState,
) -> tauri::Result<Menu<tauri::Wry>> {
    let has_workspace = state.has_workspace;
    let has_open_note = state.has_open_note;
    let editable_note = has_open_note && state.active_note_editable;
    let rich_editable_note = editable_note && !state.raw_markdown_visible;

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
    let new_notebook = MenuItem::with_id(
        handle,
        "new_notebook",
        "New Notebook...",
        true,
        Some("Cmd+Shift+O"),
    )?;
    let recently_deleted = MenuItem::with_id(
        handle,
        "open_recently_deleted",
        "Recently Deleted",
        has_workspace,
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
    let new_note = MenuItem::with_id(handle, "new_note", "New Note", has_workspace, Some("Cmd+N"))?;
    let new_folder = MenuItem::with_id(
        handle,
        "new_folder",
        "New Folder/Section",
        has_workspace,
        Some("Cmd+Shift+N"),
    )?;
    let new_tab = MenuItem::with_id(handle, "new_tab", "New Tab", true, Some("Cmd+T"))?;
    let save_note = MenuItem::with_id(
        handle,
        "save_note",
        "Save",
        editable_note && state.has_unsaved_changes,
        Some("Cmd+S"),
    )?;
    let export_markdown = MenuItem::with_id(
        handle,
        "export_markdown",
        "Export Current Note as Markdown...",
        has_open_note,
        None::<&str>,
    )?;
    let export_html = MenuItem::with_id(
        handle,
        "export_html",
        "Export Current Note as HTML...",
        has_open_note,
        None::<&str>,
    )?;
    let print_note = MenuItem::with_id(
        handle,
        "print_note",
        "Print Current Note...",
        has_open_note,
        Some("Cmd+P"),
    )?;

    let find_note = MenuItem::with_id(
        handle,
        "find_note",
        "Find in Note",
        has_open_note,
        Some("Cmd+F"),
    )?;
    let find_next = MenuItem::with_id(
        handle,
        "find_next",
        "Find Next",
        has_open_note,
        Some("Cmd+G"),
    )?;
    let find_previous = MenuItem::with_id(
        handle,
        "find_previous",
        "Find Previous",
        has_open_note,
        Some("Cmd+Shift+G"),
    )?;
    let replace_note = MenuItem::with_id(
        handle,
        "replace_note",
        "Replace in Note",
        editable_note,
        None::<&str>,
    )?;
    let start_dictation = MenuItem::with_id(
        handle,
        "start_dictation",
        "Start Dictation...",
        editable_note,
        None::<&str>,
    )?;
    let search_notebook = MenuItem::with_id(
        handle,
        "search_notebook",
        "Search Notebook",
        has_workspace,
        Some("Cmd+K"),
    )?;
    let spellcheck = CheckMenuItem::with_id(
        handle,
        "toggle_spellcheck",
        "Check Spelling While Typing",
        true,
        state.spellcheck_enabled,
        None::<&str>,
    )?;

    let toggle_sidebar = CheckMenuItem::with_id(
        handle,
        "toggle_sidebar",
        "Show Sidebar",
        true,
        state.left_visible,
        Some("Cmd+\\"),
    )?;
    let toggle_outline = CheckMenuItem::with_id(
        handle,
        "toggle_outline",
        "Show Outline",
        has_open_note,
        state.outline_visible,
        None::<&str>,
    )?;
    let toggle_raw = CheckMenuItem::with_id(
        handle,
        "toggle_raw_markdown",
        "Show Raw Markdown",
        has_open_note,
        state.raw_markdown_visible,
        Some("Cmd+Alt+R"),
    )?;
    let width_comfortable = CheckMenuItem::with_id(
        handle,
        "width_comfortable",
        "Comfortable Width",
        has_open_note,
        state.editor_width_mode == "comfortable",
        None::<&str>,
    )?;
    let width_narrow = CheckMenuItem::with_id(
        handle,
        "width_narrow",
        "Narrow Width",
        has_open_note,
        state.editor_width_mode == "narrow",
        None::<&str>,
    )?;
    let width_full = CheckMenuItem::with_id(
        handle,
        "width_full",
        "Full Width",
        has_open_note,
        state.editor_width_mode == "full",
        None::<&str>,
    )?;
    let width_menu = Submenu::with_items(
        handle,
        "Editor Width",
        has_open_note,
        &[&width_comfortable, &width_narrow, &width_full],
    )?;
    let align_left = CheckMenuItem::with_id(
        handle,
        "align_left",
        "Left",
        has_open_note,
        state.note_alignment == "left",
        None::<&str>,
    )?;
    let align_center = CheckMenuItem::with_id(
        handle,
        "align_center",
        "Center",
        has_open_note,
        state.note_alignment == "center",
        None::<&str>,
    )?;
    let alignment_menu = Submenu::with_items(
        handle,
        "Note Alignment",
        has_open_note,
        &[&align_left, &align_center],
    )?;

    let format_bold = MenuItem::with_id(
        handle,
        "format_bold",
        "Bold",
        rich_editable_note,
        Some("Cmd+B"),
    )?;
    let format_italic = MenuItem::with_id(
        handle,
        "format_italic",
        "Italic",
        rich_editable_note,
        Some("Cmd+I"),
    )?;
    let format_strike = MenuItem::with_id(
        handle,
        "format_strike",
        "Strikethrough",
        rich_editable_note,
        None::<&str>,
    )?;
    let format_code = MenuItem::with_id(
        handle,
        "format_code",
        "Inline Code",
        rich_editable_note,
        None::<&str>,
    )?;
    let format_highlight = MenuItem::with_id(
        handle,
        "format_highlight",
        "Highlight",
        rich_editable_note,
        None::<&str>,
    )?;
    let format_link = MenuItem::with_id(
        handle,
        "format_link",
        "Link",
        rich_editable_note,
        Some("Cmd+Shift+K"),
    )?;
    let format_clear = MenuItem::with_id(
        handle,
        "format_clear",
        "Clear Formatting",
        rich_editable_note,
        None::<&str>,
    )?;
    let format_paragraph = MenuItem::with_id(
        handle,
        "format_paragraph",
        "Paragraph",
        rich_editable_note,
        None::<&str>,
    )?;
    let format_h1 = MenuItem::with_id(
        handle,
        "format_h1",
        "Heading 1",
        rich_editable_note,
        None::<&str>,
    )?;
    let format_h2 = MenuItem::with_id(
        handle,
        "format_h2",
        "Heading 2",
        rich_editable_note,
        None::<&str>,
    )?;
    let format_h3 = MenuItem::with_id(
        handle,
        "format_h3",
        "Heading 3",
        rich_editable_note,
        None::<&str>,
    )?;
    let format_h4 = MenuItem::with_id(
        handle,
        "format_h4",
        "Heading 4",
        rich_editable_note,
        None::<&str>,
    )?;
    let format_h5 = MenuItem::with_id(
        handle,
        "format_h5",
        "Heading 5",
        rich_editable_note,
        None::<&str>,
    )?;
    let format_h6 = MenuItem::with_id(
        handle,
        "format_h6",
        "Heading 6",
        rich_editable_note,
        None::<&str>,
    )?;
    let format_bullet_list = MenuItem::with_id(
        handle,
        "format_bullet_list",
        "Bulleted List",
        rich_editable_note,
        None::<&str>,
    )?;
    let format_ordered_list = MenuItem::with_id(
        handle,
        "format_ordered_list",
        "Numbered List",
        rich_editable_note,
        None::<&str>,
    )?;
    let format_task_list = MenuItem::with_id(
        handle,
        "format_task_list",
        "Task List",
        rich_editable_note,
        None::<&str>,
    )?;
    let format_quote = MenuItem::with_id(
        handle,
        "format_quote",
        "Quote",
        rich_editable_note,
        None::<&str>,
    )?;
    let format_code_block = MenuItem::with_id(
        handle,
        "format_code_block",
        "Code Block",
        rich_editable_note,
        None::<&str>,
    )?;
    let format_divider = MenuItem::with_id(
        handle,
        "format_divider",
        "Divider",
        rich_editable_note,
        None::<&str>,
    )?;
    let format_table = MenuItem::with_id(
        handle,
        "format_table",
        "Table",
        rich_editable_note,
        None::<&str>,
    )?;
    let format_image = MenuItem::with_id(
        handle,
        "format_image",
        "Image...",
        rich_editable_note,
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
            &new_notebook,
            &open_notebook,
            &manage_notebooks,
            &PredefinedMenuItem::separator(handle)?,
            &new_note,
            &new_folder,
            &new_tab,
            &save_note,
            &PredefinedMenuItem::separator(handle)?,
            &export_markdown,
            &export_html,
            &print_note,
            &PredefinedMenuItem::separator(handle)?,
            &recently_deleted,
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
            &PredefinedMenuItem::separator(handle)?,
            &find_note,
            &find_next,
            &find_previous,
            &replace_note,
            &start_dictation,
            &search_notebook,
            &PredefinedMenuItem::separator(handle)?,
            &spellcheck,
        ],
    )?;
    let view_menu = Submenu::with_items(
        handle,
        "View",
        true,
        &[
            &toggle_sidebar,
            &toggle_outline,
            &toggle_raw,
            &PredefinedMenuItem::separator(handle)?,
            &width_menu,
            &alignment_menu,
            &PredefinedMenuItem::separator(handle)?,
            &PredefinedMenuItem::fullscreen(handle, None)?,
        ],
    )?;
    let format_menu = Submenu::with_items(
        handle,
        "Format",
        true,
        &[
            &format_bold,
            &format_italic,
            &format_strike,
            &format_code,
            &format_highlight,
            &format_link,
            &format_clear,
            &PredefinedMenuItem::separator(handle)?,
            &format_paragraph,
            &format_h1,
            &format_h2,
            &format_h3,
            &format_h4,
            &format_h5,
            &format_h6,
            &PredefinedMenuItem::separator(handle)?,
            &format_bullet_list,
            &format_ordered_list,
            &format_task_list,
            &format_quote,
            &format_code_block,
            &format_divider,
            &PredefinedMenuItem::separator(handle)?,
            &format_table,
            &format_image,
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
            &format_menu,
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
    let active_label = app
        .webview_windows()
        .values()
        .find(|window| window.is_focused().unwrap_or(false))
        .map(|window| window.label().to_string())
        .or_else(|| {
            app.webview_windows()
                .values()
                .next()
                .map(|window| window.label().to_string())
        });
    let active_state = {
        let mut menu_states = state
            .menu_states
            .lock()
            .map_err(|error| error.to_string())?;
        menu_states.retain(|label, _| live_labels.contains(label));
        active_label
            .as_ref()
            .and_then(|label| menu_states.get(label))
            .cloned()
            .unwrap_or_default()
    };
    notebooks.sort_by(|a, b| a.name.cmp(&b.name).then(a.workspace.cmp(&b.workspace)));
    let menu = build_app_menu(app, &notebooks, &active_state).map_err(|error| error.to_string())?;
    app.set_menu(menu).map_err(|error| error.to_string())?;
    remove_macos_system_dictation_menu_item(app);
    Ok(())
}

#[cfg(target_os = "macos")]
fn remove_macos_system_dictation_menu_item(app: &AppHandle) {
    let _ = app.run_on_main_thread(|| {
        remove_macos_system_dictation_menu_item_on_main_thread();
    });
}

#[cfg(not(target_os = "macos"))]
fn remove_macos_system_dictation_menu_item(_app: &AppHandle) {}

#[cfg(target_os = "macos")]
fn remove_macos_system_dictation_menu_item_on_main_thread() {
    use objc2::MainThreadMarker;
    use objc2_app_kit::NSApplication;

    let Some(mtm) = MainThreadMarker::new() else {
        return;
    };
    let Some(main_menu) = NSApplication::sharedApplication(mtm).mainMenu() else {
        return;
    };
    let Some(edit_menu) = find_macos_submenu(&main_menu, "Edit") else {
        return;
    };

    let count = edit_menu.numberOfItems();
    let mut lower_system_cluster_start = None;
    for index in 0..count {
        let Some(item) = edit_menu.itemAtIndex(index) else {
            continue;
        };
        let title = item.title().to_string();
        if title == "AutoFill" || title == "Emoji & Symbols" {
            lower_system_cluster_start = Some(index);
            break;
        }
    }

    let Some(cluster_start) = lower_system_cluster_start else {
        return;
    };
    for index in (cluster_start..count).rev() {
        let Some(item) = edit_menu.itemAtIndex(index) else {
            continue;
        };
        if is_macos_system_dictation_title(&item.title().to_string()) {
            edit_menu.removeItemAtIndex(index);
        }
    }
}

#[cfg(target_os = "macos")]
fn find_macos_submenu(
    menu: &objc2_app_kit::NSMenu,
    title: &str,
) -> Option<objc2::rc::Retained<objc2_app_kit::NSMenu>> {
    let count = menu.numberOfItems();
    for index in 0..count {
        let item = menu.itemAtIndex(index)?;
        if item.title().to_string() == title {
            return item.submenu();
        }
    }
    None
}

#[cfg(target_os = "macos")]
fn is_macos_system_dictation_title(title: &str) -> bool {
    matches!(title, "Start Dictation..." | "Start Dictation…")
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

fn emit_menu_command(app: &AppHandle, command: &str) {
    if let Some(window) = active_menu_window(app) {
        dispatch_frontend_menu_action(
            &window,
            "tigrana-menu-command",
            serde_json::Value::String(command.to_string()),
        );
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
        .menu(|handle| build_app_menu(handle, &[], &AppMenuState::default()))
        .on_window_event(|window, event| {
            let app = window.app_handle();
            match event {
                WindowEvent::Destroyed => {
                    let state = app.state::<NotebookWindowState>();
                    if let Ok(mut windows) = state.windows.lock() {
                        windows.remove(window.label());
                    }
                    if let Ok(mut menu_states) = state.menu_states.lock() {
                        menu_states.remove(window.label());
                    }
                    let _ = rebuild_app_menu(app, &state);
                    let lock_state = app.state::<NoteEditLockState>();
                    release_note_edit_locks_for_window(&lock_state, window.label());
                }
                WindowEvent::Focused(true) => {
                    let state = app.state::<NotebookWindowState>();
                    let _ = rebuild_app_menu(app, &state);
                }
                _ => {}
            }
        })
        .on_menu_event(|app, event| match event.id().as_ref() {
            "open_settings" => {
                emit_menu_command(app, "open_settings");
            }
            "open_notebook" => {
                open_notebook_from_menu(app);
            }
            "manage_notebooks" => {
                manage_notebooks_from_menu(app);
            }
            "open_recently_deleted" => {
                emit_menu_command(app, "open_recently_deleted");
            }
            "new_notebook" => emit_menu_command(app, "new_notebook"),
            "new_note" => emit_menu_command(app, "new_note"),
            "new_folder" => emit_menu_command(app, "new_folder"),
            "new_tab" => emit_menu_command(app, "new_tab"),
            "save_note" => emit_menu_command(app, "save_note"),
            "export_markdown" => emit_menu_command(app, "export_markdown"),
            "export_html" => emit_menu_command(app, "export_html"),
            "print_note" => emit_menu_command(app, "print_note"),
            "find_note" => emit_menu_command(app, "find_note"),
            "find_next" => emit_menu_command(app, "find_next"),
            "find_previous" => emit_menu_command(app, "find_previous"),
            "replace_note" => emit_menu_command(app, "replace_note"),
            "start_dictation" => emit_menu_command(app, "start_dictation"),
            "search_notebook" => emit_menu_command(app, "search_notebook"),
            "toggle_spellcheck" => emit_menu_command(app, "toggle_spellcheck"),
            "toggle_sidebar" => emit_menu_command(app, "toggle_sidebar"),
            "toggle_outline" => emit_menu_command(app, "toggle_outline"),
            "toggle_raw_markdown" => emit_menu_command(app, "toggle_raw_markdown"),
            "width_comfortable" => emit_menu_command(app, "width_comfortable"),
            "width_narrow" => emit_menu_command(app, "width_narrow"),
            "width_full" => emit_menu_command(app, "width_full"),
            "align_left" => emit_menu_command(app, "align_left"),
            "align_center" => emit_menu_command(app, "align_center"),
            "format_bold" => emit_menu_command(app, "format_bold"),
            "format_italic" => emit_menu_command(app, "format_italic"),
            "format_strike" => emit_menu_command(app, "format_strike"),
            "format_code" => emit_menu_command(app, "format_code"),
            "format_highlight" => emit_menu_command(app, "format_highlight"),
            "format_link" => emit_menu_command(app, "format_link"),
            "format_clear" => emit_menu_command(app, "format_clear"),
            "format_paragraph" => emit_menu_command(app, "format_paragraph"),
            "format_h1" => emit_menu_command(app, "format_h1"),
            "format_h2" => emit_menu_command(app, "format_h2"),
            "format_h3" => emit_menu_command(app, "format_h3"),
            "format_h4" => emit_menu_command(app, "format_h4"),
            "format_h5" => emit_menu_command(app, "format_h5"),
            "format_h6" => emit_menu_command(app, "format_h6"),
            "format_bullet_list" => emit_menu_command(app, "format_bullet_list"),
            "format_ordered_list" => emit_menu_command(app, "format_ordered_list"),
            "format_task_list" => emit_menu_command(app, "format_task_list"),
            "format_quote" => emit_menu_command(app, "format_quote"),
            "format_code_block" => emit_menu_command(app, "format_code_block"),
            "format_divider" => emit_menu_command(app, "format_divider"),
            "format_table" => emit_menu_command(app, "format_table"),
            "format_image" => emit_menu_command(app, "format_image"),
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
            update_app_menu_state,
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
            open_external,
            write_export_text_file,
            print_current_webview
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

fn main() {
    run();
}
