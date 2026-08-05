export type DraftSaveRevision = {
  generation: number;
  revision: number;
};

/**
 * Tracks one active Note's draft independently from React's boolean dirty
 * state. This lets an older save completion detect newer typing without
 * scheduling duplicate saves that have already been requested.
 */
export class DraftSaveRevisions {
  private generation = 0;
  private revision = 0;
  private requestedRevision = 0;
  private savedRevision = 0;
  private markdown = "";

  reset(markdown: string) {
    this.generation += 1;
    this.revision = 0;
    this.requestedRevision = 0;
    this.savedRevision = 0;
    this.markdown = markdown;
  }

  observe(markdown: string): DraftSaveRevision {
    if (markdown !== this.markdown) {
      this.markdown = markdown;
      this.revision += 1;
    }
    return this.current();
  }

  markRequested(save: DraftSaveRevision) {
    if (save.generation !== this.generation) return;
    this.requestedRevision = Math.max(this.requestedRevision, save.revision);
  }

  complete(save: DraftSaveRevision) {
    if (save.generation !== this.generation) return false;
    this.savedRevision = Math.max(this.savedRevision, save.revision);
    return this.revision > this.savedRevision && this.requestedRevision <= this.savedRevision;
  }

  private current(): DraftSaveRevision {
    return { generation: this.generation, revision: this.revision };
  }
}
