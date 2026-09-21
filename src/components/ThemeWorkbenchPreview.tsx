import { compileThemeCss } from "../lib/themeCss";
import { useCallback, useLayoutEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { FileText, Plus, X, Folder, PanelLeftClose, PanelRightClose, Ellipsis } from "lucide-react";
import appCss from "../styles/app.css?inline";
import plasmaCss from "../styles/plasma.css?inline";
import apiCss from "../styles/theme-api.css?inline";
import type { NavigationStyle } from "../types";
import type { ThemeDocument } from "../lib/themes";
import { themeStylesheet, themeVariables, themeBackgroundImage, themeRenderingMode } from "../lib/themeRuntime";
import PlasmaTheme from "./PlasmaTheme";

const previewCss = (appCss + plasmaCss)
  .replace(/:root/g, ":host")
  .replace(/html((?:\[[^\]]+\]|:not\([^)]*\))*)/g, (_, attrs: string) =>
    attrs ? `:host(${attrs})` : ":host",
  )
  .replace(/(?<![-\w.])body\b/g, ".preview-body");
const previewWidth = 1200;
const previewHeight = 800;

const fixtureCss = `:host{display:block;isolation:isolate;clip-path:inset(0 round 8px);position:relative;contain:style;width:100%;aspect-ratio:${previewWidth}/${previewHeight};max-height:max(140px,calc(100dvh - 300px));overflow:hidden;}
.preview-body{min-width:0;min-height:0;background:var(--app-bg);font-family:var(--app-font-family);font-size:var(--app-font-size);color:var(--text)}
.preview-stage.app-shell{position:relative;width:100%;height:100%;min-height:0;overflow:hidden;background:var(--app-bg)}.preview-body{position:absolute;width:${previewWidth}px;height:${previewHeight}px;transform:scale(var(--preview-scale,1));transform-origin:top left;left:var(--preview-left,0px);overflow:hidden;background:transparent}.preview-layout{display:flex;flex-direction:column;height:100%;min-height:0}.app-titlebar{z-index:1}.app-frame{display:grid;grid-template-columns:136px minmax(0,1fr);flex:1;min-height:0;padding:var(--tigrana-workspace-inset,0px);gap:var(--tigrana-panel-gap,0px)}
.app-frame .left-panes>aside{width:auto;min-width:0;overflow:hidden}.app-frame>.right-sidebar{display:flex}.app-frame>.folder-pane{width:auto;min-width:0;display:block}.app-frame>.main-pane{min-width:0;display:flex;flex-direction:column;overflow:hidden;position:relative}.note-title-input{height:1.3em;flex-shrink:0}.note-surface{padding:14px;overflow:auto;min-height:0;padding-bottom:54px}.ProseMirror{flex-shrink:0;min-height:0;padding:0;font-size:var(--editor-font-size);font-family:var(--editor-font-family)}
.app-shell[data-plasma] .app-frame{padding:var(--tigrana-workspace-inset,18px 16px 16px);gap:var(--tigrana-panel-gap,20px)}.app-shell[data-plasma] .note-surface{padding:12px}.note-tab{width:160px;text-align:left}.note-tab-add{flex-shrink:0}.folder-row{margin-left:0;margin-right:6px;width:calc(100% - 6px)}.folder-select{min-width:0}.folder-select span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.title-shell,.editor-shell{width:100%;margin:0}.editor-shell{padding:28px 0 40px}.preview-controls{display:flex;gap:6px;flex-wrap:wrap;margin-top:14px}.preview-controls input{width:100%;min-width:0}
.plasma-background{position:fixed!important;inset:0;z-index:-1}.plasma-background canvas{position:fixed!important;width:100vw!important;height:100vh!important;inset:0}
.note-surface.is-comfortable-width :is(.title-shell,.editor-shell){width:min(860px,calc(100% - 72px))}
.note-surface.is-narrow-width :is(.title-shell,.editor-shell){width:min(640px,calc(100% - 72px))}
.note-surface.is-full-width :is(.title-shell,.editor-shell){width:calc(100% - 48px)}
.note-surface.is-center-aligned :is(.title-shell,.editor-shell){margin-left:auto;margin-right:auto}
.note-surface.is-left-aligned :is(.title-shell,.editor-shell){margin-left:36px;margin-right:auto}
.note-surface.is-left-aligned.is-full-width :is(.title-shell,.editor-shell){margin-left:24px}
`;

/** Uses the production styles and editor DOM contract, isolated from the authoring form. */
export function ThemeWorkbenchPreview({
  theme,
  mode,
}: {
  theme: ThemeDocument;
  mode: "light" | "dark";
}) {
  const renderedMode = themeRenderingMode(theme, mode);
  const backgroundImage = useMemo(() => themeBackgroundImage(theme), [theme]);
  const [navigationOverride, setNavigation] = useState<NavigationStyle | null>(null);
  const [outlineOverride, setOutline] = useState<boolean | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [compactTitle, setCompactTitle] = useState(false);
  const navigation = navigationOverride ?? theme.navigationStyle ?? 'section-view';
  const outline = outlineOverride ?? theme.rightSidebarOpen ?? true;
  const [root, setRoot] = useState<ShadowRoot | null>(null);
  const attach = useCallback((host: HTMLDivElement | null) => {
    if (host) setRoot(host.shadowRoot ?? host.attachShadow({ mode: "open" }));
  }, []);
  const [fit, setFit] = useState({ scale: 1, left: 0 });
  useLayoutEffect(() => {
    if (!root) return;
    const host = root.host as HTMLElement;
    const fitPreview = () => {
      // Use layout dimensions so application zoom is not applied twice.
      const { clientWidth: width, clientHeight: height } = host;
      if (!width || !height) return;
      const scale = Math.min(1, width / previewWidth, height / previewHeight);
      const left = Math.max(0, (width - previewWidth * scale) / 2);
      setFit(previous => previous.scale === scale && previous.left === left ? previous : { scale, left });
    };
    fitPreview();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(fitPreview);
    observer.observe(host);
    return () => observer.disconnect();
  }, [root]);
  const compiled = useMemo(() => {
    try {
      return { css: themeStylesheet(theme, mode, "preview"), error: "" };
    } catch (e) {
      return {
        css: themeStylesheet({ ...theme, design: undefined }, mode, "preview"),
        error: String(e),
      };
    }
  }, [theme, mode]);
  // WebKit does not register @font-face inside a shadow tree. Register the
  // same region-scoped families in the document for portable font previews.
  const fontCss = useMemo(() => { try { return theme.design ? compileThemeCss({ ...theme.design, css: "" }, "preview") : ""; } catch { return ''; } }, [theme.design]);
  const plasma =
    theme.plasma?.enabled && theme.design?.supportsPlasma !== false;
  return (
    <>
      <div className="theme-preview-options" aria-label="Preview controls">
        <label>Navigation <select aria-label="Preview navigation" value={navigation} onChange={e => setNavigation(e.target.value as NavigationStyle)}>
          <option value="single-pane">Single pane</option><option value="dual-pane">Dual pane</option><option value="section-view">Dual pane with sections</option>
        </select></label>
        <label><input type="checkbox" checked={outline} onChange={e => setOutline(e.target.checked)} />Outline</label>
        <label><input type="checkbox" checked={menuOpen} onChange={e => setMenuOpen(e.target.checked)} />Menu states</label>
        <label><input type="checkbox" checked={compactTitle} onChange={e => setCompactTitle(e.target.checked)} />Compact title</label>
        <button type="button" className="toolbar-button" onClick={() => { setNavigation(null); setOutline(null); }}>Theme defaults</button>
      </div>
      <p className="settings-description">Preview scales to fit the full layout. Scroll inside the note to explore its content; hover items and use Tab to check focus.</p>
      {fontCss ? <style>{fontCss}</style> : null}
      {compiled.error ? (
        <p role="alert">Preview uses visual settings until the CSS is valid.</p>
      ) : null}
      <div
        ref={attach}
        className="theme-workbench-preview"
        data-theme={renderedMode}
        data-theme-preset="custom"
        data-accent-titlebar={theme.accentTitlebar ? "true" : "false"}
        aria-label={`${mode} full theme preview`}
        style={{ ...themeVariables(theme, mode, "preview"), "--preview-scale": fit.scale, "--preview-left": `${fit.left}px` } as React.CSSProperties}
      />
      {root &&
        createPortal(
          <>
            <style>{previewCss + apiCss + fixtureCss}</style>
            <style>{compiled.css}</style>
              <div
                className="app-shell preview-stage"
                data-plasma={plasma || undefined}
                style={
                  {
                    "--plasma-panel-opacity": `${(theme.plasma?.frost ?? 80) * 0.9}%`,
                    "--plasma-editor-opacity": `${Math.min(95, (theme.plasma?.frost ?? 80) * 1.1)}%`,
                  } as React.CSSProperties
                }
              >
                {/* Plasma measures viewport coordinates, so keep its canvas outside the scaled layout. */}
                {plasma ? (
                  <PlasmaTheme
                    backgroundImage={backgroundImage}
                    ambientDrops={theme.plasma?.ambientDrops}
                    flow={(theme.plasma?.flow ?? 0) / 100}
                    theme={renderedMode}
                    accentColor={theme[mode].accent}
                    frost={(theme.plasma?.frost ?? 80) / 100}
                    backgroundBlur={theme.plasma?.backgroundBlur ?? 0}
                    surfaceScale={fit.scale}
                    layoutKey={`workbench-${navigation}-${outline}`}
                  />
                ) : null}
                <div className="preview-body"><div className="preview-layout">
                <header
                  className={`app-titlebar theme-${renderedMode} ${plasma ? "theme-plasma" : "theme-standard"}`}
                  data-theme-region="preview"
                  data-theme-api={theme.design ? "1" : undefined}
                >
                  <div className="note-tabs">
                    <button className="note-tab is-active">
                      <FileText size={14} className="note-tab-icon" />
                      <span className="note-tab-label">Notes</span>
                      <span className="tab-close" aria-hidden="true">
                        <X size={13} />
                      </span>
                    </button>
                    <button className="note-tab">
                      <FileText size={14} className="note-tab-icon" />
                      <span className="note-tab-label">Ideas</span>
                    </button>
                  </div>
                  <button className="note-tab-add" aria-label="Preview new tab">
                    <Plus size={16} />
                  </button>
                </header>
                <div
                  className={`app-frame theme-${renderedMode} ${plasma ? "theme-plasma" : "theme-standard"} ${outline ? '' : 'is-outline-hidden'}`}
                  style={{ gridTemplateColumns: `${navigation === 'single-pane' ? '240px' : '460px'} minmax(360px,1fr)${outline ? ' 200px' : ''}` }}
                  data-theme-region="preview"
                  data-theme-api={theme.design ? "1" : undefined}
                >
                  <div className="left-panes" style={{ display: 'grid', gridTemplateColumns: navigation === 'single-pane' ? '1fr' : '200px minmax(0,1fr)', minWidth: 0 }}>
                    <aside className={navigation === 'single-pane' ? 'unified-tree-pane' : `folder-pane ${navigation === 'section-view' ? 'section-view-folder-pane' : ''}`}>
                      <div className="pane-header"><strong>{navigation === 'single-pane' ? 'Notebook' : navigation === 'section-view' ? 'Sections' : 'Folders'}</strong></div>
                      {["Notes", "Ideas", "Projects"].map((name, index) => navigation === 'single-pane' ? (
                        <div key={name} className={`unified-tree-row unified-note-row${index === 0 ? ' is-active' : ''}`}><FileText size={15} /><span>{name}</span></div>
                      ) : (
                        <div key={name} className={`folder-row${index === 0 ? " is-active" : ""}`}>
                          <button className="folder-select"><Folder size={15} /><span>{name}</span></button>
                        </div>
                      ))}
                    </aside>
                    {navigation !== 'single-pane' && <aside className="notes-pane"><div className="pane-header"><strong>Notes</strong></div>
                      <div className="note-card is-active"><span className="note-card-main"><FileText size={15} /><span className="note-card-text"><strong>Notes</strong></span></span></div>
                      <div className="note-card"><span className="note-card-main"><FileText size={15} /><span className="note-card-text"><strong>Another idea</strong></span></span></div>
                    </aside>}
                  </div>
                  <main className="main-pane">
                    <header className="topbar">
                      <button className="icon-button sidebar-toggle" aria-label="Preview hide sidebar"><PanelLeftClose size={17} /></button>
                      {compactTitle && <button className="topbar-note-title is-visible"><span>Notes</span></button>}
                      <div className="topbar-actions">
                        <div className="note-view-control"><button className="icon-button" aria-label="Preview editor options" onClick={() => setMenuOpen(value => !value)}><Ellipsis size={17} /></button>
                        {menuOpen && <div className="note-view-dropdown" role="menu" aria-label="Sample editor options">
                          <button role="menuitem"><span><strong>Enter focus mode</strong><small>Hide navigation and outline</small></span></button>
                          <div className="note-view-menu-divider" /><div className="note-view-menu-label">Editor width</div>
                          <button className="is-active" role="menuitemradio" aria-checked="true"><span><strong>Comfortable width</strong><small>Default</small></span><span>✓</span></button>
                          <button role="menuitemradio" aria-checked="false"><span><strong>Narrow width</strong><small>Hover to check this state</small></span></button>
                        </div>}
                        </div>
                        <button className="icon-button outline-toggle" aria-label="Preview show outline"><PanelRightClose size={17} /></button>
                      </div>
                    </header>
                    <div className={`note-surface${theme.editorWidthMode ? ` is-${theme.editorWidthMode}-width` : ''}${theme.noteAlignment ? ` is-${theme.noteAlignment}-aligned` : ''}`}>
                      <div className="title-shell" hidden={compactTitle}><textarea
                        className="note-title-input"
                        aria-label="Preview note title"
                        value="Notes"
                        readOnly
                        rows={1}
                      /></div>
                      <div className="editor-shell"><div className="editor-content"><div
                        className="ProseMirror"
                        role="document"
                        aria-label="Sample note"
                      >
                        <h1>A fresh page</h1>
                        <p>
                          A quiet space to <strong>think</strong>,{" "}
                          <em>write</em>, and explore.
                        </p>
                        <p>
                          <a href="#sample" onClick={(e) => e.preventDefault()}>
                            A link to another idea
                          </a>{" "}
                          and <mark>highlighted text</mark>.
                        </p>
                        <h2>A new thought</h2>
                        <blockquote>
                          <p>Make room for a new thought.</p>
                        </blockquote>
                        <h3>Things to explore</h3>
                        <ul>
                          <li>
                            <p>A bulleted idea</p>
                          </li>
                          <li>
                            <p>Another idea</p>
                          </li>
                        </ul>
                        <ol>
                          <li>
                            <p>First step</p>
                          </li>
                        </ol>
                        <ul data-type="taskList">
                          <li data-type="taskItem" data-checked="false">
                            <label>
                              <input type="checkbox" readOnly />
                              <span />
                            </label>
                            <div>
                              <p>Unfinished task</p>
                            </div>
                          </li>
                          <li data-type="taskItem" data-checked="true">
                            <label>
                              <input type="checkbox" checked readOnly />
                              <span />
                            </label>
                            <div>
                              <p>Completed task</p>
                            </div>
                          </li>
                        </ul>
                        <p>
                          Inline <code>code</code> and <s>removed text</s>.
                        </p>
                        <pre>
                          <code>const idea = "Keep it simple";</code>
                        </pre>
                        <hr />
                        <table>
                          <thead>
                            <tr>
                              <th>
                                <p>Topic</p>
                              </th>
                              <th>
                                <p>Status</p>
                              </th>
                            </tr>
                          </thead>
                          <tbody>
                            <tr>
                              <td>
                                <p>Themes</p>
                              </td>
                              <td>
                                <p>Exploring</p>
                              </td>
                            </tr>
                          </tbody>
                        </table>
                        <p>
                          <small>Edited just now</small>
                        </p>
                      </div>
                      </div></div>
                      <div className="preview-controls">
                        <button className="toolbar-button">Button</button>
                        <button className="toolbar-button" disabled>
                          Disabled
                        </button>
                        <input
                          className="settings-text-input"
                          aria-label="Sample text field"
                          defaultValue="Text field"
                        />
                        <select
                          className="settings-select"
                          aria-label="Sample select"
                        >
                          <option>Menu choice</option>
                        </select>
                      </div>
                    </div>
                    {theme.wordCountVisible !== false && <div className="note-status-bar"><span>125 words</span><span>720 characters</span></div>}
                  </main>
                  {outline && <aside className="right-sidebar"><div className="pane-header"><strong>Outline</strong></div><button className="outline-item">A fresh page</button></aside>}
                </div>
                </div></div>
              </div>
          </>,
          root,
        )}
    </>
  );
}
