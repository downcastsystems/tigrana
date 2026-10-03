use crate::notebook_metadata::{
    read_workspace_metadata, write_workspace_metadata, WorkspaceMetadata,
};
use crate::notebook_paths::app_dir;
use crate::notebook_storage::create_note_with_content;
use serde::Serialize;
use std::path::Path;

pub fn create_notebook(
    parent: &Path,
    name: &str,
    content: &str,
    appearance: &serde_json::Value,
) -> Result<String, String> {
    let name = name.trim();
    if name.is_empty() {
        return Err("Enter a notebook name.".to_string());
    }
    if name.ends_with('.')
        || name
            .chars()
            .any(|c| c.is_control() || "/\\:*?\"<>|".contains(c))
    {
        return Err("Use a notebook name without path separators, control characters, or reserved filename characters.".to_string());
    }
    let stem = name.split('.').next().unwrap_or("").to_ascii_uppercase();
    if matches!(stem.as_str(), "CON" | "PRN" | "AUX" | "NUL")
        || (stem.len() == 4
            && (stem.starts_with("COM") || stem.starts_with("LPT"))
            && matches!(stem.as_bytes()[3], b'1'..=b'9'))
    {
        return Err("That name is reserved by the filesystem.".to_string());
    }
    if !parent.is_dir() {
        return Err("Choose an existing folder to store your notebook.".to_string());
    }
    let destination = parent.join(name);
    std::fs::create_dir(&destination).map_err(|error| {
        if error.kind() == std::io::ErrorKind::AlreadyExists {
            "A folder or file with that notebook name already exists here. Change the name or location.".to_string()
        } else { error.to_string() }
    })?;
    // Initialize before the parent's watcher can assign this child a folder ID.
    ensure_welcome_note(&destination, content, appearance).map_err(|error| {
        format!("The notebook folder was created at {}, but could not be initialized: {error}. You can open that folder as an existing notebook to retry.", destination.display())
    })?;
    Ok(destination.to_string_lossy().into_owned())
}

#[derive(Serialize)]
pub struct WelcomeNoteResult {
    pub metadata: WorkspaceMetadata,
    pub created: bool,
}

// Call under the notebook write coordinator, before snapshots build the index.
pub fn ensure_welcome_note(
    root: &Path,
    content: &str,
    appearance: &serde_json::Value,
) -> Result<WelcomeNoteResult, String> {
    let mut metadata = read_workspace_metadata(root)?;
    if app_dir(root).exists() || metadata.welcome_note_added {
        return Ok(WelcomeNoteResult {
            metadata,
            created: false,
        });
    }
    let created = if root.join("Welcome.md").exists() {
        false
    } else {
        create_note_with_content(root, "", "Welcome", content)?;
        true
    };
    metadata.welcome_note_added = true;
    if metadata.appearance.is_none() {
        metadata.appearance = Some(appearance.clone());
    }
    let metadata = write_workspace_metadata(root, &metadata)?;
    Ok(WelcomeNoteResult { metadata, created })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::path::PathBuf;
    use uuid::Uuid;

    fn appearance() -> serde_json::Value {
        serde_json::json!({ "themePresetId": "builtin-baseline", "themeColorPreferences": { "builtin-baseline": "blue" }, "colorScheme": "system" })
    }

    struct Notebook(PathBuf);
    impl Notebook {
        fn new() -> Self {
            let path = std::env::temp_dir().join(format!("tigrana-onboarding-{}", Uuid::new_v4()));
            fs::create_dir_all(&path).unwrap();
            Self(path)
        }
    }
    impl Drop for Notebook {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn creates_only_the_confirmed_child_and_welcomes_it_on_first_open() {
        let parent = Notebook::new();
        let path = create_notebook(&parent.0, "My Notes", "Welcome", &appearance()).unwrap();
        let root = Path::new(&path);
        assert_eq!(root, parent.0.join("My Notes"));
        assert!(!app_dir(&parent.0).exists());
        assert!(app_dir(root).exists());
        assert_eq!(
            read_workspace_metadata(root).unwrap().appearance,
            Some(appearance())
        );
        assert!(
            !ensure_welcome_note(root, "Welcome", &appearance())
                .unwrap()
                .created
        );
        assert!(root.join("Welcome.md").exists());
        assert!(create_notebook(&parent.0, "My Notes", "Welcome", &appearance()).is_err());
        assert!(root.join("Welcome.md").exists());
    }

    #[test]
    fn rejects_unsafe_names_and_never_creates_missing_parents() {
        let parent = Notebook::new();
        for name in [
            "",
            ".",
            "..",
            "../escape",
            "a/b",
            "a\\b",
            "CON",
            "LPT1.txt",
            "trailing.",
            "a:b",
        ] {
            assert!(
                create_notebook(&parent.0, name, "Welcome", &appearance()).is_err(),
                "accepted {name}"
            );
        }
        let missing = parent.0.join("missing");
        assert!(create_notebook(&missing, "My Notes", "Welcome", &appearance()).is_err());
        assert!(!missing.exists());
    }

    #[test]
    fn welcomes_new_notebooks_only_once_even_after_deletion() {
        let notebook = Notebook::new();
        fs::write(notebook.0.join("Existing.md"), "Keep this").unwrap();
        let result = ensure_welcome_note(&notebook.0, "Hello", &appearance()).unwrap();
        assert!(result.created);
        assert!(result.metadata.welcome_note_added);
        assert!(fs::read_to_string(notebook.0.join("Welcome.md"))
            .unwrap()
            .ends_with("Hello"));
        assert_eq!(
            fs::read_to_string(notebook.0.join("Existing.md")).unwrap(),
            "Keep this"
        );
        fs::remove_file(notebook.0.join("Welcome.md")).unwrap();
        assert!(
            !ensure_welcome_note(&notebook.0, "Again", &appearance())
                .unwrap()
                .created
        );
        assert!(!notebook.0.join("Welcome.md").exists());
    }

    #[test]
    fn existing_app_folder_without_metadata_is_already_initialized() {
        let notebook = Notebook::new();
        fs::create_dir(app_dir(&notebook.0)).unwrap();
        assert!(
            !ensure_welcome_note(&notebook.0, "Hello", &appearance())
                .unwrap()
                .created
        );
        assert!(!notebook.0.join("Welcome.md").exists());
    }

    #[test]
    fn existing_metadata_without_welcome_marker_does_not_add_a_note() {
        let notebook = Notebook::new();
        write_workspace_metadata(&notebook.0, &WorkspaceMetadata::default()).unwrap();
        assert!(
            !ensure_welcome_note(&notebook.0, "Hello", &appearance())
                .unwrap()
                .created
        );
        assert!(!notebook.0.join("Welcome.md").exists());
        assert!(read_workspace_metadata(&notebook.0)
            .unwrap()
            .appearance
            .is_none());
    }

    #[test]
    fn preserves_a_users_existing_welcome_note() {
        let notebook = Notebook::new();
        fs::write(notebook.0.join("Welcome.md"), "My own welcome").unwrap();
        assert!(
            !ensure_welcome_note(&notebook.0, "Hello", &appearance())
                .unwrap()
                .created
        );
        assert_eq!(
            fs::read_to_string(notebook.0.join("Welcome.md")).unwrap(),
            "My own welcome"
        );
        assert!(
            read_workspace_metadata(&notebook.0)
                .unwrap()
                .welcome_note_added
        );
    }
}
