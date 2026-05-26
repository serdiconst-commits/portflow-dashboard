# email-whatsapp-agent

Production-style MVP microservice for reviewing unread Gmail messages from WhatsApp before any reply is sent.

## What It Does

1. Reads unread Gmail messages.
2. Summarizes each email with OpenAI.
3. Creates a professional suggested reply.
4. Sends the summary and draft reply to your WhatsApp.
5. Waits for your command.
6. Sends the Gmail reply only when you reply `SEND`.

The service never auto-sends email replies.

## Folder Structure

```text
services/email-whatsapp-agent/
├── src/
│   ├── server.ts
│   ├── gmail.ts
│   ├── whatsapp.ts
│   ├── openai.ts
│   ├── agent.ts
│   ├── store.ts
│   ├── types.ts
│   └── routes/
│       └── webhook.ts
├── .env.example
├── package.json
├── tsconfig.json
├── README.md
└── Dockerfile
```

## Environment Variables

Create `.env` in this folder:

```env
OPENAI_API_KEY=
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REFRESH_TOKEN=
WHATSAPP_TOKEN=
WHATSAPP_PHONE_NUMBER_ID=
WHATSAPP_VERIFY_TOKEN=
MY_WHATSAPP_NUMBER=
PORT=3000
```

Optional:

```env
OPENAI_MODEL=gpt-4o-mini
POLL_INTERVAL_MS=60000
```

`MY_WHATSAPP_NUMBER` should be in international format without `+`, for example `17135551212`.

## Install

```bash
cd services/email-whatsapp-agent
npm install
```

## Run Locally

```bash
npm run dev
```

Health check:

```bash
curl http://localhost:3000/health
```

Manual email poll:

```bash
curl -X POST http://localhost:3000/agent/poll
```

The server also polls Gmail automatically every 60 seconds by default.

## Google Gmail API Setup

1. Go to Google Cloud Console.
2. Create or select a project.
3. Enable the Gmail API.
4. Configure OAuth consent screen.
5. Create OAuth Client ID credentials.
6. Use an OAuth flow to get a refresh token with this scope:

```text
https://www.googleapis.com/auth/gmail.modify
```

7. Add these values to `.env`:

```env
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REFRESH_TOKEN=
```

The service uses Gmail modify permission so it can read unread messages, send replies, and remove the `UNREAD` label after a WhatsApp approval request is created.

## Meta WhatsApp Cloud API Setup

1. Go to Meta Developers.
2. Create or open your app.
3. Add WhatsApp product.
4. Copy your permanent or temporary access token.
5. Copy the Phone Number ID.
6. Add your personal WhatsApp number as a test recipient if you are using test mode.
7. Add these values to `.env`:

```env
WHATSAPP_TOKEN=
WHATSAPP_PHONE_NUMBER_ID=
MY_WHATSAPP_NUMBER=
```

## Webhook Setup

Set a webhook verify token in `.env`:

```env
WHATSAPP_VERIFY_TOKEN=make-a-secret-token-here
```

Webhook verify URL:

```text
https://your-public-url/webhook/whatsapp
```

Subscribe to WhatsApp messages in the Meta webhook settings.

## ngrok Local Testing

Start the service:

```bash
npm run dev
```

In another terminal:

```bash
ngrok http 3000
```

Use the HTTPS ngrok URL in Meta:

```text
https://your-ngrok-url.ngrok-free.app/webhook/whatsapp
```

Use the same `WHATSAPP_VERIFY_TOKEN` from your `.env` when Meta asks for the verify token.

## WhatsApp Commands

When a Gmail email is found, you receive:

```text
From:
Subject:
Summary:
Suggested reply:

Reply with one command:
SEND
SKIP
EDIT: <new message>
```

Commands:

```text
SEND
```

Sends the suggested Gmail reply.

```text
SKIP
```

Marks the approval as skipped. No Gmail reply is sent.

```text
EDIT: Thank you, I will check this and get back to you today.
```

Replaces the draft reply. You must still reply `SEND` after editing.

## Test Flow

1. Send a test email to the Gmail account.
2. Make sure the email is unread.
3. Start the service.
4. Trigger a poll:

```bash
curl -X POST http://localhost:3000/agent/poll
```

5. Confirm WhatsApp receives the summary and suggested reply.
6. Reply `EDIT: <new message>` if needed.
7. Reply `SEND`.
8. Confirm Gmail sent the reply in the original thread.
9. Try replying `SEND` again. It should be blocked because duplicate sends are prevented.

## Safety Notes

- No Gmail reply is sent unless WhatsApp receives an explicit `SEND`.
- `EDIT:` only changes the draft. It does not send.
- `SKIP` closes the pending approval without sending.
- The MVP uses in-memory storage, so pending approvals reset when the service restarts.
- For production, replace `store.ts` with a persistent database before relying on long-lived approvals.

## Build

```bash
npm run build
npm run start
```

## Docker

```bash
docker build -t email-whatsapp-agent .
docker run --env-file .env -p 3000:3000 email-whatsapp-agent
```
