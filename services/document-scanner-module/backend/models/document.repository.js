import pg from 'pg';

const { Pool } = pg;

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : false,
});

export async function createDocumentRecord(document) {
  const result = await pool.query(
    `INSERT INTO shipment_documents (
      id,
      document_group_id,
      load_id,
      load_number,
      document_type,
      driver_id,
      file_name,
      mime_type,
      size_bytes,
      storage_key,
      storage_url,
      page_number,
      status,
      uploaded_at
    ) VALUES (
      $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, NOW()
    )
    RETURNING *`,
    [
      document.id,
      document.documentGroupId,
      document.loadId,
      document.loadNumber,
      document.documentType,
      document.driverId,
      document.fileName,
      document.mimeType,
      document.sizeBytes,
      document.storageKey,
      document.storageUrl,
      document.pageNumber,
      document.status,
    ]
  );

  return result.rows[0];
}

export async function findDocumentsByLoad(loadId) {
  const result = await pool.query(
    `SELECT *
     FROM shipment_documents
     WHERE load_id = $1 OR load_number = $1
     ORDER BY uploaded_at DESC, document_group_id, page_number ASC`,
    [loadId]
  );

  return result.rows;
}

export async function findDocumentById(documentId) {
  const result = await pool.query(
    `SELECT * FROM shipment_documents WHERE id = $1`,
    [documentId]
  );

  return result.rows[0] || null;
}

export async function deleteDocumentRecord(documentId) {
  await pool.query(`DELETE FROM shipment_documents WHERE id = $1`, [documentId]);
}

