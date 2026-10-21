# Text shortcuts

Open **Settings > Shortcuts** to add, edit, or remove named text expansions.
The table lists names, triggers, and a preview of the inserted text. Choose
**Add shortcut**, click a name, or use its pencil button to open an editing
dialog. Give each shortcut a name, a unique trigger (for example `n:a`), and text
to insert, then choose **Add shortcut** or **Save changes** in the dialog.
Changes save automatically when confirmed. Cancel leaves the shortcut unchanged.
The trash button asks for confirmation before deleting a shortcut; confirmed
deletions save immediately. If saving fails, the dialog keeps your edits so you
can retry. These preferences are stored on this device, shared across notebooks,
and synchronized between open Tigrana windows.

Triggers must be 3–64 characters long, contain a colon anywhere, and contain no
whitespace. Examples: `:sig`, `n:a`, and `ship:`. A leading slash is reserved for
slash commands. Ordinary words and single-character triggers cannot be saved.

Type the case-sensitive trigger at the beginning of a line or bullet or after
whitespace, followed by **Space** or **Enter**. The trigger and terminating key
are replaced by the template. The terminating key does not add an extra space
or paragraph. Include any desired spacing in the template. Code blocks and
inline code do not expand triggers. Press **Backspace immediately after an
expansion** to restore the text you typed and its caret position. This works
for Space, Enter, and slash-menu insertions, including multiline and nested-list
templates. A Space expansion restores the terminating space, matching Bullet
Status shortcuts. Once you type more text, move the caret, or switch notes,
Backspace returns to normal editing. Standard Undo/Redo remain available.

Type **/shortcut** to list saved shortcuts. Continue with a name, such as
`/shortcut Avery`, to filter the list. Arrow keys select an entry; Enter or Tab
inserts it. Saved shortcuts also appear when searching their names in the
regular slash menu.

Saved shortcuts with older triggers that do not meet the new rules keep their
names and template text. Their typed expansion is disabled and Settings flags
the trigger for correction; they remain available through `/shortcut`. Fixing
one shortcut or adding another does not discard untouched older entries. Current
Bullet Status conflicts still make shortcuts unavailable in both paths.

Templates use the same Markdown as notes: paragraphs, multiline text, lists,
headings, code blocks, `**bold**`, `*italic*`, and `==highlight==`. To create an
empty bullet, use `- ` (dash followed by a space). When a list template replaces the
whole first line of an existing bullet, its entries take that bullet’s place at
the same indentation level, including inside nested lists. Existing sibling
items and child content are preserved.

For a centered character cue followed by dialogue, name the shortcut Avery,
use `n:a` as its trigger, and enter this template (including the blank lines):

```markdown
<div style="text-align: center">

**AVERY**

</div>

Dialogue goes here.
```

Alignment uses Tigrana's existing portable HTML wrapper; expanded content saves
as ordinary note Markdown. Expansions insert content once and do not link it
back to the saved template.

Triggers cannot collide with Markdown block shortcuts or current Bullet Status
names, the `-:` starting-status shortcut, named forms such as `-TODO:`, or any
configured status shortcut. Checks remain active even if Bullet Statuses are
disabled, so enabling them later is safe. If a status setting later creates a
conflict, the affected text shortcut becomes unavailable. Resolve the error in
Settings > Shortcuts to re-enable it.

These are reusable text templates, not a screenplay layout engine. Final Draft's
[SmartType](https://kb.finaldraft.com/hc/en-us/articles/27750003388948-What-is-SmartType-and-how-do-I-use-it)
provides related completion of character names and other screenplay elements.
