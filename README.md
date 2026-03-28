# Core Refactor Initiative

This repository stays as a **single Vite + React codebase** for:

- Desktop web (first-class)
- Mobile web / PWA
- Native Android + iOS wrappers via Capacitor

No React Native rewrite is used.

## Capacitor foundation

Capacitor is configured to wrap the existing Vite output in `dist/`.

- Config file: `capacitor.config.ts`
- Runtime guard utilities: `src/platform/runtime.ts`
- Native bootstrap hooks (deep-link + push scaffolding): `src/platform/native-bridge.tsx`

## Install dependencies

```bash
npm install
```

## Build and run web

```bash
npm run dev
npm run build
npm run preview
```

## Capacitor workflow

Build + sync native platforms:

```bash
npm run cap:sync
```

Open Android Studio project:

```bash
npm run cap:android
```

Open Xcode project:

```bash
npm run cap:ios
```

If this is the first native run and platform folders do not exist yet, create them once:

```bash
npx cap add android
npx cap add ios
```

## Shared vs platform-aware boundaries

### Shared across desktop web, mobile web, and native wrappers

- Business logic and calculations
- React Router route definitions
- Supabase integrations
- Hooks/state management
- Existing desktop-first screens and workflows

### Platform-aware (guarded) additions

- Runtime detection helpers (`isNativeApp`, `isAndroid`, `isIOS`, `isWebBrowser`)
- Native deep-link listener scaffold (App URL open)
- Native push registration scaffold (no-op on web)
- Safe-area helper utilities

## Rules to avoid desktop regressions

1. Keep desktop navigation/layout and data workflows unchanged.
2. Add native-only code behind runtime guards.
3. Do not replace React Router.
4. Do not remove PWA support.
5. Treat Capacitor as additive container infrastructure only.

## Verification checklist

- [ ] Desktop web still builds and runs unchanged.
- [ ] Existing Vite `dist/` output is still used as source of truth.
- [ ] Capacitor Android project opens successfully.
- [ ] Capacitor iOS project opens successfully.
- [ ] Native-only code paths are guarded from browser execution.
- [ ] PWA support remains intact.
- [ ] No global desktop navigation/layout regression introduced.
