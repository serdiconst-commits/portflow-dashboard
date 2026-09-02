# Port Houston Integration Service

Node.js + TypeScript microservice for Portflow integration with the Port Houston Data Integration APIs.

## What It Does

- Authenticates with Port Houston using OAuth client credentials.
- Caches the access token and refreshes before expiration.
- Exposes backend routes under `/porthouston`.
- Keeps this integration isolated from the main PortFlow dashboard.

## Setup

Request Port Houston Data Integration API access from Port Houston. Their process requires signing up to receive a Client ID and Client Secret, then using those credentials to request a secure access token. Download the current API documentation from Port Houston’s developer/API documentation portal and confirm the exact endpoint paths for your account.

Copy `.env.example`:

```bash
cp .env.example .env
```

Set:

```env
PORT=3010
PORT_HOUSTON_CLIENT_ID=your-client-id
PORT_HOUSTON_CLIENT_SECRET=your-client-secret
PORT_HOUSTON_API_BASE_URL=https://api.america.naviscloudops.com/v3/
PORT_HOUSTON_WEBHOOK_SECRET=choose-a-private-secret
```

If Port Houston gives you a separate token URL, also set:

```env
PORT_HOUSTON_AUTH_URL=https://their-token-url.example.com/oauth/token
```

Optional TMS callback variables:

```env
PORTFLOW_TMS_API_BASE_URL=https://your-portflow-api.example.com
PORTFLOW_TMS_API_TOKEN=your-internal-token
PORTFLOW_TMS_EIR_UPLOAD_URL=https://your-portflow-api.example.com/api/port-houston/eir-upload
PORTFLOW_DISPATCH_ALERT_URL=https://your-portflow-api.example.com/api/dispatch-alerts
```

Set the same token in the main Portflow server as `PORT_HOUSTON_INTERNAL_TOKEN`
or `PORTFLOW_TMS_API_TOKEN`. The integration service uses:

- `POST /api/port-houston/events` to update a matching load by container/BOL.
- `POST /api/port-houston/eir-upload` to attach retrieved EIR files as load paperwork.

If Port Houston gives a document download path that differs from the default,
set `PORT_HOUSTON_EIR_DOCUMENT_URL_PATTERN` and include `{id}` where the gate
transaction number or gkey belongs.

## Commands

```bash
npm install
npm run dev
npm run build
npm run start
```

## Routes

Health:

```bash
curl http://localhost:3010/health
```

Vessel schedule:

```bash
curl "http://localhost:3010/porthouston/vessel-schedule?fromDate=2026-06-01&toDate=2026-06-07"
```

Available container:

```bash
curl "http://localhost:3010/porthouston/available-containers/ABCD1234567"
```

Associated equipment:

```bash
curl "http://localhost:3010/porthouston/associated-equipment?facility=BPT&departOrderNbr=BOOKING123"
```

Use `facility=BPT` for Bayport and `facility=BCT` for Barbours Cut. Leave
`facility` off to request results across all Port Houston facilities when the
endpoint supports it:

```bash
curl "http://localhost:3010/porthouston/associated-equipment?departOrderNbr=BOOKING123"
```

Available containers by BOL:

```bash
curl "http://localhost:3010/porthouston/available-containers-by-bol/BOL123456"
```

Equipment ownership:

```bash
curl "http://localhost:3010/porthouston/equipment-ownership/ABCD1234567"
```

Create appointment:

```bash
curl -X POST http://localhost:3010/porthouston/appointments \
  -H "Content-Type: application/json" \
  -d "{\"facility\":\"BPT\",\"unitId\":\"ABCD1234567\",\"startTime\":\"2026-06-07T10:00:00-05:00\"}"
```

Update appointment:

```bash
curl -X PUT http://localhost:3010/porthouston/appointments \
  -H "Content-Type: application/json" \
  -d "{\"appointmentNbr\":\"APT123\",\"startTime\":\"2026-06-07T11:00:00-05:00\"}"
```

Cancel appointment:

```bash
curl -X DELETE http://localhost:3010/porthouston/appointments \
  -H "Content-Type: application/json" \
  -d "{\"appointmentNbr\":\"APT123\"}"
```

Booking inquiry:

```bash
curl "http://localhost:3010/porthouston/booking-inquiry/BOOKING123"
```

Equipment history:

```bash
curl "http://localhost:3010/porthouston/equipment-history/ABCD1234567"
```

Barbours Cut equipment history:

```bash
curl "http://localhost:3010/porthouston/equipment-history/ABCD1234567?facility=BCT"
```

Gate transactions:

```bash
curl "http://localhost:3010/porthouston/gate-transactions/TICKET123"
```

Create the default Port Houston event subscriptions:

```bash
curl -X POST http://localhost:3010/porthouston/subscriptions/default
```

Webhook endpoint for Port Houston notifications:

```bash
curl -X POST "http://localhost:3010/porthouston/webhook/porthouston?secret=choose-a-private-secret" \
  -H "Content-Type: application/json" \
  -d "{\"eventName\":\"TruckTransaction\",\"nbr\":\"20173766\",\"subType\":\"RO\",\"ctrId\":\"ABCD1234567\",\"blNbr\":\"BOL123\",\"hasDocuments\":true}"
```

## Notes

Endpoint names in this first MVP follow the Port Houston service operation names you provided, such as `GetVesselSchedule` and `GetAvailableContainers`. If Port Houston’s downloaded documentation shows facility-specific paths or a different token URL, update `src/porthouston.ts` endpoint strings and `PORT_HOUSTON_AUTH_URL`.

Webhook processing maps Port Houston `TruckTransaction` records into Portflow
shipments using `ctrId` as the container number and `blNbr` as the bill of
lading. Port Houston truck-transaction subtypes are classified as follows:
`DI` and `RE` become `OUT EIR`; `DE` and `RM` become `IN EIR`. Legacy
subtypes `RO`/`DM` remain `OUT EIR`, while `RI`/`RC`/`RB` remain `IN EIR`. The
service logs every incoming event for auditing and alerts dispatch when a Unit
event indicates an SSL hold.
