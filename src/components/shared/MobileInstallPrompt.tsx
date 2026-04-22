import { useEffect, useMemo, useState } from 'react';
import { Download, Smartphone, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { isInstalledPwa, isNativeApp } from '@/platform/runtime';

type BeforeInstallPromptEventLike = Event & {
  prompt: () => Promise<void> | void;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform?: string }>;
};

const DISMISS_KEY = 'pwa-install-prompt-dismissed-at';
const INSTALLED_KEY = 'pwa-install-prompt-installed';
const REPROMPT_AFTER_MS = 7 * 24 * 60 * 60 * 1000;

function isMobileInstallSurface() {
  if (typeof window === 'undefined') return false;

  const coarse = window.matchMedia?.('(pointer: coarse)').matches ?? false;
  const narrow = window.matchMedia?.('(max-width: 1024px)').matches ?? false;
  const mobileUA =
    typeof navigator !== 'undefined' &&
    (Boolean((navigator as Navigator & { userAgentData?: { mobile?: boolean } }).userAgentData?.mobile) ||
      /iphone|ipad|ipod|android|mobile/i.test(navigator.userAgent));

  return coarse && (narrow || mobileUA);
}

function isIOSSafari() {
  if (typeof window === 'undefined') return false;
  const ua = navigator.userAgent;
  const isAppleMobile = /iphone|ipad|ipod/i.test(ua);
  const isSafari = /safari/i.test(ua) && !/crios|fxios|edgios|opios/i.test(ua);
  return isAppleMobile && isSafari;
}

export function shouldShowMobileInstallPrompt(params: {
  isInstalled: boolean;
  isNative: boolean;
  isMobile: boolean;
  hasDeferredPrompt: boolean;
  isIOS: boolean;
  dismissedAt: number | null;
  now: number;
}) {
  if (params.isInstalled || params.isNative || !params.isMobile) return false;
  if (params.dismissedAt && params.now - params.dismissedAt < REPROMPT_AFTER_MS) return false;
  return params.hasDeferredPrompt || params.isIOS;
}

export default function MobileInstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEventLike | null>(null);
  const [installed, setInstalled] = useState(false);
  const [dismissedAt, setDismissedAt] = useState<number | null>(null);
  const [visible, setVisible] = useState(false);
  const [installing, setInstalling] = useState(false);

  const mobileSurface = useMemo(isMobileInstallSurface, []);
  const iosSafari = useMemo(isIOSSafari, []);

  useEffect(() => {
    setInstalled(isInstalledPwa());
    if (typeof window === 'undefined') return;

    const rawDismiss = window.localStorage.getItem(DISMISS_KEY);
    const parsedDismiss = rawDismiss ? Number(rawDismiss) : null;
    setDismissedAt(Number.isFinite(parsedDismiss ?? NaN) ? parsedDismiss : null);

    const handleBeforeInstallPrompt = (event: Event) => {
      const promptEvent = event as BeforeInstallPromptEventLike;
      event.preventDefault();
      setDeferredPrompt(promptEvent);
    };

    const handleInstalled = () => {
      window.localStorage.setItem(INSTALLED_KEY, String(Date.now()));
      window.localStorage.removeItem(DISMISS_KEY);
      setInstalled(true);
      setVisible(false);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    window.addEventListener('appinstalled', handleInstalled);

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      window.removeEventListener('appinstalled', handleInstalled);
    };
  }, []);

  useEffect(() => {
    const storedInstalled =
      typeof window !== 'undefined' ? Boolean(window.localStorage.getItem(INSTALLED_KEY)) : false;
    const shouldShow = shouldShowMobileInstallPrompt({
      isInstalled: installed || storedInstalled,
      isNative: isNativeApp(),
      isMobile: mobileSurface,
      hasDeferredPrompt: Boolean(deferredPrompt),
      isIOS: iosSafari,
      dismissedAt,
      now: Date.now(),
    });

    if (!shouldShow) {
      setVisible(false);
      return;
    }

    const timer = window.setTimeout(() => setVisible(true), 1200);
    return () => window.clearTimeout(timer);
  }, [deferredPrompt, dismissedAt, installed, iosSafari, mobileSurface]);

  const handleDismiss = () => {
    const now = Date.now();
    setDismissedAt(now);
    setVisible(false);
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(DISMISS_KEY, String(now));
    }
  };

  const handleInstall = async () => {
    if (!deferredPrompt) {
      handleDismiss();
      return;
    }

    setInstalling(true);
    try {
      await deferredPrompt.prompt();
      const choice = await deferredPrompt.userChoice;
      if (choice.outcome === 'accepted') {
        if (typeof window !== 'undefined') {
          window.localStorage.setItem(INSTALLED_KEY, String(Date.now()));
          window.localStorage.removeItem(DISMISS_KEY);
        }
        setVisible(false);
      } else {
        handleDismiss();
      }
    } finally {
      setInstalling(false);
    }
  };

  if (!visible) return null;

  return (
    <div className="fixed inset-x-4 bottom-4 z-50 mx-auto max-w-md">
      <Card className="border-primary/20 bg-card/95 shadow-2xl backdrop-blur">
        <CardContent className="space-y-4 p-4">
          <div className="flex items-start gap-3">
            <div className={cn(
              'mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl',
              'bg-primary/10 text-primary',
            )}>
              <Smartphone className="h-5 w-5" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold text-foreground">Install the app</div>
              <div className="text-xs text-muted-foreground">
                Add the portal to your home screen for quicker access and a cleaner mobile experience.
              </div>
            </div>
            <button
              onClick={handleDismiss}
              className="rounded-full p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
              aria-label="Dismiss install prompt"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {iosSafari ? (
            <div className="rounded-xl border border-border/60 bg-muted/30 p-3 text-xs text-muted-foreground">
              <div className="font-semibold text-foreground">On iPhone or iPad:</div>
              <ol className="mt-2 space-y-1 list-decimal ps-4">
                <li>Open the browser share menu.</li>
                <li>Tap Add to Home Screen.</li>
              </ol>
            </div>
          ) : (
            <div className="rounded-xl border border-border/60 bg-muted/30 p-3 text-xs text-muted-foreground">
              {deferredPrompt ? 'Your browser is ready to install this app.' : 'Installation will appear when your browser makes it available.'}
            </div>
          )}

          <div className="flex gap-2">
            <Button className="flex-1 gap-2" onClick={handleInstall} disabled={!deferredPrompt || installing}>
              <Download className="h-4 w-4" />
              {deferredPrompt ? (installing ? 'Installing...' : 'Install') : 'Ready soon'}
            </Button>
            <Button variant="outline" onClick={handleDismiss}>
              Not now
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
