import { Plugin, PluginKey } from "@tiptap/pm/state";

type Celebration = { position: number | null; revision: number };
export const bulletCelebrationKey = new PluginKey<Celebration>("bulletCelebration");

/** Explicit status changes only. Loading, sorting, undo and redo never celebrate. */
export function createBulletCelebrationPlugin() {
  return new Plugin<Celebration>({
    key: bulletCelebrationKey,
    state: {
      init: () => ({ position: null, revision: 0 }),
      apply(tr, previous) {
        const position = tr.getMeta(bulletCelebrationKey) as number | undefined;
        if (position !== undefined) return { position, revision: previous.revision + 1 };
        return tr.docChanged || tr.getMeta("bulletMethodDisplay")
          ? { position: null, revision: previous.revision + 1 } : previous;
      },
    },
    view(view) {
      const document = view.dom.ownerDocument;
      const window = document.defaultView!;
      let frame: number | undefined;
      let timer: number | undefined;
      let burst: HTMLElement | undefined;
      const clear = () => {
        if (frame !== undefined) window.cancelAnimationFrame(frame);
        window.clearTimeout(timer);
        burst?.remove();
        frame = timer = undefined;
        burst = undefined;
      };
      return {
        update(view, previousState) {
          const current = bulletCelebrationKey.getState(view.state)!;
          if (current === bulletCelebrationKey.getState(previousState)) return;
          clear();
          if (current.position === null || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
          // Wait until status auto-sort has anchored the clicked item and scrolled.
          frame = window.requestAnimationFrame(() => {
            frame = undefined;
            if (!view.dom.isConnected) return;
            const paragraph = view.nodeDOM(current.position!);
            if (!(paragraph instanceof window.HTMLElement)) return;
            const marker = paragraph.closest("li")?.querySelector(".bullet-method-marker-button");
            const rect = (marker ?? paragraph).getBoundingClientRect();
            if (rect.bottom < 0 || rect.top > window.innerHeight) return;
            burst = document.createElement("div");
            burst.className = "bullet-status-celebration";
            burst.setAttribute("aria-hidden", "true");
            burst.style.left = `${marker ? rect.left + rect.width / 2 : rect.left}px`;
            burst.style.top = `${rect.top + Math.min(rect.height, 24) / 2}px`;
            for (let i = 0; i < 12; i++) {
              const pixel = document.createElement("i");
              const angle = i * Math.PI / 6;
              const distance = i % 2 ? 32 : 46;
              pixel.style.setProperty("--pixel-x", `${Math.cos(angle) * distance}px`);
              pixel.style.setProperty("--pixel-y", `${Math.sin(angle) * distance - 12}px`);
              pixel.style.setProperty("--pixel-color", ["#ffd36e", "#f6a9dd", "#a6dfcf"][i % 3]);
              burst.append(pixel);
            }
            document.body.append(burst);
            timer = window.setTimeout(clear, 650);
          });
        },
        destroy: clear,
      };
    },
  });
}
