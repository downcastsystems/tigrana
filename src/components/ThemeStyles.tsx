import { useEffect, useMemo } from "react";
import type { ThemeDocument } from "../lib/themes";
import { themeStylesheet } from "../lib/themeRuntime";
export function ThemeStyles({
  theme,
  mode,
  onReset,
}: {
  theme: ThemeDocument | null;
  mode: "light" | "dark";
  onReset: () => void;
}) {
  const css = useMemo(() => {
    if (!theme) return "";
    try {
      return themeStylesheet(theme, mode, "notebook");
    } catch {
      return "";
    }
  }, [theme, mode]);
  useEffect(() => {
    const recover = (event: KeyboardEvent) => {
      if (
        (event.metaKey || event.ctrlKey) &&
        event.altKey &&
        event.shiftKey &&
        event.code === "KeyT"
      ) {
        event.preventDefault();
        event.stopImmediatePropagation();
        onReset();
      }
    };
    window.addEventListener("keydown", recover, true);
    return () => window.removeEventListener("keydown", recover, true);
  }, [onReset]);
  return css ? (
    <style data-theme-styles="notebook">{css}</style>
  ) : null;
}
