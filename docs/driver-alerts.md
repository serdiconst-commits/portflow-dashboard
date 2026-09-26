# Driver confirmation, dispatch alerts, and app updates

Implemented locally: Drop confirmation with Cancel focused, duplicate-submit guard, visible notices for assignment/route/appointment changes, a three-chime foreground sound, native push registration, APNs/FCM delivery with an SQLite retry queue, and native store-version checks. Payroll changes remain in the separate `payroll-stop-details` worktree.

## Activation still required

Provider credentials are installed separately as Render secret files. Keep `DRIVER_PUSH_ENABLED=false` until the native build and a controlled device test are ready. Existing installed apps need a new binary to acquire these features. Never commit provider credentials.

1. **Android / Firebase:** create or select the Firebase project for `com.portflow.driverapp`, enable Cloud Messaging, and place its Android `google-services.json` in `android/app/` (gitignored). Put a service-account JSON in the backend's secret-file storage and set `FCM_SERVICE_ACCOUNT_PATH` to that file. Never put it in Vite variables, the mobile bundle, or Git.
2. **Apple:** enable Push Notifications for the existing App ID, create an APNs signing key, and install the `.p8` file in backend secret-file storage. Set `APNS_KEY_PATH`, `APNS_KEY_ID`, and `APNS_TEAM_ID`. Use `APNS_ENVIRONMENT=sandbox` with a sandbox-capable key for development-signed testing and `production` for TestFlight/App Store. A production-only APNs key cannot deliver to development-signed builds. Regenerate the provisioning profile after enabling the capability.
3. **Build:** in the actual mobile-release checkout containing the iOS project, apply these changes, run `npm install`, then `npm run mobile:sync`. The sync includes `scripts/configure-driver-push.mjs`, which adds the iOS registration callbacks, entitlement, and custom sound without replacing app identity/signing settings. Review the native diff. Do not create a replacement iOS identity or reset the existing version/signing configuration.
4. **Backend:** deploy the reviewed server changes with provider secrets configured, then set `DRIVER_PUSH_ENABLED=true`. The worker starts at the current audit-log position, queues new dispatch changes per driver/company, and retries transient failures. Use a single worker instance against the app's existing SQLite deployment.
5. **Release notice:** only after the release is available in the relevant store, set `DRIVER_IOS_LATEST_VERSION` / `DRIVER_ANDROID_LATEST_VERSION` and their corresponding `*_STORE_URL`. iOS needs the actual App Store listing URL. Empty versions do not show a notice; a server deployment alone does not advertise a new native version. The app checks on startup, foreground/resume, and every 15 minutes while running.

## Phone acceptance checks

- Drop opens with the correct container and actual drop destination. Cancel/Escape sends no request. Confirm sends one status update; stale displayed routes require review again.
- Tap **Enable alerts & test sound** and grant notification permission. Change an assigned load from dispatch. Verify the notice and sound in the foreground, background, and on a locked device on both platforms.
- Verify new assignments, reassignments, route/appointment changes, two different drivers, and company isolation. Completed actions initiated by a driver do not generate dispatch push events.
- Logout removes that account's token registration. If unregistering fails, the app explains the failure and keeps the session open for retry. Inactive driver records are excluded. Registrations expire after 30 days without refresh. Invalid provider tokens are removed.
- Mark a newer store version as available and verify the banner/store button; equal, lower, and unset versions must show no update notice. Updating never reloads the app or discards a document capture automatically.

Sound respects notification permissions, phone volume, silent/Focus/Do Not Disturb settings, and OS delivery restrictions. This is a standard notification, not a critical-alert entitlement or a volume override. Android force-stop can prevent push until the app is opened again. The custom Android channel is versioned because users/Android control channel sound after creation.

## Validation recorded

- Unit/integration suite, frontend builds, and Android Capacitor plugin sync.
- Browser QA with synthetic data: cancel produces zero writes; confirming produces one PUT; Cancel receives initial focus.
- iOS preparation tested twice against a temporary copy of the existing project: no duplicate callbacks; project/entitlements pass `plutil -lint`.
- Real APNs/FCM delivery, signing, physical-device volume and locked-screen delivery remain unverified until activation above.

References: [Capacitor Push Notifications](https://capacitorjs.com/docs/apis/push-notifications), [Capacitor App information](https://capacitorjs.com/docs/apis/app), [FCM HTTP v1](https://firebase.google.com/docs/cloud-messaging/send/v1-api), [APNs token authentication](https://developer.apple.com/documentation/usernotifications/establishing-a-token-based-connection-to-apns).
