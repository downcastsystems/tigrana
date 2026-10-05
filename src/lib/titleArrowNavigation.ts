// Textareas do not expose caret geometry. Measure a hidden copy with the same
// wrapping and typography to keep Down Arrow local until the last visual line.
export function isTitleCaretOnLastLine(input: HTMLTextAreaElement) {
  if (input.selectionStart !== input.selectionEnd) return false;
  if (input.selectionStart === input.value.length) return true;
  const style = getComputedStyle(input);
  const mirror = document.createElement("div");
  for (const property of ["box-sizing", "font-family", "font-size", "font-weight", "font-style",
    "font-variant", "font-stretch", "direction", "line-height", "letter-spacing", "word-spacing", "text-transform", "text-indent", "text-align",
    "padding-top", "padding-right", "padding-bottom", "padding-left", "border-top-width",
    "border-right-width", "border-bottom-width", "border-left-width", "word-break", "overflow-wrap", "tab-size"]) {
    mirror.style.setProperty(property, style.getPropertyValue(property));
  }
  Object.assign(mirror.style, {
    position: "fixed", visibility: "hidden", pointerEvents: "none",
    width: style.width,
    whiteSpace: input.wrap === "off" ? "pre" : "pre-wrap", borderStyle: "solid",
  });
  const text = document.createTextNode(input.value + "\u200b");
  mirror.append(text);
  document.body.append(mirror);
  try {
    const range = document.createRange();
    range.setStart(text, input.selectionStart);
    range.collapse(true);
    const caret = range.getBoundingClientRect();
    range.setStart(text, input.value.length);
    range.collapse(true);
    const end = range.getBoundingClientRect();
    return Math.abs(caret.top - end.top) < 1;
  } finally {
    mirror.remove();
  }
}
