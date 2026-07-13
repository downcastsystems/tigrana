import type { WorkspaceMetadata } from "../types";
import type { NotebookStorage } from "./notebookStorage";

type MetadataWriter = Pick<NotebookStorage, "writeWorkspaceMetadata">;

export class NotebookMetadataPersistence {
  private readonly tails = new Map<string, Promise<void>>();

  constructor(private readonly storage: MetadataWriter) {}

  write(workspace: string, readMetadata: () => WorkspaceMetadata) {
    return this.enqueue(workspace, () => this.storage.writeWorkspaceMetadata(workspace, readMetadata()));
  }

  runExclusive<T>(workspace: string, operation: () => Promise<T>) {
    return this.enqueue(workspace, operation);
  }

  flush(workspace: string) {
    return this.tails.get(workspace) ?? Promise.resolve();
  }

  private enqueue<T>(workspace: string, operation: () => Promise<T>) {
    const previous = this.tails.get(workspace) ?? Promise.resolve();
    const result = previous.then(operation);
    const tail = result.then(() => undefined, () => undefined);
    this.tails.set(workspace, tail);
    void tail.then(() => {
      if (this.tails.get(workspace) === tail) this.tails.delete(workspace);
    });
    return result;
  }
}
