import { useEffect, useId, useRef, useState } from 'react';
import { Trash2, X } from 'lucide-react';
import { listThemes, type ThemeDocument } from '../lib/themes';
import { wallpaperDeletionReason } from '../lib/notebookWallpapers';
import type { NotebookWallpaper } from '../types';

export function NotebookWallpaperDialog({ wallpapers, theme, active, onDelete, onSelect, onClose }: {
  wallpapers: NotebookWallpaper[];
  theme: ThemeDocument;
  active?: NotebookWallpaper;
  onDelete: (wallpaper: NotebookWallpaper) => Promise<void>;
  onSelect: (wallpaper: NotebookWallpaper) => void;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [library, setLibrary] = useState<ThemeDocument[] | null>(null);
  const [error, setError] = useState('');
  const [deleting, setDeleting] = useState(false);
  useEffect(() => {
    let cancelled = false;
    void listThemes().then(result => {
      if (cancelled) return;
      if (result.warnings.length) setError('Some custom themes could not be checked. Deletion is unavailable.');
      else setLibrary(result.themes);
    }).catch(() => { if (!cancelled) setError('Custom themes could not be checked. Deletion is unavailable.'); });
    return () => { cancelled = true; };
  }, []);
  const remove = async (wallpaper: NotebookWallpaper) => {
    setDeleting(true);
    setError('');
    try {
      // Recheck on deletion in case another window saved a theme since opening.
      const result = await listThemes();
      if (result.warnings.length) throw new Error('Some custom themes could not be checked.');
      setLibrary(result.themes);
      const reason = wallpaperDeletionReason(wallpaper, [theme, ...result.themes], active);
      if (reason) throw new Error(reason);
      await onDelete(wallpaper);
      dialog.current?.querySelector<HTMLButtonElement>('[aria-label="Close wallpaper picker"]')?.focus();
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setDeleting(false); }
  };
  useEffect(() => {
    const element = dialog.current!;
    element.showModal();
    return () => element.close();
  }, []);
  const close = () => { dialog.current?.close(); onClose(); };
  return <dialog ref={dialog} className="notebook-wallpaper-dialog" aria-labelledby={titleId}
    onMouseDown={event => event.stopPropagation()}
    onCancel={event => { event.preventDefault(); close(); }}
    onKeyDown={event => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); }
    }}>
    <header>
      <h2 id={titleId}>Notebook wallpapers</h2>
      <button type="button" className="icon-button" aria-label="Close wallpaper picker" onClick={close} autoFocus><X size={18} /></button>
    </header>
    {wallpapers.length ? <div className="notebook-wallpaper-grid">
      {wallpapers.map((wallpaper, index) => {
        const reason = library === null ? (error ? 'Custom themes could not be checked.' : 'Checking custom themes…') : wallpaperDeletionReason(wallpaper, [theme, ...library], active);
        const tooltip = reason ?? (deleting ? 'Deleting wallpaper…' : 'Delete wallpaper');
        return <div key={index} className="notebook-wallpaper-item">
          <button type="button" className="notebook-wallpaper-choice" title={wallpaper.name}
            onClick={() => { close(); onSelect(wallpaper); }}>
            <img src={`data:${wallpaper.asset.mime};base64,${wallpaper.asset.data}`} alt="" />
            <span>{wallpaper.name}</span>
          </button>
          <span className="notebook-wallpaper-delete" title={tooltip}>
            <button type="button" className="icon-button" aria-label={`Delete ${wallpaper.name}`} title={tooltip}
              disabled={!!reason || deleting} onClick={() => void remove(wallpaper)}><Trash2 size={14} aria-hidden="true" /></button>
          </span>
        </div>;
      })}
    </div> : <p className="setting-help-text">No wallpapers saved yet. Choose an image from your computer to add it to this notebook.</p>}
    {error && <p role="alert">{error}</p>}
  </dialog>;
}
