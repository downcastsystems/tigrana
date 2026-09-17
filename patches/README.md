# Plasma UI background blur

`@cruxgarden/plasma-ui` is pinned to 0.2.0. `npm install` applies its patch
through `patch-package`; patch failures stop installation.

The patch adds `RendererSettings.backgroundBlur` in CSS pixels, clamped to
0–40. It blurs the background texture before panel masks, refraction, and
lighting are drawn. Text and panel borders therefore stay sharp. The Sharp
setting skips the extra passes. Nonzero values use eight fixed GPU passes
and reuse existing scratch textures without allocating per frame.

When upgrading Plasma UI, check its rendering order and framebuffer sizes
before regenerating the patch. Verify Sharp and maximum blur with panel
frostiness at zero, then check nonzero frostiness and light/dark mode.
