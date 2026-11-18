# Branding

## Where it comes from

| What | Where |
|---|---|
| Official MPL logo, exactly as supplied | `branding/mpl-logo-source.png` |
| Names, season, launch colour, studio credit | `packages/shared/src/branding.js` (`BRAND`) — read by the viewer, Android app, admin console, LED and the viewer's `index.html` (via a small Vite plugin) |
| Every generated image | `python branding/generate.py` (needs Pillow) |

The logo is never redrawn or recoloured: the generator only crops the white margin, makes the white
area outside the outer ring transparent, and resizes it (aspect ratio kept).

Generated files (committed — the build does not need Python):

| File | Used for |
|---|---|
| `apps/*/public/brand/mpl-logo.webp` (384 px, 40 KB) | launch loader, admin login, LED idle screen |
| `apps/*/public/brand/mpl-logo-128.webp` (9 KB) | headers (viewer, admin, LED scoreboard) |
| `apps/*/public/favicon-32.png` | browser tab icons |
| `apps/viewer/public/icon-192.png`, `icon-512.png`, `icon-maskable-512.png`, `apple-touch-icon.png` | PWA / home-screen icons (`manifest.webmanifest`) |
| `apps/viewer/assets/icon-*.png`, `splash*.png` | sources for the Android launcher icons and splash screen |

## Changing the logo

1. Replace `branding/mpl-logo-source.png` (keep a white background around the round logo).
2. `python branding/generate.py`
3. Android: `cd apps/viewer && npx capacitor-assets generate --android --iconBackgroundColor '#ffffff' --splashBackgroundColor '#0b0b0b' --splashBackgroundColorDark '#0b0b0b'`,
   then rebuild the APK (`npm run android:release -w apps/viewer`).
4. `npm run build`. Installed PWAs pick up the new shell because the service-worker cache name
   changes with each branding release (`apps/viewer/public/sw.js`, `SHELL`).

A logo URL set in **Admin → Settings → Logo URL** overrides the bundled header logo in the viewer.

## Launch loader

`apps/viewer/index.html` (`#boot`) + `apps/viewer/src/lib/boot.js`. Dark background
(`BRAND.launchBackground`, the same as the Android splash), the logo with a short fade-in and a
soft glow, the name and season, a thin progress bar, and the studio credit. It shows on launch
only (web, PWA and Android — after the native splash), for at least 2 s and until the tournament
information is available, at most 10 s; never on in-app navigation. Respects reduced motion. No
inline script (the server's Content-Security-Policy forbids it).

## Studio credit (iKRA Studios)

Shown as text — "by iKRA Studios" — on the launch loader, the viewer footer, the admin login and
the LED idle screen. The studio logo has not been supplied yet: when it is, put it in
`branding/`, add it to `generate.py`, set `BRAND.studio.logo`, and show it next to the credit in
those four places (each is a single line: `index.html` `#boot`, viewer `Layout.jsx` footer,
admin `Login.jsx`, LED `main.jsx` idle screen).
