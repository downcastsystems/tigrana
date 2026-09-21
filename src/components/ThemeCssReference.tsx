const variables = [
  ["--tigrana-menu-selected-background / --tigrana-menu-selected-text", "Selected menu colors; follow selected note colors by default"],
  ["--tigrana-hover-background / --tigrana-hover-text", "Hovered menu and navigation colors"],
  ["--tigrana-font-title / --tigrana-font-compact-title", "Full and compact note title sizes"],
  ["--tigrana-font-navigation / --tigrana-font-tab / --tigrana-font-menu", "Navigation, tab and menu label sizes"],
  ["--tigrana-font-secondary / --tigrana-font-status", "Menu descriptions, captions and word count sizes"],
  ["--tigrana-control-ID", "Value of a theme-specific range, color or toggle; add units with calc(value * 1px)"],
  ["--tigrana-panel-gap", "Space between panels, including draggable dividers, e.g. 18px"],
  ["--tigrana-workspace-inset", "Space around the workspace, e.g. 18px"],
  ["--tigrana-panel-radius", "Panel corners in standard UI, e.g. 16px"],
  ["--tigrana-panel-shadow", "Panel shadows in standard UI, e.g. 0 8px 24px #00000030"],
  ["--tigrana-workspace-background", "Color or gradient behind panels in standard UI"],
  ["--tigrana-background", "Note background"],
  ["--tigrana-surface", "Navigation pane background"],
  ["--tigrana-text", "Interface text"],
  ["--tigrana-editor-text", "Note title and editor text"],
  ["--tigrana-selected-text", "Text on selected rows, tabs, and text selections"],
  ["--tigrana-highlight-text", "Highlighted words inside notes"],
  ["--tigrana-highlight-background", "Highlight background inside notes"],
  ["--tigrana-editor-opacity", "Editor surface opacity percentage, when Advanced surfaces is configured"],
  ["--tigrana-muted", "Secondary text"],
  ["--tigrana-accent", "Selection and accent color"],
  ["--tigrana-border", "Borders"],
  ["--tigrana-radius", "Corner radius, e.g. 8px"],
  ["--tigrana-spacing", "Spacing multiplier, e.g. 1 or 0.9"],
  ["--tigrana-line-height", "Editor line spacing, e.g. 1.6"],
];
const selectors = [
  [
    "Title bar and tabs",
    ".app-titlebar, .note-tabs, .note-tab, .note-tab.is-active, .tab-close",
  ],
  [
    "Navigation panes",
    ".folder-pane, .notes-pane, .unified-tree-pane, .pane-header",
  ],
  [
    "Navigation rows",
    ".folder-row, .note-card, .unified-note-row, .unified-folder-row",
  ],
  ["Workspace", ".app-frame, .main-pane, .right-sidebar, .note-surface"],
  ["Controls", ".toolbar-button, .icon-button, button, input, select"],
  ["Note title", ".note-title-input"],
  ["Word count badge", ".note-status-bar, .note-status-bar span"],
  [
    "Note content",
    ".ProseMirror h1, .ProseMirror h2, .ProseMirror p, .ProseMirror a",
  ],
  [
    "Other note elements",
    ".ProseMirror ul, .ProseMirror ol, .ProseMirror blockquote, .ProseMirror pre, .ProseMirror code, .ProseMirror table, .ProseMirror img, .ProseMirror mark, .ProseMirror hr",
  ],
  [
    "Tasks",
    '[data-type="taskList"], [data-type="taskItem"], [data-checked="true"]',
  ],
];
export function ThemeCssReference() {
  return (
    <article className="theme-css-reference">
      <h1>CSS reference and examples</h1>
      <p className="theme-reference-intro">Keep this window beside the theme editor while you work. Changes to your CSS appear in the editor’s preview.</p>
      <p>
        Use CSS properties such as color, background, border, border-radius,
        padding, and font-family with the selectors below. Changes appear in the
        preview before you save.
      </p>
      <h2>Theme variables</h2>
      <p>
        Set these inside <code>:scope</code> to change the notebook panes and
        title bar. These are the supported theme variables.
      </p>
      <table aria-label="Supported theme variables">
        <tbody>
          {variables.map(([name, description]) => (
            <tr key={name}>
              <td>
                <code>{name}</code>
              </td>
              <td>{description}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <h2>What you can style</h2>
      <p>
        These selectors are supported by Theme API 1. Note content uses ordinary
        HTML elements inside <code>.ProseMirror</code>. Add{" "}
        <code>.is-active</code> to navigation rows to target the selected row.
      </p>
      <table aria-label="Supported theme selectors">
        <tbody>
          {selectors.map(([name, selector]) => (
            <tr key={name}>
              <td>{name}</td>
              <td>
                <code>{selector}</code>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <h2>Example: spacing, headings, and tabs</h2>
      <pre>
        <code>{`:scope {
  --tigrana-radius: 6px;
  --tigrana-spacing: 0.9;
  --tigrana-line-height: 1.7;
}
.theme-dark .ProseMirror h2 { color: #90d6c4; }
.theme-light .ProseMirror h2 { color: #235b50; }
.note-tab { border-radius: 4px; }
.note-tab.is-active { font-weight: 600; }`}</code>
      </pre>
      <p>
        Use <code>.theme-light</code> or <code>.theme-dark</code> for color
        schemes, and <code>.theme-standard</code> or <code>.theme-plasma</code>{" "}
        for rendering modes. Check each supported combination in the preview.
      </p>
      <h2>Window panels without Plasma</h2>
      <p>Separate panels can use ordinary CSS. These layout variables preserve resizing and hidden-sidebar behavior. Plasma adds glass rendering; it is not required for panel layouts.</p>
      <pre><code>{`:scope {
  --tigrana-panel-gap: 18px;
  --tigrana-workspace-inset: 18px;
  --tigrana-panel-radius: 16px;
  --tigrana-panel-shadow: 0 8px 24px #00000030;
  --tigrana-workspace-background: var(--surface-muted);
}
.main-pane, .folder-pane, .notes-pane, .right-sidebar {
  border: 1px solid var(--tigrana-border);
}
.pane-resizer { background: transparent; }`}</code></pre>
      <p>Use Advanced surfaces for panel transparency. Set different colors and gradients with <code>:scope.theme-light</code> and <code>:scope.theme-dark</code>.</p>
      <h2>Word count badge</h2>
      <p>Style the badge’s background, border, corners, shadow and typography. Use <code>--tigrana-font-status</code> for its text size. The same styling appears in the notebook and preview.</p>
      <pre><code>{`.note-status-bar {
  background: var(--tigrana-surface);
  color: var(--tigrana-text);
  border: 1px solid var(--tigrana-accent);
  border-radius: 4px;
  font-variant-numeric: tabular-nums;
}`}</code></pre>
      <h2>Local images and fonts</h2>
      <p>
        Use Add asset in the Advanced CSS tab to include a PNG, JPEG, WebP image or WOFF2 font
        with your theme. Reference the filename shown after adding it.
      </p>
      <pre>
        <code>{`.folder-pane { background-image: url("assets/paper.png"); }
.ProseMirror { font-family: theme-font-body, sans-serif; }`}</code>
      </pre>
      <p>
        The font example requires an asset named <code>assets/body.woff2</code>.
      </p>
      <h2>Supported CSS and limits</h2>
      <p>
        Use descendant or child selectors and ordinary rules, including{" "}
        <code>@media</code>. Basic state selectors such as <code>:hover</code>,{" "}
        <code>:focus-visible</code>, <code>:disabled</code> and{" "}
        <code>:checked</code> are supported, as are <code>::before</code>,{" "}
        <code>::after</code>, <code>::marker</code>, <code>::selection</code>{" "}
        and <code>::placeholder</code>. Color, gradient, arithmetic, layout and
        basic transform functions are supported.
      </p>
      <p>
        Remote URLs, imports, SVG, arbitrary data URLs, other at-rules, nested
        rules, sibling selectors, functional pseudo-classes such as{" "}
        <code>:has()</code>, <code>!important</code>, animations, transitions,
        filters and custom cursors are not supported. Custom variable names must
        start with <code>--tigrana-</code>.
      </p>
      <p>
        CSS is limited to 100 KB. Assets are limited to 32 files, about 2 MB
        each. Validation messages identify unsupported CSS. Settings, app
        dialogs and operating-system controls are outside the theme CSS area.
      </p>
    </article>
  );
}
