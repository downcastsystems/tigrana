import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

export const ThemePreviewHostContext = createContext<HTMLDivElement | null>(
  null,
);

/** Keep the preview outside the form's scroll area when the window has room. */
export function ThemePreviewPanel({ children }: { children: ReactNode }) {
  const host = useContext(ThemePreviewHostContext);
  const [wide, setWide] = useState(false);
  useEffect(() => {
    if (!host) return;
    const media = window.matchMedia("(min-width: 1221px)");
    const update = () => setWide(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, [host]);
  return host && wide ? createPortal(children, host) : children;
}
