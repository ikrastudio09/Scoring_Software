# Android app

The app is the viewer web app (`apps/viewer`) packaged with Capacitor 7. There is no separate
Android code base or backend: the app talks to the same public API and Socket.IO server.

## Requirements
- JDK 21 (`JAVA_HOME`), Android SDK with platform 35 and build-tools 35
  (`ANDROID_HOME`, or `apps/viewer/android/local.properties` → `sdk.dir=…`).
- A deployed server reachable over **HTTPS** (cleartext HTTP is disabled in the app).

## Configure
```bash
cd apps/viewer
cp .env.android.example .env.android      # VITE_API_URL=https://scores.example.com
```
- App id / name: `capacitor.config.json` (`appId` must be unique on Play; change it per tournament).
- Icon & splash: edit `assets/*.svg`, then regenerate PNGs and run
  `npx capacitor-assets generate --android`.
- Deep links: pass `-PappLinkHost=scores.example.com` to Gradle. Links such as
  `https://scores.example.com/matches/<id>` then open the match screen in the app
  (`src/lib/native.js` handles `appUrlOpen`). For verified App Links serve
  `/.well-known/assetlinks.json` (nginx block included) containing the release certificate's
  SHA-256 (`keytool -list -v -keystore release.jks`).

## Build
```bash
# from apps/viewer
npm run build:android && npx cap sync android     # web bundle → android/app/src/main/assets
cd android
./gradlew assembleDebug -PappLinkHost=scores.example.com
#   → app/build/outputs/apk/debug/app-debug.apk   (install: adb install -r app-debug.apk)
```

### Release (direct download APK and Play Store AAB)
1. Create a signing key once and keep it safe (losing it means you can never update the app):
   `keytool -genkeypair -v -keystore release.jks -alias cricket -keyalg RSA -keysize 2048 -validity 10000`
2. Create `apps/viewer/android/keystore.properties` (git-ignored):
   ```
   storeFile=/absolute/path/release.jks
   storePassword=…
   keyAlias=cricket
   keyPassword=…
   ```
   (or set `CRICKET_KEYSTORE_FILE`, `CRICKET_KEYSTORE_PASSWORD`, `CRICKET_KEY_ALIAS`, `CRICKET_KEY_PASSWORD`).
3. Build, bumping the version for each upload:
   ```bash
   ./gradlew assembleRelease bundleRelease -PversionCode=2 -PversionName=1.0.1 -PappLinkHost=scores.example.com
   ```
   - `app/build/outputs/apk/release/app-release.apk` → host for direct download
     (users must allow "install unknown apps").
   - `app/build/outputs/bundle/release/app-release.aab` → upload to Google Play Console.

## Play Store checklist
- targetSdk 35 (set in `android/variables.gradle`), 64-bit (WebView app — no native code).
- App icon 512×512 and feature graphic 1024×500 for the listing (export from `assets/icon.svg`).
- Privacy policy URL (the app collects no personal data; viewers do not log in).
- Data safety form: no data collected/shared; network access only.
- Content rating questionnaire; app category Sports.

## Behaviour in the app
- Realtime updates over WebSocket (falls back to long-polling), auto-reconnect with backoff.
- Resubscribes and fetches the latest state when the app returns to the foreground or the network
  comes back; an "Offline — showing the last known scores" banner shows meanwhile.
- Tournament branding is cached on the device so the app starts branded even offline.
- Android back button navigates back; exits from the home screen.
