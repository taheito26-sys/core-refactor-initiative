import { showAppUpdate, dismissAppUpdate } from '@/features/app-updates/update-notice';

/** Keep an open app current without discarding an edited page. */
export function startAppUpdates(buildId: string, reload = () => window.location.reload()) {
  let dirty = false;
  let pending = false;
  let reloading = false;
  let checking = false;
  let stopped = false;
  let pathname = location.pathname;
  let targetVersion = 'worker';
  let activated = false;
  let updateRequested = false;
  let noticeShown = false;
  let registration: ServiceWorkerRegistration | undefined;
  let controlled = !!navigator.serviceWorker?.controller;
  const apply = () => {
    if (!pending || reloading || document.visibilityState === 'hidden') return;
    const openEditor = Array.from(document.querySelectorAll('[role=dialog],dialog[open],[data-update-guard]'))
      .some(editor => !editor.closest('[hidden],[aria-hidden=true],[data-state=closed]')
        && editor.querySelector('input,textarea,select,[contenteditable=true]'));
    if (!updateRequested && (dirty || openEditor || document.activeElement?.matches('input,textarea,[contenteditable=true]'))) {
      if (!noticeShown) {
        noticeShown = true;
        showAppUpdate({
          updating: false,
          onUpdate: () => {
            if (stopped || updateRequested) return;
            updateRequested = true;
            showAppUpdate({ updating: true, onUpdate: () => {}, onLater: () => {} });
            apply();
          },
          onLater: dismissAppUpdate,
        });
      }
      return;
    }
    if (registration?.installing) return;
    if (registration?.waiting) { registration.waiting.postMessage({ type: 'SKIP_WAITING' }); return; }
    const attempt = `${buildId}->${targetVersion}`;
    try {
      if (!activated && sessionStorage.getItem('app-update-attempt') === attempt) return;
      sessionStorage.setItem('app-update-attempt', attempt);
    } catch { /* Updates still work if browser storage is unavailable. */ }
    reloading = true;
    dismissAppUpdate();
    reload();
  };
  const edited = (event: Event) => {
    const target = event.target as Element;
    if (target?.closest('[data-update-passive]')) return;
    if (target?.matches('input,textarea,select,[contenteditable=true]')) dirty = true;
  };
  const interacted = (event: Event) => {
    const button = (event.target as Element)?.closest('button');
    if (button?.closest('form,[data-update-guard]')) dirty = true;
  };
  const controllerChanged = () => {
    if (controlled || pending) { activated = true; pending = true; apply(); }
    controlled = true;
  };
  const check = async () => {
    if (stopped || checking || reloading || document.visibilityState === 'hidden') return;
    checking = true;
    try {
      // An offline or stalled worker request must not block the independent version check.
      void registration?.update().catch(() => undefined);
      const response = await fetch('/app-version.json', { cache: 'no-store' });
      if (!response.ok) return;
      const version: unknown = await response.json();
      if (!stopped && version && typeof version === 'object' && 'buildId' in version
        && typeof version.buildId === 'string' && version.buildId !== buildId) {
        targetVersion = version.buildId;
        pending = true;
        apply();
      }
    } catch { /* Offline clients continue using their current version. */ }
    finally { checking = false; }
  };
  document.addEventListener('click', interacted, true);
  document.addEventListener('input', edited, true);
  document.addEventListener('change', edited, true);
  document.addEventListener('focusout', apply);
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
            if (!stopped && worker.state === 'installed' && (controlled || pending)) { pending = true; window.setTimeout(() => { if (!stopped) apply(); }, 0); }
          });
        };
        reg.addEventListener?.('updatefound', installing);
        installing();
        if (reg.waiting) { pending = true; apply(); }
        void check();
      }
    }).catch(() => undefined);
  }
  const timer = window.setInterval(check, 30_000);
  const navigation = window.setInterval(() => {
    if (pathname !== location.pathname) {
      pathname = location.pathname;
      dirty = false;
      apply();
    }
  }, 1000);
  void check();
  return () => {
    stopped = true;
    dismissAppUpdate();
    clearInterval(timer); clearInterval(navigation);
    document.removeEventListener('click', interacted, true);
    document.removeEventListener('input', edited, true);
    document.removeEventListener('change', edited, true);
    document.removeEventListener('focusout', apply);
    document.removeEventListener('visibilitychange', check);
    window.removeEventListener('focus', check);
    window.removeEventListener('online', check);
    navigator.serviceWorker?.removeEventListener('controllerchange', controllerChanged);
  };
}
