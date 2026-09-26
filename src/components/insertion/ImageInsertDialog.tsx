import { FileText, X } from "lucide-react";
import { useState } from "react";
import { notebookStorage } from "../../lib/notebookStorage";
const { saveAsset } = notebookStorage;

export type ImageInsertResult = { src: string; alt?: string };

export function ImageInsertDialog({
  workspace,
  onClose,
  onError,
  onInsert,
}: {
  workspace: string;
  onClose: () => void;
  onError: (message: string) => void;
  onInsert: (src: string, alt?: string) => void;
}) {
  const [url, setUrl] = useState("");
  const [alt, setAlt] = useState("");
  const [saving, setSaving] = useState(false);

  async function insertFile(file: File | null | undefined) {
    if (!file) return;
    if (!workspace) {
      onError("Open a notebook before inserting local images.");
      return;
    }
    setSaving(true);
    try {
      const src = await saveAsset(workspace, file);
      onInsert(src, alt || file.name || "Image");
    } catch (error) {
      onError(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="dialog-backdrop" onMouseDown={onClose}>
      <form
        className="dialog"
        onMouseDown={(event) => event.stopPropagation()}
        onSubmit={(event) => {
          event.preventDefault();
          if (url.trim()) onInsert(url.trim(), alt || "Image");
        }}
      >
        <div className="dialog-header">
          <span className="dialog-icon">
            <FileText size={18} />
          </span>
          <div>
            <h2>Insert image</h2>
            <p>Add an image URL or choose a local file.</p>
          </div>
          <button className="icon-button" type="button" title="Close" onClick={onClose}>
            <X size={17} />
          </button>
        </div>
        <label className="field-label" htmlFor="image-url">Image URL</label>
        <input
          id="image-url"
          className="dialog-input"
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          placeholder="https://example.com/image.png"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          autoFocus
        />
        <label className="field-label" htmlFor="image-alt">Alt text</label>
        <input
          id="image-alt"
          className="dialog-input"
          value={alt}
          onChange={(event) => setAlt(event.target.value)}
          placeholder="Image"
          spellCheck={false}
        />
        <label className="toolbar-button image-file-button">
          Choose Local Image
          <input
            type="file"
            accept="image/*"
            disabled={saving}
            onChange={(event) => {
              void insertFile(event.currentTarget.files?.[0]);
            }}
          />
        </label>
        <div className="dialog-actions">
          <button className="toolbar-button" type="button" onClick={onClose}>
            Cancel
          </button>
          <button className="primary-button" type="submit" disabled={!url.trim() || saving}>
            Insert
          </button>
        </div>
      </form>
    </div>
  );
}
