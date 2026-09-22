# Bundled font licenses

Tigrana bundles these font families under the SIL Open Font License 1.1. The font files retain their own license; Tigrana's application code remains MIT licensed. The OFL permits bundling and redistribution with software when the original copyright and license notices are retained. See the [OFL guidance](https://openfontlicense.org/how-to-use-ofl-fonts/).

| Font | Used by | Distributed source | Notice |
| --- | --- | --- | --- |
| [Inter](https://github.com/rsms/inter) | App interface and Settings | `@fontsource-variable/inter` 5.3.0, normal and italic WOFF2 subsets | [Inter-OFL.txt](Inter-OFL.txt) |
| [IBM Plex Mono](https://github.com/IBM/plex) | Old Basement PC and Quick appearance | `@fontsource/ibm-plex-mono` 5.3.0, Latin regular WOFF2 | [IBM-Plex-Mono-OFL.txt](IBM-Plex-Mono-OFL.txt) |
| [Solway](https://github.com/mashavp/Solway) | Twain and Quick appearance | `@fontsource/solway` 5.3.0, Latin regular WOFF2 | [Solway-OFL.txt](Solway-OFL.txt) |
| [VT323](https://github.com/phoikoi/VT323) | Quick appearance | `@fontsource/vt323` 5.2.5, Latin regular WOFF2 in `src/lib/vt323Font.json` | [VT323-OFL.txt](VT323-OFL.txt), [package notice](VT323-Fontsource-LICENSE.txt) |

| [Geist Pixel Square](https://github.com/vercel/geist-font) | Quest | Unmodified upstream WOFF2, commit `10dc7658f13c38a474cde201bb09a4617267545b` | [Geist-Pixel-OFL.txt](Geist-Pixel-OFL.txt) |

These files are copied into `dist/licenses/` by the frontend build and included in the desktop frontend assets. Embedded theme fonts also carry their notices in the theme document and exported package.

Names such as Georgia, Menlo, Consolas, Segoe UI, and system-ui in CSS are fallbacks to fonts already installed on the user's computer. Tigrana does not redistribute those font files or American Typewriter.

Before adding or replacing a bundled font, review its redistribution terms, retain its original notices, and update this inventory and the build's font-license check. User-imported themes are not covered by this inventory; their creators must have redistribution rights for included assets.
