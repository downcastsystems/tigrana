import type { WorkspaceMetadata } from "../types";

export class NotebookMetadataSession {
  private activeWorkspace: string | null;
  private readyWorkspace: string | null = null;
  private readonly metadataByWorkspace = new Map<string, WorkspaceMetadata>();

  constructor(activeWorkspace: string | null) {
    this.activeWorkspace = activeWorkspace;
  }

  activate(workspace: string | null) {
    this.activeWorkspace = workspace;
    this.readyWorkspace = null;
  }

  isActive(workspace: string) {
    return this.activeWorkspace === workspace;
  }

  adopt(workspace: string, metadata: WorkspaceMetadata) {
    this.metadataByWorkspace.set(workspace, metadata);
    if (this.activeWorkspace !== workspace) return false;
    this.readyWorkspace = workspace;
    return true;
  }

  read(workspace: string) {
    return this.metadataByWorkspace.get(workspace) ?? null;
  }

  readActive(workspace: string) {
    if (this.activeWorkspace !== workspace || this.readyWorkspace !== workspace) return null;
    return this.metadataByWorkspace.get(workspace) ?? null;
  }

  updateActive(
    workspace: string,
    updater: (current: WorkspaceMetadata) => WorkspaceMetadata,
  ) {
    if (this.activeWorkspace !== workspace || this.readyWorkspace !== workspace) return null;
    const current = this.metadataByWorkspace.get(workspace);
    if (!current) return null;
    const next = updater(current);
    this.metadataByWorkspace.set(workspace, next);
    return next;
  }
}
