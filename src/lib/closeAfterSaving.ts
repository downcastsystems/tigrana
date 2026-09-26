/** Keep the window alive on any persistence failure, including metadata
 * queued by the final Note save. */
export async function closeAfterSaving({ saveNotes, saveMetadata, close }: {
  saveNotes: () => Promise<void>;
  saveMetadata: () => Promise<void>;
  close: () => Promise<void>;
}) {
  await saveNotes();
  await saveMetadata();
  await close();
}
