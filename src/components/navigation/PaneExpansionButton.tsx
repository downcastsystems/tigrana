import { ChevronsDownUp, ChevronsUpDown } from "lucide-react";
import type { WorkspaceMetadata } from "../../types";

export type SetPaneExpanded = (paths: string[], expanded: boolean, includeBookmarks: boolean) => void;

export function PaneExpansionButton({ paths, metadata, includeBookmarks = false, disabled, onSetExpanded }: {
  paths: string[];
  metadata: WorkspaceMetadata;
  includeBookmarks?: boolean;
  disabled: boolean;
  onSetExpanded: SetPaneExpanded;
}) {
  const anyExpanded = paths.some(path => metadata.expandedFolders[path] ?? true)
    || (includeBookmarks && metadata.bookmarksExpanded);
  const label = anyExpanded ? "Collapse all" : "Expand all";
  return (
    <button className="icon-button" type="button" title={label} aria-label={label}
      disabled={disabled || (!paths.length && !includeBookmarks)}
      onClick={() => onSetExpanded(paths, !anyExpanded, includeBookmarks)}>
      {anyExpanded ? <ChevronsDownUp size={16} /> : <ChevronsUpDown size={16} />}
    </button>
  );
}
