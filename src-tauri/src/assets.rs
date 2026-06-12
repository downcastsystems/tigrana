use crate::notebook_paths::{normalize_relative, slugify};
use base64::{engine::general_purpose, Engine as _};
use serde::Deserialize;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

#[derive(Debug, Deserialize)]
pub struct SaveAssetPayload {
    pub workspace: String,
    pub file_name: String,
    pub mime_type: Option<String>,
    pub bytes: Vec<u8>,
}

pub fn save_asset(root: &Path, payload: SaveAssetPayload) -> Result<String, String> {
    let assets_dir = assets_dir(root);
    fs::create_dir_all(&assets_dir).map_err(|error| error.to_string())?;

    if should_convert_tiff_asset(&payload.file_name, payload.mime_type.as_deref()) {
        return save_tiff_asset_as_png(root, &assets_dir, &payload);
    }

    let clean_name = unique_asset_name(
        &assets_dir,
        &payload.file_name,
        payload.mime_type.as_deref(),
    );
    let path = assets_dir.join(clean_name);
    fs::write(&path, payload.bytes).map_err(|error| error.to_string())?;
    relative_asset_path(root, &path)
}

pub fn save_clipboard_image_asset(root: &Path) -> Result<String, String> {
    let assets_dir = assets_dir(root);
    fs::create_dir_all(&assets_dir).map_err(|error| error.to_string())?;

    save_macos_clipboard_png(root, &assets_dir)
        .or_else(|_| save_macos_clipboard_tiff(root, &assets_dir))
}

pub fn read_asset_data_url(root: &Path, path: &str) -> Result<String, String> {
    let relative = normalize_relative(path)?;
    let asset_path = root.join(relative);
    if !asset_path.starts_with(root) {
        return Err("Path escapes workspace.".to_string());
    }
    if !asset_path.exists() {
        return Err("Asset does not exist.".to_string());
    }
    let bytes = fs::read(&asset_path).map_err(|error| error.to_string())?;
    let mime = mime_type_for_asset(&asset_path);
    Ok(format!(
        "data:{mime};base64,{}",
        general_purpose::STANDARD.encode(bytes)
    ))
}

fn assets_dir(root: &Path) -> PathBuf {
    root.join(".assets")
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

fn save_tiff_asset_as_png(
    root: &Path,
    assets_dir: &Path,
    payload: &SaveAssetPayload,
) -> Result<String, String> {
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

fn convert_tiff_file_to_png(
    root: &Path,
    assets_dir: &Path,
    temp_path: &Path,
) -> Result<String, String> {
    let png_name = unique_asset_name(assets_dir, "pasted-image.png", Some("image/png"));
    let png_path = assets_dir.join(png_name);
    let output = Command::new("sips")
        .args(["-s", "format", "png"])
        .arg(temp_path)
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
