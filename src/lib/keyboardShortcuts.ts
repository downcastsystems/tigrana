/** Frontend fallbacks for native menu commands, also used in the browser demo.
 * Match modifiers exactly so editor combinations (for example Mod+Shift+S)
 * cannot fall through to a different application action (Save).
 */
export function appShortcutCommand(event: Pick<KeyboardEvent,
  "key" | "code" | "metaKey" | "ctrlKey" | "shiftKey" | "altKey" | "isComposing" | "defaultPrevented"
>): string | null {
  if (event.defaultPrevented || event.isComposing || !(event.metaKey || event.ctrlKey)
    || (event.metaKey && event.ctrlKey)) return null;
  const key = event.key.toLowerCase();
  if (event.altKey) {
    if (event.shiftKey) return null;
    if (key === "r" || event.code === "KeyR") return "toggle_raw_markdown";
    if (key === "." || event.code === "Period") return "sort_bullet_method";
    return null;
  }
  if (event.shiftKey) {
    switch (key) {
      case "f": return "search_notebook";
      case "g": return "find_previous";
      case "k": return "format_link";
      case "n": return "new_folder";
      case "o": return "new_notebook";
      default: return null;
    }
  }
  switch (key) {
    case "b": return "format_bold";
    case "i": return "format_italic";
    case "f": return "find_note";
    case "g": return "find_next";
    case "k": return "search_notebook";
    case "n": return "new_note";
    case "o": return "open_notebook";
    case "p": return "print_note";
    case "s": return "save_note";
    case "t": return "new_tab";
    case ",": return "open_settings";
    default: return null;
  }
}
