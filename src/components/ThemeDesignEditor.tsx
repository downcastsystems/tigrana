import { generatedVisualCss } from "../lib/themeVisualCss";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  defaultThemeDesign,
  parseThemeDesign,
  type ThemeDesign,
} from "../lib/themeDesign";
import { ExternalLink } from "lucide-react";
import { openThemeReferenceWindow } from "../lib/themeReferenceWindow";
import { compileThemeCss } from "../lib/themeCss";
import type { ThemeDocument } from "../lib/themes";
export function ThemeDesignEditor({
  theme,
  onChange,
  cssMode,
}: {
  theme: ThemeDocument;
  onChange: (patch: Partial<ThemeDocument>) => void;
  cssMode: boolean;
}) {
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const design = theme.design ?? defaultThemeDesign;
  const [assetError, setAssetError] = useState("");
  const [referenceError, setReferenceError] = useState("");
  const generatedCss = useMemo(() => generatedVisualCss(theme), [theme]);
  const fileInput = useRef<HTMLInputElement>(null);
  const validation = useMemo(() => {
    try {
      compileThemeCss(design, "validation");
      return "";
    } catch (e) {
      return String(e);
    }
  }, [design]);
  const change = (patch: Partial<ThemeDesign>) =>
    onChange({ schemaVersion: 2, design: { ...design, ...patch } });
  return (
    <div className="theme-design-controls">
      {cssMode ? (
        <>
          <p>
            CSS styles the notebook panes and title bar. Settings and recovery
            controls stay protected. CSS overrides the matching Visual settings.
            Open the reference in a separate window to see what you can style.
          </p>
          <button type="button" className="toolbar-button theme-reference-link"
            onClick={() => { setReferenceError(""); void openThemeReferenceWindow().catch(error => setReferenceError(String(error))); }}>
            <ExternalLink size={16} aria-hidden="true" />
            CSS reference and examples
          </button>
          {referenceError ? <p role="alert">{referenceError}</p> : null}
          <h3>Generated from Visual settings</h3>
          <p>Read-only. Updates automatically when you change Visual settings. Your custom rules below are kept separate and are never rewritten.</p>
          <textarea className="theme-code theme-generated-css" aria-label="Generated visual CSS" readOnly spellCheck={false} value={generatedCss} />
          <h3>Custom CSS</h3>
          <p>Use variables such as <code>var(--tigrana-accent)</code> to follow Visual settings. Fixed colors override them for the matching elements.</p>
          <textarea
            className="theme-code"
            aria-label="Theme CSS"
            spellCheck={false}
            value={design.css}
            placeholder={
              ":scope { --tigrana-radius: 12px; }\n.ProseMirror h2 { letter-spacing: 0.04em; }"
            }
            onChange={(e) => change({ css: e.target.value })}
          />
          {validation ? (
            <p role="alert">{validation}</p>
          ) : (
            <p>CSS is valid. Preview changes before saving.</p>
          )}
          <p>
            Local assets: PNG, JPEG, WebP, or WOFF2. Reference images as
            url("assets/name.png") and fonts as theme-font-name.
          </p>
          <input
            type="file"
            ref={fileInput}
            hidden
            accept=".png,.jpg,.jpeg,.webp,.woff2"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (!file) return;
              try {
                setAssetError("");
                if (file.size > 2_100_000)
                  throw new Error("Assets must be smaller than 2 MB.");
                const ext = file.name.split(".").pop()?.toLowerCase();
                const name = file.name
                  .replace(/\.[^.]+$/, "")
                  .replace(/[^a-zA-Z0-9_-]/g, "-");
                const path = `assets/${name}.${ext}`;
                const bytes = new Uint8Array(await file.arrayBuffer());
                let binary = "";
                for (let i = 0; i < bytes.length; i += 8192)
                  binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
                const mime =
                  ext === "png"
                    ? "image/png"
                    : ext === "webp"
                      ? "image/webp"
                      : ext === "woff2"
                        ? "font/woff2"
                        : "image/jpeg";
                const next = parseThemeDesign({
                  ...design,
                  assets: {
                    ...design.assets,
                    [path]: { mime, data: btoa(binary) },
                  },
                });
                if (mounted.current) change({ assets: next.assets });
              } catch (error) {
                setAssetError(String(error));
              }
            }}
          />
          {assetError ? <p role="alert">{assetError}</p> : null}
          <button
            className="toolbar-button"
            onClick={() => fileInput.current?.click()}
          >
            Add asset
          </button>
          {Object.keys(design.assets).map((path) => (
            <div key={path}>
              {path}{" "}
              <button
                className="toolbar-button"
                onClick={() =>
                  change({
                    assets: Object.fromEntries(
                      Object.entries(design.assets).filter(
                        ([key]) => key !== path,
                      ),
                    ),
                  })
                }
              >
                Remove
              </button>
            </div>
          ))}
        </>
      ) : (
        <>
          <label>
            Corner radius
            <input
              type="range"
              aria-label="Corner radius"
              min={0}
              max={24}
              value={design.metrics.radius}
              onChange={(e) =>
                change({
                  metrics: {
                    ...design.metrics,
                    radius: Number(e.target.value),
                  },
                })
              }
            />
          </label>
          <label>
            Spacing
            <input
              type="range"
              aria-label="Theme spacing"
              min={0.75}
              max={1.5}
              step={0.05}
              value={design.metrics.spacing}
              onChange={(e) =>
                change({
                  metrics: {
                    ...design.metrics,
                    spacing: Number(e.target.value),
                  },
                })
              }
            />
          </label>
        </>
      )}
      <section className="theme-sharing-details" aria-label="Sharing details">
        <h3>Sharing details</h3>
        <label>
          Author
          <input
            className="settings-text-input"
            aria-label="Theme author"
            maxLength={100}
            value={design.author}
            onChange={(e) => change({ author: e.target.value })}
          />
        </label>
        <label>
          Version
          <input
            className="settings-text-input"
            aria-label="Theme version"
            value={design.version}
            onChange={(e) => change({ version: e.target.value })}
          />
        </label>
        <label>
          <input
            type="checkbox"
            checked={design.supportsPlasma}
            onChange={(e) => {
              change({ supportsPlasma: e.target.checked });
              if (!e.target.checked && theme.plasma)
                onChange({
                  schemaVersion: 2,
                  design: { ...design, supportsPlasma: false },
                  plasma: { ...theme.plasma, enabled: false },
                });
            }}
          />
          Supports Plasma
        </label>
        <label>
          License
          <textarea
            className="theme-code"
            style={{ minHeight: 80 }}
            aria-label="Theme license"
            maxLength={20000}
            value={design.license}
            onChange={(e) => change({ license: e.target.value })}
          />
        </label>
      </section>
    </div>
  );
}
