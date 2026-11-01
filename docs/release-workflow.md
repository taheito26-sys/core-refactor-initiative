# Release workflow

The owner authorizes implementation, validation, direct pushes to main, and the resulting
production deployment for requested routine fixes. Do not add a final confirmation step.

## Measured delays

The production deployment for edf8eab, measured from Vercel events on November 1, 2026:

| Stage | Observed duration |
| --- | ---: |
| Repository clone | 6.8 seconds |
| Dependency installation | 1.2 seconds reported by pnpm; about 3 seconds including startup |
| Vite build | 22.9 seconds |
| Vercel build command and packaging | 33 seconds total, including Vite |
| Checkout start to live production | About 43 seconds |

A small app change still needs a production build. The build cache is already restored.
The 23-second cache-upload step runs after the site is live and is not release latency.
The pnpm approve-builds log is a dependency-script warning, not a user deployment-approval gate.
Do not disable checks or enable every dependency script just to suppress that warning.

Local work is a separate part of the turnaround. The full test suite takes roughly 90–130
seconds in this workspace and has 22 pre-existing failures. Do not rerun it for every
presentation or documentation edit. Use the impact-based checks in CLAUDE.md; retain broad
coverage for changes to identity, money, persistence, authentication, and shared runtime code.
Run independent checks in parallel and build a given revision once.

## Automatic deployment

GitHub main is already connected to the Vercel project p2ptracker. A push builds and assigns
the production domain automatically. Verify the deployment SHA and production alias with
the connected Vercel tools; no separate promotion or user approval is normally required.
Avoid shell-network commands when the workspace proxy is unavailable. A request waiting
for network permission is not a slow Vercel build.

## Approval scope

ChatGPT connector permissions and workspace command permissions are different settings.
On November 1, 2026, the owner explicitly confirmed GitHub and Vercel only. Both connections
now have a plugin-specific Allow all actions override. The global default and all unrelated
apps remain unchanged. This permission applies beyond this repository; do not expand its
scope without a new instruction.

Connector settings do not disable sandbox restrictions, mandatory platform review, login
requirements, or financial order approvals in the tracker. If a required platform action
is rejected, report it directly instead of repeatedly requesting the same action.

## Client updates

The installed client checks versions every five seconds and fetches startup code instead
of preloading every page. Startup precache is about 1.46 MiB, down from about 5.5 MiB.
The owner now explicitly requests automatic launch/resume updates without acceptance buttons.
The app renders while checking and downloading in parallel. Once ready, it restarts automatically
after submitted tracker and cash writes finish. Open editors do not require an update decision.
Progress is shown when an update arrives, and completion is confirmed only after a different
build loads. Offline checks retry without blocking the initial screen.
