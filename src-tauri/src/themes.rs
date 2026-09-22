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
            contents: if entry
                .metadata()
                .map(|m| m.len() <= 8 * 1024 * 1024)
                .unwrap_or(false)
            {
                fs::read_to_string(entry.path()).unwrap_or_default()
            } else {
                String::new()
            },
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

fn number_value(n: f64) -> Value {
    if n.fract() == 0.0 { Value::from(n as i64) } else { Value::from(n) }
}
fn normalize_theme(theme: &Value) -> Result<Value, String> {
    normalize_theme_inner(theme, true)
}
fn normalize_theme_inner(theme: &Value, allow_base: bool) -> Result<Value, String> {
    let mut clean = serde_json::Map::new();
    if let Some(base) = theme.get("baseThemeSnapshot") {
        if !allow_base { return Err("Nested original theme snapshots are not supported".into()); }
        let base = normalize_theme_inner(base, false)?;
        if base["id"] != theme["baseThemeId"] { return Err("Original theme ID does not match the snapshot".into()); }
        clean.insert("baseThemeSnapshot".into(), base);
    }
    if let Some(typography) = theme.get("typography") {
        let values = typography.as_object().ok_or("Invalid typography settings")?;
        let mut sizes = serde_json::Map::new();
        for (key, value) in values {
            if !["title", "compactTitle", "navigation", "tab", "menu", "secondary", "status"].contains(&key.as_str()) { return Err("Unknown typography role".into()); }
            let n = value.as_f64().ok_or("Invalid typography size")?;
            if !(11.0..=if key == "title" {96.0} else {32.0}).contains(&n) { return Err("Invalid typography size".into()); }
            sizes.insert(key.clone(), number_value(n));
        }
        clean.insert("typography".into(), Value::Object(sizes));
    }
    if let Some(controls) = theme.get("controls") {
        let controls = controls.as_array().ok_or("Invalid theme controls")?;
        if controls.len() > 24 { return Err("Use at most 24 theme controls".into()); }
        let mut ids = std::collections::HashSet::new();
        let mut result = Vec::new();
        for control in controls {
            let id = control["id"].as_str().ok_or("Invalid control ID")?;
            if id.is_empty() || id.len() > 48 || !id.as_bytes()[0].is_ascii_lowercase() || !id.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-') || !ids.insert(id) { return Err("Theme controls need unique lowercase IDs".into()); }
            let label = control["label"].as_str().ok_or("Invalid control label")?;
            if label.trim().is_empty() || label.encode_utf16().count() > 80 { return Err("Invalid control label".into()); }
            let mut c = serde_json::Map::new();
            c.insert("id".into(), Value::from(id)); c.insert("label".into(), Value::from(label.trim()));
            let kind = control["type"].as_str().ok_or("Invalid control type")?;
            c.insert("type".into(), Value::from(kind));
            match kind {
                "toggle" => { c.insert("value".into(), Value::from(control["value"].as_bool().ok_or("Invalid toggle")?)); }
                "color" => {
                    let color = control["value"].as_str().ok_or("Invalid control color")?;
                    if color.len() != 7 || !color.starts_with('#') || !color.as_bytes()[1..].iter().all(u8::is_ascii_hexdigit) { return Err("Invalid control color".into()); }
                    c.insert("value".into(), Value::from(color.to_ascii_lowercase()));
                }
                "range" => {
                    let min = control["min"].as_f64().ok_or("Invalid range")?;
                    let max = control["max"].as_f64().ok_or("Invalid range")?;
                    let step = control["step"].as_f64().ok_or("Invalid range")?;
                    let value = control["value"].as_f64().ok_or("Invalid range")?;
                    if min < -1000.0 || max > 1000.0 || max <= min || step <= 0.0 || step > max - min || !(min..=max).contains(&value) { return Err("Invalid range".into()); }
                    for (key, n) in [("min",min),("max",max),("step",step),("value",value)] { c.insert(key.into(), number_value(n)); }
                }
                _ => return Err("Invalid control type".into()),
            }
            result.push(Value::Object(c));
        }
        clean.insert("controls".into(), Value::Array(result));
    }
    if !matches!(theme["schemaVersion"].as_u64(), Some(1 | 2)) {
        return Err("Unsupported theme version".into());
    }
    clean.insert("schemaVersion".into(), theme["schemaVersion"].clone());
    if theme["schemaVersion"] == 2 {
        clean.insert("design".into(), normalize_design(&theme["design"])?);
    }
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
    if let Some(base) = theme.get("baseThemeId") {
        let id = base.as_str().ok_or("Invalid base theme ID")?;
        if id.is_empty() || id.len() > 80 || !id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-') {
            return Err("Invalid base theme ID".into());
        }
        clean.insert("baseThemeId".into(), base.clone());
    }
    if let Some(sidebar) = theme.get("rightSidebarOpen") {
        clean.insert("rightSidebarOpen".into(), Value::from(sidebar.as_bool().ok_or("Invalid right sidebar setting")?));
    }
    if let Some(word_count) = theme.get("wordCountVisible") {
        clean.insert("wordCountVisible".into(), Value::from(word_count.as_bool().ok_or("Invalid word count setting")?));
    }
    if let Some(width) = theme.get("editorWidthMode") {
        match width.as_str() {
            Some("comfortable" | "narrow" | "full") => {
                clean.insert("editorWidthMode".into(), width.clone());
            }
            _ => return Err("Invalid editor width setting".into()),
        }
    }
    if let Some(alignment) = theme.get("noteAlignment") {
        match alignment.as_str() {
            Some("left" | "center") => {
                clean.insert("noteAlignment".into(), alignment.clone());
            }
            _ => return Err("Invalid note alignment setting".into()),
        }
    }
    if let Some(navigation) = theme.get("navigationStyle") {
        match navigation.as_str() {
            Some("dual-pane" | "single-pane" | "section-view") => {
                clean.insert("navigationStyle".into(), navigation.clone());
            }
            _ => return Err("Invalid navigation style".into()),
        }
    }
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
        if let Some(flow) = plasma.get("flow") {
            let n = flow.as_f64().ok_or("Invalid Plasma flow")?;
            if !(0.0..=100.0).contains(&n) { return Err("Invalid Plasma flow".into()); }
            settings.insert("flow".into(), if n.fract() == 0.0 { Value::from(n as u64) } else { Value::from(n) });
        }
        if let Some(ambient) = plasma.get("ambientDrops") {
            let enabled = ambient.as_bool().ok_or("Invalid Plasma ambient bubbles")?;
            settings.insert("ambientDrops".into(), Value::from(enabled));
        }
        clean.insert("plasma".into(), Value::Object(settings));
    }
    if let Some(surfaces) = theme.get("surfaces") {
        let mut settings = serde_json::Map::new();
        let color = surfaces["background"].as_str().ok_or("Invalid surface background")?;
        if color.len() != 7 || !color.starts_with('#') || !color.as_bytes()[1..].iter().all(u8::is_ascii_hexdigit) {
            return Err("Invalid surface background".into());
        }
        settings.insert("background".into(), Value::from(color.to_ascii_lowercase()));
        for key in ["navigation", "editor", "outline", "titlebar"] {
            let n = surfaces[key].as_f64().ok_or("Invalid surface opacity")?;
            if !(0.0..=100.0).contains(&n) { return Err("Invalid surface opacity".into()); }
            settings.insert(key.into(), if n.fract() == 0.0 { Value::from(n as u64) } else { Value::from(n) });
        }
        if let Some(image) = surfaces.get("image") {
            let path = image.as_str().ok_or("Invalid surface image")?;
            let name = path.strip_prefix("assets/").ok_or("Invalid surface image")?;
            let (stem, ext) = name.rsplit_once('.').ok_or("Invalid surface image")?;
            if stem.is_empty() || !stem.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-') || !["png", "jpg", "jpeg", "webp"].contains(&ext) {
                return Err("Invalid surface image".into());
            }
            settings.insert("image".into(), Value::from(path));
        }
        clean.insert("surfaces".into(), Value::Object(settings));
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
        // Optional text colors preserve legacy snapshots and their conflict fingerprints.
        for key in ["editorText", "selectedText", "highlightText", "highlightBackground", "menuSelectedBackground", "menuSelectedText", "hoverBackground", "hoverText"] {
            if let Some(value) = theme[mode].get(key) {
                let color = value.as_str().ok_or_else(|| format!("Invalid {mode} {key} color"))?;
                if color.len() != 7 || !color.starts_with('#')
                    || !color.as_bytes()[1..].iter().all(u8::is_ascii_hexdigit) {
                    return Err(format!("Invalid {mode} {key} color"));
                }
                colors.insert(key.into(), Value::from(color.to_ascii_lowercase()));
            }
        }
        clean.insert(mode.into(), Value::Object(colors));
    }
    Ok(Value::Object(clean))
}

// CSS is inert storage here. The frontend parses and scopes it before rendering.
fn normalize_design(v: &Value) -> Result<Value, String> {
    use serde_json::json;
    if v["apiVersion"].as_u64() != Some(1) {
        return Err("Unsupported theme API".into());
    }
    let text = |key: &str, max: usize| -> Result<String, String> {
        let s = v[key]
            .as_str()
            .ok_or_else(|| format!("Invalid theme {key}"))?;
        if s.encode_utf16().count() > max {
            return Err(format!("Theme {key} exceeds limit"));
        }
        Ok(s.to_owned())
    };
    let version = text("version", 40)?;
    let parts: Vec<_> = version.split('.').collect();
    if parts.len() != 3
        || parts
            .iter()
            .any(|p| p.is_empty() || !p.bytes().all(|b| b.is_ascii_digit()))
    {
        return Err("Invalid theme version".into());
    }
    let supports = v["supportsPlasma"]
        .as_bool()
        .ok_or("Invalid Plasma support")?;
    let mut metrics = serde_json::Map::new();
    for (key, min, max) in [
        ("radius", 0.0, 24.0),
        ("spacing", 0.75, 1.5),
        ("lineHeight", 1.2, 2.2),
    ] {
        let n = v["metrics"][key].as_f64().ok_or("Invalid theme metric")?;
        if !(min..=max).contains(&n) {
            return Err("Invalid theme metric".into());
        }
        metrics.insert(
            key.into(),
            if n.fract() == 0.0 {
                json!(n as u64)
            } else {
                json!(n)
            },
        );
    }
    let entries = v["assets"].as_object().ok_or("Invalid assets")?;
    if entries.len() > 32 {
        return Err("Too many theme assets".into());
    }
    let mut assets = serde_json::Map::new();
    let mut total = 0;
    for (path, a) in entries {
        let name = path.strip_prefix("assets/").ok_or("Invalid asset path")?;
        let (stem, ext) = name.rsplit_once('.').ok_or("Invalid asset path")?;
        if stem.is_empty()
            || !stem
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
        {
            return Err("Invalid asset path".into());
        }
        let mime = match ext {
            "png" => "image/png",
            "jpg" | "jpeg" => "image/jpeg",
            "webp" => "image/webp",
            "woff2" => "font/woff2",
            _ => return Err("Unsupported asset type".into()),
        };
        if a["mime"].as_str() != Some(mime) {
            return Err("Invalid asset type".into());
        }
        let data = a["data"].as_str().ok_or("Invalid asset data")?;
        total += data.len();
        if data.len() > 2_800_000 || total > 6_000_000 {
            return Err("Theme assets exceed size limit".into());
        }
        assets.insert(path.clone(), json!({"mime":mime,"data":data}));
    }
    Ok(
        json!({"apiVersion":1,"author":text("author",100)?,"version":version,"license":text("license",20_000)?,"supportsPlasma":supports,"css":text("css",100_000)?,"assets":assets,"metrics":metrics}),
    )
}

fn save_in_dir(dir: &Path, theme: Value, expected: Option<Value>) -> Result<(), String> {
    let theme = normalize_theme(&theme)?;
    let expected = expected.as_ref().map(normalize_theme).transpose()?;
    let id = theme
        .get("id")
        .and_then(Value::as_str)
        .ok_or("Missing theme ID")?;
    if id == "default" {
        return Err("Default is a protected built-in theme. Save your changes as a new theme.".into());
    }
    if id.is_empty()
        || id.len() > 80
        || !id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
    {
        return Err("Invalid theme ID".into());
    }
    if !matches!(
        theme.get("schemaVersion").and_then(Value::as_u64),
        Some(1 | 2)
    ) {
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
    // Check under the same directory lock as the write: two app windows cannot
    // create different IDs with the same display name concurrently.
    let name_key = theme["name"].as_str().unwrap().trim().to_lowercase();
    for entry in fs::read_dir(dir).map_err(|e| e.to_string())? {
        let candidate = entry.map_err(|e| e.to_string())?.path();
        if candidate == path || candidate.extension().and_then(|s| s.to_str()) != Some("json") { continue; }
        let bytes = fs::read(&candidate).map_err(|e| e.to_string())?;
        if let Ok(other) = serde_json::from_slice::<Value>(&bytes) {
            if other["name"].as_str().map(|s| s.trim().to_lowercase()) == Some(name_key.clone()) {
                return Err("A theme with this name already exists. Choose a different name.".into());
            }
        }
    }
    let temp = dir.join(format!(".{}.tmp", uuid::Uuid::new_v4()));
    let contents = serde_json::to_string_pretty(&theme).map_err(|e| e.to_string())?;
    if contents.len() + 1 > 8 * 1024 * 1024 { return Err("Theme including its original snapshot must be smaller than 8 MB".into()); }
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
    fn saved_theme_keeps_layout_settings_and_original_snapshot() {
        let original: Value = serde_json::from_str(include_str!("../../src/themes/vampire.json")).unwrap();
        let mut theme = original.clone();
        theme["id"] = json!("vampire-copy");
        theme["name"] = json!("Vampire copy");
        theme["baseThemeId"] = original["id"].clone();
        theme["baseThemeSnapshot"] = original;
        let dir = std::env::temp_dir().join(format!("tigrana-theme-layout-{}", uuid::Uuid::new_v4()));
        let mut expected = None;
        for width in ["comfortable", "narrow", "full"] {
            for alignment in ["left", "center"] {
                for word_count in [false, true] {
                    theme["editorWidthMode"] = json!(width);
                    theme["noteAlignment"] = json!(alignment);
                    theme["wordCountVisible"] = json!(word_count);
                    save_in_dir(&dir, theme.clone(), expected.clone()).unwrap();
                    let saved: Value = serde_json::from_str(&fs::read_to_string(dir.join("vampire-copy.json")).unwrap()).unwrap();
                    assert!(saved == theme, "Save and use must preserve the entire notebook snapshot");
                    if let Some(stale) = &expected {
                        assert!(save_in_dir(&dir, stale.clone(), Some(stale.clone())).is_err());
                    }
                    expected = Some(theme.clone());
                }
            }
        }
        for (key, value) in [("editorWidthMode", json!("invalid")), ("noteAlignment", json!("right")), ("wordCountVisible", json!("yes"))] {
            let mut invalid = theme.clone();
            invalid[key] = value;
            assert!(save_in_dir(&dir, invalid, expected.clone()).is_err());
        }
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn preserves_authoring_options_and_rejects_invalid_originals() {
        let palette = json!({"background":"#112233","surface":"#112233","surfaceSoft":"#112233","surfaceStrong":"#112233","surfaceMuted":"#112233","border":"#112233","text":"#ffffff","textMuted":"#aaaaaa","accent":"#225588","titlebar":"#112233","menuSelectedText":"#ABCDEF"});
        let base = json!({"schemaVersion":1,"id":"base","name":"Base","light":palette,"dark":palette,"appFontFamily":"system-ui","editorFontFamily":"serif","appFontSize":14,"editorFontSize":17,"accentTitlebar":false});
        let mut copy = base.clone();
        copy["id"] = json!("copy"); copy["baseThemeId"] = json!("base"); copy["baseThemeSnapshot"] = base.clone();
        copy["typography"] = json!({"menu":20,"status":18});
        copy["controls"] = json!([{"id":"border","label":"Border","type":"range","min":0,"max":8,"step":1,"value":3},{"id":"art","label":"Art","type":"toggle","value":true},{"id":"ink","label":"Ink","type":"color","value":"#ABCDEF"}]);
        let clean = normalize_theme(&copy).unwrap();
        assert_eq!(clean["typography"]["menu"], json!(20));
        assert_eq!(clean["controls"][2]["value"], json!("#abcdef"));
        assert_eq!(clean["baseThemeSnapshot"]["id"], json!("base"));
        assert_eq!(clean["dark"]["menuSelectedText"], json!("#abcdef"));
        let mut invalid = copy.clone(); invalid["controls"][0]["value"] = json!(20); assert!(normalize_theme(&invalid).is_err());
        invalid = copy.clone(); invalid["typography"]["status"] = json!(5); assert!(normalize_theme(&invalid).is_err());
        invalid = copy.clone(); invalid["baseThemeSnapshot"]["baseThemeSnapshot"] = base; assert!(normalize_theme(&invalid).is_err());
    }

    #[test]
    fn default_cannot_be_created_or_overwritten_in_the_theme_library() {
        let catalog: Value = serde_json::from_str(include_str!("../../src/themes/classic.json")).unwrap();
        let original = catalog.as_array().unwrap().iter().find(|theme| theme["id"] == "default").unwrap().clone();
        let dir = std::env::temp_dir().join(format!("tigrana-default-theme-{}", uuid::Uuid::new_v4()));
        assert!(save_in_dir(&dir, original.clone(), None).unwrap_err().contains("protected built-in"));
        assert!(!dir.exists());
        // An older release may have written this file. A rejected update must preserve it.
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("default.json");
        let contents = serde_json::to_string(&original).unwrap();
        fs::write(&path, &contents).unwrap();
        let mut changed = original.clone();
        changed["editorFontSize"] = json!(24);
        assert!(save_in_dir(&dir, changed, Some(original)).unwrap_err().contains("protected built-in"));
        assert_eq!(fs::read_to_string(path).unwrap(), contents);
        fs::remove_dir_all(dir).unwrap();
    }

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
        b["baseThemeId"] = json!("nord");
        b["navigationStyle"] = json!("single-pane");
        b["rightSidebarOpen"] = json!(false);
        for style in ["dual-pane", "single-pane", "section-view"] {
            let mut variant = b.clone();
            variant["navigationStyle"] = json!(style);
            assert_eq!(normalize_theme(&variant).unwrap()["navigationStyle"], json!(style));
        }
        let mut invalid_navigation = b.clone();
        invalid_navigation["navigationStyle"] = json!("invalid");
        assert!(save_in_dir(&dir, invalid_navigation, None).is_err());
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
        let mut duplicate = b.clone();
        duplicate["id"] = json!("different-id");
        duplicate["name"] = json!(format!("  {}  ", b["name"].as_str().unwrap().to_uppercase()));
        assert!(save_in_dir(&dir, duplicate, None).unwrap_err().contains("name already exists"));
        assert!(!dir.join("different-id.json").exists());
        let mut plasma_theme = b.clone();
        plasma_theme["plasma"] = json!({"enabled":true,"frost":60,"backgroundBlur":12,"flow":65,"ambientDrops":true});
        save_in_dir(&dir, plasma_theme.clone(), Some(b)).unwrap();
        assert_eq!(
            serde_json::from_str::<Value>(&fs::read_to_string(dir.join("sample.json")).unwrap())
                .unwrap(),
            plasma_theme
        );
        let mut invalid_plasma = plasma_theme.clone();
        invalid_plasma["plasma"]["ambientDrops"] = json!("yes");
        assert!(save_in_dir(&dir, invalid_plasma, Some(plasma_theme.clone())).is_err());
        let mut invalid_plasma = plasma_theme.clone();
        invalid_plasma["plasma"]["frost"] = json!(101);
        assert!(save_in_dir(&dir, invalid_plasma, Some(plasma_theme.clone())).is_err());
        let mut advanced = plasma_theme.clone();
        advanced["schemaVersion"] = json!(2);
        advanced["design"] = json!({"apiVersion":1,"author":"Creator","version":"1.0.0","license":"MIT","supportsPlasma":true,"css":".ProseMirror h1 { color: red; }","assets":{},"metrics":{"radius":12,"spacing":1,"lineHeight":1.6}});
        for key in ["editorText", "selectedText", "highlightText", "highlightBackground"] {
            advanced["light"][key] = json!("#123456");
            advanced["dark"][key] = json!("#ffffff");
            let mut invalid = advanced.clone();
            invalid["light"][key] = json!("url(evil)");
            assert!(normalize_theme(&invalid).is_err());
            invalid["light"][key] = Value::Null;
            assert!(normalize_theme(&invalid).is_err());
        }
        advanced["surfaces"] = json!({"background":"#112233","navigation":30,"editor":80,"outline":0,"titlebar":100,"image":"assets/background.webp"});
        let mut invalid_surfaces = advanced.clone();
        invalid_surfaces["surfaces"]["editor"] = json!(101);
        assert!(normalize_theme(&invalid_surfaces).is_err());
        invalid_surfaces["surfaces"]["editor"] = json!(50);
        invalid_surfaces["surfaces"]["image"] = json!("https://example.com/image.png");
        assert!(normalize_theme(&invalid_surfaces).is_err());
        save_in_dir(&dir, advanced.clone(), Some(plasma_theme.clone())).unwrap();
        assert_eq!(
            serde_json::from_str::<Value>(&fs::read_to_string(dir.join("sample.json")).unwrap())
                .unwrap(),
            advanced
        );
        let mut bad = advanced.clone();
        bad["design"]["apiVersion"] = json!(2);
        assert!(save_in_dir(&dir, bad, Some(advanced.clone())).is_err());
        let mut stale = advanced.clone();
        stale["name"] = json!("Stale");
        assert!(delete_in_dir(&dir, stale).is_err());
        assert!(dir.join("sample.json").exists());
        delete_in_dir(&dir, advanced).unwrap();
        assert!(!dir.join("sample.json").exists());
        assert_eq!(fs::read_dir(dir.join(".trash")).unwrap().count(), 1);
        fs::remove_dir_all(dir).unwrap();
    }
}

#[tauri::command]
pub fn delete_theme(app: AppHandle, expected: Value) -> Result<(), String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?.join("themes");
    delete_in_dir(&dir, expected)
}

fn delete_in_dir(dir: &Path, expected: Value) -> Result<(), String> {
    let expected = normalize_theme(&expected)?;
    if !dir.exists() { return Err("The theme was already removed. Reload the library.".into()); }
    let lock = OpenOptions::new().create(true).truncate(false).read(true).write(true)
        .open(dir.join(".lock")).map_err(|e| e.to_string())?;
    lock.lock_exclusive().map_err(|e| e.to_string())?;
    let id = expected["id"].as_str().ok_or("Missing theme ID")?;
    let path = dir.join(format!("{id}.json"));
    let contents = fs::read_to_string(&path).map_err(|_| "The theme was already removed. Reload the library.".to_string())?;
    let current = normalize_theme(&serde_json::from_str::<Value>(&contents).map_err(|e| e.to_string())?)?;
    if current != expected { return Err("The shared theme changed. Reload the library and try again.".into()); }
    // Retain a local recovery file outside the active library scan.
    let trash = dir.join(".trash");
    fs::create_dir_all(&trash).map_err(|e| e.to_string())?;
    fs::rename(path, trash.join(format!("{id}-{}.json", uuid::Uuid::new_v4()))).map_err(|e| e.to_string())
}
