# Core Refactor Initiative

This repository remains a **single Vite + React codebase** for desktop web, mobile web/PWA, and Capacitor native wrappers.

## What was added in this step

- Capacitor dependency wiring in `package.json`
- Capacitor config in `capacitor.config.ts` (uses Vite `dist/` output)
- Scripts to add/sync/open Android and iOS projects (all via `npx cap` so no global `cap` binary is required)
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
