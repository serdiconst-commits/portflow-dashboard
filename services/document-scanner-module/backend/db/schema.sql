CREATE TABLE IF NOT EXISTS shipment_documents (
  id UUID PRIMARY KEY,
  document_group_id UUID NOT NULL,
  load_id TEXT NOT NULL,
  load_number TEXT NOT NULL,
  document_type TEXT NOT NULL CHECK (
    document_type IN (
      'BOL',
      'POD',
      'Delivery Receipt',
      'Lumper Receipt',
      'Rate Confirmation',
      'Other'
    )
  ),
  driver_id TEXT NOT NULL,
  file_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes BIGINT NOT NULL DEFAULT 0,
  storage_key TEXT NOT NULL,
  storage_url TEXT,
  page_number INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'uploaded' CHECK (
    status IN ('pending', 'uploading', 'uploaded', 'failed')
  ),
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS shipment_documents_load_idx
  ON shipment_documents (load_id, uploaded_at DESC);

CREATE INDEX IF NOT EXISTS shipment_documents_load_number_idx
  ON shipment_documents (load_number, uploaded_at DESC);

CREATE INDEX IF NOT EXISTS shipment_documents_group_idx
  ON shipment_documents (document_group_id, page_number);

CREATE INDEX IF NOT EXISTS shipment_documents_driver_idx
  ON shipment_documents (driver_id, uploaded_at DESC);

