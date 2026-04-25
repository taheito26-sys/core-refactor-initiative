import { useEffect, useState } from 'react';
import { Download, Smartphone } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { isInstalledPwa, isNativeApp } from '@/platform/runtime';

type BeforeInstallPromptEventLike = Event & {
  prompt: () => Promise<void> | void;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform?: string }>;
};

/**
 * localStorage key stamped ONLY when a real install is confirmed:
 * - `appinstalled` browser event fires, OR
 * - `isInstalledPwa()` returns true (display-mode: standalone detected)
 *
 * Once stamped, the user is allowed to use the browser too.
 * There is no self-report "I already installed" button — the stamp can only
 * be set by verified install signals.
 */
const VERIFIED_INSTALL_KEY = 'pwa-verified-installed';

function safeLocalStorageGet(key: string): string | null {
  try {
    return typeof window !== 'undefined'
      ? window.localStorage.getItem(key)
      : null;
  } catch {
    return null;
  }
}

function safeLocalStorageSet(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // ignore
  }
}

function isMobileInstallSurface() {
  if (typeof window === 'undefined') return false;
  const coarse = window.matchMedia?.('(pointer: coarse)').matches ?? false;
  const narrow = window.matchMedia?.('(max-width: 1024px)').matches ?? false;
  const mobileUA =
    typeof navigator !== 'undefined' &&
    (Boolean(
      (navigator as Navigator & { userAgentData?: { mobile?: boolean } })
        .userAgentData?.mobile,
    ) ||
      /iphone|ipad|ipod|android|mobile/i.test(navigator.userAgent));
  return mobileUA || narrow || coarse;
}

function isIOSSafari() {
  if (typeof window === 'undefined') return false;
  const ua = navigator.userAgent;
  const isAppleMobile = /iphone|ipad|ipod/i.test(ua);
  const isSafari =
    /safari/i.test(ua) && !/crios|fxios|edgios|opios/i.test(ua);
  return isAppleMobile && isSafari;
}

/**
 * Check whether a verified install has been recorded.
 * Returns true if the user has previously installed the PWA (confirmed by
 * browser signals), meaning they're now free to use the browser too.
 */
function hasVerifiedInstall(): boolean {
  return Boolean(safeLocalStorageGet(VERIFIED_INSTALL_KEY));
}

/**
 * Record a verified install. Called only from trusted browser signals.
 */
function stampVerifiedInstall(): void {
  safeLocalStorageSet(VERIFIED_INSTALL_KEY, String(Date.now()));
}

/**
 * Full-screen gate that blocks mobile browser users until they install the PWA.
 *
 * Once the install is verified (appinstalled event or standalone mode detected),
 * a localStorage stamp is set. From that point on the user can also use the
 * browser freely — the gate never shows again on that device.
 */
export default function MobileInstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] =
    useState<BeforeInstallPromptEventLike | null>(null);
  const [installed, setInstalled] = useState(() => isInstalledPwa());
  const [verifiedInstall, setVerifiedInstall] = useState(() =>
    hasVerifiedInstall(),
  );
  const [installing, setInstalling] = useState(false);
  const [nativePromptDismissed, setNativePromptDismissed] = useState(false);

  const mobileSurface = isMobileInstallSurface();
  const iosSafari = isIOSSafari();

  useEffect(() => {
    if (typeof window === 'undefined') return;

    // If we're currently running as an installed PWA, stamp it so the user
    // can also use the browser in the future.
    if (isInstalledPwa()) {
      stampVerifiedInstall();
      setInstalled(true);
      setVerifiedInstall(true);
    }

    const handleBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      setDeferredPrompt(event as BeforeInstallPromptEventLike);
      setNativePromptDismissed(false);
    };

    const handleInstalled = () => {
      stampVerifiedInstall();
      setInstalled(true);
      setVerifiedInstall(true);
    };

    // Re-check on visibility change: after the user installs and opens from
    // the home screen, the old browser tab may still be alive. When they
    // switch back, re-evaluate.
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        const nowInstalled = isInstalledPwa();
        if (nowInstalled) {
          stampVerifiedInstall();
          setVerifiedInstall(true);
        }
        setInstalled(nowInstalled);
      }
    };

    // Sync across tabs — if the PWA tab stamps the key, browser tabs pick it up.
    const handleStorage = (e: StorageEvent) => {
      if (e.key === VERIFIED_INSTALL_KEY && e.newValue) {
        setVerifiedInstall(true);
      }
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    window.addEventListener('appinstalled', handleInstalled);
    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('storage', handleStorage);

    return () => {
      window.removeEventListener(
        'beforeinstallprompt',
        handleBeforeInstallPrompt,
      );
      window.removeEventListener('appinstalled', handleInstalled);
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('storage', handleStorage);
    };
  }, []);

  // ── Gate logic ──
  // Allow through if:
  // - Desktop browser (not mobile surface)
  // - Native app (Capacitor)
  // - Currently running as installed PWA
  // - Previously verified install exists (localStorage stamp)
  const shouldBlock =
    mobileSurface &&
    !isNativeApp() &&
    !installed &&
    !isInstalledPwa() &&
    !verifiedInstall;

  const debug =
    typeof window !== 'undefined' &&
    new URLSearchParams(window.location.search).get('pwa_debug') === '1';

  if (!shouldBlock && !debug) return null;

  const handleInstall = async () => {
    if (!deferredPrompt) return;
    setInstalling(true);
    try {
      await deferredPrompt.prompt();
      const choice = await deferredPrompt.userChoice;
      if (choice.outcome === 'accepted') {
        stampVerifiedInstall();
        setInstalled(true);
        setVerifiedInstall(true);
      } else {
        setNativePromptDismissed(true);
      }
    } finally {
      setDeferredPrompt(null);
      setInstalling(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-background/95 p-4 backdrop-blur">
      <Card className="w-full max-w-md border-primary/20 shadow-2xl">
        <CardContent className="space-y-4 p-6">
          {debug && (
            <div className="rounded-xl border border-border/60 bg-muted/30 p-3 text-[11px] text-muted-foreground">
              <div className="font-semibold text-foreground">
                PWA gate debug
              </div>
              <div className="mt-2 space-y-1 font-mono">
                <div>shouldBlock: {String(shouldBlock)}</div>
                <div>mobileSurface: {String(mobileSurface)}</div>
                <div>isNativeApp: {String(isNativeApp())}</div>
                <div>installed(state): {String(installed)}</div>
                <div>isInstalledPwa(): {String(isInstalledPwa())}</div>
                <div>verifiedInstall: {String(verifiedInstall)}</div>
                <div>
                  hasDeferredPrompt: {String(Boolean(deferredPrompt))}
                </div>
                <div>iosSafari: {String(iosSafari)}</div>
              </div>
            </div>
          )}
          <div className="flex items-center gap-3">
            <div
              className={cn(
                'flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl',
                'bg-primary/10 text-primary',
              )}
            >
              <Smartphone className="h-6 w-6" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-base font-semibold text-foreground">
                Install the app to continue
              </div>
              <div className="text-xs text-muted-foreground">
                On mobile this portal must be used as an installed app — please
                add it to your home screen.
              </div>
            </div>
          </div>

          {iosSafari ? (
            <div className="rounded-xl border border-border/60 bg-muted/30 p-3 text-xs text-muted-foreground">
              <div className="font-semibold text-foreground">
                On iPhone or iPad:
              </div>
              <ol className="mt-2 list-decimal space-y-1 ps-4">
                <li>
                  Tap the <strong>Share</strong> icon in Safari (bottom bar).
                </li>
                <li>
                  Choose <strong>Add to Home Screen</strong>.
                </li>
                <li>Open the app from your home screen.</li>
              </ol>
              <p className="mt-3 text-[11px] text-muted-foreground/70">
                This screen will disappear once you open the installed app.
              </p>
            </div>
          ) : (
            <div className="rounded-xl border border-border/60 bg-muted/30 p-3 text-xs text-muted-foreground">
              {deferredPrompt ? (
                nativePromptDismissed ? (
                  <>
                    Install was dismissed. Use your browser menu to install (⋮ →
                    Install app / Add to Home Screen), then reopen from your
                    home screen.
                    <p className="mt-2 text-[11px] text-muted-foreground/70">
                      This screen will disappear once you open the installed
                      app.
                    </p>
                  </>
                ) : (
                  'Tap Install below to add the app to your home screen.'
                )
              ) : (
                <>
                  Open your browser menu (⋮) and choose{' '}
                  <strong>Install app</strong> or{' '}
                  <strong>Add to Home Screen</strong>, then reopen from your
                  home screen.
                  <p className="mt-2 text-[11px] text-muted-foreground/70">
                    If you don't see the option, try opening this site in Chrome
                    or your default browser.
                  </p>
                </>
              )}
            </div>
          )}

          <div className="flex flex-col gap-2">
            {!iosSafari && deferredPrompt && !nativePromptDismissed && (
              <Button
                className="w-full gap-2"
                onClick={handleInstall}
                disabled={installing}
              >
                <Download className="h-4 w-4" />
                {installing ? 'Installing...' : 'Install'}
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
