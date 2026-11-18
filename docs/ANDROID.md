# Android app

The app is the viewer web app (`apps/viewer`) packaged with Capacitor 7. There is no separate
Android code base or backend: the app talks to the same public API and Socket.IO server.

## Requirements
- JDK 21 (`JAVA_HOME`), Android SDK with platform 35 and build-tools 35
  (`ANDROID_HOME`, or `apps/viewer/android/local.properties` → `sdk.dir=…`).
- A deployed server reachable over **HTTPS** for release builds. A laptop on the local network over
  plain HTTP works for testing builds (see *Testing against a laptop* below).

## Configure
```bash
cd apps/viewer
echo VITE_API_URL=https://scores.example.com > .env.android     # the server's full address
```
- App id / name: `capacitor.config.json` (`appId` must be unique on Play; change it per tournament).
- Icon & splash: edit `assets/*.svg`, then regenerate PNGs and run
  `npx capacitor-assets generate --android`.
- Deep links: pass `-PappLinkHost=scores.example.com` to Gradle. Links such as
  `https://scores.example.com/mens/matches/<id>` (or the older `/matches/<id>`, which redirects to
  the last category used) then open the match screen in the app
  (`src/lib/native.js` handles `appUrlOpen`). For verified App Links serve
  `/.well-known/assetlinks.json` (nginx block included) containing the release certificate's
  SHA-256 (`keytool -list -v -keystore release.jks`).

## Build
```bash
# from apps/viewer
npm run cap:sync      # web bundle → android/app/src/main/assets, WebView settings for VITE_API_URL
cd android
./gradlew assembleDebug -PappLinkHost=scores.example.com
#   → app/build/outputs/apk/debug/app-debug.apk   (install: adb install -r app-debug.apk)
```

Always sync with `npm run cap:sync`, not `npx cap sync` or Android Studio's sync on their own:
`scripts/cap-sync.mjs` sets the WebView origin and the cleartext permission to match the API (below).

### Testing against a laptop on the local network (plain HTTP)
Capacitor serves the app from `https://localhost`, and Android's WebView refuses **mixed content**
(`MIXED_CONTENT_NEVER_ALLOW`, the default for apps targeting Android 5+): an `https://` page can
never call an `http://` API — REST, Socket.IO polling and WebSockets are all blocked, and the app
shows *"Reconnecting…"* forever. Therefore `npm run cap:sync` reads `VITE_API_URL` and:

| `VITE_API_URL` | App served from | Cleartext HTTP |
|---|---|---|
| `https://…` (production) | `https://localhost` | off |
| `http://192.168.x.x:4000` (laptop) | `http://localhost` | on (that build only) |

1. Server: `HOST=0.0.0.0` in `server/.env`, allow port 4000 through the laptop's firewall; check
   `http://<laptop-ip>:4000/api/health` in the phone's browser.
2. `apps/viewer/.env.android`: `VITE_API_URL=http://<laptop-ip>:4000`
3. `npm run cap:sync`, then `cd android && ./gradlew assembleDebug` (Windows cmd: `gradlew.bat assembleDebug`).
4. The console prints `app served from http://localhost, cleartext HTTP on`. Never ship that build:
   switch `VITE_API_URL` back to `https://…` and sync again before a release build.

Debugging the WebView: with the phone on USB debugging, open `chrome://inspect` on the laptop and
inspect the app. A `[viewer] Mixed content` error in the console means the build was synced
without `npm run cap:sync`.

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
