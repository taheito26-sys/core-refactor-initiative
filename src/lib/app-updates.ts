import { showAppUpdate, showAppUpdated, dismissAppUpdate } from '@/features/app-updates/update-notice';
import { hasPendingAppSaves, waitForAppSaves } from './app-update-saves';

/** Check immediately without blocking render; install and restart automatically without an acceptance step. */
export function startAppUpdates(buildId: string, reload = () => {
  const recovery = new URL('/auth/refresh.html', location.origin);
  recovery.searchParams.set('next', location.pathname + location.search + location.hash);
  window.location.replace(recovery.href);
}) {
  let pending = false;
  let reloading = false;
  let preparing = false;
  let checking = false;
  let stopped = false;
  let targetVersion = 'worker';
  let activated = false;
  let noticePhase = '';
  let registration: ServiceWorkerRegistration | undefined;
  let workerReady = !navigator.serviceWorker;
  let workerChecking = false;
  let controlled = !!navigator.serviceWorker?.controller;
  const announce = (phase: 'updating' | 'saving') => {
    if (noticePhase === phase) return;
    noticePhase = phase;
    showAppUpdate(phase);
  };

  try {
    const priorBuild = sessionStorage.getItem('app-update-from-build');
    if (priorBuild && priorBuild !== buildId) {
      sessionStorage.removeItem('app-update-from-build');
      showAppUpdated();
    }
  } catch { /* Updates also work when browser storage is unavailable. */ }

  const apply = () => {
    if (!pending || reloading || preparing || stopped || document.visibilityState === 'hidden') return;
    announce(hasPendingAppSaves() ? 'saving' : 'updating');
    if (!workerReady || (workerChecking && !activated) || registration?.installing) return;
    if (registration?.waiting) { registration.waiting.postMessage({ type: 'SKIP_WAITING' }); return; }
    preparing = true;
    void (async () => {
      try {
        await waitForAppSaves();
        if (stopped || document.visibilityState === 'hidden' || registration?.installing || registration?.waiting) return;
        const attempt = `${buildId}->${targetVersion}`;
        try {
          if (!activated && sessionStorage.getItem('app-update-attempt') === attempt) {
            dismissAppUpdate();
            return;
          }
          sessionStorage.setItem('app-update-attempt', attempt);
          sessionStorage.setItem('app-update-from-build', buildId);
        } catch { /* A storage restriction does not prevent updating. */ }
        announce('updating');
        reloading = true;
        reload();
      } catch {
        // Keep the app available and retry automatically; never interrupt a failed financial save.
        announce('saving');
      } finally { preparing = false; }
    })();
  };
  const controllerChanged = () => {
    if (controlled || pending) { activated = true; pending = true; apply(); }
    controlled = true;
  };
  const check = async () => {
    if (stopped || checking || reloading || document.visibilityState === 'hidden') return;
    checking = true;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 8000);
    try {
      if (registration && !workerChecking) {
        workerChecking = true;
        void registration.update().catch(() => undefined).finally(() => { workerChecking = false; if (!stopped) apply(); });
      }
      const response = await fetch('/app-version.json', { cache: 'no-store', signal: controller.signal });
      if (!response.ok) return;
      const version: unknown = await response.json();
      if (!stopped && version && typeof version === 'object' && 'buildId' in version
        && typeof version.buildId === 'string' && version.buildId !== buildId) {
        targetVersion = version.buildId;
        pending = true;
        apply();
      }
    } catch { /* Offline clients keep opening normally; the next check retries. */ }
    finally { window.clearTimeout(timeout); checking = false; }
  };
  document.addEventListener('visibilitychange', check);
  window.addEventListener('focus', check);
  window.addEventListener('online', check);
  navigator.serviceWorker?.addEventListener('controllerchange', controllerChanged);
  if (navigator.serviceWorker) {
    void navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' }).then(reg => {
      if (!stopped) {
        registration = reg;
        const installing = () => {
          const worker = reg.installing;
          worker?.addEventListener('statechange', () => {
            if (!stopped && worker.state === 'installed' && (controlled || pending)) {
              pending = true;
              window.setTimeout(() => { if (!stopped) apply(); }, 0);
            }
          });
        };
        reg.addEventListener?.('updatefound', installing);
        installing();
        if (reg.waiting) { pending = true; apply(); }
        void check();
      }
    }).catch(() => undefined).finally(() => { workerReady = true; if (!stopped) apply(); });
  }
  const timer = window.setInterval(check, 5000);
  void check();
  return () => {
    stopped = true;
    dismissAppUpdate();
    clearInterval(timer);
    document.removeEventListener('visibilitychange', check);
    window.removeEventListener('focus', check);
    window.removeEventListener('online', check);
    navigator.serviceWorker?.removeEventListener('controllerchange', controllerChanged);
  };
}
