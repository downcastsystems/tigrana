// Native menu APIs require the main thread on macOS, so this test has its own
// entry point instead of running on a libtest worker thread.
#[path = "../src/application_menu.rs"]
mod application_menu;

use application_menu::{application_submenu, replace_menu_items};
use tauri::menu::{Menu, MenuItem, Submenu};

fn main() {
    let mut context = tauri::generate_context!();
    context.config_mut().app.windows.clear();
    let app = tauri::Builder::default()
        .build(context)
        .expect("build test app");
    let handle = app.handle();
    let current = Menu::new(handle).unwrap();
    let window_reference = current.clone();

    for generation in 0..4 {
        let command =
            MenuItem::with_id(handle, "new_note", "New Note", true, None::<&str>).unwrap();
        let file = Submenu::with_id_and_items(handle, "File", "File", true, &[&command]).unwrap();
        let replacement = Menu::with_items(handle, &[&file]).unwrap();
        replace_menu_items(&current, &replacement).unwrap();
        assert!(
            replacement.items().unwrap().is_empty(),
            "transfer must detach the temporary parent"
        );
        drop(replacement);

        let resolved = application_submenu(&window_reference, "File").unwrap();
        assert_eq!(
            resolved.text().unwrap(),
            "File",
            "label survives refresh {generation}"
        );
        assert_eq!(resolved.items().unwrap().len(), 1);
        assert_eq!(resolved.items().unwrap()[0].id().as_ref(), "new_note");
        // Popup routing must survive mnemonic/localized labels.
        resolved.set_text("&Datei").unwrap();
        assert!(application_submenu(&window_reference, "File").is_ok());
        assert!(application_submenu(&window_reference, "Missing").is_err());
        assert_eq!(current.items().unwrap().len(), 1);
    }
    println!("Native application menu transfer and ID lookup passed");
}
