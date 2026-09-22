# First-theme tutorial site

`site/index.html` is a short, standalone Advanced CSS tutorial. `site/styles.css`
provides its responsive dark appearance using system fonts. No build step,
JavaScript, tracking, or remote assets are required.

Preview locally:

```sh
python3 -m http.server 1423 --directory site
```

Open http://localhost:1423. The HTML uses relative stylesheet paths so it also
works beneath a GitHub Pages project path.

## Publishing

The prepared `.github/workflows/pages.yml` uploads only `site/`, not notebook
content or the rest of the repository. Select **GitHub Actions** as the source
in the repository's **Settings → Pages**. Once the workflow is on `main`, changes
to `site/` publish automatically; it can also be run manually from Actions.
The repository did not have a configured Pages site when this tutorial was
prepared. Nothing has been published by the local authoring/preview process.

The tutorial's further-reading links currently point to the existing
`proper-theme-support` documentation. Change those links to `main` once that
branch's documentation has merged.

## Checking the example

Extract the CSS inside the tutorial's `pre/code` block into a theme's
`design.css`, then validate the theme with `npm run theme:check -- <theme.json>`.
The example has been validated against the app's actual theme parser and
light/dark stylesheet compiler. Theme check may report inherited palette contrast
warnings; its visual-review warning is expected for any custom CSS.
