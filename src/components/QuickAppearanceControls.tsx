import { useEffect, useId, useRef, useState } from "react";
import { ImageIcon, RotateCcw } from "lucide-react";
import type { NotebookAppearance } from "../types";
import type { ThemeDocument } from "../lib/themes";
import { quickEditorFonts, quickPanelOpacity, themeFontLabel, type QuickAppearanceField } from "../lib/quickAppearance";
import { defaultThemeDesign, parseThemeDesign } from "../lib/themeDesign";
import { themeBackgroundImage } from "../lib/themeRuntime";
import { WallpaperMenu } from "./WallpaperMenu";
import { notebookWallpapers } from "../lib/notebookWallpapers";
import { ThemeColorField } from "./ThemeColorField";

function ResetControl({ label, changed, onReset }: { label: string; changed: boolean; onReset: () => void }) {
  const title = `Reset ${label} to theme default`;
  return <span className="quick-appearance-reset-slot">
    {changed && <button type="button" className="icon-button quick-appearance-reset" title={title} aria-label={title}
      onClick={event => {
        // Return focus to the input before this button disappears.
        event.currentTarget.closest('.setting-row, .theme-color-field')
          ?.querySelector<HTMLElement>('select, input[type="text"], input[type="range"], input[type="file"]')?.focus();
        onReset();
      }}><RotateCcw size={15} aria-hidden="true" /></button>}
  </span>;
}

export function QuickAppearanceControls({ theme, mode, current, quick, wallpapers, onDeleteWallpaper, onChange, onReset }: {
  wallpapers?: NotebookAppearance["wallpapers"];
  theme: ThemeDocument;
  mode: "light" | "dark";
  current: { accentColor: string; editorFontFamily: string; editorFontSize: number };
  quick: NotebookAppearance["quickAppearance"];
  onChange: (patch: NonNullable<NotebookAppearance["quickAppearance"]>) => void;
  onDeleteWallpaper: (wallpaper: import("../types").NotebookWallpaper) => Promise<void>;
  onReset: (field: QuickAppearanceField) => void;
}) {
  const id = useId();
  const firstFamily = (family: string) => family.split(',')[0].trim().replace(/^["']|["']$/g, '').toLowerCase();
  const fontChanged = firstFamily(current.editorFontFamily) !== firstFamily(theme.editorFontFamily);
  const additionalChanges = fontChanged || quick?.backgroundImage !== undefined
    || (quick?.panelOpacity !== undefined && quick.panelOpacity !== quickPanelOpacity(theme));
  const [moreOpen, setMoreOpen] = useState(additionalChanges);
  const [imageError, setImageError] = useState('');
  const [imageLoading, setImageLoading] = useState(false);
  const imageRequest = useRef(0);
  const imageInput = useRef<HTMLInputElement>(null);
  const imageControls = useRef<HTMLDivElement>(null);
  const imageAsset = quick?.backgroundImage?.asset;
  const imagePreview = imageAsset ? `data:${imageAsset.mime};base64,${imageAsset.data}` : themeBackgroundImage(theme);
  const latestChange = useRef(onChange);
  latestChange.current = onChange;
  useEffect(() => {
    imageRequest.current += 1;
    setImageLoading(false);
    setImageError('');
    return () => { imageRequest.current += 1; };
  }, [theme.id]);
  const chooseImage = async (file: File) => {
    const request = ++imageRequest.current;
    setImageLoading(true);
    setImageError('');
    try {
      const extension = file.name.split('.').pop()?.toLowerCase();
      const mime = extension === 'png' ? 'image/png' : extension === 'webp' ? 'image/webp'
        : extension === 'jpg' || extension === 'jpeg' ? 'image/jpeg' : null;
      if (!mime) throw new Error('Choose a PNG, JPEG, or WebP image.');
      if (file.size > 2_100_000) throw new Error('Choose an image smaller than 2 MB.');
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (request !== imageRequest.current) return;
      let binary = '';
      for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
      const asset = { mime, data: btoa(binary) };
      // Validate signature and the combined theme asset budget before persisting.
      parseThemeDesign({ ...(theme.design ?? defaultThemeDesign), assets: {
        ...theme.design?.assets, [`assets/quick-upload-check.${extension}`]: asset,
      } });
      latestChange.current({ backgroundImage: { name: file.name, asset } });
    } catch (error) {
      if (request === imageRequest.current) setImageError(error instanceof Error ? error.message : String(error));
    } finally {
      if (request === imageRequest.current) setImageLoading(false);
    }
  };
  return <section className="settings-quick-appearance" aria-label="Quick appearance">
    <h3>Quick appearance</h3>
    <p className="settings-description">These changes apply to this notebook. Choosing a theme resets them.</p>
    <ThemeColorField label="Accent color" name="Quick accent color" value={current.accentColor}
      onChange={accentColor => onChange({ accentColor })}
      trailingControl={<ResetControl label="accent color" changed={current.accentColor.toLowerCase() !== theme[mode].accent.toLowerCase()} onReset={() => onReset('accentColor')} />} />
    <div className="setting-row">
      <label htmlFor={`${id}-size`}>Editor font size</label>
      <span className="quick-appearance-control">
        <span className="quick-font-size-control">
          <input id={`${id}-size`} aria-label="Quick editor font size" type="range" min={11} max={28} step={1} value={current.editorFontSize}
            onChange={event => onChange({ editorFontSize: Number(event.target.value) })} />
          <output>{current.editorFontSize}px</output>
        </span>
        <ResetControl label="editor font size" changed={current.editorFontSize !== theme.editorFontSize} onReset={() => onReset('editorFontSize')} />
      </span>
    </div>
    <details className="quick-appearance-more" open={moreOpen} onToggle={event => setMoreOpen(event.currentTarget.open)}>
      <summary>More appearance options</summary>
    <div className="setting-row">
      <label htmlFor={`${id}-font`}>Editor font</label>
      <span className="quick-appearance-control">
        <select id={`${id}-font`} className="settings-select" aria-label="Quick editor font"
          value={quickEditorFonts.some(font => font.value === quick?.editorFontFamily) ? quick!.editorFontFamily : ""}
          onChange={event => onChange({ editorFontFamily: event.target.value || undefined })}>
          <option value="">Theme font ({themeFontLabel(theme.editorFontFamily)})</option>
          {quickEditorFonts.map(font => <option key={font.value} value={font.value}>{font.label}</option>)}
        </select>
        <ResetControl label="editor font" changed={firstFamily(current.editorFontFamily) !== firstFamily(theme.editorFontFamily)} onReset={() => onReset('editorFontFamily')} />
      </span>
    </div>
    <div className="setting-row">
      <label htmlFor={`${id}-opacity`}>Panel opacity</label>
      <span className="quick-appearance-control">
        <span className="quick-font-size-control">
          <input id={`${id}-opacity`} aria-label="Quick panel opacity" type="range" min={0} max={100} step={1}
            value={quick?.panelOpacity ?? quickPanelOpacity(theme)}
            onChange={event => onChange({ panelOpacity: Number(event.target.value) })} />
          <output>{Math.round(quick?.panelOpacity ?? quickPanelOpacity(theme))}%</output>
        </span>
        <ResetControl label="panel opacity" changed={quick?.panelOpacity !== undefined} onReset={() => onReset('panelOpacity')} />
      </span>
    </div>
    <div className="quick-background-control" role="group" aria-labelledby={`${id}-background-label`}>
      <div className="setting-row">
        <span id={`${id}-background-label`}>Background image</span>
        <div ref={imageControls}>
          <WallpaperMenu theme={theme} active={quick?.backgroundImage} onDelete={onDeleteWallpaper} label={imagePreview ? 'Change image' : 'Choose image'}
            wallpapers={notebookWallpapers(wallpapers, quick?.backgroundImage)}
            onComputer={() => imageInput.current?.click()} onSelect={backgroundImage => {
              imageRequest.current += 1;
              setImageLoading(false);
              setImageError('');
              try {
                const extension = backgroundImage.asset.mime === 'image/jpeg' ? 'jpeg' : backgroundImage.asset.mime === 'image/webp' ? 'webp' : 'png';
                parseThemeDesign({ ...(theme.design ?? defaultThemeDesign), assets: {
                  ...theme.design?.assets, [`assets/quick-upload-check.${extension}`]: backgroundImage.asset,
                } });
                onChange({ backgroundImage });
              } catch (error) {
                setImageError(error instanceof Error ? error.message : String(error));
              }
            }} />
        </div>
        <input ref={imageInput} type="file" hidden aria-label="Quick background image" accept="image/png,image/jpeg,image/webp"
          onChange={event => {
            const file = event.target.files?.[0];
            event.target.value = '';
            if (file) void chooseImage(file);
          }} />
      </div>
      <div className="quick-background-details">
        <div className="quick-background-preview">
          {imagePreview ? <img src={imagePreview} alt="Current background" />
            : <ImageIcon size={24} strokeWidth={1.25} aria-hidden="true" />}
        </div>
        <div className="quick-background-info">
          <span>{quick?.backgroundImage ? 'Custom image' : imagePreview ? 'Theme background' : 'No background image'}</span>
          <small id={`${id}-background-formats`} className="setting-help-text">PNG, JPEG or WebP · Up to 2 MB</small>
          {quick?.backgroundImage && <button type="button" className="quick-background-reset"
            aria-label="Reset background image to theme default" onClick={() => {
              imageControls.current?.querySelector<HTMLButtonElement>('button')?.focus();
              imageRequest.current += 1;
              setImageLoading(false);
              setImageError('');
              onReset('backgroundImage');
            }}>Use theme default</button>}
        </div>
      </div>
      <small id={`${id}-background-help`} className="setting-help-text">Supported themes only. Lower panel opacity to reveal the image.</small>
      {imageLoading && <p role="status">Loading background image…</p>}
      {imageError && <p role="alert">{imageError}</p>}
    </div>
    </details>
  </section>;
}
