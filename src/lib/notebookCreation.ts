import { WELCOME_NOTE_CONTENT } from "./welcomeNote";
import { newNotebookAppearance } from "./newNotebookAppearance";
import { invoke } from "@tauri-apps/api/core";

export function notebookNameError(value: string): string | null {
  const name = value.trim();
  if (!name) return "Enter a notebook name.";
  if (name === "." || name === ".." || name.endsWith(".")) return "Notebook names cannot end with a period.";
  if (/[\\/:*?"<>|]/.test(name) || Array.from(name).some(char => char.charCodeAt(0) < 32)) {
    return 'Notebook names cannot contain / \\ : * ? " < > | or control characters.';
  }
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)) return "That name is reserved by the filesystem.";
  return null;
}

export function notebookDestination(parent: string, name: string): string {
  const separator = parent.includes("\\") ? "\\" : "/";
  return `${parent.replace(/[\\/]+$/, "")}${separator}${name.trim()}`;
}

export function hasRepeatedNotebookName(parent: string, name: string): boolean {
  return parent.replace(/[\\/]+$/, "").split(/[\\/]/).at(-1)?.toLowerCase() === name.trim().toLowerCase();
}

export async function createNotebookDirectory(parent: string, name: string): Promise<string> {
  const error = notebookNameError(name);
  if (error) throw new Error(error);
  return invoke<string>("create_notebook", { parent, name: name.trim(), content: WELCOME_NOTE_CONTENT, appearance: newNotebookAppearance() });
}
