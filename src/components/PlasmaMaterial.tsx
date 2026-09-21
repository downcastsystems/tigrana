import "../styles/plasma.css";
import { useEffect, useRef } from "react";
import { PlasmaRenderer, type RendererSettings } from "@cruxgarden/plasma-ui";

const paneSelector = ".folder-pane, .notes-pane, .unified-tree-pane, .main-pane, .right-sidebar";

export default function PlasmaMaterial({ theme, accentColor, frost, backgroundBlur, backgroundImage, flow = 0, layoutKey, preview = false }: { theme: "light" | "dark"; frost: number; flow?: number; backgroundBlur: number; backgroundImage?: string; accentColor: string; layoutKey: string; preview?: boolean }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<PlasmaRenderer | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    // PlasmaProvider reuses a lost context during StrictMode's effect replay.
    // Own a fresh canvas per setup so cleanup can always release the GPU.
    const canvas = document.createElement("canvas");
    host.append(canvas);
    const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
    const settings: RendererSettings = {
      colors: ["#000000", "#000000", "#000000"],
      blend: 0,
      theme,
      tint: theme === "dark" ? "#192a32" : "#f1f7fa",
      opacity: 0.65,
      frost: 0.8,
      quality: 1,
      freezeOnScroll: false,
      shimmer: 1,
      glow: 1,
      wash: 1,
      grain: 1,
      backgroundBlur: 0,
      maxSurfaces: 4,
      pointerDrop: false,
      ambientDrops: false,
      // Keep borders locked to panel bounds during resizing and layout changes.
      animateSurfaces: false,
      reducedMotion: reducedMotion.matches,
      stretch: 0,
      flow: 0,
      viscosity: 0.85,
      refraction: 0.7,
      dispersion: 0.4,
      rim: 0.65,
      rimColor: "tint",
      rimWidth: 1,
      highlight: 1,
      edgeLine: 1,
      smoothness: 1,
      elevation: 0.2,
      background: null,
    };
    const renderer = PlasmaRenderer.create(canvas, settings);
    rendererRef.current = renderer;
    if (!renderer) canvas.hidden = true;
    const updateMotion = () => renderer?.configure({
      ...renderer.settings,
      reducedMotion: reducedMotion.matches,
      pointerDrop: false,
    });
    reducedMotion.addEventListener("change", updateMotion);
    return () => {
      reducedMotion.removeEventListener("change", updateMotion);
      renderer?.destroy();
      rendererRef.current = null;
      canvas.remove();
    };
  }, [theme]);

  useEffect(() => {
    const renderer = rendererRef.current;
    if (!renderer) return;
    // Register existing panes without wrapping or remounting ProseMirror.
    // No DOM observation or note-content work runs while the user types.
    const panes = hostRef.current?.parentElement?.querySelectorAll<HTMLElement>(
      preview ? ".theme-preview-body > aside, .theme-preview-body > article" : paneSelector,
    ) ?? [];
    const handles = Array.from(panes, (pane) => renderer.register(pane, {
      radius: 18,
      lean: 0,
      fuse: false,
    }));
    return () => handles.forEach((handle) => handle.remove());
  }, [theme, layoutKey, preview]);

  useEffect(() => {
    const renderer = rendererRef.current;
    const host = hostRef.current;
    if (!renderer || !host) return;
    delete host.dataset.plasmaImageReady;
    if (!backgroundImage) {
      renderer.configure({ ...renderer.settings, background: null });
      return;
    }
    // Keep the CSS landscape visible until the renderer can sample the image.
    // Passing a loaded element avoids a second asynchronous load inside Plasma.
    const image = new Image();
    let cancelled = false;
    image.onload = () => {
      if (cancelled) return;
      renderer.configure({ ...renderer.settings, background: image });
      host.dataset.plasmaImageReady = "true";
    };
    image.src = backgroundImage;
    return () => {
      cancelled = true;
      image.onload = null;
      delete host.dataset.plasmaImageReady;
    };
  }, [theme, backgroundImage]);

  useEffect(() => {
    const renderer = rendererRef.current;
    if (!renderer) return;
    // Keep the procedural swirl, but use shades of the notebook's accent.
    // configure interpolates colors without recreating the canvas or renderer.
    renderer.configure({
      ...renderer.settings,
      frost,
      backgroundBlur,
      flow,
      rimColor: accentColor,
      // Fade the material tint too, so clear glass is not hidden by solid color.
      opacity: frost * 0.8125,
      colors: [mixAccent(accentColor, 0, 0.65), accentColor, mixAccent(accentColor, 255, 0.25)],
    });
  }, [accentColor, theme, frost, backgroundBlur, flow]);

  return <div className={preview ? "plasma-preview-background" : "plasma-background"} ref={hostRef} aria-hidden="true" />;
}

function mixAccent(accent: string, target: number, amount: number): string {
  const hex = accent.replace(/^#/, "");
  const fullHex = hex.length === 3 ? [...hex].map((digit) => digit + digit).join("") : hex;
  return "#" + [0, 2, 4].map((offset) => {
    const channel = parseInt(fullHex.slice(offset, offset + 2), 16);
    return Math.round(channel + (target - channel) * amount).toString(16).padStart(2, "0");
  }).join("");
}
