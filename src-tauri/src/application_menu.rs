use tauri::{
    menu::{Menu, MenuItemKind, Submenu},
    Runtime,
};

pub fn application_submenu<R: Runtime>(menu: &Menu<R>, id: &str) -> Result<Submenu<R>, String> {
    for item in menu.items().map_err(|error| error.to_string())? {
        if let Some(submenu) = item.as_submenu() {
            // Labels are presentation; Windows may read them through a native
            // parent handle. IDs remain stable across menu rebuilds.
            if submenu.id().as_ref() == id {
                return Ok(submenu.clone());
            }
        }
    }
    Err(format!("Unknown application menu: {id}"))
}

pub fn replace_menu_items<R: Runtime>(
    current: &Menu<R>,
    replacement: &Menu<R>,
) -> tauri::Result<()> {
    for item in current.items()? {
        current.remove(&item)?;
    }
    for item in replacement.items()? {
        // muda's Windows text/state access reads the first parent HMENU. Appending
        // alone leaves the temporary parent there after its native handle is
        // destroyed. Remove first so the retained submenu belongs to current.
        replacement.remove(&item)?;
        current.append(&item)?;
    }
    register_menu_accelerators(current)
}

/// muda 0.19 registers Windows accelerators when an item is appended to a
/// submenu that already belongs to a root menu. Our menus are built bottom-up,
/// so reattach descendants top-down after construction or a root transfer.
pub fn register_menu_accelerators<R: Runtime>(menu: &Menu<R>) -> tauri::Result<()> {
    if !cfg!(target_os = "windows") {
        return Ok(());
    }
    fn attach_children<R: Runtime>(submenu: &Submenu<R>) -> tauri::Result<()> {
        let children = submenu.items()?;
        for (index, child) in children.iter().enumerate() {
            // Windows predefined editing items synthesize Ctrl+C/V/Z/etc.
            // Leave them with the webview's editing handlers instead of
            // intercepting the same keystrokes through an accelerator table.
            // Alt+F4 already belongs to the OS. Separators need no registration.
            if matches!(child, MenuItemKind::Predefined(_)) {
                continue;
            }
            submenu.remove(child)?;
            submenu.insert(child, index)?;
            if let Some(nested) = child.as_submenu() {
                attach_children(nested)?;
            }
        }
        Ok(())
    }
    for item in menu.items()? {
        if let Some(submenu) = item.as_submenu() {
            attach_children(submenu)?;
        }
    }
    Ok(())
}
