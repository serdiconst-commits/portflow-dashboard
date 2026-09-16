# Owner-managed account access

Only the PortFlow owner creates companies from **Tenant Management → Create company & invite administrator**. Enter the company, administrator name/email, plan, initial Active/Trial status, and optional SCAC. The administrator is inactive until they choose a password through the invitation.

The public **Request information** form stores a prospect request only. The former public registration endpoint rejects account creation. Existing accounts and passwords are preserved.

## Email configuration

The feature reuses `RESEND_API_KEY` and `DRIVER_COMPLIANCE_FROM_EMAIL`. Optionally set `PORTFLOW_ACCOUNT_FROM_EMAIL` to a verified sender dedicated to accounts. `PORTFLOW_PUBLIC_URL` is the trusted HTTPS origin for links; it defaults to `https://portflow-dashboard.onrender.com`. Request headers never determine the link host.

Missing configuration prevents company creation with an owner-visible message. If the provider fails after a company is saved, it stays pending; use **Resend invitation**, not another company creation. Provider acceptance is not proof of inbox delivery. Confirm receipt with the intended administrator when onboarding the first real company.

## Activation and recovery

- Invitations expire in 24 hours. Resending replaces earlier links; a one-minute resend cooldown applies.
- **Forgot password?** sends a 30-minute link only for an eligible existing active account. Recovery cannot create an account or restore disabled company access. Pending invitees ask the owner to resend their invitation.
- Links are random, hashed in the database, single-use and bound to the account's email and current password hash. Consumption and password changes commit together on a separate SQLite connection.
- Links use URL fragments. The dedicated account page removes the fragment, uses no third-party scripts, and keeps the token in memory only. Refreshing after removal requires reopening the email link.
- Password updates invalidate that user's previous sessions. Other users' existing sessions remain valid. No automatic login occurs after a reset.
- The existing owner recovery-code procedure remains available.

Two additive tables, `account_access` and `account_tokens`, hold pending activation, session versions and tokens. No existing company or user records are rewritten during this migration.

## Verification

Run `npm test` and `npm run build`. Account tests use temporary SQLite databases and mocked emails, including the real server/login flow, legacy owner recovery, tenant activation/status controls, unauthorized owner-role creation, token replay/expiry, session invalidation, duplicate emails and provider failure. They do not send real emails or contact Port Houston.
