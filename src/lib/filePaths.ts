export function notebookFilePath(workspace: string, relativePath = ""): string {
  if (!relativePath) return workspace;
  const separator = workspace.includes("\\") ? "\\" : "/";
  return `${workspace.replace(/[\\/]+$/, "")}${separator}${relativePath.replace(/\//g, separator)}`;
}
