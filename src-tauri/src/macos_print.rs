use objc2::{msg_send, rc::Retained, runtime::AnyObject};
use objc2_app_kit::{NSPrintInfo, NSPrintOperation, NSWindow};
use objc2_foundation::NSCopying;
use tauri::WebviewWindow;

// Match the HTML @page margin. AppKit uses points, not CSS pixels.
const PAGE_MARGIN_POINTS: f64 = 18.0 * 72.0 / 25.4;

fn set_page_margins(info: &NSPrintInfo) {
    // WKWebView's pagination can clip the CSS page area when AppKit carries
    // a scale from an earlier job. Start each Note print at its natural size.
    info.setScalingFactor(1.0);
    info.setTopMargin(PAGE_MARGIN_POINTS);
    info.setBottomMargin(PAGE_MARGIN_POINTS);
    info.setLeftMargin(PAGE_MARGIN_POINTS);
    info.setRightMargin(PAGE_MARGIN_POINTS);
    info.setVerticallyCentered(false);
    info.setHorizontallyCentered(false);
}

pub fn print(window: &WebviewWindow) -> Result<(), String> {
    window
        .with_webview(|webview| unsafe {
            // Tauri supplies live native pointers and runs this callback on the UI thread.
            let view: &AnyObject = &*webview.inner().cast();
            let can_print: bool =
                msg_send![view, respondsToSelector: objc2::sel!(printOperationWithPrintInfo:)];
            if !can_print {
                return;
            } // WKWebView native printing requires macOS 11+.
            let parent: &NSWindow = &*webview.ns_window().cast();
            // Copy printer/paper settings without changing the application's shared defaults.
            let info = NSPrintInfo::sharedPrintInfo().copy();
            set_page_margins(&info);
            // Tauri's default print() sets these native margins to zero. With print
            // scaling, CSS @page alone does not reliably preserve the bottom margin.
            let operation: Retained<NSPrintOperation> =
                msg_send![view, printOperationWithPrintInfo: &*info];
            operation.setCanSpawnSeparateThread(true);
            operation.runOperationModalForWindow_delegate_didRunSelector_contextInfo(
                parent,
                None,
                None,
                std::ptr::null_mut(),
            );
        })
        .map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reserves_physical_margins_and_resets_inherited_scale_without_changing_paper() {
        let info = NSPrintInfo::new();
        info.setScalingFactor(0.75);
        let paper = info.paperSize();
        set_page_margins(&info);
        for margin in [
            info.topMargin(),
            info.bottomMargin(),
            info.leftMargin(),
            info.rightMargin(),
        ] {
            assert!((margin - 51.0236220472441).abs() < 0.0001);
        }
        assert_eq!(info.paperSize(), paper);
        assert_eq!(info.scalingFactor(), 1.0);
        assert!(!info.isVerticallyCentered());
        assert!(!info.isHorizontallyCentered());
    }
}
