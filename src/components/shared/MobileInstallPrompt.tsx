import { useEffect, useMemo, useState } from 'react';
import { Download, Smartphone } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { isInstalledPwa, isNativeApp } from '@/platform/runtime';
import { useAuth } from '@/features/auth/auth-context';

type BeforeInstallPromptEventLike = Event & {
  prompt: () => Promise<void> | void;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform?: string }>;
};

const INSTALLED_KEY = 'pwa-install-prompt-installed';

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

export default function MobileInstallPrompt() {
  const { isAuthenticated } = useAuth();
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEventLike | null>(null);
  const [installed, setInstalled] = useState(false);
  const [installing, setInstalling] = useState(false);

  const mobileSurface = useMemo(isMobileInstallSurface, []);
  const iosSafari = useMemo(isIOSSafari, []);

  useEffect(() => {
    setInstalled(isInstalledPwa());
    if (typeof window === 'undefined') return;

    const handleBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      setDeferredPrompt(event as BeforeInstallPromptEventLike);
    };

    const handleInstalled = () => {
      window.localStorage.setItem(INSTALLED_KEY, String(Date.now()));
      setInstalled(true);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    window.addEventListener('appinstalled', handleInstalled);

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      window.removeEventListener('appinstalled', handleInstalled);
    };
  }, []);

  const storedInstalled =
    typeof window !== 'undefined' ? Boolean(window.localStorage.getItem(INSTALLED_KEY)) : false;

  const shouldBlock =
    isAuthenticated &&
    mobileSurface &&
    !isNativeApp() &&
    !installed &&
    !storedInstalled &&
    !isInstalledPwa();

  // Auto-fire native prompt as soon as the browser provides it. Browsers
  // require a user gesture for prompt(), but Chrome/Edge allow it during the
  // beforeinstallprompt event handler chain after a recent interaction.
  useEffect(() => {
    if (!shouldBlock || !deferredPrompt || installing) return;
    let cancelled = false;
    const fire = async () => {
      setInstalling(true);
      try {
        await deferredPrompt.prompt();
        const choice = await deferredPrompt.userChoice;
        if (cancelled) return;
        if (choice.outcome === 'accepted') {
          window.localStorage.setItem(INSTALLED_KEY, String(Date.now()));
          setInstalled(true);
        }
      } catch {
        // User dismissed or browser blocked — fall back to manual button.
      } finally {
        if (!cancelled) setInstalling(false);
      }
    };
    void fire();
    return () => {
      cancelled = true;
    };
  }, [shouldBlock, deferredPrompt, installing]);

  if (!shouldBlock) return null;

  const handleInstall = async () => {
    if (!deferredPrompt) return;
    setInstalling(true);
    try {
      await deferredPrompt.prompt();
      const choice = await deferredPrompt.userChoice;
      if (choice.outcome === 'accepted') {
        window.localStorage.setItem(INSTALLED_KEY, String(Date.now()));
        setInstalled(true);
      }
    } finally {
      setInstalling(false);
    }
  };

  const handleAlreadyInstalled = () => {
    window.localStorage.setItem(INSTALLED_KEY, String(Date.now()));
    setInstalled(true);
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-background/95 p-4 backdrop-blur">
      <Card className="w-full max-w-md border-primary/20 shadow-2xl">
        <CardContent className="space-y-4 p-6">
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
              <div className="text-base font-semibold text-foreground">Install the app to continue</div>
              <div className="text-xs text-muted-foreground">
                On mobile this portal must be used as an installed app — please add it to your home screen.
              </div>
            </div>
          </div>

          {iosSafari ? (
            <div className="rounded-xl border border-border/60 bg-muted/30 p-3 text-xs text-muted-foreground">
              <div className="font-semibold text-foreground">On iPhone or iPad:</div>
              <ol className="mt-2 space-y-1 list-decimal ps-4">
                <li>Tap the Share icon in Safari.</li>
                <li>Choose Add to Home Screen.</li>
                <li>Open the app from your home screen.</li>
              </ol>
            </div>
          ) : (
            <div className="rounded-xl border border-border/60 bg-muted/30 p-3 text-xs text-muted-foreground">
              {deferredPrompt
                ? 'Tap Install below to add the app to your home screen.'
                : 'If your browser does not show an install option, open this site in Chrome or your default browser and try again.'}
            </div>
          )}

          <div className="flex flex-col gap-2">
            {!iosSafari && (
              <Button className="w-full gap-2" onClick={handleInstall} disabled={!deferredPrompt || installing}>
                <Download className="h-4 w-4" />
                {installing ? 'Installing...' : deferredPrompt ? 'Install' : 'Waiting for browser...'}
              </Button>
            )}
            <Button variant="outline" className="w-full" onClick={handleAlreadyInstalled}>
              I've already installed it
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
