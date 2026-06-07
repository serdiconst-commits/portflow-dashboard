import { v4 as uuidv4 } from 'uuid';
import { deleteFromS3, uploadToS3 } from '../utils/s3.js';
import {
  createDocumentRecord,
  deleteDocumentRecord,
  findDocumentById,
  findDocumentsByLoad,
} from '../models/document.repository.js';

export async function uploadDocuments(req, res) {
  const files = req.files || [];
  const {
    loadId = '',
    loadNumber = '',
    documentType = 'Other',
    driverId = '',
  } = req.body || {};

  if (!loadId && !loadNumber) {
    return res.status(400).json({ error: 'loadId or loadNumber is required.' });
  }

  if (!driverId) {
    return res.status(400).json({ error: 'driverId is required.' });
  }

  if (!files.length) {
    return res.status(400).json({ error: 'At least one file is required.' });
  }

  try {
    const uploaded = [];
    const documentGroupId = uuidv4();

    for (let index = 0; index < files.length; index += 1) {
      const file = files[index];
      const id = uuidv4();
      const safeLoad = String(loadNumber || loadId).replace(/[^a-zA-Z0-9-_]/g, '-');
      const key = `driver-documents/${safeLoad}/${documentGroupId}/page-${index + 1}-${id}.jpg`;

      const s3Object = await uploadToS3({
        key,
        body: file.buffer,
        contentType: file.mimetype || 'image/jpeg',
      });

      const record = await createDocumentRecord({
        id,
        documentGroupId,
        loadId: loadId || loadNumber,
        loadNumber: loadNumber || loadId,
        documentType,
        driverId,
        fileName: file.originalname || key.split('/').pop(),
        mimeType: file.mimetype || 'image/jpeg',
        sizeBytes: file.size,
        storageKey: key,
        storageUrl: s3Object.url,
        pageNumber: index + 1,
        status: 'uploaded',
      });

      uploaded.push(record);
    }

    return res.status(201).json({
      ok: true,
      documentGroupId,
      count: uploaded.length,
      documents: uploaded,
    });
  } catch (error) {
    console.error('Document upload failed:', error);
    return res.status(500).json({ error: 'Failed to upload documents.' });
  }
}

export async function getDocumentsForLoad(req, res) {
  try {
    const documents = await findDocumentsByLoad(req.params.loadId);
    return res.json(documents);
  } catch (error) {
    console.error('Failed to fetch load documents:', error);
    return res.status(500).json({ error: 'Failed to fetch documents.' });
  }
}

export async function deleteDocument(req, res) {
  try {
    const document = await findDocumentById(req.params.documentId);
    if (!document) {
      return res.status(404).json({ error: 'Document not found.' });
    }

    await deleteFromS3(document.storage_key);
    await deleteDocumentRecord(req.params.documentId);

    return res.json({ ok: true });
  } catch (error) {
    console.error('Failed to delete document:', error);
    return res.status(500).json({ error: 'Failed to delete document.' });
  }
}

