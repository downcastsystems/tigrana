import { FileText, Folder, Palette, Pencil, X } from "lucide-react";
import type { NavigationStyle } from "../types";

export type PropertyDialogState =
  | { kind: "rename-folder"; path: string; value: string; name: string }
  | { kind: "folder-color"; path: string; value: string; name: string; subject?: "folder" | "section"; navigationStyle: NavigationStyle; previewColor?: string };

export function PropertyDialog({
  appError,
  state,
  onChange,
  onClose,
  onReset,
  onSubmit,
}: {
  appError: string | null;
  state: PropertyDialogState;
  onChange: (value: string) => void;
  onClose: () => void;
  onReset?: () => void;
  onSubmit: () => void;
}) {
  const config = {
    "rename-folder": {
      title: "Rename folder",
      description: state.name,
      label: "Folder name",
      placeholder: "Folder name",
      icon: <Pencil size={18} />,
      type: "text",
      action: "Rename",
    },
    "folder-icon": {
      title: "Folder icon",
      description: state.name,
      label: "Icon",
      placeholder: "Emoji or short mark",
      icon: <Folder size={18} />,
      type: "text",
      action: "Save",
    },
    "folder-color": {
      title: state.kind === "folder-color" && state.subject === "section" ? "Section color" : "Folder color",
      description: state.name,
      label: "Color",
      placeholder: "#4b7d75",
      icon: <Palette size={18} />,
      type: "color",
      action: "Save",
    },
    "note-icon": {
      title: "Note icon",
      description: state.name,
      label: "Icon",
      placeholder: "Emoji or short mark",
      icon: <FileText size={18} />,
      type: "text",
      action: "Save",
    },
  }[state.kind];

  return (
    <div className="dialog-backdrop" onMouseDown={onClose}>
      <form
        className="dialog"
        onMouseDown={(event) => event.stopPropagation()}
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit();
        }}
      >
        <div className="dialog-header">
          <span className="dialog-icon">{config.icon}</span>
          <div>
            <h2>{config.title}</h2>
            <p>{config.description}</p>
          </div>
          <button className="icon-button" type="button" title="Close" onClick={onClose}>
            <X size={17} />
          </button>
        </div>
        <label className="field-label" htmlFor="property-value">
          {config.label}
        </label>
        <div className={config.type === "color" ? "color-field" : ""}>
          <input
            className="dialog-input"
            id="property-value"
            type={config.type}
            value={state.value}
            onChange={(event) => onChange(event.target.value)}
            placeholder={config.placeholder}
            autoFocus
          />
          {config.type === "color" ? (
            <input
              className="dialog-input color-text"
              value={state.value}
              onChange={(event) => onChange(event.target.value)}
              placeholder="#4b7d75"
            />
          ) : null}
        </div>
        {appError ? <p className="dialog-error">{appError}</p> : null}
        <div className="dialog-actions">
          {onReset ? (
            <button className="toolbar-button dialog-reset-button" type="button" onClick={onReset}>
              Reset
            </button>
          ) : null}
          <button className="toolbar-button" type="button" onClick={onClose}>
            Cancel
          </button>
          <button className="primary-button" type="submit">
            {config.action}
          </button>
        </div>
      </form>
    </div>
  );
}
