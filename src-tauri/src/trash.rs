use crate::notebook_paths::{app_dir, normalize_relative};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::SystemTime;
use time::macros::format_description;
use time::OffsetDateTime;

const TRASH_RETENTION_DAYS: u64 = 30;

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TrashEntry {
    pub id: String,
    pub kind: String,
    pub original_path: String,
    pub display_name: String,
    pub trash_name: String,
    pub deleted_at: u64,
}

#[derive(Debug, Serialize, Deserialize, Default)]
struct TrashIndex {
    #[serde(default)]
    entries: Vec<TrashEntry>,
}

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
    SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
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

pub fn trash_item(root: &Path, relative_path: &str, kind: &str) -> Result<TrashEntry, String> {
    let relative = normalize_relative(relative_path)?;
    if relative.as_os_str().is_empty() {
        return Err("The notebook root cannot be deleted.".to_string());
    }
    let source = root.join(&relative);
    if !source.exists() {
        return Err("That item no longer exists.".to_string());
    }

    let items_dir = trash_items_dir(root);
    fs::create_dir_all(&items_dir).map_err(|error| error.to_string())?;

    let display_name = relative
        .file_name()
        .and_then(|name| name.to_str())
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

    let mut index = read_trash_index(root).unwrap_or_default();
    index.entries.push(entry.clone());
    write_trash_index(root, &index)?;
    Ok(entry)
}

pub fn list_trash(root: &Path) -> Vec<TrashEntry> {
    let index = read_trash_index(root).unwrap_or_default();
    index.entries
}

pub fn restore_trash(root: &Path, id: &str) -> Result<String, String> {
    let mut index = read_trash_index(root).unwrap_or_default();
    let pos = index
        .entries
        .iter()
        .position(|entry| entry.id == id)
        .ok_or_else(|| "Trash entry not found.".to_string())?;
    let entry = index.entries[pos].clone();

    let items_dir = trash_items_dir(root);
    let source = items_dir.join(&entry.trash_name);
    if !source.exists() {
        index.entries.remove(pos);
        write_trash_index(root, &index)?;
        return Err("That deleted item is missing from the trash.".to_string());
    }

    let original_rel = normalize_relative(&entry.original_path)?;
    let parent_rel = original_rel.parent().map(PathBuf::from).unwrap_or_default();
    let parent_abs = root.join(&parent_rel);
    if !parent_abs.starts_with(root) {
        return Err("Restore target escapes the notebook.".to_string());
    }
    fs::create_dir_all(&parent_abs).map_err(|error| error.to_string())?;

    let desired_name = original_rel
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or(&entry.display_name)
        .to_string();
    let date_label = date_suffix_from_millis(entry.deleted_at);
    let final_name = unique_name_in_dir(&parent_abs, &desired_name, &date_label);
    let target = parent_abs.join(&final_name);
    fs::rename(&source, &target).map_err(|error| error.to_string())?;

    index.entries.remove(pos);
    write_trash_index(root, &index)?;

    let restored = target
        .strip_prefix(root)
        .map(|path| path.to_string_lossy().replace('\\', "/"))
        .unwrap_or_else(|_| entry.original_path.clone());
    Ok(restored)
}

pub fn purge_trash(root: &Path, id: &str) -> Result<(), String> {
    let mut index = read_trash_index(root).unwrap_or_default();
    let pos = index
        .entries
        .iter()
        .position(|entry| entry.id == id)
        .ok_or_else(|| "Trash entry not found.".to_string())?;
    let entry = index.entries.remove(pos);

    let target = trash_items_dir(root).join(&entry.trash_name);
    if target.exists() {
        if target.is_dir() {
            fs::remove_dir_all(&target).map_err(|error| error.to_string())?;
        } else {
            fs::remove_file(&target).map_err(|error| error.to_string())?;
        }
    }
    write_trash_index(root, &index)?;
    Ok(())
}

pub fn purge_trash_all(root: &Path) -> Result<(), String> {
    let items_dir = trash_items_dir(root);
    if items_dir.exists() {
        fs::remove_dir_all(&items_dir).map_err(|error| error.to_string())?;
    }
    write_trash_index(root, &TrashIndex::default())?;
    Ok(())
}

pub fn cleanup_trash(root: &Path) -> Result<u32, String> {
    let mut index = read_trash_index(root).unwrap_or_default();
    let cutoff_millis = now_millis().saturating_sub(TRASH_RETENTION_DAYS * 24 * 60 * 60 * 1000);
    let items_dir = trash_items_dir(root);

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
    write_trash_index(root, &index)?;
    Ok(purged)
}
