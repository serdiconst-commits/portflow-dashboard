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
VITE_GOOGLE_MAPS_API_KEY=<Google Maps browser API key>
DB_PATH=/var/data/portflow.db
UPLOADS_DIR=/var/data/uploads
BACKUP_DIR=/var/data/backups
MAX_UPLOAD_MB=25
NODE_VERSION=22
JWT_SECRET=<long random secret>
```

Do not set `PORT` manually on Render. Render provides it.

## Port Houston

To enable the Port Houston check button, set these Render environment values after Port Houston/Navis API access is approved:

```env
PORT_HOUSTON_ENABLED=true
PORT_HOUSTON_API_BASE=https://api.america.naviscloudops.com/v3/evp
PORT_HOUSTON_AUTH_URL=https://auth-v1.america.naviscloudops.com/auth/realms/phaprod/protocol/openid-connect/token
PORT_HOUSTON_CLIENT_ID=<Port Houston client id>
PORT_HOUSTON_CLIENT_SECRET=<Port Houston client secret>
```

`PORT_HOUSTON_API_KEY`, `PORT_HOUSTON_USERNAME`, and `PORT_HOUSTON_PASSWORD` are optional fallbacks for credential formats Port Houston may provide. If `PORT_HOUSTON_ENABLED` is left as `false`, the dashboard will show `Port Houston integration is disabled` before it attempts any API request.

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
