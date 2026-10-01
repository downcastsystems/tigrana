# Keyboard shortcuts

Audited against the native menu, frontend handlers, and installed Tiptap
extensions. `Mod` means Command on macOS and Ctrl on Windows. Native menus
use `CmdOrCtrl`; Tiptap uses `Mod`. Alt is labeled Option on macOS.

## App menu and frontend shortcuts

| Action | Shortcut on Windows | Shortcut on macOS |
| --- | --- | --- |
| Settings | Ctrl+, | Cmd+, |
| Quit Tigrana | Ctrl+Q | Cmd+Q |
| Open Notebook | Ctrl+O | Cmd+O |
| New Notebook | Ctrl+Shift+O | Cmd+Shift+O |
| New Note | Ctrl+N | Cmd+N |
| New Folder/Section | Ctrl+Shift+N | Cmd+Shift+N |
| New Tab | Ctrl+T | Cmd+T |
| Save | Ctrl+S | Cmd+S |
| Print current Note | Ctrl+P | Cmd+P |
| Find in Note | Ctrl+F | Cmd+F |
| Find next / previous | Ctrl+G / Ctrl+Shift+G | Cmd+G / Cmd+Shift+G |
| Search all Notes | Ctrl+K or Ctrl+Shift+F | Cmd+K or Cmd+Shift+F |
| Show left sidebar | Ctrl+/ | Cmd+/ |
| Show right sidebar | Ctrl+Backslash | Cmd+Backslash |
| Show raw Markdown | Ctrl+Alt+R | Cmd+Option+R |
| Zoom in / out / reset | Ctrl+= / Ctrl+- / Ctrl+0 | Cmd+= / Cmd+- / Cmd+0 |
| Bold | Ctrl+B | Cmd+B |
| Italic | Ctrl+I | Cmd+I |
| Insert link | Ctrl+Shift+K | Cmd+Shift+K |
| Sort by Bullet Statuses | Ctrl+Alt+. | Cmd+Option+. |

Zoom in also accepts Mod+Plus. Bullet Statuses must be enabled, and sorting
requires an editable rich-text Note with a selection or a cursor in a list.
App commands retain their menu enablement and editing restrictions.

Tigrana retains its existing search/link convention: Mod+K opens notebook
search and Mod+Shift+K inserts a link. This differs from word processors that
use Ctrl+K for links. No Windows-key shortcut is required.

## Editor shortcuts

Tiptap resolves these bindings for each OS. They run in the editor before
frontend app fallbacks, which leave already handled events alone.

| Action | Binding |
| --- | --- |
| Underline | Mod+U |
| Strikethrough | Mod+Shift+S |
| Inline code | Mod+E |
| Highlight | Mod+Shift+H |
| Heading 1–6 | Mod+Alt+1–6 |
| Paragraph | Mod+Alt+0 |
| Code block | Mod+Alt+C |
| Blockquote | Mod+Shift+B |
| Bulleted / numbered / task list | Mod+Shift+8 / Mod+Shift+7 / Mod+Shift+9 |
| Align left / center / right | Mod+Shift+L / Mod+Shift+E / Mod+Shift+R |
| Hard break / exit code block | Shift+Enter or Mod+Enter, depending on block context |
| Undo | Mod+Z |
| Redo | Mod+Shift+Z; Ctrl+Y on Windows |
| Cut / copy / paste / select all | Mod+X / Mod+C / Mod+V / Mod+A |

Tab and Shift+Tab retain the existing indentation, list, code, and table
behavior. Enter, Escape, arrows, Backspace, and Delete remain contextual editor
or dialog keys. Text expansions such as `::` followed by Space and slash
commands do not depend on a platform modifier.

## Platform and utility exceptions

- Native Close Window uses Alt+F4 on Windows and Cmd+W on macOS.
- Native Redo shows Ctrl+Y on Windows and Cmd+Shift+Z on macOS.
- Native Minimize uses Ctrl+M on Windows and Cmd+M on macOS.
- macOS Hide and Hide Others use Cmd+H and Cmd+Option+H. Services and these
  hide commands are platform-specific predefined menu items.
- macOS also accepts Control+/ for the left sidebar through its local native
  event monitor. This avoids WebKit interpreting that key as a text command.
- Theme recovery uses Mod+Alt+Shift+T. Saving an equation uses Mod+Enter.

## Native Windows regression checks

The pinned muda 0.19 menu library registers accelerators when children are
attached to a submenu that already belongs to a root menu. Tigrana constructs
menus bottom-up, so `register_menu_accelerators` reattaches descendants
in parent-first order at startup and after every menu replacement. Predefined
editing commands retain webview key handling because the Windows library
implements menu clicks by synthesizing those same keys. Windows Minimize uses
a custom command so its displayed Ctrl+M remains registered.

`src-tauri/tests/application_menu.rs` tests native regular, check, and nested
icon menu accelerators against Tauri's Windows message loop, including hidden
menus and repeated refreshes. The release workflow runs this test on Windows
and checks that the built executable's PE subsystem is Windows GUI, value 2.
Release builds use `windows_subsystem = "windows"` to avoid opening a console.
Development builds retain console output.

Local macOS verification cannot establish Windows runtime behavior. The
Windows-only test and a fresh-install launch check still need a Windows host.
