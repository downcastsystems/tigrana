# Plasma UI renderer adjustment

`@cruxgarden/plasma-ui` is pinned to 0.3.0. `npm install` applies its patch
through `patch-package`; patch failures stop installation.

Version 0.3.0 includes our background-only blur implementation upstream, so
we no longer patch it. `RendererSettings.backgroundBlur` accepts 0–40 CSS
pixels, using eight extra GPU passes above zero and none at zero.

The remaining patch adds `RendererSettings.animateSurfaces: false`. It disables
the entrance spring, edge trailing, pointer lean, and panel scale pulses.
Panel geometry follows DOM bounds directly while the background and Flow
retain their normal animation speed. Upstream defaults remain unchanged.

On upgrades, check for a native equivalent before retaining this patch.
Verify panel/window resizing and hiding/showing sidebars: rendered bounds
must equal DOM bounds on every frame, surface form must stay at 1, and
background animation must continue. Check light/dark, zero/nonzero frost,
and zero/maximum background blur. The upstream renderer export is now marked
internal, so keep the version pinned and verify its settings on every upgrade.
