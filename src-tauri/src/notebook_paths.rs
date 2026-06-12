use std::path::{Component, Path, PathBuf};

pub const APP_DIR: &str = ".tigrana";

pub fn app_dir(root: &Path) -> PathBuf {
    root.join(APP_DIR)
}

pub fn metadata_path(root: &Path) -> PathBuf {
    app_dir(root).join("metadata.json")
}

pub fn safe_workspace(workspace: &str) -> Result<PathBuf, String> {
    let path = PathBuf::from(workspace);
    if !path.is_absolute() {
        return Err("Workspace path must be absolute.".to_string());
    }
    Ok(path)
}

pub fn safe_note_path(workspace: &str, relative: &str) -> Result<PathBuf, String> {
    let root = safe_workspace(workspace)?;
    let relative = normalize_relative(relative)?;
    let path = root.join(relative);
    if !path.starts_with(&root) {
        return Err("Path escapes workspace.".to_string());
    }
    Ok(path)
}

pub fn normalize_relative(value: &str) -> Result<PathBuf, String> {
    let path = PathBuf::from(value);
    if path.is_absolute() {
        return Err("Only relative paths inside the workspace are allowed.".to_string());
    }

    for component in path.components() {
        if matches!(
            component,
            Component::ParentDir | Component::CurDir | Component::RootDir | Component::Prefix(_)
        ) {
            return Err("Only relative paths inside the workspace are allowed.".to_string());
        }
    }

    Ok(path)
}

pub fn is_hidden_entry(path: &Path) -> bool {
    path.file_name()
        .and_then(|name| name.to_str())
        .map(|name| name.starts_with('.'))
        .unwrap_or(false)
}

pub fn relative_path(root: &Path, path: &Path) -> Result<String, String> {
    Ok(path
        .strip_prefix(root)
        .map_err(|error| error.to_string())?
        .to_string_lossy()
        .replace('\\', "/"))
}

pub fn note_title_from_path(rel: &str) -> String {
    Path::new(rel)
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("Untitled")
        .to_string()
}

pub fn slugify(title: &str) -> String {
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

pub fn validate_note_title(title: &str) -> Result<(), String> {
    let trimmed = title.trim();
    if trimmed.is_empty() {
        return Err("Add a title before saving this note.".to_string());
    }

    let invalid = ['/', '\\', ':', '*', '?', '"', '<', '>', '|'];
    if trimmed.contains(invalid) {
        return Err("Note titles cannot contain / \\ : * ? \" < > |".to_string());
    }

    if trimmed.chars().any(|ch| ch.is_control()) {
        return Err("Note titles cannot contain line breaks or control characters.".to_string());
    }

    if trimmed == "." || trimmed == ".." {
        return Err("That title is reserved by the filesystem.".to_string());
    }

    Ok(())
}
