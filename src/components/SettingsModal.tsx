import { ThemePreviewHostContext } from "./ThemePreviewHost";
import type { ReactNode } from "react";
import { useState } from "react";
import { Maximize2, Minimize2, RotateCcw, Settings, X } from "lucide-react";
import type { NavigationStyle } from "../types";

export default function SettingsModal(props: {
  navigationStyle: NavigationStyle;
  onNavigationStyleChange: (value: NavigationStyle) => void;
  spellcheckEnabled: boolean;
  onSpellcheckEnabledChange: (value: boolean) => void;
  wordCountVisible: boolean;
  onWordCountVisibleChange: (value: boolean) => void;
  plasmaEnabled: boolean;
  plasmaSupported?: boolean;
  onPlasmaEnabledChange: (value: boolean) => void;
  plasmaFrost: number;
  onPlasmaFrostChange: (value: number) => void;
  plasmaBackgroundBlur: number;
  onPlasmaBackgroundBlurChange: (value: number) => void;
  onClose: () => void;
  onResetTheme?: () => void;
  themeContent: ReactNode;
}) {
  const [maximized, setMaximized] = useState(false);
  const [section, setSection] = useState("general");
  const [previewHost, setPreviewHost] = useState<HTMLDivElement | null>(null);
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
                {["general", "appearance"].map((id) => (
                  <button
                    key={id}
                    className={`settings-nav-item ${section === id ? "is-active" : ""}`}
                    onClick={() => setSection(id)}
                  >
                    {id === "appearance" ? "Appearance" : "General"}
                  </button>
                ))}
              </nav>
            </aside>
            <div className="settings-content">
              <div className="settings-content-header">
                <div>
                  <h2>{section === "appearance" ? "Appearance" : "General"}</h2>
                  <p>
                    {section === "appearance"
                      ? "Customize navigation, themes, and visual effects."
                      : "Editing and word count preferences."}
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
                {section === "appearance" ? (
                  <div className="settings-appearance">
                    <div className="setting-row settings-navigation-style">
                      <strong>Navigation style</strong>
                      <select
                        className="settings-select"
                        aria-label="Navigation style"
                        value={props.navigationStyle}
                        onChange={(e) =>
                          props.onNavigationStyleChange(
                            e.target.value as NavigationStyle,
                          )
                        }
                      >
                        <option value="dual-pane">Dual pane</option>
                        <option value="single-pane">Single pane</option>
                        <option value="section-view">
                          Dual pane with sections
                        </option>
                      </select>
                    </div>
                    {props.themeContent}
                    <section
                      className="settings-experimental"
                      aria-label="Experimental appearance"
                    >
                      <h3>Experimental appearance</h3>
                      <p>
                        These overrides stay with this notebook until you select a theme again. Edit the theme to change its saved Plasma default.
                      </p>
                      <label className="setting-row">
                        Plasma glass panes
                        <input
                          type="checkbox"
                          checked={props.plasmaEnabled}
                          onChange={(e) =>
                            props.onPlasmaEnabledChange(e.target.checked)
                          }
                        />
                      </label>
                      {props.plasmaSupported === false ? (
                        <p>
                          This theme recommends standard rendering. You can still try Plasma here.
                        </p>
                      ) : null}
                      {props.plasmaEnabled ? (
                        <>
                          <label className="setting-row">
                            Panel frostiness
                            <input
                              type="range"
                              min={0}
                              max={100}
                              value={props.plasmaFrost}
                              onChange={(e) =>
                                props.onPlasmaFrostChange(
                                  Number(e.target.value),
                                )
                              }
                            />
                          </label>
                          <label className="setting-row">
                            Background blur
                            <input
                              type="range"
                              min={0}
                              max={40}
                              value={props.plasmaBackgroundBlur}
                              onChange={(e) =>
                                props.onPlasmaBackgroundBlurChange(
                                  Number(e.target.value),
                                )
                              }
                            />
                          </label>
                        </>
                      ) : null}
                    </section>
                    {props.onResetTheme ? (
                      <section className="settings-reset-appearance" aria-label="Default appearance">
                        <h3>Default appearance</h3>
                        <p>Reset this notebook’s theme and Plasma settings to their defaults.</p>
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
