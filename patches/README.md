# Plasma UI renderer adjustment

`@cruxgarden/plasma-ui` is pinned to 0.3.0. `npm install` applies its patch
through `patch-package`; patch failures stop installation.

Vite's dependency cache key includes a content hash of this patch through the
`plasmaPatchVersion` plugin. Its default patch detection only checks the patches
directory's timestamp, which does not change when an existing patch is edited.
Without this, the desktop webview can retain an older optimized renderer at an
immutable URL even after an app reload. The plugin restarts the dev server on
patch edits, rebuilding the dependency and changing its URL. Apply patch changes
to the installed package as well, or reinstall dependencies, before testing.
Production builds still bundle the renderer normally.

Version 0.3.0 includes our background-only blur implementation upstream, so
we no longer patch it. `RendererSettings.backgroundBlur` accepts 0–40 CSS
pixels, using eight extra GPU passes above zero and none at zero.

The patch adds `RendererSettings.animateSurfaces: false`. It disables
the entrance spring, edge trailing, pointer lean, and panel scale pulses.
Panel geometry follows DOM bounds directly while the background and Flow
retain their normal animation speed. Upstream defaults remain unchanged.

`ambientBehindSurfaces: true` renders the library's native ambient drops
into a background texture before drawing panel glass. The original
single scene otherwise unions drops with full-height panels, hiding their
outlines. This uses the existing shaders, context, and animation loop, with one
additional color target allocated on first use and reused until renderer cleanup.
The extra pass is skipped when ambient drops are off or Reduce Motion is on.
`ambientBounds` keeps the native orbits within the notebook or preview region.
The background is blurred only once, before the drops; panel frost then applies
normally. Native bubbles retain clear refraction and a subdued iridescent rim.
`ambientPointerPull` stretches existing drops toward a nearby pointer with a
bounded attraction and smooth distance falloff. The influence fades across
30–150 px beyond each drop, with up to 29 px of pull and 62.5% directional stretch. It uses the renderer's smoothed
mouse position and visibility, adds no cursor silhouette, and is disabled with
Reduce Motion. Native drop orbits, merging, and refraction remain intact.
The ambient pass disables the milky wash; panel wash follows Frostiness.
The custom SVG bubbles and their pointer/shape animations are no longer used.

Target allocation also checks texture sizes after context restoration, even if
the canvas dimensions have not changed. This ensures the new render targets are
allocated after a lost context, including the lazily created ambient target.

On upgrades, check for a native equivalent before retaining this patch.
Verify panel/window resizing and hiding/showing sidebars: rendered bounds
must equal DOM bounds on every frame, surface form must stay at 1, and
background animation must continue. Check light/dark, zero/nonzero frost,
and zero/maximum background blur. The upstream renderer export is now marked
internal, so keep the version pinned and verify its settings on every upgrade.
Run `src/lib/plasmaRenderer.test.ts` to check pass order, toggle/reduced-motion
behavior, target reuse, and context restoration against the patched renderer.
Also verify native merging, clear refraction, image orientation, and panel rims
in a browser; the GL stub does not compile shaders or evaluate pixel output.

For a real GPU pointer-response check, run Vite and open
`/scripts/check-plasma-pointer.html` with a viewport at least 1200×600. It freezes
the orbits and reads the rendered mask: a nearby pointer must advance the edge
by 30–44 px, a distant pointer must leave it unchanged, and pointer leave
must restore the original shape. This keeps the response visible but subdued. The compare button toggles
the same frozen scene for visual inspection. No diagnostic code runs in the app.

`pointerLightAtCursor` removes the upstream 200 px upward light offset and uses
the raw pointer position for rim lighting. Bubble motion retains its smoothed
pointer coordinates. Pane highlights respond from both sides of the glass so
a pointer inside the editor lights the rim at the same height. Normalization
is bounded when the pointer is directly on the sampled pixel. The browser
fixture also checks rendered rim highlights along horizontal and vertical edges,
with the pointer inside and outside a pane, to within 2 px of the cursor axis.
