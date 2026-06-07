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
```

If Port Houston gives you a separate token URL, also set:

```env
PORT_HOUSTON_AUTH_URL=https://their-token-url.example.com/oauth/token
```

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

Gate transactions:

```bash
curl "http://localhost:3010/porthouston/gate-transactions/TICKET123"
```

## Notes

Endpoint names in this first MVP follow the Port Houston service operation names you provided, such as `GetVesselSchedule` and `GetAvailableContainers`. If Port Houston’s downloaded documentation shows facility-specific paths or a different token URL, update `src/porthouston.ts` endpoint strings and `PORT_HOUSTON_AUTH_URL`.
