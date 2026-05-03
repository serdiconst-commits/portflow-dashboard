# PortFlow Driver Store Release

PortFlow Driver is a Capacitor app that packages the existing driver portal for app stores.

## Current App Identity

- App name: `PortFlow Driver`
- Android package: `com.portflow.driverapp`
- iOS bundle ID: `com.portflow.driverapp`
- Production API: `https://portflow-dashboard.onrender.com`

## Android: Google Play

Use Android Studio's bundled JDK if the system Java points to Java 8:

```powershell
$env:JAVA_HOME='C:\Program Files\Android\Android Studio\jbr'
$env:Path="$env:JAVA_HOME\bin;$env:Path"
```

Make sure `android/local.properties` points to the Android SDK:

```properties
sdk.dir=C\:\\Users\\furil\\AppData\\Local\\Android\\Sdk
```

Create an upload key once:

```powershell
New-Item -ItemType Directory -Force android\keystores
& "$env:JAVA_HOME\bin\keytool.exe" -genkeypair -v -keystore android\keystores\portflow-upload-key.jks -keyalg RSA -keysize 2048 -validity 10000 -alias portflow-upload
```

Copy `android/signing.properties.example` to `android/signing.properties` and replace the passwords. `android/signing.properties` and `android/keystores/` are ignored by git.

Build the Google Play App Bundle:

```powershell
npm.cmd run mobile:android
```

Upload this file in Play Console:

```txt
android/app/build/outputs/bundle/release/app-release.aab
```

Verify the bundle is signed:

```powershell
& "$env:JAVA_HOME\bin\jarsigner.exe" -verify -verbose -certs android\app\build\outputs\bundle\release\app-release.aab
```

## iPhone: App Store

iOS requires macOS, Xcode, and an Apple Developer account.

On a Mac:

```bash
npm install
npm run build:driver
npx cap add ios
npx cap sync ios
npx cap open ios
```

In Xcode:

1. Select the `App` target.
2. Set the bundle ID to `com.portflow.driverapp`.
3. Select the Apple Developer Team.
4. Choose a real version and build number.
5. Product > Archive.
6. Upload the archive to App Store Connect.

## Before Review

- Confirm only driver accounts can log into the mobile app.
- Confirm assigned loads display on a real phone.
- Confirm status updates reach the live Render backend.
- Confirm camera/photo document upload works.
- Prepare store listing screenshots, privacy policy URL, support URL, and demo credentials for review.
