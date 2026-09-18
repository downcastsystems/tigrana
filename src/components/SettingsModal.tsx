import { ThemePreviewHostContext } from "./ThemePreviewHost";
import type { ReactNode } from "react";
import { useState } from "react";
import { Settings, X } from "lucide-react";
import type { NavigationStyle } from "../types";

export default function SettingsModal(props: {
  navigationStyle: NavigationStyle;
  onNavigationStyleChange: (value: NavigationStyle) => void;
  spellcheckEnabled: boolean;
  onSpellcheckEnabledChange: (value: boolean) => void;
  plasmaEnabled: boolean;
  onPlasmaEnabledChange: (value: boolean) => void;
  plasmaFrost: number;
  onPlasmaFrostChange: (value: number) => void;
  plasmaBackgroundBlur: number;
  onPlasmaBackgroundBlurChange: (value: number) => void;
  onClose: () => void;
  themeContent: ReactNode;
}) {
  const [section, setSection] = useState("general");
  const [previewHost, setPreviewHost] = useState<HTMLDivElement | null>(null);
  return (
    <div
      className="dialog-backdrop settings-backdrop"
      onMouseDown={props.onClose}
    >
      <ThemePreviewHostContext.Provider value={previewHost}>
        <div
          className="settings-window"
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
                    {id === "appearance" ? "Themes" : "General"}
                  </button>
                ))}
              </nav>
            </aside>
            <div className="settings-content">
              <div className="settings-content-header">
                <div>
                  <h2>{section === "appearance" ? "Themes" : "General"}</h2>
                  <p>
                    {section === "appearance"
                      ? "Choose a theme or make one of your own."
                      : "Navigation and editing preferences."}
                  </p>
                </div>
                <button
                  className="icon-button"
                  aria-label="Close settings"
                  onClick={props.onClose}
                >
                  <X size={17} />
                </button>
              </div>
              <div className="settings-scroll" key={section}>
                {section === "appearance" ? (
                  <div className="settings-appearance">
                    {props.themeContent}
                    <section
                      className="settings-experimental"
                      aria-label="Experimental appearance"
                    >
                      <h3>Experimental appearance</h3>
                      <p>
                        These settings travel with this notebook. Create or edit
                        a theme to save them in the shared library.
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
                  </div>
                ) : null}
                {section === "general" ? (
                  <div>
                    <div className="setting-row">
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
