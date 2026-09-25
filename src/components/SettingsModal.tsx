import BulletMethodSettings from "./BulletMethodSettings";
import { BulletMethodIcon } from "./BulletMethodIcon";
import type { BulletMethodStatus } from "../lib/bulletMethod";
import type { NewNoteWritingStyle, WritingStyle } from "../lib/writingStyle";
import { ThemePreviewHostContext } from "./ThemePreviewHost";
import type { ReactNode } from "react";
import { useState } from "react";
import { Maximize2, Minimize2, RotateCcw, Settings, X } from "lucide-react";
import type { NavigationStyle } from "../types";

export type SettingsSection = "general" | "appearance" | "bullet-method";

export default function SettingsModal(props: {
  bulletMethodStatuses: readonly BulletMethodStatus[];
  onBulletMethodStatusesChange: (statuses: readonly BulletMethodStatus[]) => void;
  newNoteWritingStyle: NewNoteWritingStyle;
  lastWritingStyle: WritingStyle;
  onNewNoteWritingStyleChange: (value: NewNoteWritingStyle) => void;
  initialSection?: SettingsSection;
  onSectionChange?: (section: SettingsSection) => void;
  navigationStyle: NavigationStyle;
  onNavigationStyleChange: (value: NavigationStyle) => void;
  editorWidthMode: "comfortable" | "narrow" | "full";
  onEditorWidthModeChange: (value: "comfortable" | "narrow" | "full") => void;
  noteAlignment: "left" | "center";
  onNoteAlignmentChange: (value: "left" | "center") => void;
  spellcheckEnabled: boolean;
  onSpellcheckEnabledChange: (value: boolean) => void;
  wordCountVisible: boolean;
  onWordCountVisibleChange: (value: boolean) => void;
  onClose: () => void;
  onResetTheme?: () => void;
  themeContent: ReactNode;
}) {
  const [maximized, setMaximized] = useState(false);
  const [section, setSection] = useState<SettingsSection>(props.initialSection ?? "general");
  const [previewHost, setPreviewHost] = useState<HTMLDivElement | null>(null);
  const navigationControls = (
    <div className="setting-row settings-navigation-style">
      <strong>Navigation style</strong>
      <select className="settings-select" aria-label="Navigation style"
        value={props.navigationStyle}
        onChange={event => props.onNavigationStyleChange(event.target.value as NavigationStyle)}>
        <option value="dual-pane">Dual pane</option>
        <option value="section-view">Dual pane with sections (recommended)</option>
        <option value="single-pane">Single pane</option>
      </select>
    </div>
  );
  return (
    <div
      className="dialog-backdrop settings-backdrop"
      onMouseDown={props.onClose}
    >
      <ThemePreviewHostContext.Provider value={previewHost}>
        <div
          className={`settings-window${maximized ? " is-maximized" : ""}`}
          role="dialog"
          aria-modal="true"
          aria-label="Settings"
          onMouseDown={(e) => e.stopPropagation()}
        >
          <section className="settings-modal">
            <aside className="settings-sidebar">
              <div className="settings-title">
                <Settings size={18} />
                <h2>Settings</h2>
              </div>
              <nav className="settings-nav" aria-label="Settings sections">
                {(["general", "appearance", "bullet-method"] as const).map((id) => (
                  <button
                    key={id}
                    className={`settings-nav-item ${section === id ? "is-active" : ""}`}
                    onClick={() => { setSection(id); props.onSectionChange?.(id); }}
                  >
                    {id === "bullet-method" ? "Bullet Method" : id === "appearance" ? "Appearance" : "General"}
                  </button>
                ))}
              </nav>
            </aside>
            <div className="settings-content">
              <div className="settings-content-header">
                <div>
                  <h2 className={section === "bullet-method" ? "bullet-method-heading" : undefined}>
                    {section === "bullet-method" ? "Bullet Method" : section === "appearance" ? "Appearance" : "General"}
                    {section === "bullet-method" ? <BulletMethodIcon size={20} /> : null}
                  </h2>
                  <p>
                    {section === "bullet-method" ? "Tasks in ordinary notes. Settings apply across notebooks on this device." : section === "appearance"
                      ? "Customize themes, colors, and typography."
                      : "Navigation, editing, and word count preferences."}
                  </p>
                </div>
                <div className="settings-window-actions">
                <button
                  type="button"
                  className="icon-button"
                  aria-label={maximized ? "Restore settings size" : "Maximize settings"}
                  title={maximized ? "Restore settings size" : "Maximize settings"}
                  aria-pressed={maximized}
                  onClick={() => setMaximized(value => !value)}
                >
                  {maximized ? <Minimize2 size={17} /> : <Maximize2 size={17} />}
                </button>
                <button
                  className="icon-button"
                  aria-label="Close settings"
                  onClick={props.onClose}
                >
                  <X size={17} />
                </button>
                </div>
              </div>
              <div className="settings-scroll" key={section}>
                {section === "bullet-method" ? <BulletMethodSettings statuses={props.bulletMethodStatuses} onChange={props.onBulletMethodStatusesChange} /> : null}
                {section === "appearance" ? (
                  <div className="settings-appearance">
                    {props.themeContent}
                    {props.onResetTheme ? (
                      <section className="settings-reset-appearance" aria-label="Default appearance">
                        <h3>Default appearance</h3>
                        <p>Restore Classic with Default colors, fonts, effects, and layout, including sidebars and word count.</p>
                        <button className="toolbar-button" onClick={props.onResetTheme}>
                          <RotateCcw size={16} aria-hidden="true" />
                          Restore default appearance
                        </button>
                      </section>
                    ) : null}
                  </div>
                ) : null}
                {section === "general" ? (
                  <div>
                    {navigationControls}
                    <hr className="settings-appearance-divider" />
                    <label className="setting-row">
                      Editor width
                      <select className="settings-select" aria-label="Editor width" value={props.editorWidthMode}
                        onChange={event => props.onEditorWidthModeChange(event.target.value as "comfortable" | "narrow" | "full")}>
                        <option value="comfortable">Comfortable Width</option>
                        <option value="narrow">Narrow Width</option>
                        <option value="full">Full Width</option>
                      </select>
                    </label>
                    <label className="setting-row">
                      Editor Alignment
                      <select className="settings-select" aria-label="Editor Alignment" value={props.noteAlignment}
                        onChange={event => props.onNoteAlignmentChange(event.target.value as "left" | "center")}>
                        <option value="left">Align left</option>
                        <option value="center">Align center</option>
                      </select>
                    </label>
                    <label className="setting-row">
                      <span>New Note Writing Style<small className="setting-description">For this notebook</small></span>
                      <select className="settings-select" aria-label="New Note Writing Style" value={props.newNoteWritingStyle}
                        onChange={event => props.onNewNoteWritingStyleChange(event.target.value as NewNoteWritingStyle)}>
                        <option value="last-used">Last used writing style ({props.lastWritingStyle === "story" ? "Story" : "Notes"})</option>
                        <option value="notes">Notes</option>
                        <option value="story">Story</option>
                      </select>
                    </label>
                    <label className="setting-row">
                      Check spelling while typing
                      <input
                        type="checkbox"
                        checked={props.spellcheckEnabled}
                        onChange={(e) =>
                          props.onSpellcheckEnabledChange(e.target.checked)
                        }
                      />
                    </label>
                    <label className="setting-row">
                      Show word count
                      <input
                        type="checkbox"
                        checked={props.wordCountVisible}
                        onChange={(e) => props.onWordCountVisibleChange(e.target.checked)}
                      />
                    </label>
                  </div>
                ) : null}
              </div>
            </div>
          </section>
          <div className="settings-preview-host" ref={setPreviewHost} />
        </div>
      </ThemePreviewHostContext.Provider>
    </div>
  );
}
