/**
 * An editor instance survives note switches, so an update can briefly belong
 * to the document that was loaded before the active note changed. Only apply
 * updates that identify the currently active note.
 */
export function shouldApplyEditorUpdate(
  activePath: string | null,
  sourceNotePath: string | null,
  editable: boolean,
) {
  return editable && activePath !== null && activePath === sourceNotePath;
}
