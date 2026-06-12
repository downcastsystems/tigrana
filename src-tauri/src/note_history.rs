use crate::link_index::{
    ensure_note_id_in_content_with_preferred, read_frontmatter_field, read_link_index_file,
    reindex_note_after_save, split_frontmatter,
};
use crate::notebook_paths::{app_dir, note_title_from_path};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::fs;
use std::hash::{Hash, Hasher};
use std::path::{Path, PathBuf};
use std::{collections::hash_map::DefaultHasher, time::SystemTime};
use uuid::Uuid;

const NOTE_HISTORY_AUTOSAVE_THROTTLE_MS: u64 = 10 * 60 * 1000;
const NOTE_HISTORY_KEEP_ALL_MS: u64 = 24 * 60 * 60 * 1000;
const NOTE_HISTORY_KEEP_HOURLY_MS: u64 = 7 * 24 * 60 * 60 * 1000;
const NOTE_HISTORY_KEEP_DAILY_MS: u64 = 90 * 24 * 60 * 60 * 1000;
const NOTE_HISTORY_MAX_BYTES: u64 = 250 * 1024 * 1024;

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct NoteVersionEntry {
    pub id: String,
    pub note_id: Option<String>,
    pub path: String,
    pub title: String,
    pub file_name: String,
    pub created_at: u64,
    pub reason: String,
    pub content_length: u64,
    pub content_hash: String,
}

#[derive(Debug, Serialize, Deserialize, Default)]
struct NoteHistoryIndex {
    #[serde(default)]
    entries: Vec<NoteVersionEntry>,
}

pub enum NoteSnapshotMode {
    Throttled,
    Force,
}

fn note_history_root(workspace: &Path) -> PathBuf {
    app_dir(workspace).join("history").join("notes")
}

fn note_history_items_dir(workspace: &Path) -> PathBuf {
    note_history_root(workspace).join("items")
}

fn note_history_index_path(workspace: &Path) -> PathBuf {
    note_history_root(workspace).join("index.json")
}

fn read_note_history_index(workspace: &Path) -> Result<NoteHistoryIndex, String> {
    let path = note_history_index_path(workspace);
    if !path.exists() {
        return Ok(NoteHistoryIndex::default());
    }
    let bytes = fs::read(&path).map_err(|error| error.to_string())?;
    if bytes.is_empty() {
        return Ok(NoteHistoryIndex::default());
    }
    serde_json::from_slice::<NoteHistoryIndex>(&bytes).map_err(|error| error.to_string())
}

fn write_note_history_index(workspace: &Path, index: &NoteHistoryIndex) -> Result<(), String> {
    let root = note_history_root(workspace);
    fs::create_dir_all(&root).map_err(|error| error.to_string())?;
    let json = serde_json::to_vec_pretty(index).map_err(|error| error.to_string())?;
    fs::write(note_history_index_path(workspace), json).map_err(|error| error.to_string())
}

fn note_content_hash(content: &str) -> String {
    let mut hasher = DefaultHasher::new();
    content.hash(&mut hasher);
    format!("{:016x}", hasher.finish())
}

fn normalized_note_content(content: &str) -> String {
    content.replace("\r\n", "\n").trim_end().to_string()
}

pub fn note_history_reason(existing: &str, incoming: &str) -> String {
    let existing_len = existing.trim().len();
    let incoming_len = incoming.trim().len();
    if existing_len > 500 && incoming_len.saturating_mul(2) < existing_len {
        "large-change".to_string()
    } else {
        "save".to_string()
    }
}

fn note_id_from_content(content: &str) -> Option<String> {
    let (frontmatter, _, has_frontmatter) = split_frontmatter(content);
    if has_frontmatter {
        read_frontmatter_field(&frontmatter, "id")
    } else {
        None
    }
}

fn note_history_key(path: &str, note_id: Option<&str>) -> String {
    note_id.unwrap_or(path).to_string()
}

fn note_history_entry_key(entry: &NoteVersionEntry) -> String {
    note_history_key(&entry.path, entry.note_id.as_deref())
}

fn note_title_from_content_or_path(content: &str, path: &str) -> String {
    let (_, body, has_frontmatter) = split_frontmatter(content);
    let source = if has_frontmatter {
        body.as_str()
    } else {
        content
    };
    let first_line = source.lines().find(|line| !line.trim().is_empty());
    if let Some(line) = first_line {
        if let Some(title) = line.trim().strip_prefix("# ") {
            let trimmed = title.trim();
            if !trimmed.is_empty() {
                return trimmed.to_string();
            }
        }
    }
    note_title_from_path(path)
}

pub fn create_note_version_snapshot(
    root: &Path,
    path: &str,
    existing_content: &str,
    incoming_content: &str,
    reason: &str,
    mode: NoteSnapshotMode,
) -> Result<Option<NoteVersionEntry>, String> {
    if normalized_note_content(existing_content) == normalized_note_content(incoming_content) {
        return Ok(None);
    }

    let note_id =
        note_id_from_content(existing_content).or_else(|| note_id_from_content(incoming_content));
    let key = note_history_key(path, note_id.as_deref());
    let existing_hash = note_content_hash(existing_content);
    let now = now_millis();
    let mut index = read_note_history_index(root).unwrap_or_default();

    if index
        .entries
        .iter()
        .filter(|entry| note_history_entry_key(entry) == key)
        .any(|entry| entry.content_hash == existing_hash)
    {
        return Ok(None);
    }

    if matches!(mode, NoteSnapshotMode::Throttled) && reason != "large-change" {
        let recent = index
            .entries
            .iter()
            .filter(|entry| note_history_entry_key(entry) == key)
            .map(|entry| entry.created_at)
            .max()
            .is_some_and(|created_at| {
                now.saturating_sub(created_at) < NOTE_HISTORY_AUTOSAVE_THROTTLE_MS
            });
        if recent {
            return Ok(None);
        }
    }

    let items_dir = note_history_items_dir(root);
    fs::create_dir_all(&items_dir).map_err(|error| error.to_string())?;
    let id = format!("{}-{}", now, Uuid::new_v4());
    let file_name = format!("{id}.md");
    fs::write(items_dir.join(&file_name), existing_content).map_err(|error| error.to_string())?;

    let entry = NoteVersionEntry {
        id,
        note_id,
        path: path.to_string(),
        title: note_title_from_content_or_path(existing_content, path),
        file_name,
        created_at: now,
        reason: reason.to_string(),
        content_length: existing_content.len() as u64,
        content_hash: existing_hash,
    };

    index.entries.push(entry.clone());
    cleanup_note_history(root, &mut index);
    write_note_history_index(root, &index)?;
    Ok(Some(entry))
}

fn cleanup_note_history(root: &Path, index: &mut NoteHistoryIndex) {
    let now = now_millis();
    let mut kept: Vec<NoteVersionEntry> = Vec::new();
    let mut seen_hourly: HashSet<String> = HashSet::new();
    let mut seen_daily: HashSet<String> = HashSet::new();

    index
        .entries
        .sort_by(|a, b| b.created_at.cmp(&a.created_at));
    for entry in index.entries.drain(..) {
        let age = now.saturating_sub(entry.created_at);
        let key = note_history_entry_key(&entry);
        let keep = if age <= NOTE_HISTORY_KEEP_ALL_MS {
            true
        } else if age <= NOTE_HISTORY_KEEP_HOURLY_MS {
            let bucket = entry.created_at / (60 * 60 * 1000);
            seen_hourly.insert(format!("{key}:{bucket}"))
        } else if age <= NOTE_HISTORY_KEEP_DAILY_MS {
            let bucket = entry.created_at / (24 * 60 * 60 * 1000);
            seen_daily.insert(format!("{key}:{bucket}"))
        } else {
            false
        };

        if keep {
            kept.push(entry);
        } else {
            let _ = fs::remove_file(note_history_items_dir(root).join(&entry.file_name));
        }
    }

    let mut total_bytes: u64 = kept.iter().map(|entry| entry.content_length).sum();
    while total_bytes > NOTE_HISTORY_MAX_BYTES {
        let Some(entry) = kept.pop() else {
            break;
        };
        total_bytes = total_bytes.saturating_sub(entry.content_length);
        let _ = fs::remove_file(note_history_items_dir(root).join(&entry.file_name));
    }

    kept.sort_by(|a, b| b.created_at.cmp(&a.created_at));
    index.entries = kept;
}

pub fn list_note_versions(
    root: &Path,
    path: &str,
    note_path: &Path,
) -> Result<Vec<NoteVersionEntry>, String> {
    let current_content = fs::read_to_string(note_path).unwrap_or_default();
    let current_id = note_id_from_content(&current_content)
        .or_else(|| read_link_index_file(root).path_to_id.get(path).cloned());
    let key = note_history_key(path, current_id.as_deref());
    let mut index = read_note_history_index(root).unwrap_or_default();
    cleanup_note_history(root, &mut index);
    let _ = write_note_history_index(root, &index);
    let mut entries = index
        .entries
        .into_iter()
        .filter(|entry| note_history_entry_key(entry) == key)
        .collect::<Vec<_>>();
    entries.sort_by(|a, b| b.created_at.cmp(&a.created_at));
    Ok(entries)
}

pub fn read_note_version(root: &Path, id: &str) -> Result<String, String> {
    let index = read_note_history_index(root).unwrap_or_default();
    let entry = index
        .entries
        .iter()
        .find(|entry| entry.id == id)
        .ok_or_else(|| "Version not found.".to_string())?;
    fs::read_to_string(note_history_items_dir(root).join(&entry.file_name))
        .map_err(|error| error.to_string())
}

pub fn restore_note_version(
    root: &Path,
    path: &str,
    note_path: &Path,
    id: &str,
) -> Result<String, String> {
    let index = read_note_history_index(root).unwrap_or_default();
    let entry = index
        .entries
        .iter()
        .find(|entry| entry.id == id)
        .ok_or_else(|| "Version not found.".to_string())?;
    let version_content = fs::read_to_string(note_history_items_dir(root).join(&entry.file_name))
        .map_err(|error| error.to_string())?;

    let current_content = fs::read_to_string(note_path).ok();
    let current_id = current_content
        .as_deref()
        .and_then(note_id_from_content)
        .or_else(|| read_link_index_file(root).path_to_id.get(path).cloned());
    let current_key = note_history_key(path, current_id.as_deref());
    if note_history_entry_key(entry) != current_key {
        return Err("That version does not belong to this note.".to_string());
    }

    if let Some(existing) = current_content.as_deref() {
        create_note_version_snapshot(
            root,
            path,
            existing,
            &version_content,
            "restore",
            NoteSnapshotMode::Force,
        )?;
    }

    let (_id, content_with_id, _mutated) =
        ensure_note_id_in_content_with_preferred(&version_content, current_id);
    fs::write(note_path, &content_with_id).map_err(|error| error.to_string())?;
    let _ = reindex_note_after_save(root, path);
    Ok(content_with_id)
}

fn now_millis() -> u64 {
    SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0)
}
