import AsyncStorage from '@react-native-async-storage/async-storage';

const QUEUE_KEY = 'portflow.documentUploadQueue.v1';

export async function getQueuedDocuments() {
  const raw = await AsyncStorage.getItem(QUEUE_KEY);
  return raw ? JSON.parse(raw) : [];
}

export async function saveQueuedDocuments(items) {
  await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(items));
}

export async function addToUploadQueue(item) {
  const queue = await getQueuedDocuments();
  await saveQueuedDocuments([...queue.filter((existing) => existing.id !== item.id), item]);
}

export async function updateQueuedDocument(id, patch) {
  const queue = await getQueuedDocuments();
  await saveQueuedDocuments(
    queue.map((item) => (item.id === id ? { ...item, ...patch, updatedAt: new Date().toISOString() } : item))
  );
}

export async function removeQueuedDocument(id) {
  const queue = await getQueuedDocuments();
  await saveQueuedDocuments(queue.filter((item) => item.id !== id));
}

export async function uploadQueuedDocuments({ apiBaseUrl, authToken }) {
  const queue = await getQueuedDocuments();

  for (const item of queue) {
    if (item.status === 'uploaded') continue;

    try {
      await updateQueuedDocument(item.id, { status: 'uploading', error: '' });

      const formData = new FormData();
      formData.append('loadId', item.loadId);
      formData.append('loadNumber', item.loadNumber);
      formData.append('documentType', item.documentType);
      formData.append('driverId', item.driverId);

      item.pageUris.forEach((uri, index) => {
        formData.append('files', {
          uri,
          type: 'image/jpeg',
          name: `${item.loadNumber}-${item.documentType}-page-${index + 1}.jpg`,
        });
      });

      const res = await fetch(`${apiBaseUrl}/api/documents/upload`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${authToken}`,
        },
        body: formData,
      });

      if (!res.ok) {
        const errorText = await res.text();
        throw new Error(errorText || 'Upload failed.');
      }

      await updateQueuedDocument(item.id, { status: 'uploaded', uploadedAt: new Date().toISOString() });
      await removeQueuedDocument(item.id);
    } catch (error) {
      await updateQueuedDocument(item.id, {
        status: 'failed',
        error: error.message,
      });
    }
  }
}

