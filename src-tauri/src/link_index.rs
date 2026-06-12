use crate::notebook_paths::{
    app_dir, is_hidden_entry, note_title_from_path, relative_path, APP_DIR,
};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use uuid::Uuid;
use walkdir::WalkDir;

const INDEX_SCHEMA_VERSION: u32 = 1;

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct NoteRecord {
    pub id: String,
    pub path: String,
    pub title: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct FolderRecord {
    pub id: String,
    pub path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct LinkRef {
    pub source_id: String,
    pub target_id: Option<String>,
    pub target_kind: String,
    pub target_path: String,
    pub display_text: String,
    pub anchor: Option<String>,
    pub occurrence: u32,
    pub broken: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LinkIndex {
    pub schema_version: u32,
    pub notes_by_id: HashMap<String, NoteRecord>,
    pub folders_by_id: HashMap<String, FolderRecord>,
    pub path_to_id: HashMap<String, String>,
    pub outbound: HashMap<String, Vec<LinkRef>>,
    pub inbound: HashMap<String, Vec<LinkRef>>,
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
pub struct FolderSidecar {
    pub id: String,
}

pub fn link_index_path(root: &Path) -> PathBuf {
    app_dir(root).join("index.json")
}

fn folder_sidecar_dir(root: &Path, relative: &str) -> Option<PathBuf> {
    if relative.is_empty() {
        return None;
    }
    Some(root.join(relative).join(APP_DIR))
}

fn folder_sidecar_path(root: &Path, relative: &str) -> Option<PathBuf> {
    folder_sidecar_dir(root, relative).map(|dir| dir.join("folder.json"))
}

pub fn read_link_index_file(root: &Path) -> LinkIndex {
    let path = link_index_path(root);
    if !path.exists() {
        return LinkIndex::default();
    }
    let Ok(contents) = fs::read_to_string(&path) else {
        return LinkIndex::default();
    };
    serde_json::from_str(&contents).unwrap_or_default()
}

pub fn write_link_index_file(root: &Path, index: &LinkIndex) -> Result<(), String> {
    let app_metadata_dir = app_dir(root);
    fs::create_dir_all(&app_metadata_dir).map_err(|error| error.to_string())?;
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

pub fn write_folder_sidecar(
    root: &Path,
    relative: &str,
    sidecar: &FolderSidecar,
) -> Result<(), String> {
    let Some(dir) = folder_sidecar_dir(root, relative) else {
        return Ok(());
    };
    let Some(file) = folder_sidecar_path(root, relative) else {
        return Ok(());
    };
    fs::create_dir_all(&dir).map_err(|error| error.to_string())?;
    let json = serde_json::to_string_pretty(sidecar).map_err(|error| error.to_string())?;
    fs::write(file, format!("{json}\n")).map_err(|error| error.to_string())
}

// Returns (id, mutated_content). If the note has no frontmatter `id`, one is minted
// and inserted; otherwise the existing id is returned and the content is unchanged.
pub fn ensure_note_id_in_content(content: &str) -> (String, String, bool) {
    ensure_note_id_in_content_with_preferred(content, None)
}

pub fn ensure_note_id_in_content_with_preferred(
    content: &str,
    preferred_id: Option<String>,
) -> (String, String, bool) {
    let normalized = content.replace("\r\n", "\n");
    let (frontmatter, body, has_frontmatter) = split_frontmatter(&normalized);

    if has_frontmatter {
        if let Some(id) = read_frontmatter_field(&frontmatter, "id") {
            if !id.is_empty() {
                return (id, content.to_string(), false);
            }
        }
        let new_id = preferred_id.unwrap_or_else(|| Uuid::new_v4().to_string());
        let new_frontmatter = insert_frontmatter_field(&frontmatter, "id", &new_id);
        let recombined = format!(
            "---\n{new_frontmatter}\n---\n\n{}",
            body.trim_start_matches('\n')
        );
        (new_id, recombined, true)
    } else {
        let new_id = preferred_id.unwrap_or_else(|| Uuid::new_v4().to_string());
        let recombined = format!(
            "---\nid: {new_id}\n---\n\n{}",
            normalized.trim_start_matches('\n')
        );
        (new_id, recombined, true)
    }
}

pub fn split_frontmatter(content: &str) -> (String, String, bool) {
    let lines: Vec<&str> = content.split('\n').collect();
    if lines.is_empty() || lines[0].trim() != "---" {
        return (String::new(), content.to_string(), false);
    }
    let closing = lines
        .iter()
        .enumerate()
        .skip(1)
        .find(|(_, line)| line.trim() == "---");
    let Some((closing_index, _)) = closing else {
        return (String::new(), content.to_string(), false);
    };
    let frontmatter = lines[1..closing_index].join("\n");
    let body = lines[(closing_index + 1)..].join("\n");
    (frontmatter, body, true)
}

pub fn read_frontmatter_field(frontmatter: &str, key: &str) -> Option<String> {
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
    let trimmed = frontmatter.trim_end();
    if trimmed.is_empty() {
        format!("{key}: {value}")
    } else {
        format!("{key}: {value}\n{trimmed}")
    }
}

fn set_frontmatter_field(frontmatter: &str, key: &str, value: &str) -> String {
    let mut replaced = false;
    let lines = frontmatter.split('\n').map(|line| {
        let trimmed = line.trim_start();
        if !replaced && !trimmed.starts_with('#') {
            if let Some((k, _)) = trimmed.split_once(':') {
                if k.trim() == key {
                    replaced = true;
                    return format!("{key}: {value}");
                }
            }
        }
        line.to_string()
    });
    let updated = lines.collect::<Vec<_>>().join("\n");
    if replaced {
        updated
    } else {
        insert_frontmatter_field(&updated, key, value)
    }
}

pub fn set_note_id_in_content(content: &str, id: &str) -> String {
    let normalized = content.replace("\r\n", "\n");
    let (frontmatter, body, has_frontmatter) = split_frontmatter(&normalized);
    if has_frontmatter {
        let new_frontmatter = set_frontmatter_field(&frontmatter, "id", id);
        format!("---\n{new_frontmatter}\n---\n{body}")
    } else {
        format!(
            "---\nid: {id}\n---\n\n{}",
            normalized.trim_start_matches('\n')
        )
    }
}

pub fn note_relative(parent: &Path, stem: &str) -> PathBuf {
    if parent.as_os_str().is_empty() {
        PathBuf::from(format!("{stem}.md"))
    } else {
        parent.join(format!("{stem}.md"))
    }
}

pub fn unique_note_relative(root: &Path, parent: &Path, stem: &str) -> PathBuf {
    let mut suffix = 0;
    loop {
        let candidate_stem = if suffix == 0 {
            stem.to_string()
        } else {
            format!("{stem} {suffix}")
        };
        let relative = note_relative(parent, &candidate_stem);
        if !root.join(&relative).exists() {
            return relative;
        }
        suffix += 1;
    }
}

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
        if bytes[i] == b'`' {
            let mut run = 0;
            while i + run < len && bytes[i + run] == b'`' {
                run += 1;
            }
            let close_pat = vec![b'`'; run];
            let after = i + run;
            let mut j = after;
            while j + run <= len {
                if &bytes[j..j + run] == close_pat.as_slice()
                    && (j + run == len || bytes[j + run] != b'`')
                {
                    break;
                }
                j += 1;
            }
            if j + run > len {
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
            let text_str = std::str::from_utf8(&bytes[text_start..text_end])
                .unwrap_or("")
                .to_string();
            let href_str_raw = std::str::from_utf8(&bytes[href_start..href_end])
                .unwrap_or("")
                .to_string();
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
    let trimmed = raw.trim();
    let bytes = trimmed.as_bytes();
    let mut last_quote_start: Option<usize> = None;
    let mut i = 0;
    while i < bytes.len() {
        if (bytes[i] == b'"' || bytes[i] == b'\'') && i > 0 && bytes[i - 1].is_ascii_whitespace() {
            let quote = bytes[i];
            let mut j = i + 1;
            while j < bytes.len() && bytes[j] != quote {
                j += 1;
            }
            if j < bytes.len() && bytes[j] == quote && trimmed[j + 1..].trim().is_empty() {
                last_quote_start = Some(i);
                break;
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
    let bytes = href.as_bytes();
    if !bytes.is_empty() && bytes[0].is_ascii_alphabetic() {
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

pub fn rebuild_index_for_root(root: &Path) -> Result<LinkIndex, String> {
    let (notes, folders) = enumerate_workspace(root)?;
    let mut index = LinkIndex::default();

    for folder_abs in &folders {
        let rel = relative_path(root, folder_abs)?;
        let sidecar_id = read_folder_sidecar(root, &rel).map(|s| s.id);
        let id = sidecar_id.unwrap_or_else(|| Uuid::new_v4().to_string());
        let _ = write_folder_sidecar(root, &rel, &FolderSidecar { id: id.clone() });
        index.folders_by_id.insert(
            id.clone(),
            FolderRecord {
                id: id.clone(),
                path: rel.clone(),
            },
        );
        index.path_to_id.insert(rel, id);
    }

    for note_abs in &notes {
        let rel = relative_path(root, note_abs)?;
        let raw = fs::read_to_string(note_abs).unwrap_or_default();
        let (id, new_content, mutated) = ensure_note_id_in_content(&raw);
        if mutated {
            if let Err(error) = fs::write(note_abs, &new_content) {
                return Err(format!("Failed to write id into {rel}: {error}"));
            }
        }
        index.notes_by_id.insert(
            id.clone(),
            NoteRecord {
                id: id.clone(),
                path: rel.clone(),
                title: note_title_from_path(&rel),
            },
        );
        index.path_to_id.insert(rel, id);
    }

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

pub fn parse_links_for_note(source_id: &str, content: &str, index: &LinkIndex) -> Vec<LinkRef> {
    let (_, body, _) = split_frontmatter(content);
    let scan_text = if body.is_empty() {
        content.to_string()
    } else {
        body
    };
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

pub fn update_index_links_for_source(
    index: &mut LinkIndex,
    source_id: &str,
    new_refs: Vec<LinkRef>,
) {
    if let Some(prev) = index.outbound.get(source_id).cloned() {
        for entry in prev {
            if let Some(target_id) = entry.target_id {
                if let Some(list) = index.inbound.get_mut(&target_id) {
                    list.retain(|r| r.source_id != source_id);
                }
            }
        }
    }
    for r in &new_refs {
        if let Some(target_id) = &r.target_id {
            index
                .inbound
                .entry(target_id.clone())
                .or_default()
                .push(r.clone());
        }
    }
    if new_refs.is_empty() {
        index.outbound.remove(source_id);
    } else {
        index.outbound.insert(source_id.to_string(), new_refs);
    }
}

pub fn reindex_note_after_save(root: &Path, rel: &str) -> Result<(), String> {
    let mut index = read_link_index_file(root);
    let abs = root.join(rel);
    let content = fs::read_to_string(&abs).unwrap_or_default();
    let id_in_file = read_frontmatter_field(&split_frontmatter(&content).0, "id");
    let Some(id) = id_in_file else { return Ok(()) };
    index.notes_by_id.insert(
        id.clone(),
        NoteRecord {
            id: id.clone(),
            path: rel.to_string(),
            title: note_title_from_path(rel),
        },
    );
    index.path_to_id.insert(rel.to_string(), id.clone());
    let refs = parse_links_for_note(&id, &content, &index);
    update_index_links_for_source(&mut index, &id, refs);
    write_link_index_file(root, &index)
}

fn rewrite_links_in_content(content: &str, old_path: &str, new_path: &str) -> (String, u32) {
    let (frontmatter, body, has_frontmatter) = split_frontmatter(content);
    let body_for_scan = if has_frontmatter {
        body
    } else {
        content.to_string()
    };
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

pub fn repair_inbound_links(
    root: &Path,
    index: &mut LinkIndex,
    target_id: &str,
    old_path: &str,
    new_path: &str,
) -> Result<u32, String> {
    let mut rewritten = 0u32;
    let sources: HashSet<String> = index
        .inbound
        .get(target_id)
        .map(|list| list.iter().map(|r| r.source_id.clone()).collect())
        .unwrap_or_default();
    for source_id in sources {
        let Some(source_record) = index.notes_by_id.get(&source_id).cloned() else {
            continue;
        };
        let source_abs = root.join(&source_record.path);
        let original = match fs::read_to_string(&source_abs) {
            Ok(s) => s,
            Err(_) => continue,
        };
        let (new_content, count) = rewrite_links_in_content(&original, old_path, new_path);
        if count > 0 {
            fs::write(&source_abs, &new_content).map_err(|error| error.to_string())?;
            rewritten += count;
            let refs = parse_links_for_note(&source_id, &new_content, index);
            update_index_links_for_source(index, &source_id, refs);
        }
    }
    Ok(rewritten)
}

pub fn move_index_path(
    index: &mut LinkIndex,
    old_path: &str,
    new_path: &str,
    id: &str,
    kind: &str,
) {
    index.path_to_id.remove(old_path);
    index
        .path_to_id
        .insert(new_path.to_string(), id.to_string());
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

pub fn repair_subtree_paths(
    root: &Path,
    index: &mut LinkIndex,
    old_folder_path: &str,
    new_folder_path: &str,
) -> Result<(), String> {
    if old_folder_path == new_folder_path {
        return Ok(());
    }
    let mut affected: Vec<(String, String, String, String)> = Vec::new();
    if let Some(id) = index.path_to_id.get(old_folder_path).cloned() {
        affected.push((
            id,
            "folder".to_string(),
            old_folder_path.to_string(),
            new_folder_path.to_string(),
        ));
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

    for (id, kind, old_path, new_path) in &affected {
        move_index_path(index, old_path, new_path, id, kind);
    }

    for (id, _kind, old_path, new_path) in &affected {
        let _ = repair_inbound_links(root, index, id, old_path, new_path);
    }
    Ok(())
}

pub fn forget_path_from_index(index: &mut LinkIndex, path: &str) {
    let Some(id) = index.path_to_id.remove(path) else {
        return;
    };
    index.notes_by_id.remove(&id);
    index.folders_by_id.remove(&id);
    if let Some(refs) = index.outbound.remove(&id) {
        for r in refs {
            if let Some(target_id) = r.target_id {
                if let Some(list) = index.inbound.get_mut(&target_id) {
                    list.retain(|x| x.source_id != id);
                }
            }
        }
    }
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

pub fn forget_subtree_from_index(index: &mut LinkIndex, folder_path: &str) {
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
