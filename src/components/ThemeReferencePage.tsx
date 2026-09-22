import { useLayoutEffect } from "react";
import { ThemeCssReference } from "./ThemeCssReference";

export default function ThemeReferencePage() {
  useLayoutEffect(() => {
    document.title = "CSS reference — Tigrana";
    document.documentElement.dataset.theme = new URLSearchParams(window.location.search).get("mode") === "light" ? "light" : "dark";
  }, []);
  return (
    <main className="theme-reference-page">
      <ThemeCssReference />
    </main>
  );
}
