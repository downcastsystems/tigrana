use fs2::FileExt;
use serde::Serialize;
use serde_json::Value;
use std::fs::{self, OpenOptions};
use std::path::Path;
use tauri::{AppHandle, Manager};

#[derive(Serialize)]
pub struct ThemeFile {
    name: String,
    contents: String,
}

#[tauri::command]
pub fn list_themes(app: AppHandle) -> Result<Vec<ThemeFile>, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("themes");
    if !dir.exists() {
        return Ok(vec![]);
    }
    let mut files = vec![];
    for entry in fs::read_dir(dir).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        if entry.path().extension().and_then(|s| s.to_str()) != Some("json") {
            continue;
        }
        files.push(ThemeFile {
            name: entry.file_name().to_string_lossy().into_owned(),
            contents: fs::read_to_string(entry.path()).unwrap_or_default(),
        });
    }
    files.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(files)
}

#[tauri::command]
pub fn save_theme(app: AppHandle, theme: Value, expected: Option<Value>) -> Result<(), String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("themes");
    save_in_dir(&dir, theme, expected)
}

fn normalize_theme(theme: &Value) -> Result<Value, String> {
    let mut clean = serde_json::Map::new();
    if theme["schemaVersion"].as_u64() != Some(1) {
        return Err("Unsupported theme version".into());
    }
    clean.insert("schemaVersion".into(), Value::from(1));
    for key in ["id", "name", "appFontFamily", "editorFontFamily"] {
        let text = theme[key]
            .as_str()
            .ok_or_else(|| format!("Invalid {key}"))?;
        let limit = if key == "id" {
            80
        } else if key == "name" {
            100
        } else {
            200
        };
        if text.trim().is_empty() || text.encode_utf16().count() > limit {
            return Err(format!("Invalid {key}"));
        }
        if key == "id"
            && !text
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
        {
            return Err("Invalid theme ID".into());
        }
        if key.ends_with("FontFamily") && text.chars().any(|c| ";{}<>\\".contains(c)) {
            return Err(format!("Invalid {key}"));
        }
        clean.insert(key.into(), Value::from(text.trim()));
    }
    for key in ["appFontSize", "editorFontSize"] {
        let size = theme[key].as_f64().ok_or("Invalid font size")?;
        if !(11.0..=28.0).contains(&size) {
            return Err("Font sizes must be between 11 and 28".into());
        }
        clean.insert(
            key.into(),
            if size.fract() == 0.0 {
                Value::from(size as u64)
            } else {
                Value::from(size)
            },
        );
    }
    clean.insert(
        "accentTitlebar".into(),
        Value::from(
            theme["accentTitlebar"]
                .as_bool()
                .ok_or("Invalid title bar setting")?,
        ),
    );
    if let Some(plasma) = theme.get("plasma") {
        let enabled = plasma["enabled"]
            .as_bool()
            .ok_or("Invalid Plasma enabled setting")?;
        let mut settings = serde_json::Map::new();
        settings.insert("enabled".into(), Value::from(enabled));
        for (key, max) in [("frost", 100.0), ("backgroundBlur", 40.0)] {
            let n = plasma[key].as_f64().ok_or("Invalid Plasma setting")?;
            if !(0.0..=max).contains(&n) {
                return Err("Invalid Plasma setting".into());
            }
            settings.insert(
                key.into(),
                if n.fract() == 0.0 {
                    Value::from(n as u64)
                } else {
                    Value::from(n)
                },
            );
        }
        clean.insert("plasma".into(), Value::Object(settings));
    }
    for mode in ["light", "dark"] {
        let mut colors = serde_json::Map::new();
        for key in [
            "background",
            "surface",
            "surfaceSoft",
            "surfaceStrong",
            "surfaceMuted",
            "border",
            "text",
            "textMuted",
            "accent",
            "titlebar",
        ] {
            let color = theme[mode][key]
                .as_str()
                .ok_or_else(|| format!("Invalid {mode} {key} color"))?;
            if color.len() != 7
                || !color.starts_with('#')
                || !color.as_bytes()[1..].iter().all(u8::is_ascii_hexdigit)
            {
                return Err(format!("Invalid {mode} {key} color"));
            }
            colors.insert(key.into(), Value::from(color.to_ascii_lowercase()));
        }
        clean.insert(mode.into(), Value::Object(colors));
    }
    Ok(Value::Object(clean))
}

fn save_in_dir(dir: &Path, theme: Value, expected: Option<Value>) -> Result<(), String> {
    let theme = normalize_theme(&theme)?;
    let expected = expected.as_ref().map(normalize_theme).transpose()?;
    let id = theme
        .get("id")
        .and_then(Value::as_str)
        .ok_or("Missing theme ID")?;
    if id.is_empty()
        || id.len() > 80
        || !id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
    {
        return Err("Invalid theme ID".into());
    }
    if theme.get("schemaVersion").and_then(Value::as_u64) != Some(1) {
        return Err("Unsupported theme version".into());
    }
    fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    let lock = OpenOptions::new()
        .create(true)
        .truncate(false)
        .read(true)
        .write(true)
        .open(dir.join(".lock"))
        .map_err(|e| e.to_string())?;
    lock.lock_exclusive().map_err(|e| e.to_string())?;
    let path = dir.join(format!("{id}.json"));
    let current = if path.exists() {
        Some(normalize_theme(
            &serde_json::from_str::<Value>(&fs::read_to_string(&path).map_err(|e| e.to_string())?)
                .map_err(|e| e.to_string())?,
        )?)
    } else {
        None
    };
    if current != expected {
        return Err("The shared theme changed. Reload the library and try again.".into());
    }
    let temp = dir.join(format!(".{}.tmp", uuid::Uuid::new_v4()));
    let contents = serde_json::to_string_pretty(&theme).map_err(|e| e.to_string())?;
    fs::write(&temp, format!("{contents}\n")).map_err(|e| e.to_string())?;
    fs::rename(&temp, &path).map_err(|e| {
        let _ = fs::remove_file(&temp);
        e.to_string()
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    #[test]
    fn saves_atomically_and_rejects_stale_updates_and_paths() {
        let dir = std::env::temp_dir().join(format!("tigrana-themes-{}", uuid::Uuid::new_v4()));
        let mut palette = serde_json::Map::new();
        for key in [
            "background",
            "surface",
            "surfaceSoft",
            "surfaceStrong",
            "surfaceMuted",
            "border",
            "text",
            "textMuted",
            "accent",
            "titlebar",
        ] {
            palette.insert(key.into(), json!("#abcdef"));
        }
        let a = json!({"id":"sample", "schemaVersion":1, "name":"A", "light":palette, "dark":palette, "appFontFamily":"system-ui", "editorFontFamily":"serif", "appFontSize":14, "editorFontSize":18, "accentTitlebar":true});
        let mut b = a.clone();
        b["name"] = json!("B");
        save_in_dir(&dir, a.clone(), None).unwrap();
        assert!(save_in_dir(&dir, b.clone(), None).is_err());
        save_in_dir(&dir, b.clone(), Some(a.clone())).unwrap();
        assert!(save_in_dir(&dir, a.clone(), Some(a.clone())).is_err());
        let mut external = b.clone();
        external["dark"]["accent"] = json!("#ABCDEF");
        external["extra"] = json!("ignored");
        external["editorFontSize"] = json!(18.0);
        fs::write(
            dir.join("sample.json"),
            serde_json::to_string(&external).unwrap(),
        )
        .unwrap();
        save_in_dir(&dir, b.clone(), Some(b.clone())).unwrap();
        let mut invalid = a;
        invalid["light"]["text"] = json!("url(evil)");
        assert!(save_in_dir(&dir, invalid, Some(b.clone())).is_err());
        assert_eq!(
            serde_json::from_str::<Value>(&fs::read_to_string(dir.join("sample.json")).unwrap())
                .unwrap(),
            b
        );
        assert!(save_in_dir(&dir, json!({"id":"../escape", "schemaVersion":1}), None).is_err());
        let mut plasma_theme = b.clone();
        plasma_theme["plasma"] = json!({"enabled":true,"frost":60,"backgroundBlur":12});
        save_in_dir(&dir, plasma_theme.clone(), Some(b)).unwrap();
        assert_eq!(
            serde_json::from_str::<Value>(&fs::read_to_string(dir.join("sample.json")).unwrap())
                .unwrap(),
            plasma_theme
        );
        let mut invalid_plasma = plasma_theme.clone();
        invalid_plasma["plasma"]["frost"] = json!(101);
        assert!(save_in_dir(&dir, invalid_plasma, Some(plasma_theme)).is_err());
        fs::remove_dir_all(dir).unwrap();
    }
}
