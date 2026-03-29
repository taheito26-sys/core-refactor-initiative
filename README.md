# Core Refactor Initiative

This repository remains a **single Vite + React codebase** for desktop web, mobile web/PWA, and Capacitor native wrappers.

## What was added in this step

- Capacitor dependency wiring in `package.json`
- Capacitor config in `capacitor.config.ts` (uses Vite `dist/` output)
- Scripts to add/sync/open Android and iOS projects (all via `npx --no-install cap` so no global `cap` binary is required and commands only use the local CLI install)
- Safe platform detection helpers in `src/platform/runtime.ts`

No desktop layout/navigation/business-logic rewrite is included.

## Install dependencies

```bash
npm install
```

## Run web (unchanged)

```bash
npm run dev
npm run build
npm run preview
```

## Capacitor setup (Android + iOS)

Create native projects once:

```bash
npm run cap:add:android
npm run cap:add:ios
```

Sync web build into native projects:

```bash
npm run cap:sync
```

Open native IDE projects:

```bash
npm run cap:android
npm run cap:ios
```

## Host prerequisites for native validation

- Node modules must be installable from your configured package registry (must allow `@capacitor/*` packages).
- Android validation requires Android Studio + Android SDK.
- iOS validation requires macOS + Xcode (cannot be fully validated on Linux hosts).

## Platform helper usage

Use `src/platform/runtime.ts` utilities for guarded checks:

- `isNativeApp()`
- `isAndroid()`
- `isIOS()`
- `isWebBrowser()`

Keep native-only behavior behind these checks so browser desktop remains unaffected.

## Native pipeline validation checklist

Run these commands in order to validate native pipeline readiness:

```bash
npm run build
test -f dist/index.html
npx cap sync
```

If platform folders are missing, generate them once:

> Note: Native `android/` and `ios/` projects are generated locally via Capacitor commands and are not committed to this repository to avoid binary artifacts in PRs.


```bash
npx cap add android
npx cap add ios
```

## Auth redirect configuration (Supabase / OAuth provider)

For this app's auth to work reliably across web + Capacitor Android, configure **all** of these redirect URLs in your Supabase Auth settings (and any provider allow-list if required):

- Web production callback: `https://<your-production-domain>/auth/callback`
- Local web callback: `http://localhost:5173/auth/callback`
- Local web password reset callback: `http://localhost:5173/reset-password`
- Capacitor Android OAuth callback: `com.taheito26sys.corerefactorinitiative://login-callback`
- Capacitor Android password reset callback: `com.taheito26sys.corerefactorinitiative://reset-password-callback`

Implementation notes:

- Web runtime uses web URLs (`/auth/callback`, `/reset-password`).
- Capacitor native runtime uses deep links with the app scheme (`com.taheito26sys.corerefactorinitiative://...`).
- Android receives those deep links via `AndroidManifest.xml` intent filters and routes back into the SPA callback routes.
