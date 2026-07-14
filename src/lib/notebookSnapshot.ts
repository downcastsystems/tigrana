export class LatestNotebookSnapshot<T> {
  private generation = 0;

  async load(
    notebook: string,
    read: () => Promise<T>,
    isActive: (notebook: string) => boolean = () => true,
  ) {
    if (!isActive(notebook)) return null;
    const generation = ++this.generation;
    let snapshot: T;
    try {
      snapshot = await read();
    } catch (error) {
      if (generation !== this.generation || !isActive(notebook)) return null;
      throw error;
    }
    if (generation !== this.generation || !isActive(notebook)) return null;
    return { notebook, snapshot };
  }

  invalidate() {
    this.generation += 1;
  }
}
