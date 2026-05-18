import type { NoteEntry, TreeNode } from "../types";

export function buildTree(notes: NoteEntry[]): TreeNode[] {
  const root: TreeNode[] = [];
  const folders = new Map<string, TreeNode>();

  const ensureFolder = (path: string) => {
    if (!path) return root;
    const parts = path.split("/").filter(Boolean);
    let currentPath = "";
    let children = root;

    for (const part of parts) {
      currentPath = currentPath ? `${currentPath}/${part}` : part;
      let folder = folders.get(currentPath);
      if (!folder) {
        folder = {
          id: `folder:${currentPath}`,
          name: part,
          path: currentPath,
          kind: "folder",
          children: [],
        };
        folders.set(currentPath, folder);
        children.push(folder);
      }
      children = folder.children;
    }

    return children;
  };

  for (const note of notes) {
    const parent = ensureFolder(note.parent_path);
    parent.push({
      id: `note:${note.path}`,
      name: note.title,
      path: note.path,
      kind: "note",
      children: [],
      note,
    });
  }

  const sort = (nodes: TreeNode[]) => {
    nodes.sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === "folder" ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    nodes.forEach((node) => sort(node.children));
  };

  sort(root);
  return root;
}
