use crate::notebook_paths::{app_dir, metadata_path};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::fs;
use std::path::Path;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FolderPlacement {
    Before,
    After,
}

#[derive(Debug, Clone, Copy)]
pub struct FolderSiblingPlacement<'a> {
    pub target_path: &'a str,
    pub placement: FolderPlacement,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceMetadata {
    #[serde(default)]
    pub folder_order: Map<String, Value>,
    #[serde(default)]
    pub note_order: Map<String, Value>,
    #[serde(default)]
    pub pinned_notes: Map<String, Value>,
    #[serde(default)]
    pub folder_icons: Map<String, Value>,
    #[serde(default)]
    pub folder_colors: Map<String, Value>,
    #[serde(default)]
    pub note_icons: Map<String, Value>,
    #[serde(default)]
    pub note_positions: Map<String, Value>,
    #[serde(default)]
    pub bookmarks: Vec<Value>,
    #[serde(default = "default_true")]
    pub bookmarks_expanded: bool,
    #[serde(default)]
    pub expanded_folders: Map<String, Value>,
    #[serde(default)]
    pub welcome_note_added: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub appearance: Option<Value>,
}

impl Default for WorkspaceMetadata {
    fn default() -> Self {
        Self {
            folder_order: Map::new(),
            note_order: Map::new(),
            pinned_notes: Map::new(),
            folder_icons: Map::new(),
            folder_colors: Map::new(),
            note_icons: Map::new(),
            note_positions: Map::new(),
            bookmarks: Vec::new(),
            bookmarks_expanded: true,
            expanded_folders: Map::new(),
            welcome_note_added: false,
            appearance: None,
        }
    }
}

pub fn read_workspace_metadata(root: &Path) -> Result<WorkspaceMetadata, String> {
    let path = metadata_path(root);
    if !path.exists() {
        return Ok(WorkspaceMetadata::default());
    }
    let contents = fs::read_to_string(path).map_err(|error| error.to_string())?;
    serde_json::from_str(&contents).map_err(|error| error.to_string())
}

pub fn write_workspace_metadata(root: &Path, metadata: &WorkspaceMetadata) -> Result<(), String> {
    fs::create_dir_all(app_dir(root)).map_err(|error| error.to_string())?;
    let contents = serde_json::to_string_pretty(metadata).map_err(|error| error.to_string())?;
    write_atomic(&metadata_path(root), &format!("{contents}\n"))
}

pub fn repair_note_path(
    metadata: &mut WorkspaceMetadata,
    old_path: &str,
    new_path: &str,
    old_parent: &str,
    new_parent: &str,
) {
    replace_exact_in_array_map_values(&mut metadata.note_order, old_path, new_path);
    replace_exact_map_key(&mut metadata.pinned_notes, old_path, new_path);
    replace_exact_map_key(&mut metadata.note_icons, old_path, new_path);
    replace_exact_map_key(&mut metadata.note_positions, old_path, new_path);
    if let Some(position) = metadata.note_positions.get_mut(new_path) {
        replace_object_path(position, old_path, new_path, false);
    }
    for bookmark in &mut metadata.bookmarks {
        if bookmark.get("kind").and_then(Value::as_str) == Some("note") {
            replace_object_path(bookmark, old_path, new_path, false);
        }
    }

    if old_parent != new_parent {
        remove_from_order(&mut metadata.note_order, old_parent, new_path);
        append_to_order(&mut metadata.note_order, new_parent, new_path);
    }
}

pub fn repair_folder_path(
    metadata: &mut WorkspaceMetadata,
    old_path: &str,
    new_path: &str,
    old_parent: &str,
    new_parent: &str,
    sibling_placement: Option<FolderSiblingPlacement<'_>>,
) {
    replace_prefix_in_array_map(&mut metadata.folder_order, old_path, new_path);
    replace_prefix_in_array_map(&mut metadata.note_order, old_path, new_path);
    replace_prefix_map_keys(&mut metadata.pinned_notes, old_path, new_path);
    replace_prefix_map_keys(&mut metadata.folder_icons, old_path, new_path);
    replace_prefix_map_keys(&mut metadata.folder_colors, old_path, new_path);
    replace_prefix_map_keys(&mut metadata.expanded_folders, old_path, new_path);
    replace_prefix_map_keys(&mut metadata.note_icons, old_path, new_path);
    replace_prefix_map_keys(&mut metadata.note_positions, old_path, new_path);
    for position in metadata.note_positions.values_mut() {
        replace_object_path(position, old_path, new_path, true);
    }
    for bookmark in &mut metadata.bookmarks {
        replace_object_path(bookmark, old_path, new_path, true);
    }

    if old_parent != new_parent {
        remove_from_order(&mut metadata.folder_order, old_parent, new_path);
        append_to_order(&mut metadata.folder_order, new_parent, new_path);
    }
    if let Some(sibling_placement) = sibling_placement {
        place_in_order(
            &mut metadata.folder_order,
            new_parent,
            new_path,
            sibling_placement,
        );
    }
}

fn replace_exact_in_array_map_values(map: &mut Map<String, Value>, old_path: &str, new_path: &str) {
    for value in map.values_mut() {
        if let Some(paths) = value.as_array_mut() {
            for path in paths {
                if path.as_str() == Some(old_path) {
                    *path = Value::String(new_path.to_string());
                }
            }
        }
    }
}

fn replace_prefix_in_array_map(map: &mut Map<String, Value>, old_path: &str, new_path: &str) {
    let current = std::mem::take(map);
    for (key, mut value) in current {
        if let Some(paths) = value.as_array_mut() {
            for path in paths {
                if let Some(current_path) = path.as_str() {
                    *path = Value::String(replace_path_prefix(current_path, old_path, new_path));
                }
            }
        }
        map.insert(replace_path_prefix(&key, old_path, new_path), value);
    }
}

fn replace_exact_map_key(map: &mut Map<String, Value>, old_path: &str, new_path: &str) {
    if let Some(value) = map.remove(old_path) {
        map.insert(new_path.to_string(), value);
    }
}

fn replace_prefix_map_keys(map: &mut Map<String, Value>, old_path: &str, new_path: &str) {
    let current = std::mem::take(map);
    for (key, value) in current {
        map.insert(replace_path_prefix(&key, old_path, new_path), value);
    }
}

fn replace_object_path(value: &mut Value, old_path: &str, new_path: &str, prefix: bool) {
    let Some(object) = value.as_object_mut() else {
        return;
    };
    let Some(current_path) = object.get("path").and_then(Value::as_str) else {
        return;
    };
    let next_path = if prefix {
        replace_path_prefix(current_path, old_path, new_path)
    } else if current_path == old_path {
        new_path.to_string()
    } else {
        return;
    };
    object.insert("path".to_string(), Value::String(next_path));
}

fn remove_from_order(map: &mut Map<String, Value>, parent: &str, path: &str) {
    if let Some(paths) = map.get_mut(parent).and_then(Value::as_array_mut) {
        paths.retain(|value| value.as_str() != Some(path));
    }
}

fn append_to_order(map: &mut Map<String, Value>, parent: &str, path: &str) {
    let paths = map
        .entry(parent.to_string())
        .or_insert_with(|| Value::Array(Vec::new()));
    let Some(paths) = paths.as_array_mut() else {
        return;
    };
    paths.retain(|value| value.as_str() != Some(path));
    paths.push(Value::String(path.to_string()));
}

fn place_in_order(
    map: &mut Map<String, Value>,
    parent: &str,
    path: &str,
    sibling_placement: FolderSiblingPlacement<'_>,
) {
    let paths = map
        .entry(parent.to_string())
        .or_insert_with(|| Value::Array(Vec::new()));
    let Some(paths) = paths.as_array_mut() else {
        return;
    };

    paths.retain(|value| value.as_str() != Some(path));
    let target_index = paths
        .iter()
        .position(|value| value.as_str() == Some(sibling_placement.target_path));
    let target_index = target_index.unwrap_or_else(|| {
        paths.push(Value::String(sibling_placement.target_path.to_string()));
        paths.len() - 1
    });
    let insertion_index = match sibling_placement.placement {
        FolderPlacement::Before => target_index,
        FolderPlacement::After => target_index + 1,
    };
    paths.insert(insertion_index, Value::String(path.to_string()));
}

fn replace_path_prefix(path: &str, old_prefix: &str, new_prefix: &str) -> String {
    if path == old_prefix {
        return new_prefix.to_string();
    }
    if let Some(suffix) = path.strip_prefix(&format!("{old_prefix}/")) {
        return format!("{new_prefix}/{suffix}");
    }
    path.to_string()
}

fn write_atomic(path: &Path, contents: &str) -> Result<(), String> {
    let temp_path = path.with_extension(format!("tmp-{}", uuid::Uuid::new_v4()));
    fs::write(&temp_path, contents).map_err(|error| error.to_string())?;
    fs::rename(&temp_path, path).map_err(|error| {
        let _ = fs::remove_file(&temp_path);
        error.to_string()
    })
}

fn default_true() -> bool {
    true
}
