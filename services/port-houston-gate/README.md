# Port Houston Gate Transaction Service

Small TypeScript/Express microservice for retrieving Port Houston gate transaction data, which represents the digital EIR details returned by the EVP Road Service.

## Setup

Request Data Integration API credentials from Port Houston. You need:

- Client ID
- Client Secret
- Operator code, normally `POHA`

Create a local `.env` file:

```bash
cp .env.example .env
```

Then fill in:

```env
PORT_HOUSTON_CLIENT_ID=your-client-id
PORT_HOUSTON_CLIENT_SECRET=your-client-secret
PORT_HOUSTON_OPERATOR_CODE=POHA
PORT_HOUSTON_BASE_URL=https://api.america.naviscloudops.com/v3/
PORT_HOUSTON_GATETRANSACTIONS_ENDPOINT=evp/road/gatetransactions
```

`PORT_HOUSTON_TOKEN_URL` is optional. The default is:

```env
PORT_HOUSTON_TOKEN_URL=https://auth-v1.america.naviscloudops.com/auth/realms/phaprod/protocol/openid-connect/token
```

## Run Locally

```bash
npm install
npm run dev
```

Health check:

```bash
curl http://localhost:3000/health
```

Fetch a gate transaction:

```bash
curl http://localhost:3000/gate-transactions/123456
```

The service calls Port Houston Road Service with `operator=POHA` and `predicate=nbr = 123456`.

The service authenticates with Port Houston using `grant_type=client_credentials`, caches the bearer token in memory, and refreshes it when it is close to expiry. If Port Houston returns `401`, the service refreshes the token and retries once.

## Build And Start

```bash
npm run build
npm run start
```

## Notes

- The endpoint returns Port Houston's Road Service gate transaction payload.
- This service is only for retrieving gate transaction / digital EIR details by transaction number.
- Per Port Houston guidance, EVP returns digital EIR details. The official Customer Service Portal document is not returned by this API.
