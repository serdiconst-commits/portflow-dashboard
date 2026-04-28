# PortFlow Driver Mobile App

PortFlow Driver uses the existing React driver portal wrapped with Capacitor. The dispatcher/admin app remains web-based.

## Driver Portal Source

The driver portal is currently inside `src/App.jsx` behind:

```jsx
activeView === 'driver' && currentUser?.role === 'driver'
```

The mobile build sets:

```env
VITE_APP_PORTAL=driver
VITE_API_BASE=https://portflow-dashboard.onrender.com
```

This makes the app open directly as `PortFlow Driver`, reject non-driver logins, and use the live Render API.

## App IDs

- App name: `PortFlow Driver`
- iOS bundle ID: `com.portflow.driver`
- Android package ID: `com.portflow.driver`

## Required Store Accounts

- Apple Developer Program account: required to build, sign, TestFlight, and submit to App Store.
- Google Play Developer account: required to upload Android App Bundles and submit to Google Play.

## First-Time Capacitor Setup

Install dependencies:

```bash
npm install
```

Add native projects once:

```bash
npx cap add android
npx cap add ios
```

The iOS command requires macOS with Xcode.

## Android AAB For Google Play

On Windows:

```bash
npm run mobile:android
```

On macOS/Linux:

```bash
npm run mobile:android:mac
```

The AAB will be generated under:

```txt
android/app/build/outputs/bundle/release/
```

For Play Store release, create/use a signing key and configure Gradle release signing before uploading.

## iOS App Store Build

On macOS:

```bash
npm run mobile:ios
```

Then in Xcode:

1. Select the `App` target.
2. Set signing team to your Apple Developer account.
3. Confirm bundle ID is `com.portflow.driver`.
4. Product > Archive.
5. Upload archive to App Store Connect.

## Driver Features

- Driver login only.
- Assigned loads only.
- Status updates through the live Render API.
- Document upload supports camera/photo/file selection through the phone browser file picker.
- Driver JWT expiry is 30 days.

## Notes

Do not put dispatcher/admin screens in a separate mobile navigation. The mobile app uses `VITE_APP_PORTAL=driver` and client guards, while the backend still enforces driver-only load filtering based on the JWT role and `driverId`.
