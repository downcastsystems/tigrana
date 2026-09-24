# Equations in Tigrana

Choose **Insert → Equation** in the **…** editor menu, use the **∑** button
in the floating formatting bar, or type `/equation`.
Choose an example, change its numbers or letters, and watch the preview.
The maximize button beside Close expands the dialog; click Restore to shrink it
without losing edits. **More examples** groups familiar formulas by subject.
Try **Advanced → Heat equation on a rod** for the multiline heat-diffusion example.
This example switches to a separate block and expands the dialog automatically.
Choose **On its own line** for a large equation, or **Within a sentence** for
inline math. Click **Insert equation**. Click an existing equation to edit it.
Right-click an equation to Cut, Copy, or Delete it. Copy retains both its formula
and rich content. Cut and Delete support Undo; read-only notes allow Copy only.
Escape cancels; Command+Enter on Mac or Control+Enter saves.
Inside lists, quotes, and tables, use inline equations. Separate equation blocks
are available in the main note body. Tables containing equations use Tigrana's
HTML-table format to preserve formula characters such as vertical bars.

Equations display mathematical notation. They do not calculate answers.
The formula is written in a small subset of LaTeX, a text notation for math.
You do not need to write a full LaTeX document or install LaTeX.

| What you want | Formula to enter | How it works |
| --- | --- | --- |
| One half plus one half | `\frac{1}{2} + \frac{1}{2} = 1` | First braces are the top of a fraction; second are the bottom. |
| Percentage | `\frac{25}{100} \times 100\% = 25\%` | `\times` is multiplication; `\%` is a percent sign. |
| Powers | `x^2 + y^2 = z^2` | `^2` means squared. Use `x^{10}` for longer powers. |
| Square root | `\sqrt{16} = 4` | Braces group what goes under the root. |
| Subscripts | `a_1 + a_2 + a_3` | `_1` puts a small 1 below the letter. |
| Words in a formula | `\text{Total} = \text{Price} \times \text{Quantity}` | `\text{...}` keeps ordinary words together. |

Enter formulas without dollar delimiters in the dialog. If there is a typo,
the preview explains the error. Nothing is saved until you choose Insert or Save.
You can copy a formula from another source and edit it here. Tigrana supports
[KaTeX's math commands](https://katex.org/docs/supported), not all LaTeX packages.

## Markdown compatibility

Inline equations are stored as `$x^2$`. Separate equations use this format:

```markdown
$$
\frac{1}{2} + \frac{1}{2} = 1
$$
```

You can also put these forms directly in a Markdown file or the raw Markdown
view. Tigrana renders them when opening the rich editor. An equation keeps its
original formula, not an image or generated HTML.

Math is a common Markdown extension, not part of basic Markdown. Other readers
need math support to render it. Readers without that support show the formula
as text. GitHub documents the same [dollar-delimited notation](https://docs.github.com/en/get-started/writing-on-github/working-with-advanced-formatting/writing-mathematical-expressions).

Code blocks and inline code keep equations literal. Normal prices such as
`$5 and $10` are not equations. Escape literal delimiters as `\$` or use inline
code when writing examples. Printing uses rendered equations; standalone HTML
exports include MathML and need a browser with MathML support.

Choose **Size** in the equation popup to make the whole formula smaller or larger. The preview updates before you save. Choose **Normal** to restore its original size. Sizes are saved as standard LaTeX size groups inside the Markdown equation, so they survive reopening and copying. This changes the formula size; it does not automatically fit it to the note width.

To resize directly in the note, hover over an equation on its own line and drag the handle at its bottom-right corner. Drag outward to enlarge or inward to shrink. Sizes snap to the same choices as the popup. Release to save; press Escape during a drag to cancel. You can also focus the handle and use arrow keys. Undo restores the previous size.
