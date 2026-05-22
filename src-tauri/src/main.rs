use base64::{engine::general_purpose, Engine as _};
use serde::{Deserialize, Serialize};
use notify::{Config, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Mutex;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::{AppHandle, Emitter, Manager};
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
struct TrashIdPayload {
    workspace: String,
    id: String,
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
    let root = safe_workspace(&payload.workspace)?;
    let note_path = safe_note_path(&payload.workspace, &payload.path)?;
    if let Some(parent) = note_path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    // Make sure the note carries an id in its frontmatter.
    let (_id, content_with_id, _mutated) = ensure_note_id_in_content(&payload.content);
    fs::write(&note_path, &content_with_id).map_err(|error| error.to_string())?;
    let _ = reindex_note_after_save(&root, &payload.path);
    Ok(())
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
    index.notes_by_id.insert(new_id.clone(), NoteRecord {
        id: new_id.clone(),
        path: path.clone(),
        title: note_title_from_path(&path),
    });
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
    let _ = write_folder_sidecar(&root, &path, &FolderSidecar { id: folder_id.clone() });
    let mut index = read_link_index_file(&root);
    index.folders_by_id.insert(folder_id.clone(), FolderRecord { id: folder_id.clone(), path: path.clone() });
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
    let new_relative = if target_parent.as_os_str().is_empty() {
        PathBuf::from(file_name)
    } else {
        target_parent.join(file_name)
    };
    let old_path = root.join(&old_relative);
    let new_path = root.join(&new_relative);

    let old_rel_str = payload.path.clone();
    let new_rel_str = new_relative.to_string_lossy().replace('\\', "/");

    if old_path != new_path {
        if new_path.exists() {
            return Err("A note with that title already exists in the target folder.".to_string());
        }
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

const INDEX_SCHEMA_VERSION: u32 = 1;

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct NoteRecord {
    id: String,
    path: String,
    title: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct FolderRecord {
    id: String,
    path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct LinkRef {
    source_id: String,
    target_id: Option<String>,
    target_kind: String,  // "note" | "folder" | "unknown"
    target_path: String,  // workspace-relative, no anchor
    display_text: String,
    anchor: Option<String>,
    occurrence: u32,
    broken: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LinkIndex {
    schema_version: u32,
    notes_by_id: HashMap<String, NoteRecord>,
    folders_by_id: HashMap<String, FolderRecord>,
    path_to_id: HashMap<String, String>,
    outbound: HashMap<String, Vec<LinkRef>>,
    inbound: HashMap<String, Vec<LinkRef>>,
}

impl Default for LinkIndex {
    fn default() -> Self {
        Self {
            schema_version: INDEX_SCHEMA_VERSION,
            notes_by_id: HashMap::new(),
            folders_by_id: HashMap::new(),
            path_to_id: HashMap::new(),
            outbound: HashMap::new(),
            inbound: HashMap::new(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct FolderSidecar {
    id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct EnsureIdentityPayload {
    workspace: String,
}

fn link_index_path(root: &Path) -> PathBuf {
    root.join(".lumen").join("index.json")
}

fn folder_sidecar_dir(root: &Path, relative: &str) -> Option<PathBuf> {
    if relative.is_empty() {
        return None;
    }
    Some(root.join(relative).join(".lumen"))
}

fn folder_sidecar_path(root: &Path, relative: &str) -> Option<PathBuf> {
    folder_sidecar_dir(root, relative).map(|dir| dir.join("folder.json"))
}

fn read_link_index_file(root: &Path) -> LinkIndex {
    let path = link_index_path(root);
    if !path.exists() {
        return LinkIndex::default();
    }
    let Ok(contents) = fs::read_to_string(&path) else {
        return LinkIndex::default();
    };
    serde_json::from_str(&contents).unwrap_or_default()
}

fn write_link_index_file(root: &Path, index: &LinkIndex) -> Result<(), String> {
    let lumen_dir = root.join(".lumen");
    fs::create_dir_all(&lumen_dir).map_err(|error| error.to_string())?;
    let json = serde_json::to_string_pretty(index).map_err(|error| error.to_string())?;
    fs::write(link_index_path(root), format!("{json}\n")).map_err(|error| error.to_string())
}

fn read_folder_sidecar(root: &Path, relative: &str) -> Option<FolderSidecar> {
    let path = folder_sidecar_path(root, relative)?;
    if !path.exists() {
        return None;
    }
    let contents = fs::read_to_string(&path).ok()?;
    serde_json::from_str::<FolderSidecar>(&contents).ok()
}

fn write_folder_sidecar(root: &Path, relative: &str, sidecar: &FolderSidecar) -> Result<(), String> {
    let Some(dir) = folder_sidecar_dir(root, relative) else { return Ok(()) };
    let Some(file) = folder_sidecar_path(root, relative) else { return Ok(()) };
    fs::create_dir_all(&dir).map_err(|error| error.to_string())?;
    let json = serde_json::to_string_pretty(sidecar).map_err(|error| error.to_string())?;
    fs::write(file, format!("{json}\n")).map_err(|error| error.to_string())
}

// Returns (id, mutated_content). If the note has no frontmatter `id`, one is minted
// and inserted; otherwise the existing id is returned and the content is unchanged.
fn ensure_note_id_in_content(content: &str) -> (String, String, bool) {
    let normalized = content.replace("\r\n", "\n");
    let (frontmatter, body, has_frontmatter) = split_frontmatter(&normalized);

    if has_frontmatter {
        if let Some(id) = read_frontmatter_field(&frontmatter, "id") {
            if !id.is_empty() {
                return (id, content.to_string(), false);
            }
        }
        let new_id = Uuid::new_v4().to_string();
        let new_frontmatter = insert_frontmatter_field(&frontmatter, "id", &new_id);
        let recombined = format!("---\n{new_frontmatter}\n---\n\n{}", body.trim_start_matches('\n'));
        (new_id, recombined, true)
    } else {
        let new_id = Uuid::new_v4().to_string();
        let recombined = format!("---\nid: {new_id}\n---\n\n{}", normalized.trim_start_matches('\n'));
        (new_id, recombined, true)
    }
}

fn split_frontmatter(content: &str) -> (String, String, bool) {
    let lines: Vec<&str> = content.split('\n').collect();
    if lines.is_empty() || lines[0].trim() != "---" {
        return (String::new(), content.to_string(), false);
    }
    let closing = lines.iter().enumerate().skip(1).find(|(_, line)| line.trim() == "---");
    let Some((closing_index, _)) = closing else {
        return (String::new(), content.to_string(), false);
    };
    let frontmatter = lines[1..closing_index].join("\n");
    let body = lines[(closing_index + 1)..].join("\n");
    (frontmatter, body, true)
}

fn read_frontmatter_field(frontmatter: &str, key: &str) -> Option<String> {
    for line in frontmatter.split('\n') {
        let trimmed = line.trim_start();
        if trimmed.starts_with('#') {
            continue;
        }
        if let Some((k, v)) = trimmed.split_once(':') {
            if k.trim() == key {
                return Some(v.trim().to_string());
            }
        }
    }
    None
}

fn insert_frontmatter_field(frontmatter: &str, key: &str, value: &str) -> String {
    // Prepend the field; the writer side will keep this stable.
    let trimmed = frontmatter.trim_end();
    if trimmed.is_empty() {
        format!("{key}: {value}")
    } else {
        format!("{key}: {value}\n{trimmed}")
    }
}

// --- Markdown link extraction (simple scanner, no regex) ---

#[derive(Debug, Clone)]
struct MdLink {
    text: String,
    href: String,
    href_start: usize,
    href_end: usize,
    is_image: bool,
}

fn extract_md_links(text: &str) -> Vec<MdLink> {
    let bytes = text.as_bytes();
    let len = bytes.len();
    let mut links = Vec::new();
    let mut i = 0usize;
    let mut in_code_block = false;

    while i < len {
        if i == 0 || bytes[i - 1] == b'\n' {
            // detect fenced code block
            let rest = &bytes[i..];
            if rest.starts_with(b"```") || rest.starts_with(b"~~~") {
                in_code_block = !in_code_block;
                while i < len && bytes[i] != b'\n' {
                    i += 1;
                }
                continue;
            }
        }
        if in_code_block {
            i += 1;
            continue;
        }
        // inline code: skip backtick-delimited spans
        if bytes[i] == b'`' {
            // count backticks
            let mut run = 0;
            while i + run < len && bytes[i + run] == b'`' {
                run += 1;
            }
            let close_pat = vec![b'`'; run];
            let after = i + run;
            // find matching closing run
            let mut j = after;
            while j + run <= len {
                if &bytes[j..j + run] == close_pat.as_slice() {
                    // ensure no longer backtick run
                    if j + run == len || bytes[j + run] != b'`' {
                        break;
                    }
                }
                j += 1;
            }
            if j + run > len {
                // no close, treat the rest as not code
                i += run;
                continue;
            }
            i = j + run;
            continue;
        }

        if bytes[i] == b'\\' && i + 1 < len {
            i += 2;
            continue;
        }

        if bytes[i] == b'[' {
            let is_image = i > 0 && bytes[i - 1] == b'!';
            let text_start = i + 1;
            let mut depth = 1usize;
            let mut j = text_start;
            while j < len {
                match bytes[j] {
                    b'\\' if j + 1 < len => {
                        j += 2;
                        continue;
                    }
                    b'[' => depth += 1,
                    b']' => {
                        depth -= 1;
                        if depth == 0 {
                            break;
                        }
                    }
                    b'\n' => break,
                    _ => {}
                }
                j += 1;
            }
            if j >= len || bytes[j] != b']' {
                i += 1;
                continue;
            }
            let text_end = j;
            if bytes.get(text_end + 1) != Some(&b'(') {
                i = text_end + 1;
                continue;
            }
            let href_start = text_end + 2;
            let mut k = href_start;
            let mut paren_depth = 1usize;
            while k < len {
                match bytes[k] {
                    b'\\' if k + 1 < len => {
                        k += 2;
                        continue;
                    }
                    b'(' => paren_depth += 1,
                    b')' => {
                        paren_depth -= 1;
                        if paren_depth == 0 {
                            break;
                        }
                    }
                    b'\n' => break,
                    _ => {}
                }
                k += 1;
            }
            if k >= len || bytes[k] != b')' {
                i = text_end + 1;
                continue;
            }
            let href_end = k;
            let text_str = std::str::from_utf8(&bytes[text_start..text_end]).unwrap_or("").to_string();
            let href_str_raw = std::str::from_utf8(&bytes[href_start..href_end]).unwrap_or("").to_string();
            // Markdown links sometimes have title: (href "title"). Strip trailing title.
            let href_str = strip_link_title(&href_str_raw);
            links.push(MdLink {
                text: text_str,
                href: href_str,
                href_start,
                href_end,
                is_image,
            });
            i = href_end + 1;
        } else {
            i += 1;
        }
    }

    links
}

fn strip_link_title(raw: &str) -> String {
    // CommonMark allows an optional title after the href: (url "title") or (url 'title').
    // The title is delimited by quotes preceded by whitespace. Plain unquoted spaces in
    // the href are not legal CommonMark, but the editor emits them for paths like
    // "Folder/My Note.md" — we keep those intact.
    let trimmed = raw.trim();
    let bytes = trimmed.as_bytes();
    let mut last_quote_start: Option<usize> = None;
    let mut i = 0;
    while i < bytes.len() {
        if (bytes[i] == b'"' || bytes[i] == b'\'') && i > 0 && bytes[i - 1].is_ascii_whitespace() {
            // Look for matching closing quote that takes us to end of trimmed.
            let quote = bytes[i];
            let mut j = i + 1;
            while j < bytes.len() && bytes[j] != quote {
                j += 1;
            }
            if j < bytes.len() && bytes[j] == quote {
                // Title must end at the end of the trimmed input.
                if trimmed[j + 1..].trim().is_empty() {
                    last_quote_start = Some(i);
                    break;
                }
            }
        }
        i += 1;
    }
    if let Some(start) = last_quote_start {
        return trimmed[..start].trim_end().to_string();
    }
    trimmed.to_string()
}

fn is_internal_href(href: &str) -> bool {
    if href.is_empty() {
        return false;
    }
    if href.starts_with("//") || href.starts_with('#') {
        return false;
    }
    // detect scheme: letter followed by alnum/+/./- then ':'
    let bytes = href.as_bytes();
    if !bytes.is_empty() && (bytes[0].is_ascii_alphabetic()) {
        let mut i: usize = 1;
        while i < bytes.len() {
            let b = bytes[i];
            if b.is_ascii_alphanumeric() || b == b'+' || b == b'.' || b == b'-' {
                i += 1;
            } else {
                break;
            }
        }
        if i < bytes.len() && bytes[i] == b':' {
            return false;
        }
    }
    true
}

fn split_href_anchor(href: &str) -> (String, Option<String>) {
    if let Some(idx) = href.find('#') {
        return (href[..idx].to_string(), Some(href[idx + 1..].to_string()));
    }
    (href.to_string(), None)
}

fn decode_uri(input: &str) -> String {
    let bytes = input.as_bytes();
    let mut out: Vec<u8> = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            let h1 = (bytes[i + 1] as char).to_digit(16);
            let h2 = (bytes[i + 2] as char).to_digit(16);
            if let (Some(a), Some(b)) = (h1, h2) {
                out.push(((a << 4) | b) as u8);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8(out).unwrap_or_else(|_| input.to_string())
}

fn normalize_internal_path(href_path: &str) -> String {
    let decoded = decode_uri(href_path);
    let stripped = decoded.trim_start_matches("./");
    stripped.replace('\\', "/")
}

// --- Identity + index lifecycle ---

fn enumerate_workspace(root: &Path) -> Result<(Vec<PathBuf>, Vec<PathBuf>), String> {
    let mut notes = Vec::new();
    let mut folders = Vec::new();
    for entry in WalkDir::new(root)
        .into_iter()
        .filter_entry(|entry| !is_hidden_entry(entry.path()))
    {
        let entry = entry.map_err(|error| error.to_string())?;
        let path = entry.path();
        if path == root {
            continue;
        }
        if path.is_dir() {
            folders.push(path.to_path_buf());
        } else if path.extension().and_then(|ext| ext.to_str()) == Some("md") {
            notes.push(path.to_path_buf());
        }
    }
    Ok((notes, folders))
}

fn relative_path(root: &Path, path: &Path) -> Result<String, String> {
    Ok(path
        .strip_prefix(root)
        .map_err(|error| error.to_string())?
        .to_string_lossy()
        .replace('\\', "/"))
}

fn note_title_from_path(rel: &str) -> String {
    Path::new(rel)
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("Untitled")
        .to_string()
}

fn rebuild_index_for_root(root: &Path) -> Result<LinkIndex, String> {
    let (notes, folders) = enumerate_workspace(root)?;
    let mut index = LinkIndex::default();

    // Folders first so we can resolve folder targets.
    for folder_abs in &folders {
        let rel = relative_path(root, folder_abs)?;
        let sidecar_id = read_folder_sidecar(root, &rel).map(|s| s.id);
        let id = sidecar_id.unwrap_or_else(|| Uuid::new_v4().to_string());
        // Always ensure sidecar exists for non-root folders.
        let _ = write_folder_sidecar(root, &rel, &FolderSidecar { id: id.clone() });
        index.folders_by_id.insert(id.clone(), FolderRecord { id: id.clone(), path: rel.clone() });
        index.path_to_id.insert(rel, id);
    }

    // Notes: assign id via frontmatter.
    for note_abs in &notes {
        let rel = relative_path(root, note_abs)?;
        let raw = fs::read_to_string(note_abs).unwrap_or_default();
        let (id, new_content, mutated) = ensure_note_id_in_content(&raw);
        if mutated {
            if let Err(error) = fs::write(note_abs, &new_content) {
                return Err(format!("Failed to write id into {rel}: {error}"));
            }
        }
        index.notes_by_id.insert(id.clone(), NoteRecord {
            id: id.clone(),
            path: rel.clone(),
            title: note_title_from_path(&rel),
        });
        index.path_to_id.insert(rel, id);
    }

    // Now parse links for each note.
    let note_ids: Vec<String> = index.notes_by_id.keys().cloned().collect();
    for note_id in note_ids {
        let path = index.notes_by_id.get(&note_id).map(|r| r.path.clone());
        let Some(rel) = path else { continue };
        let abs = root.join(&rel);
        let raw = fs::read_to_string(&abs).unwrap_or_default();
        let refs = parse_links_for_note(&note_id, &raw, &index);
        update_index_links_for_source(&mut index, &note_id, refs);
    }

    write_link_index_file(root, &index)?;
    Ok(index)
}

fn parse_links_for_note(source_id: &str, content: &str, index: &LinkIndex) -> Vec<LinkRef> {
    let (_, body, _) = split_frontmatter(content);
    let scan_text = if body.is_empty() { content.to_string() } else { body };
    let raw = extract_md_links(&scan_text);
    let mut out = Vec::new();
    let mut occurrence = 0u32;
    for link in raw {
        if link.is_image {
            continue;
        }
        if !is_internal_href(&link.href) {
            continue;
        }
        let (raw_path, anchor) = split_href_anchor(&link.href);
        let normalized = normalize_internal_path(&raw_path);
        if normalized.is_empty() {
            continue;
        }
        let resolved_id = index.path_to_id.get(&normalized).cloned();
        let (target_kind, broken) = match &resolved_id {
            Some(id) => {
                if index.notes_by_id.contains_key(id) {
                    ("note".to_string(), false)
                } else if index.folders_by_id.contains_key(id) {
                    ("folder".to_string(), false)
                } else {
                    ("unknown".to_string(), true)
                }
            }
            None => ("unknown".to_string(), true),
        };
        out.push(LinkRef {
            source_id: source_id.to_string(),
            target_id: resolved_id,
            target_kind,
            target_path: normalized,
            display_text: link.text.clone(),
            anchor,
            occurrence,
            broken,
        });
        occurrence += 1;
    }
    out
}

fn update_index_links_for_source(index: &mut LinkIndex, source_id: &str, new_refs: Vec<LinkRef>) {
    // Remove existing inbound entries that came from this source.
    if let Some(prev) = index.outbound.get(source_id).cloned() {
        for entry in prev {
            if let Some(target_id) = entry.target_id {
                if let Some(list) = index.inbound.get_mut(&target_id) {
                    list.retain(|r| r.source_id != source_id);
                }
            }
        }
    }
    // Insert new ones.
    for r in &new_refs {
        if let Some(target_id) = &r.target_id {
            index.inbound.entry(target_id.clone()).or_default().push(r.clone());
        }
    }
    if new_refs.is_empty() {
        index.outbound.remove(source_id);
    } else {
        index.outbound.insert(source_id.to_string(), new_refs);
    }
}

// Called whenever a note file's content is written.
fn reindex_note_after_save(root: &Path, rel: &str) -> Result<(), String> {
    let mut index = read_link_index_file(root);
    let abs = root.join(rel);
    let content = fs::read_to_string(&abs).unwrap_or_default();
    // Make sure note has an id, and pick it up.
    let id_in_file = read_frontmatter_field(&split_frontmatter(&content).0, "id");
    let Some(id) = id_in_file else { return Ok(()) };
    index.notes_by_id.insert(id.clone(), NoteRecord {
        id: id.clone(),
        path: rel.to_string(),
        title: note_title_from_path(rel),
    });
    index.path_to_id.insert(rel.to_string(), id.clone());
    let refs = parse_links_for_note(&id, &content, &index);
    update_index_links_for_source(&mut index, &id, refs);
    write_link_index_file(root, &index)
}

// Rewrites ALL link occurrences whose normalized path equals `old_path` to `new_path`.
// Returns the number of links rewritten.
fn rewrite_links_in_content(content: &str, old_path: &str, new_path: &str) -> (String, u32) {
    let (frontmatter, body, has_frontmatter) = split_frontmatter(content);
    let body_for_scan = if has_frontmatter { body } else { content.to_string() };
    let links = extract_md_links(&body_for_scan);
    let mut new_body = body_for_scan.clone();
    let mut mutations: Vec<(usize, usize, String)> = Vec::new();
    let mut count = 0u32;
    for link in &links {
        if link.is_image {
            continue;
        }
        if !is_internal_href(&link.href) {
            continue;
        }
        let (raw_path, anchor) = split_href_anchor(&link.href);
        let normalized = normalize_internal_path(&raw_path);
        if normalized == old_path {
            let new_href = match anchor {
                Some(a) => format!("{}#{}", new_path, a),
                None => new_path.to_string(),
            };
            mutations.push((link.href_start, link.href_end, new_href));
            count += 1;
        }
    }
    mutations.sort_by(|a, b| b.0.cmp(&a.0));
    for (start, end, replacement) in mutations {
        new_body.replace_range(start..end, &replacement);
    }
    let final_content = if has_frontmatter {
        format!("---\n{frontmatter}\n---\n{new_body}")
    } else {
        new_body
    };
    (final_content, count)
}

// Repairs inbound links to a single id whose path changed from old_path -> new_path.
// Rewrites the affected source files and updates path snapshots in the index.
fn repair_inbound_links(root: &Path, index: &mut LinkIndex, target_id: &str, old_path: &str, new_path: &str) -> Result<u32, String> {
    let mut rewritten = 0u32;
    let sources: HashSet<String> = index
        .inbound
        .get(target_id)
        .map(|list| list.iter().map(|r| r.source_id.clone()).collect())
        .unwrap_or_default();
    for source_id in sources {
        let Some(source_record) = index.notes_by_id.get(&source_id).cloned() else { continue };
        let source_abs = root.join(&source_record.path);
        let original = match fs::read_to_string(&source_abs) {
            Ok(s) => s,
            Err(_) => continue,
        };
        let (new_content, count) = rewrite_links_in_content(&original, old_path, new_path);
        if count > 0 {
            fs::write(&source_abs, &new_content).map_err(|error| error.to_string())?;
            rewritten += count;
            // Reparse this source's links to refresh outbound/inbound cleanly.
            let refs = parse_links_for_note(&source_id, &new_content, index);
            update_index_links_for_source(index, &source_id, refs);
        }
    }
    Ok(rewritten)
}

fn move_index_path(index: &mut LinkIndex, old_path: &str, new_path: &str, id: &str, kind: &str) {
    index.path_to_id.remove(old_path);
    index.path_to_id.insert(new_path.to_string(), id.to_string());
    match kind {
        "note" => {
            if let Some(rec) = index.notes_by_id.get_mut(id) {
                rec.path = new_path.to_string();
                rec.title = note_title_from_path(new_path);
            }
        }
        "folder" => {
            if let Some(rec) = index.folders_by_id.get_mut(id) {
                rec.path = new_path.to_string();
            }
        }
        _ => {}
    }
}

// Updates path mappings for a folder and everything it contains after a rename/move,
// and rewrites inbound links to every affected target. Caller must pass paths that
// have already moved on disk.
fn repair_subtree_paths(root: &Path, index: &mut LinkIndex, old_folder_path: &str, new_folder_path: &str) -> Result<(), String> {
    if old_folder_path == new_folder_path {
        return Ok(());
    }
    // Snapshot ids that live under the old folder, plus the folder itself.
    let mut affected: Vec<(String, String, String, String)> = Vec::new(); // (id, kind, old_path, new_path)
    if let Some(id) = index.path_to_id.get(old_folder_path).cloned() {
        affected.push((id, "folder".to_string(), old_folder_path.to_string(), new_folder_path.to_string()));
    }
    let prefix = format!("{old_folder_path}/");
    let descendants: Vec<(String, String)> = index
        .path_to_id
        .iter()
        .filter(|(p, _)| p.starts_with(&prefix))
        .map(|(p, id)| (p.clone(), id.clone()))
        .collect();
    for (old_path, id) in descendants {
        let new_path = format!("{new_folder_path}{}", &old_path[old_folder_path.len()..]);
        let kind = if index.notes_by_id.contains_key(&id) {
            "note".to_string()
        } else if index.folders_by_id.contains_key(&id) {
            "folder".to_string()
        } else {
            continue;
        };
        affected.push((id, kind, old_path, new_path));
    }

    // Update path snapshots first so we can read source files at their CURRENT
    // on-disk locations (some sources may themselves live inside the moved subtree).
    for (id, kind, old_path, new_path) in &affected {
        move_index_path(index, old_path, new_path, id, kind);
    }

    // Now rewrite inbound link occurrences for each affected target.
    for (id, _kind, old_path, new_path) in &affected {
        let _ = repair_inbound_links(root, index, id, old_path, new_path);
    }
    Ok(())
}

fn forget_path_from_index(index: &mut LinkIndex, path: &str) {
    let Some(id) = index.path_to_id.remove(path) else { return };
    index.notes_by_id.remove(&id);
    index.folders_by_id.remove(&id);
    // Drop any outbound originating from this id.
    if let Some(refs) = index.outbound.remove(&id) {
        for r in refs {
            if let Some(target_id) = r.target_id {
                if let Some(list) = index.inbound.get_mut(&target_id) {
                    list.retain(|x| x.source_id != id);
                }
            }
        }
    }
    // Drop inbound entries pointing at this id (they become broken).
    if let Some(refs) = index.inbound.remove(&id) {
        for r in &refs {
            if let Some(list) = index.outbound.get_mut(&r.source_id) {
                for x in list.iter_mut() {
                    if x.target_id.as_deref() == Some(id.as_str()) {
                        x.target_id = None;
                        x.target_kind = "unknown".to_string();
                        x.broken = true;
                    }
                }
            }
        }
    }
}

fn forget_subtree_from_index(index: &mut LinkIndex, folder_path: &str) {
    let to_remove: Vec<String> = index
        .path_to_id
        .keys()
        .filter(|p| p.as_str() == folder_path || p.starts_with(&format!("{folder_path}/")))
        .cloned()
        .collect();
    for p in to_remove {
        forget_path_from_index(index, &p);
    }
}

#[tauri::command]
fn ensure_workspace_identity(payload: EnsureIdentityPayload) -> Result<(), String> {
    let root = safe_workspace(&payload.workspace)?;
    fs::create_dir_all(root.join(".lumen")).map_err(|error| error.to_string())?;
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

// ---------- Recently Deleted (trash) ----------

const TRASH_RETENTION_DAYS: u64 = 30;

fn trash_root(workspace: &Path) -> PathBuf {
    workspace.join(".lumen").join("trash")
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
    datetime.format(&fmt).unwrap_or_else(|_| "unknown-date".to_string())
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
fn open_external(url: String) -> Result<(), String> {
    if url.is_empty() {
        return Err("URL is empty.".to_string());
    }
    let lower = url.to_lowercase();
    let allowed = ["http://", "https://", "mailto:", "tel:", "ftp://", "ftps://"];
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
            let recently_deleted = MenuItem::with_id(handle, "open_recently_deleted", "Recently Deleted", true, None::<&str>)?;
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
                    &Submenu::with_items(
                        handle,
                        "View",
                        true,
                        &[
                            &PredefinedMenuItem::fullscreen(handle, None)?,
                            &PredefinedMenuItem::separator(handle)?,
                            &recently_deleted,
                        ],
                    )?,
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
                "open_recently_deleted" => {
                    let _ = app.emit("open-recently-deleted", ());
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
            trash_note,
            trash_folder,
            list_trash,
            restore_trash,
            purge_trash,
            purge_trash_all,
            cleanup_trash,
            read_workspace_metadata,
            write_workspace_metadata,
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
