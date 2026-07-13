/**
 * Keeps autosave drafts available to note navigation without publishing them
 * through React state at save start. A completion only clears the exact draft
 * it wrote, so a queued older save cannot erase newer typing.
 */
export class PendingNoteContents {
  private readonly contents = new Map<string, string>();

  stage(path: string, content: string) {
    this.contents.set(path, content);
  }

  read(path: string, fallback: string) {
    return this.contents.get(path) ?? fallback;
  }

  accept(path: string, content: string) {
    if (this.contents.get(path) !== content) return false;
    this.contents.delete(path);
    return true;
  }

  clear() {
    this.contents.clear();
  }
}
