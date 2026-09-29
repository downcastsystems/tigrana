// Run a Vite dev server, then on macOS:
// swift scripts/check-table-layout.swift http://127.0.0.1:1422
// WKWebView matters here: newer Playwright WebKit builds do not reproduce the
// extra strip below table cells after native paragraph/line-break edits.
import AppKit
import WebKit

let app = NSApplication.shared
app.setActivationPolicy(.prohibited)
let configuration = WKWebViewConfiguration()
configuration.websiteDataStore = .nonPersistent()
let view = WKWebView(frame: NSRect(x: 0, y: 0, width: 1200, height: 800), configuration: configuration)
let window = NSWindow(contentRect: view.frame, styleMask: .borderless, backing: .buffered, defer: false)
window.setFrameOrigin(NSPoint(x: -10000, y: -10000))
window.contentView = view
window.orderFrontRegardless()
let base = CommandLine.arguments.dropFirst().first ?? "http://127.0.0.1:1422"
view.load(URLRequest(url: URL(string: "\(base)/scripts/fixtures/table-layout.html")!))
var started = false
let deadline = Date().addingTimeInterval(60)
Timer.scheduledTimer(withTimeInterval: 0.25, repeats: true) { timer in
    if Date() > deadline {
        print("FAIL: Timed out loading or checking the table fixture")
        exit(1)
    }
    if started { return }
    view.evaluateJavaScript("typeof window.runTableLayoutChecks === 'function'") { ready, _ in
        guard ready as? Bool == true, !started else { return }
        started = true
        view.evaluateJavaScript("window.runTableLayoutChecks()") { result, error in
            timer.invalidate()
            if let error = error {
                print("FAIL: \(error)")
                exit(1)
            }
            print(result ?? "No result")
            exit(0)
        }
    }
}
app.run()
