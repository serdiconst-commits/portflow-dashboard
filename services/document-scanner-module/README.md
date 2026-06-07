# TMS Driver Document Scanner Module

Standalone React Native + Node/Express reference module for scanning and uploading driver paperwork.

This module is intentionally separate from the current PortFlow web/Capacitor app. It can be used when building a true React Native driver app, or adapted into the existing backend later.

## Features

- Document capture with `react-native-document-scanner-plugin`
- Multi-page scan support
- Document type selection
- Load/shipment linking by load number
- Local offline queue with retry on reconnect
- Upload status: pending, uploading, uploaded, failed
- Express multipart upload endpoint
- AWS S3 compatible storage
- PostgreSQL document metadata schema

## Mobile Dependencies

Install inside a React Native app:

```bash
npm install react-native-document-scanner-plugin @react-native-async-storage/async-storage @react-native-community/netinfo
```

## Backend Dependencies

Install inside a Node/Express backend:

```bash
npm install @aws-sdk/client-s3 multer pg uuid
```

## Environment Variables

```env
AWS_REGION=us-east-1
AWS_S3_BUCKET=your-document-bucket
AWS_ACCESS_KEY_ID=
AWS_SECRET_ACCESS_KEY=
DATABASE_URL=postgres://user:password@localhost:5432/portflow
```

For S3 compatible storage, also set:

```env
S3_ENDPOINT=https://your-compatible-storage-endpoint
S3_FORCE_PATH_STYLE=true
```

## API

```txt
POST   /api/documents/upload
GET    /api/documents/:loadId
DELETE /api/documents/:documentId
```

`POST /api/documents/upload` expects multipart form data:

- `files`: one or more scanned image files
- `loadId`
- `loadNumber`
- `documentType`
- `driverId`

## Integration Notes

The current PortFlow backend already has local disk document upload routes. This module uses S3 and PostgreSQL, so connect it only after the production storage/database decision is final.

