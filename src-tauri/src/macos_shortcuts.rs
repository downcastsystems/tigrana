use block2::RcBlock;
use objc2::{rc::Retained, runtime::AnyObject, MainThreadMarker};
use objc2_app_kit::{NSApplication, NSEvent, NSEventMask, NSEventModifierFlags};
use std::{cell::RefCell, ptr::NonNull};
use tauri::{AppHandle, Manager};

struct LocalMonitor(Retained<AnyObject>);

impl Drop for LocalMonitor {
    fn drop(&mut self) {
        // This token came from addLocalMonitor and is kept on the main thread.
        unsafe { NSEvent::removeMonitor(&self.0) };
    }
}

thread_local! {
    static MONITOR: RefCell<Option<LocalMonitor>> = const { RefCell::new(None) };
}

fn is_control_slash(characters: &str, modifiers: NSEventModifierFlags) -> bool {
    let shortcut_modifiers = NSEventModifierFlags::Control
        | NSEventModifierFlags::Command
        | NSEventModifierFlags::Option
        | NSEventModifierFlags::Shift;
    characters == "/" && modifiers & shortcut_modifiers == NSEventModifierFlags::Control
}

/// Consume Control+/ before WebKit's native text editing interprets it. DOM
/// preventDefault and menu accelerators cannot reliably suppress that path.
/// The monitor is local to this process and only handles our webview windows.
pub fn install(app: &AppHandle) -> Result<(), &'static str> {
    let mtm = MainThreadMarker::new().ok_or("Shortcuts must be installed on the main thread")?;
    let app = app.clone();
    let handler = RcBlock::new(move |event: NonNull<NSEvent>| -> *mut NSEvent {
        // AppKit supplies a live event for the duration of this callback.
        let key_event = unsafe { event.as_ref() };
        let characters = key_event.charactersIgnoringModifiers();
        if !is_control_slash(
            &characters.map(|value| value.to_string()).unwrap_or_default(),
            key_event.modifierFlags(),
        ) {
            return event.as_ptr();
        }
        // Leave native dialogs and sheets in charge of their own input.
        if NSApplication::sharedApplication(mtm).modalWindow().is_some() {
            return event.as_ptr();
        }
        let Some(native_window) = key_event.window(mtm) else {
            return event.as_ptr();
        };
        if native_window.attachedSheet().is_some() {
            return event.as_ptr();
        }
        let target = app.webview_windows().into_values().find(|window| {
            window.ns_window().is_ok_and(|pointer| {
                pointer == Retained::as_ptr(&native_window).cast_mut().cast()
            })
        });
        let Some(window) = target else {
            return event.as_ptr();
        };
        if !key_event.isARepeat() {
            super::dispatch_frontend_menu_action(
                &window,
                "tigrana-menu-command",
                serde_json::Value::String("toggle_outline".into()),
            );
        }
        // Returning null prevents both WebKit and the JS shortcut handler from
        // receiving this event, so it cannot beep or toggle the pane twice.
        std::ptr::null_mut()
    });
    // The handler returns only the original live event pointer or null.
    let token = unsafe {
        NSEvent::addLocalMonitorForEventsMatchingMask_handler(NSEventMask::KeyDown, &handler)
    }
    .ok_or("Could not install the Control+/ shortcut")?;
    MONITOR.with(|monitor| *monitor.borrow_mut() = Some(LocalMonitor(token)));
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn recognizes_control_slash_with_caps_lock() {
        assert!(is_control_slash("/", NSEventModifierFlags::Control));
        assert!(is_control_slash(
            "/",
            NSEventModifierFlags::Control | NSEventModifierFlags::CapsLock
        ));
    }

    #[test]
    fn leaves_typing_and_other_shortcuts_alone() {
        for modifiers in [
            NSEventModifierFlags::empty(),
            NSEventModifierFlags::Command,
            NSEventModifierFlags::Control | NSEventModifierFlags::Command,
            NSEventModifierFlags::Control | NSEventModifierFlags::Option,
            NSEventModifierFlags::Control | NSEventModifierFlags::Shift,
        ] {
            assert!(!is_control_slash("/", modifiers));
        }
        for characters in ["?", "\\", "z", ""] {
            assert!(!is_control_slash(characters, NSEventModifierFlags::Control));
        }
    }
}
