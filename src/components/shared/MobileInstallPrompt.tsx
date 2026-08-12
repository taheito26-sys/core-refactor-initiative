import { useEffect, useState } from "react";
import { Download, Smartphone, Monitor, CheckCircle2, Share, PlusSquare, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { isInstalledPwa, isNativeApp } from "@/platform/runtime";

type BeforeInstallPromptEventLike = Event & {
  prompt: () => Promise<void> | void;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform?: string }>;
};

const VERIFIED_INSTALL_KEY = "pwa-verified-installed";
const SKIP_INSTALL_KEY = "pwa-install-skipped";

function safeLocalStorageGet(key: string): string | null {
  try {
    return typeof window !== "undefined" ? window.localStorage.getItem(key) : null;
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

function detectPlatform() {
  if (typeof window === "undefined") return { isIOS: false, isAndroid: false, isDesktop: true };
  const ua = navigator.userAgent;
  const isIOS = /iphone|ipad|ipod/i.test(ua);
  const isAndroid = /android/i.test(ua);
  const isDesktop = !isIOS && !isAndroid;
  return { isIOS, isAndroid, isDesktop };
}

function hasVerifiedInstall(): boolean {
  return Boolean(safeLocalStorageGet(VERIFIED_INSTALL_KEY));
}

function stampVerifiedInstall(): void {
  safeLocalStorageSet(VERIFIED_INSTALL_KEY, String(Date.now()));
}

export default function MobileInstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEventLike | null>(null);
  const [installed, setInstalled] = useState(() => isInstalledPwa());
  const [verifiedInstall, setVerifiedInstall] = useState(() => hasVerifiedInstall());
  const [skipped, setSkipped] = useState(() => Boolean(safeLocalStorageGet(SKIP_INSTALL_KEY)));
  const [installing, setInstalling] = useState(false);
  const [nativePromptDismissed, setNativePromptDismissed] = useState(false);

  const { isIOS, isAndroid, isDesktop } = detectPlatform();

  useEffect(() => {
    if (typeof window === "undefined") return;

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

    const handleVisibility = () => {
      if (document.visibilityState === "visible") {
        const nowInstalled = isInstalledPwa();
        if (nowInstalled) {
          stampVerifiedInstall();
          setVerifiedInstall(true);
        }
        setInstalled(nowInstalled);
      }
    };

    const handleStorage = (e: StorageEvent) => {
      if (e.key === VERIFIED_INSTALL_KEY && e.newValue) {
        setVerifiedInstall(true);
      }
    };

    window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
    window.addEventListener("appinstalled", handleInstalled);
    document.addEventListener("visibilitychange", handleVisibility);
    window.addEventListener("storage", handleStorage);

    return () => {
      window.removeEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
      window.removeEventListener("appinstalled", handleInstalled);
      document.removeEventListener("visibilitychange", handleVisibility);
      window.removeEventListener("storage", handleStorage);
    };
  }, []);

  const shouldBlock =
    !isNativeApp() &&
    !installed &&
    !isInstalledPwa() &&
    !verifiedInstall &&
    !skipped;

  const debug =
    typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).get("pwa_debug") === "1";

  if (!shouldBlock && !debug) return null;

  const handleInstall = async () => {
    if (!deferredPrompt) return;
    setInstalling(true);
    try {
      await deferredPrompt.prompt();
      const choice = await deferredPrompt.userChoice;
      if (choice.outcome === "accepted") {
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
        <CardContent className="space-y-5 p-6">
          {debug && (
            <div className="rounded-xl border border-border/60 bg-muted/30 p-3 text-[11px] text-muted-foreground">
              <div className="font-semibold text-foreground">PWA Installation Debug</div>
              <div className="mt-2 space-y-1 font-mono">
                <div>shouldBlock: {String(shouldBlock)}</div>
                <div>isDesktop: {String(isDesktop)}</div>
                <div>isIOS: {String(isIOS)}</div>
                <div>isAndroid: {String(isAndroid)}</div>
                <div>isNativeApp: {String(isNativeApp())}</div>
                <div>isInstalledPwa: {String(isInstalledPwa())}</div>
                <div>verifiedInstall: {String(verifiedInstall)}</div>
                <div>hasDeferredPrompt: {String(Boolean(deferredPrompt))}</div>
              </div>
            </div>
          )}

          <div className="flex items-center gap-3">
            <div
              className={cn(
                "flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl",
                "bg-primary/10 text-primary"
              )}
            >
              {isDesktop ? <Monitor className="h-6 w-6" /> : <Smartphone className="h-6 w-6" />}
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-base font-bold text-foreground">
                Install Core Refactor App
              </div>
              <div className="text-xs text-muted-foreground">
                {isDesktop
                  ? "Install as a desktop application for offline access and native desk experience."
                  : "Add this portal to your home screen for the full app experience."}
              </div>
            </div>
          </div>

          {/* Platform Specific Guidance */}
          {isIOS ? (
            <div className="rounded-xl border border-border/60 bg-muted/30 p-4 text-xs text-muted-foreground space-y-2">
              <div className="font-semibold text-foreground flex items-center gap-1.5">
                <Share className="h-4 w-4 text-primary" />
                iOS (iPhone / iPad) Installation Steps:
              </div>
              <ol className="list-decimal space-y-1.5 ps-4 font-medium">
                <li>
                  Tap the <strong>Share</strong> button at the bottom of Safari.
                </li>
                <li>
                  Scroll down and select <strong>Add to Home Screen</strong> (<PlusSquare className="inline h-3.5 w-3.5" />).
                </li>
                <li>
                  Tap <strong>Add</strong> in the top right to launch from your home screen.
                </li>
              </ol>
            </div>
          ) : isAndroid ? (
            <div className="rounded-xl border border-border/60 bg-muted/30 p-4 text-xs text-muted-foreground space-y-2">
              <div className="font-semibold text-foreground flex items-center gap-1.5">
                <Smartphone className="h-4 w-4 text-primary" />
                Android App Installation:
              </div>
              {deferredPrompt ? (
                <p className="font-medium">
                  Tap the <strong>Install</strong> button below to automatically add the app to your device.
                </p>
              ) : (
                <p className="font-medium">
                  Open your browser menu (<strong>⋮</strong>) and tap <strong>Install App</strong> or <strong>Add to Home Screen</strong>.
                </p>
              )}
            </div>
          ) : (
            <div className="rounded-xl border border-border/60 bg-muted/30 p-4 text-xs text-muted-foreground space-y-2">
              <div className="font-semibold text-foreground flex items-center gap-1.5">
                <Monitor className="h-4 w-4 text-primary" />
                Desktop App Installation (Windows / Mac / Linux):
              </div>
              {deferredPrompt ? (
                <p className="font-medium">
                  Click <strong>Install Desktop App</strong> below to launch as a standalone desktop application.
                </p>
              ) : (
                <ol className="list-decimal space-y-1.5 ps-4 font-medium">
                  <li>
                    Look at your browser's address bar (top right corner).
                  </li>
                  <li>
                    Click the <strong>Install / App icon</strong> (<Download className="inline h-3.5 w-3.5 text-primary" />).
                  </li>
                  <li>
                    Click <strong>Install</strong> to add to your desktop/dock.
                  </li>
                </ol>
              )}
            </div>
          )}

          <div className="flex flex-col gap-2 pt-1">
            {deferredPrompt && !nativePromptDismissed && (
              <Button
                className="w-full gap-2 font-bold shadow-md"
                onClick={handleInstall}
                disabled={installing}
              >
                <Download className="h-4 w-4" />
                {installing ? "Installing App..." : isDesktop ? "Install Desktop App" : "Install App"}
              </Button>
            )}

            <Button
              variant="ghost"
              className="w-full text-xs text-muted-foreground hover:text-foreground"
              onClick={() => {
                safeLocalStorageSet(SKIP_INSTALL_KEY, String(Date.now()));
                setSkipped(true);
              }}
            >
              Continue in browser
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
