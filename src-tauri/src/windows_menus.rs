use tauri::{
    menu::{Menu, MenuItemKind},
    Runtime,
};

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MenuEntry {
    pub id: String,
    pub text: String,
    pub enabled: bool,
    pub checked: Option<bool>,
    pub separator: bool,
    pub shortcut: Option<&'static str>,
    pub children: Option<Vec<MenuEntry>>,
}

pub fn entries<R: Runtime>(menu: &Menu<R>) -> tauri::Result<Vec<MenuEntry>> {
    menu.items()?.iter().map(entry).collect()
}

fn entry<R: Runtime>(item: &MenuItemKind<R>) -> tauri::Result<MenuEntry> {
    let (text, enabled, checked, children) = match item {
        MenuItemKind::MenuItem(i) => (i.text()?, i.is_enabled()?, None, None),
        MenuItemKind::Check(i) => (i.text()?, i.is_enabled()?, Some(i.is_checked()?), None),
        MenuItemKind::Icon(i) => (i.text()?, i.is_enabled()?, None, None),
        MenuItemKind::Predefined(i) => (i.text()?, true, None, None),
        MenuItemKind::Submenu(i) => (
            i.text()?,
            i.is_enabled()?,
            None,
            Some(i.items()?.iter().map(entry).collect::<tauri::Result<_>>()?),
        ),
    };
    let text = if matches!(item, MenuItemKind::Predefined(_)) {
        text.replace('&', "")
    } else {
        text
    };
    // Predefined items receive fresh generated IDs on every menu rebuild.
    // Our app owns these English labels; stable wire IDs survive focus/save
    // refreshes between opening the web menu and choosing an item.
    let id = if matches!(item, MenuItemKind::Predefined(_)) {
        format!("predefined:{text}")
    } else {
        item.id().as_ref().to_string()
    };
    let separator = text.is_empty();
    let id = if separator {
        item.id().as_ref().to_string()
    } else {
        id
    };
    let shortcut = shortcut(&id, &text);
    Ok(MenuEntry {
        id,
        text,
        enabled,
        checked,
        separator,
        shortcut,
        children,
    })
}

pub fn find_enabled<R: Runtime>(
    menu: &Menu<R>,
    id: &str,
) -> tauri::Result<Option<MenuItemKind<R>>> {
    fn find<R: Runtime>(
        items: Vec<MenuItemKind<R>>,
        id: &str,
    ) -> tauri::Result<Option<MenuItemKind<R>>> {
        for item in items {
            let snapshot = entry(&item)?;
            if !snapshot.enabled {
                continue;
            }
            if snapshot.id == id && snapshot.children.is_none() && !snapshot.separator {
                return Ok(Some(item));
            }
            if let Some(submenu) = item.as_submenu() {
                if let Some(found) = find(submenu.items()?, id)? {
                    return Ok(Some(found));
                }
            }
        }
        Ok(None)
    }
    find(menu.items()?, id)
}

fn shortcut(id: &str, text: &str) -> Option<&'static str> {
    Some(match id {
        "open_settings" => "Ctrl+,",
        "request_quit" => "Ctrl+Q",
        "new_notebook" => "Ctrl+Shift+O",
        "open_notebook" => "Ctrl+O",
        "new_note" => "Ctrl+N",
        "new_folder" => "Ctrl+Shift+N",
        "new_tab" => "Ctrl+T",
        "save_note" => "Ctrl+S",
        "print_note" => "Ctrl+P",
        "find_note" => "Ctrl+F",
        "find_next" => "Ctrl+G",
        "find_previous" => "Ctrl+Shift+G",
        "search_notebook" => "Ctrl+K",
        "toggle_sidebar" => "Ctrl+/",
        "toggle_outline" => "Ctrl+\\",
        "toggle_raw_markdown" => "Ctrl+Alt+R",
        "zoom_in" => "Ctrl+=",
        "zoom_out" => "Ctrl+-",
        "zoom_reset" => "Ctrl+0",
        "format_bold" => "Ctrl+B",
        "format_italic" => "Ctrl+I",
        "format_link" => "Ctrl+Shift+K",
        "sort_bullet_method" => "Ctrl+Alt+.",
        "minimize_window" => "Ctrl+M",
        _ if id.starts_with("predefined:") => match text {
            "Undo" => "Ctrl+Z",
            "Redo" => "Ctrl+Y",
            "Cut" => "Ctrl+X",
            "Copy" => "Ctrl+C",
            "Paste" => "Ctrl+V",
            "Select All" => "Ctrl+A",
            "Close" | "Close Window" => "Alt+F4",
            _ => return None,
        },
        _ => return None,
    })
}

// The same Ctrl-key synthesis used by muda's Windows predefined Edit items.
#[cfg(target_os = "windows")]
pub fn edit_key(key: u16) -> Result<(), String> {
    use windows_sys::Win32::UI::Input::KeyboardAndMouse::{
        SendInput, INPUT, INPUT_KEYBOARD, KEYEVENTF_KEYUP, VK_CONTROL,
    };
    let mut inputs: [INPUT; 4] = unsafe { std::mem::zeroed() };
    for (input, (vk, flags)) in inputs.iter_mut().zip([
        (VK_CONTROL, 0),
        (key, 0),
        (key, KEYEVENTF_KEYUP),
        (VK_CONTROL, KEYEVENTF_KEYUP),
    ]) {
        input.r#type = INPUT_KEYBOARD;
        // INPUT was zero-initialized and its discriminant is INPUT_KEYBOARD.
        unsafe {
            input.Anonymous.ki.wVk = vk;
            input.Anonymous.ki.dwFlags = flags;
        }
    }
    let sent = unsafe {
        SendInput(
            inputs.len() as u32,
            inputs.as_ptr(),
            std::mem::size_of::<INPUT>() as i32,
        )
    };
    if sent == inputs.len() as u32 {
        Ok(())
    } else {
        Err("Windows could not send the editing command".into())
    }
}
