# Starfall

A playful anime theme with an original celestial illustrator, lavender palettes,
a floating-island landscape behind translucent panels, gradient tabs, pink
chapter headings, teal code accents, and a character tucked into the lower-right
editor background. Includes light and dark colors and supports
the existing Plasma toggle. Plasma mode is the default.

## Try it

Choose **Starfall** under Built-in in Settings → Appearance → Theme.
Editing it creates a personal copy.

To import the standalone example package, choose Settings → Appearance → Import theme, then
[`starfall-studio.tigrana-theme`](../starfall-studio.tigrana-theme).
Review the preview, then choose Save and use. This imports a new theme; it does not
replace the built-in appearance. The complete package works offline. Its art travels with the notebook like the rest of the theme.

## Remix it

[`theme.css`](theme.css) is commented by feature. Start with the private variables
at the top, then adjust the background illustration size or remove its rule.
The image is declared once and reused to keep the stylesheet small. Use local
packaged raster images rather than external URLs. [`theme.json`](theme.json)
contains both palettes, text colors, fonts, and Plasma settings.

The character stays in the lower-right background of the editor panel while the
note scrolls. The Editor opacity slider controls her visibility, starting at
82% to keep text readable. There is no banner or sidebar copy. The background
does not intercept pointer input, change Markdown, or appear in print.
Navigation starts at 72% opacity, the editor at 82%, and the outline at 76%.
Adjust these in Advanced surfaces to reveal more or less of the landscape.
Plasma retains the app's glass renderer and panel spacing.
Panel frostiness and background blur both start at zero, keeping the landscape
sharp through the tinted panels. Increase either in Appearance for softer glass.

Rebuild the package and the app’s bundled theme document from the repository root:

```sh
node docs/themes/build-example.mjs starfall-studio
```

Only theme.json, theme.css, LICENSE and assets belong in the ZIP. This README is
deliberately excluded. Import the rebuilt package to check changes in the app.

## Artwork and reuse

The landscape was also generated with the built-in image-generation tool, then
encoded as WebP at quality 85. Its final asset is
[`assets/starfall-landscape.webp`](assets/starfall-landscape.webp).

Landscape generation prompt:

> Use case: stylized-concept. Asset type: wide wallpaper for an anime-inspired notes application called Starfall. Original anime fantasy landscape at twilight: floating islands with a small luminous observatory, distant waterfalls falling into lavender clouds, a crescent moon, a winding teal river far below, delicate pink flowering trees framing the outer edges. Hand-painted anime background art, atmospheric depth, indigo violet and muted teal with restrained warm window lights. Wide landscape composition, rich interesting detail around the edges but calm low-contrast center to sit behind translucent text panels. Dreamlike and inviting, not neon or visually noisy. No people or characters, no text, no logos, no UI, no watermarks. Landscape 1536x1024.

The original character was generated with the built-in image-generation tool.
The transparent PNG was encoded as WebP at quality 88, preserving alpha. The final
asset is [`assets/starfall-artist.webp`](assets/starfall-artist.webp).
The example includes a CC0 dedication in [`LICENSE`](LICENSE).

Final generation prompt:

> Use case: stylized-concept. Asset type: transparent decorative character PNG for an anime-inspired desktop notes app theme called Starfall. Create an original adult anime woman, a playful celestial illustrator with short flowing lavender hair, teal headphones, oversized indigo jacket with star patches, fully clothed casual trousers and high-top sneakers. She is sitting sideways on a floating crescent-shaped cushion, drawing in a small notebook, smiling toward the viewer; a tiny cute star-shaped companion floats near her shoulder. Polished vibrant anime illustration with crisp ink outlines, luminous cyan and pink highlights and charming sticker-like silhouette. Full body contained comfortably in the frame, compact square composition, no cropped limbs. Genuine transparent background, no scenery, no ground rectangle, no lettering or watermark. Intended to decorate a sidebar below navigation without covering text. Output 1024x1024 PNG with alpha.
