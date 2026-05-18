import { FileText, Search, X } from "lucide-react";
import { useEffect, useRef } from "react";
import type { SearchResult } from "../types";

type SearchPaletteProps = {
  open: boolean;
  query: string;
  results: SearchResult[];
  onQueryChange: (query: string) => void;
  onClose: () => void;
  onSelect: (path: string) => void;
};

export function SearchPalette({ open, query, results, onQueryChange, onClose, onSelect }: SearchPaletteProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  if (!open) return null;

  return (
    <div className="palette-backdrop" onMouseDown={onClose}>
      <div className="palette" onMouseDown={(event) => event.stopPropagation()}>
        <div className="palette-input">
          <Search size={18} />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") onClose();
              if (event.key === "Enter" && results[0]) onSelect(results[0].path);
            }}
            placeholder="Find a note..."
          />
          <button className="icon-button" type="button" onClick={onClose} title="Close">
            <X size={17} />
          </button>
        </div>
        <div className="palette-results">
          {results.map((result) => (
            <button className="palette-result" key={result.path} type="button" onClick={() => onSelect(result.path)}>
              <FileText size={17} />
              <span>
                <strong>{result.title}</strong>
                <small>{result.snippet || result.path}</small>
              </span>
            </button>
          ))}
          {!results.length ? <p className="palette-empty">No matching notes</p> : null}
        </div>
      </div>
    </div>
  );
}
