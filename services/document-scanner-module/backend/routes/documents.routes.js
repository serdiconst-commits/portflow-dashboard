import express from 'express';
import multer from 'multer';
import {
  deleteDocument,
  getDocumentsForLoad,
  uploadDocuments,
} from '../controllers/documents.controller.js';

const router = express.Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 15 * 1024 * 1024,
    files: 20,
  },
});

router.post('/upload', upload.array('files'), uploadDocuments);
router.get('/:loadId', getDocumentsForLoad);
router.delete('/:documentId', deleteDocument);

export default router;

