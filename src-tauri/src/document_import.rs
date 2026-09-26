use crate::assets::{save_asset, SaveAssetPayload};
use crate::notebook_paths::normalize_relative;
use crate::notebook_storage::{create_note_with_content, NoteEntry};
use serde::Deserialize;
use std::{fs, path::Path};

pub fn read_import_file(path: &Path) -> Result<Vec<u8>, String> {
    use std::io::Read;
    let extension = path.extension().and_then(|value| value.to_str()).unwrap_or("").to_ascii_lowercase();
    if extension != "pdf" && extension != "docx" {
        return Err("Choose a PDF or a Word .docx document.".into());
    }
    let limit = 50 * 1024 * 1024;
    let file = fs::File::open(path).map_err(|error| error.to_string())?;
    if file.metadata().map_err(|error| error.to_string())?.len() > limit {
        return Err("Choose a document smaller than 50 MB.".into());
    }
    let mut bytes = Vec::new();
    file.take(limit + 1).read_to_end(&mut bytes).map_err(|error| error.to_string())?;
    if bytes.len() as u64 > limit { return Err("Choose a document smaller than 50 MB.".into()); }
    Ok(bytes)
}

#[derive(Deserialize)]
pub struct ImportAsset { pub token: String, pub name: String, pub mime: String, pub bytes: Vec<u8> }
#[derive(Deserialize)]
pub struct ImportNotePayload {
    pub workspace: String, pub parent_path: String, pub title: String,
    pub content: String, pub assets: Vec<ImportAsset>,
}
pub fn import_note(root: &Path, payload: ImportNotePayload) -> Result<NoteEntry, String> {
    let parent = normalize_relative(&payload.parent_path)?;
    if !root.join(parent).is_dir() { return Err("The destination folder no longer exists.".into()); }
    let mut content = payload.content;
    let mut saved = Vec::new();
    let result = (|| {
        for asset in payload.assets {
            if !asset.token.starts_with("tigrana-import-") || asset.token.len() != 51 {
                return Err("Invalid imported image reference.".into());
            }
            let path = save_asset(root, SaveAssetPayload { workspace: payload.workspace.clone(), file_name: asset.name, mime_type: Some(asset.mime), bytes: asset.bytes })?;
            content = content.replace(&asset.token, &path);
            saved.push(path);
        }
        for number in 1..=1000 {
            let title = if number == 1 { payload.title.clone() } else { format!("{} ({number})", payload.title) };
            match create_note_with_content(root, &payload.parent_path, &title, &content) {
                Err(error) if error == "A note with that title already exists in this folder." => continue,
                result => return result,
            }
        }
        Err("Could not find an available title for this document.".into())
    })();
    if result.is_err() { for path in saved { let _ = fs::remove_file(root.join(path)); } }
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    use uuid::Uuid;
    #[test]
    fn reads_supported_documents_and_rejects_oversized_files() {
        let path = std::env::temp_dir().join(format!("tigrana-read-test-{}.docx", Uuid::new_v4()));
        fs::write(&path, b"document bytes").unwrap();
        assert_eq!(read_import_file(&path).unwrap(), b"document bytes");
        fs::OpenOptions::new().write(true).open(&path).unwrap().set_len(50 * 1024 * 1024 + 1).unwrap();
        assert!(read_import_file(&path).unwrap_err().contains("50 MB"));
        assert!(read_import_file(Path::new("unsupported.doc")).unwrap_err().contains(".docx"));
        fs::remove_file(path).unwrap();
    }

    #[test]
    fn imports_assets_and_avoids_replacing_existing_notes() {
        let root = std::env::temp_dir().join(format!("tigrana-import-test-{}", Uuid::new_v4()));
        fs::create_dir_all(&root).unwrap();
        let token = format!("tigrana-import-{}", Uuid::new_v4());
        let payload = |title: &str| ImportNotePayload { workspace: root.to_string_lossy().into(), parent_path: "".into(), title: title.into(), content: format!("Image ![sample]({token})"), assets: vec![ImportAsset { token: token.clone(), name: "sample.png".into(), mime: "image/png".into(), bytes: vec![1, 2, 3] }] };
        let first = import_note(&root, payload("Document")).unwrap();
        let second = import_note(&root, payload("Document")).unwrap();
        assert_ne!(first.path, second.path);
        let content = fs::read_to_string(root.join(&first.path)).unwrap();
        assert!(content.contains(".assets/sample-"));
        assert!(!content.contains(&token));
        let before = fs::read_dir(root.join(".assets")).unwrap().count();
        assert!(import_note(&root, payload("invalid:title")).is_err());
        assert_eq!(before, fs::read_dir(root.join(".assets")).unwrap().count());
        fs::remove_dir_all(root).unwrap();
    }
}
