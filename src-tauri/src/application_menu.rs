use tauri::{
    menu::{Menu, Submenu},
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
    Ok(())
}
