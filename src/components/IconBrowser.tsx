import type { LucideIcon } from "lucide-react";
import * as LucideIcons from "lucide-react";
import { Search, X } from "lucide-react";
import { useMemo, useState } from "react";

const lucideIconPrefix = "lucide:";

const lucideIconMap = Object.fromEntries(
  Object.entries(LucideIcons).filter(([name, value]) => /^[A-Z]/.test(name) && !name.endsWith("Icon") && isLucideIcon(value)),
) as Record<string, LucideIcon>;

const lucideIconOptions = Object.keys(lucideIconMap).sort((a, b) => a.localeCompare(b));

export type IconBrowserState =
  | { kind: "folder"; path: string; value: string; name: string; onReset?: () => void }
  | { kind: "note"; path: string; value: string; name: string };

export function IconMark({ fallback: Fallback, size, value }: { fallback: LucideIcon; size: number; value?: string }) {
  const iconName = value?.startsWith(lucideIconPrefix) ? value.slice(lucideIconPrefix.length) : "";
  const Icon = iconName ? lucideIconMap[iconName] : null;

  if (Icon) {
    return <Icon size={size} />;
  }

  if (value && !value.startsWith(lucideIconPrefix)) {
    return <span className="custom-icon">{value}</span>;
  }

  return <Fallback size={size} />;
}

export function IconBrowserModal({
  state,
  onClose,
  onReset,
  onSelect,
}: {
  state: IconBrowserState;
  onClose: () => void;
  onReset?: () => void;
  onSelect: (iconName: string) => void;
}) {
  const [query, setQuery] = useState("");
  const activeIconName = state.value.startsWith(lucideIconPrefix) ? state.value.slice(lucideIconPrefix.length) : "";
  const filteredIcons = useMemo(() => {
    const normalizedQuery = normalizeIconName(query);
    if (!normalizedQuery) return lucideIconOptions.slice(0, 120);
    return lucideIconOptions.filter((name) => normalizeIconName(name).includes(normalizedQuery)).slice(0, 160);
  }, [query]);

  return (
    <div className="dialog-backdrop" onMouseDown={onClose}>
      <section className="dialog icon-browser" onMouseDown={(event) => event.stopPropagation()}>
        <div className="dialog-header">
          <span className="dialog-icon">
            <SearchIconPreview value={state.value} />
          </span>
          <div>
            <h2>{state.kind === "folder" ? "Folder icon" : "Note icon"}</h2>
            <p>{state.name}</p>
          </div>
          <button className="icon-button" type="button" title="Close" onClick={onClose}>
            <X size={17} />
          </button>
        </div>
        <div className="icon-search">
          <input
            className="dialog-input"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search icons"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            autoFocus
          />
          <button className="toolbar-button" type="button" onClick={() => onSelect("")}>
            Clear
          </button>
          {onReset ? (
            <button className="toolbar-button" type="button" onClick={onReset}>
              Reset
            </button>
          ) : null}
        </div>
        <div className="icon-grid">
          {filteredIcons.map((name) => {
            const Icon = lucideIconMap[name];
            return (
              <button
                className={name === activeIconName ? "icon-choice is-selected" : "icon-choice"}
                key={name}
                type="button"
                title={splitIconName(name)}
                onClick={() => onSelect(name)}
              >
                <Icon size={20} />
                <span>{splitIconName(name)}</span>
              </button>
            );
          })}
        </div>
      </section>
    </div>
  );
}

function SearchIconPreview({ value }: { value: string }) {
  return <IconMark value={value} fallback={Search} size={18} />;
}

function isLucideIcon(value: unknown): value is LucideIcon {
  return Boolean(value && typeof value === "object" && "$$typeof" in value);
}

function normalizeIconName(value: string) {
  return value.replace(/[^a-z0-9]/gi, "").toLowerCase();
}

function splitIconName(value: string) {
  return value.replace(/([a-z0-9])([A-Z])/g, "$1 $2");
}
