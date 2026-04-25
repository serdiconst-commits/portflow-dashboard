# Render Deployment

PortFlow is configured to run on Render as one Node web service. Express serves the built Vite frontend from `dist`, and all API routes stay under `/api`.

## Render Settings

Use the included `render.yaml` Blueprint or create a Web Service manually with:

- Runtime: `Node`
- Build command: `unset npm_config_build_from_source && npm install --include=optional --os=linux --cpu=x64 && npm run build`
- Start command: `npm run start:render`
- Health check path: `/api/health`
- Persistent disk mount path: `/var/data`

## Required Environment

Render should set these values:

```env
APP_ENV=production
VITE_API_BASE=
DB_PATH=/var/data/portflow.db
UPLOADS_DIR=/var/data/uploads
BACKUP_DIR=/var/data/backups
MAX_UPLOAD_MB=25
NODE_VERSION=22
JWT_SECRET=<long random secret>
```

Do not set `PORT` manually on Render. Render provides it.

## Data Safety

The SQLite database and uploaded documents must live on the persistent disk:

- Database: `/var/data/portflow.db`
- Uploads: `/var/data/uploads`
- Local DB backups: `/var/data/backups`

Before go-live, run a backup from the Render shell:

```bash
npm run backup:db
```

Render disk snapshots help with recovery, but keep an off-site copy of `/var/data/backups` before major releases or data imports.
