// Duplicate drafts keep the source type, independently of the new-load preset.
export function isExportLoadDraft(load, presetName) {
  return load.duplicatedFromLoadId ? load.loadType === 'EXPORT' : presetName === 'Export Load';
}

export function unassignDuplicate(load) {
  return { ...load, id: '', driver: '', truck: '', containerNumber: '', status: 'Pending', streetTurn: false, droppedBy: '' };
}
export async function createLoadCopies(payload, count, create, onCreated) {
  if (!Number.isInteger(count) || count < 1 || count > 100) throw new Error('Enter a whole number of copies from 1 to 100.');
  const created = [];
  for (let i = 0; i < count; i += 1) {
    try {
      const saved = await create(payload.duplicatedFromLoadId ? unassignDuplicate(payload) : payload);
      created.push(saved);
      onCreated(saved);
    } catch (error) { return { created, remaining: count - created.length, error }; }
  }
  return { created, remaining: 0, error: null };
}
