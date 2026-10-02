// Native menu APIs require the main thread on macOS, so this test has its own
// entry point instead of running on a libtest worker thread.
#[path = "../src/application_menu.rs"]
mod application_menu;
#[path = "../src/windows_menus.rs"]
mod windows_menus;

use application_menu::{application_submenu, replace_menu_items};
use tauri::menu::{Menu, MenuItem, Submenu};

fn main() {
    let mut context = tauri::generate_context!();
    context.config_mut().app.windows.clear();
    #[allow(unused_mut)]
    let mut app = tauri::Builder::default()
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
    // The web menu snapshot uses the native tree, including parent enablement.
    let disabled = MenuItem::with_id(handle, "format_table", "Table", true, None::<&str>).unwrap();
    let insert = Submenu::with_id_and_items(handle, "Insert", "Insert", false, &[&disabled]).unwrap();
    let snapshot_menu = Menu::with_items(handle, &[&insert]).unwrap();
    let entries = windows_menus::entries(&snapshot_menu).unwrap();
    assert_eq!(entries[0].id, "Insert");
    assert!(!entries[0].enabled);
    assert!(windows_menus::find_enabled(&snapshot_menu, "format_table").unwrap().is_none());
    insert.set_enabled(true).unwrap();
    assert!(windows_menus::find_enabled(&snapshot_menu, "format_table").unwrap().is_some());
    assert!(windows_menus::find_enabled(&snapshot_menu, "unknown").unwrap().is_none());
    let close = tauri::menu::PredefinedMenuItem::close_window(handle, None).unwrap();
    let close_menu = Menu::with_items(handle, &[&close]).unwrap();
    assert_eq!(windows_menus::entries(&close_menu).unwrap()[0].shortcut, Some("Alt+F4"));
    // Stable IDs keep predefined actions usable after a menu refresh.
    for _ in 0..2 {
        let undo = tauri::menu::PredefinedMenuItem::undo(handle, None).unwrap();
        let edit = Submenu::with_items(handle, "Edit", true, &[&undo]).unwrap();
        let menu = Menu::with_items(handle, &[&edit]).unwrap();
        let entries = windows_menus::entries(&menu).unwrap();
        assert_eq!(entries[0].children.as_ref().unwrap()[0].id, "predefined:Undo");
        assert!(windows_menus::find_enabled(&menu, "predefined:Undo").unwrap().is_some());
    }
    #[cfg(target_os = "windows")]
    {
        let window = shortcut_test_window(app.handle());
        windows_accelerators(&mut app, &window);
        window.close().unwrap();
    }
    println!("Native application menu transfer and ID lookup passed");
}

// Compile this setup on every platform so private or feature-gated Tauri APIs
// cannot slip into the Windows test. Only Windows needs to create the webview;
// the macOS menu test also runs in environments without a graphical session.
#[cfg_attr(not(target_os = "windows"), allow(dead_code))]
fn shortcut_test_window(handle: &tauri::AppHandle) -> tauri::WebviewWindow {
    tauri::WebviewWindowBuilder::new(
        handle,
        "shortcut-test",
        tauri::WebviewUrl::External("about:blank".parse().unwrap()),
    )
    .visible(false)
    .build()
    .expect("build shortcut test webview")
}

// Exercise Tauri's actual Win32 message hook, not just the displayed labels.
#[cfg(target_os = "windows")]
#[allow(deprecated)]
fn windows_accelerators(app: &mut tauri::App, window: &tauri::WebviewWindow) {
    use std::{sync::{Arc, Mutex}, time::{Duration, Instant}};
    use tauri::menu::{CheckMenuItem, IconMenuItem};

    #[link(name = "user32")]
    extern "system" {
        fn GetKeyboardState(state: *mut u8) -> i32;
        fn SetKeyboardState(state: *const u8) -> i32;
        fn PostMessageW(hwnd: *mut std::ffi::c_void, message: u32, wparam: usize, lparam: isize) -> i32;
    }

    let handle = app.handle().clone();
    let events = Arc::new(Mutex::new(Vec::<String>::new()));
    let received = events.clone();
    window.on_menu_event(move |_, event| received.lock().unwrap().push(event.id().as_ref().to_owned()));
    let current = Menu::new(&handle).unwrap();
    app.set_menu(current.clone()).unwrap();
    window.hide_menu().unwrap();
    app.run_iteration(|_, _| {});

    for generation in 0..4 {
        let bold = MenuItem::with_id(&handle, "bold", "Bold", true, Some("CmdOrCtrl+B")).unwrap();
        let sidebar = CheckMenuItem::with_id(&handle, "sidebar", "Sidebar", true, false, Some("CmdOrCtrl+/")).unwrap();
        let sort = IconMenuItem::with_id(&handle, "sort", "Bullet Statuses", true, None, Some("CmdOrCtrl+Alt+Period")).unwrap();
        let nested = Submenu::with_items(&handle, "Sort Lines", true, &[&sort]).unwrap();
        let edit = Submenu::with_items(&handle, "Edit", true, &[&bold, &sidebar, &nested]).unwrap();
        let replacement = Menu::with_items(&handle, &[&edit]).unwrap();
        if generation == 0 {
            application_menu::register_menu_accelerators(&replacement).unwrap();
            app.set_menu(replacement.clone()).unwrap();
        } else {
            application_menu::replace_menu_items(&app.menu().unwrap(), &replacement).unwrap();
        }
        drop(replacement);
        window.hide_menu().unwrap();
        for (key, alt, expected) in [(0x42, false, "bold"), (0xBF, false, "sidebar"), (0xBE, true, "sort")] {
            events.lock().unwrap().clear();
            let mut previous = [0u8; 256];
            let mut pressed = [0u8; 256];
            pressed[0x11] = 0x80; // VK_CONTROL
            if alt { pressed[0x12] = 0x80; } // VK_MENU
            // These buffers live through the synchronous Win32 calls. The key
            // message targets only this test window; no system-wide input.
            unsafe {
                assert_ne!(GetKeyboardState(previous.as_mut_ptr()), 0);
                assert_ne!(SetKeyboardState(pressed.as_ptr()), 0);
                assert_ne!(PostMessageW(window.hwnd().unwrap().0 as _, 0x100, key, 1), 0);
            }
            let deadline = Instant::now() + Duration::from_secs(2);
            while events.lock().unwrap().is_empty() && Instant::now() < deadline {
                app.run_iteration(|_, _| {});
                std::thread::sleep(Duration::from_millis(5));
            }
            unsafe { assert_ne!(SetKeyboardState(previous.as_ptr()), 0); }
            assert_eq!(*events.lock().unwrap(), [expected], "accelerator after refresh {generation}");
        }
    }
    println!("Windows native accelerator dispatch passed at startup and after refreshes");
}
