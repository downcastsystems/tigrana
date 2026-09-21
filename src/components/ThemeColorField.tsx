import { useEffect, useId, useState, type ReactNode } from "react";

function normalizeHex(input: string): string | null {
  const hex = input.trim().replace(/^#/, "");
  if (/^[0-9a-f]{6}$/i.test(hex)) return `#${hex.toLowerCase()}`;
  if (/^[0-9a-f]{3}$/i.test(hex))
    return `#${[...hex]
      .map((char) => char + char)
      .join("")
      .toLowerCase()}`;
  return null;
}

export function ThemeColorField({
  label,
  name,
  value,
  onChange,
  cssHint,
  onReset,
  trailingControl,
}: {
  trailingControl?: ReactNode;
  cssHint?: string;
  onReset?: () => void;
  label: string;
  name: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const id = useId();
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  function commit() {
    const color = normalizeHex(text);
    setText(color ?? value);
    if (color && color !== value) onChange(color);
  }
  return (
    <div className="theme-color-field">
      <label htmlFor={id}>{label}{cssHint && <span className="theme-css-hint" title={cssHint} aria-label={cssHint}>Custom CSS</span>}</label>
      {onReset && <button type="button" className="theme-color-reset" aria-label={`Use automatic ${name}`} onClick={onReset}>Automatic</button>}
      <div className="theme-color-inputs">
        <input
          type="color"
          aria-label={name}
          value={value}
          onChange={(event) => {
            setText(event.target.value);
            onChange(event.target.value);
          }}
        />
        <input
          id={id}
          className="settings-text-input theme-hex-input"
          type="text"
          aria-label={`${name} hex`}
          value={text}
          spellCheck={false}
          autoComplete="off"
          autoCapitalize="off"
          title="Enter a hex color, such as #8040cc or 8040cc. Three-digit hex is also accepted."
          onFocus={(event) => event.target.select()}
          onChange={(event) => {
            const next = event.target.value;
            setText(next);
            // Keep incomplete typing local; only complete six-digit colors update the preview.
            if (/^#?[0-9a-f]{6}$/i.test(next.trim()))
              onChange(normalizeHex(next)!);
          }}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              commit();
            }
            if (event.key === "Escape") {
              event.stopPropagation();
              setText(value);
            }
          }}
        />
        {trailingControl}
      </div>
    </div>
  );
}
