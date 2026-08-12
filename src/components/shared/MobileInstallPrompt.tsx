import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Download,
  Smartphone,
  Monitor,
  Share,
  PlusSquare,
  CheckCircle2,
  Copy,
  RefreshCw,
  Compass,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { isInstalledPwa, isNativeApp } from "@/platform/runtime";
import { useAuth } from "@/features/auth/auth-context";
import {
  buildChromeIntentUrl,
  detectDeviceKind,
  detectRelatedAppInstalled,
  evaluateInstallGate,
  isEdgeAndroid,
  isInAppBrowser,
  isMobileDevice,
  isMobileInstallEnforced,
} from "@/platform/install-gate";

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

function safeLocalStorageRemove(key: string): void {
  try {
    window.localStorage.removeItem(key);
  } catch {
    // ignore
  }
}

function hasVerifiedInstall(): boolean {
  return Boolean(safeLocalStorageGet(VERIFIED_INSTALL_KEY));
}

function stampVerifiedInstall(): void {
  safeLocalStorageSet(VERIFIED_INSTALL_KEY, String(Date.now()));
}

export default function MobileInstallPrompt() {
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEventLike | null>(null);
  const [standalone, setStandalone] = useState(() => isInstalledPwa());
  const [verifiedInstall, setVerifiedInstall] = useState(() => hasVerifiedInstall());
  const [skipped, setSkipped] = useState(() => Boolean(safeLocalStorageGet(SKIP_INSTALL_KEY)));
  const [installing, setInstalling] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);
  const [rechecking, setRechecking] = useState(false);
  const [recheckFoundNothing, setRecheckFoundNothing] = useState(false);
  // Kept in a ref so the `beforeinstallprompt` listener (registered once) can
  // read the latest value without being torn down and re-registered.
  const relatedAppInstalledRef = useRef(false);

  const userAgent = typeof navigator === "undefined" ? "" : navigator.userAgent;
  const deviceKind = useMemo(() => detectDeviceKind(userAgent), [userAgent]);
  const embeddedBrowser = useMemo(() => isInAppBrowser(userAgent), [userAgent]);
  const edgeAndroid = useMemo(() => isEdgeAndroid(userAgent), [userAgent]);
  const chromeIntentUrl = useMemo(
    () => (typeof window === "undefined" ? null : buildChromeIntentUrl(window.location.href)),
    [],
  );

  const isIOS = deviceKind === "ios";
  const isAndroid = deviceKind === "android";
  const isDesktop = deviceKind === "desktop";
  const mobile = isMobileDevice(deviceKind);

  const gate = evaluateInstallGate({
    isAuthenticated: isAuthenticated && !authLoading,
    deviceKind,
    isNative: isNativeApp(),
    isStandalone: standalone,
    verifiedInstall,
    skipped,
    enforceMobile: isMobileInstallEnforced(),
  });

  // Asks the browser whether the app is installed. `display-mode` is always
  // `browser` inside a normal tab, so an installed app can only be recognised
  // via `getInstalledRelatedApps()` — without it a re-check kept answering
  // "not installed" for users who had already installed the app.
  const syncInstallState = useCallback(async () => {
    const nowStandalone = isInstalledPwa();
    if (nowStandalone) {
      setStandalone(true);
      stampVerifiedInstall();
      setVerifiedInstall(true);
      return true;
    }

    const related = await detectRelatedAppInstalled();
    relatedAppInstalledRef.current = related;
    if (related) {
      stampVerifiedInstall();
      setVerifiedInstall(true);
    }
    return related;
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;

    void syncInstallState();

    const handleBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      setDeferredPrompt(event as BeforeInstallPromptEventLike);
      // Chrome/Edge only fire this while the app is NOT installed, so a stored
      // stamp is stale (the app was uninstalled) — unless the browser itself
      // still reports the app as installed, which wins.
      if (!relatedAppInstalledRef.current) {
        safeLocalStorageRemove(VERIFIED_INSTALL_KEY);
        setVerifiedInstall(false);
      }
    };

    const handleInstalled = () => {
      stampVerifiedInstall();
      setVerifiedInstall(true);
      setDeferredPrompt(null);
    };

    const handleVisibility = () => {
      if (document.visibilityState === "visible") {
        void syncInstallState();
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
  }, [syncInstallState]);

  // A stored "continue in browser" choice must never weaken the mobile gate.
  useEffect(() => {
    if (gate.enforcement === "hard" && skipped) {
      safeLocalStorageRemove(SKIP_INSTALL_KEY);
      setSkipped(false);
    }
  }, [gate.enforcement, skipped]);

  const handleInstall = useCallback(async () => {
    if (!deferredPrompt) return;
    setInstalling(true);
    try {
      await deferredPrompt.prompt();
      const choice = await deferredPrompt.userChoice;
      if (choice.outcome === "accepted") {
        stampVerifiedInstall();
        setVerifiedInstall(true);
        setDeferredPrompt(null);
      }
      // A dismissed choice keeps the gate up; Chrome will re-fire
      // `beforeinstallprompt` so the button stays available on mobile.
    } finally {
      setInstalling(false);
    }
  }, [deferredPrompt]);

  const handleRecheck = useCallback(async () => {
    setRechecking(true);
    setRecheckFoundNothing(false);
    try {
      const found = await syncInstallState();
      setRecheckFoundNothing(!found);
    } finally {
      setRechecking(false);
    }
  }, [syncInstallState]);

  const handleCopyLink = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setLinkCopied(true);
      window.setTimeout(() => setLinkCopied(false), 2500);
    } catch {
      // clipboard unavailable — the URL is shown on screen as a fallback
    }
  }, []);

  const debug =
    typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).get("pwa_debug") === "1";

  if (!gate.blocked && !debug) return null;

  const awaitingLaunch = gate.stage === "awaiting-launch" && !deferredPrompt;
  const mandatory = gate.enforcement === "hard";

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-background/95 p-4 backdrop-blur"
      role="dialog"
      aria-modal="true"
      aria-labelledby="install-gate-title"
    >
      <Card className="w-full max-w-md border-primary/20 shadow-2xl">
        <CardContent className="space-y-5 p-6">
          {debug && (
            <div className="rounded-xl border border-border/60 bg-muted/30 p-3 text-[11px] text-muted-foreground">
              <div className="font-semibold text-foreground">PWA Installation Debug</div>
              <div className="mt-2 space-y-1 font-mono">
                <div>blocked: {String(gate.blocked)}</div>
                <div>isAuthenticated: {String(isAuthenticated)}</div>
                <div>authLoading: {String(authLoading)}</div>
                <div>enforcement: {gate.enforcement}</div>
                <div>stage: {gate.stage}</div>
                <div>deviceKind: {deviceKind}</div>
                <div>inAppBrowser: {String(embeddedBrowser)}</div>
                <div>isNativeApp: {String(isNativeApp())}</div>
                <div>isInstalledPwa: {String(isInstalledPwa())}</div>
                <div>verifiedInstall: {String(verifiedInstall)}</div>
                <div>skipped: {String(skipped)}</div>
                <div>hasDeferredPrompt: {String(Boolean(deferredPrompt))}</div>
                <div>relatedAppInstalled: {String(relatedAppInstalledRef.current)}</div>
                <div>edgeAndroid: {String(edgeAndroid)}</div>
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
              {awaitingLaunch ? (
                <CheckCircle2 className="h-6 w-6" />
              ) : isDesktop ? (
                <Monitor className="h-6 w-6" />
              ) : (
                <Smartphone className="h-6 w-6" />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <div id="install-gate-title" className="text-base font-bold text-foreground">
                {awaitingLaunch ? "Open The Tracker app" : "Install The Tracker app"}
              </div>
              <div className="text-xs text-muted-foreground">
                {awaitingLaunch
                  ? "The app is installed on this device. Launch it from your home screen to continue."
                  : mandatory
                    ? "The Tracker must be installed as an app on mobile devices. Install it to continue."
                    : isDesktop
                      ? "Install as a desktop application for offline access and a native desk experience."
                      : "Add this portal to your home screen for the full app experience."}
              </div>
            </div>
          </div>

          {/* Platform specific guidance */}
          {awaitingLaunch ? (
            <div className="rounded-xl border border-border/60 bg-muted/30 p-4 text-xs text-muted-foreground space-y-2">
              <div className="font-semibold text-foreground flex items-center gap-1.5">
                <CheckCircle2 className="h-4 w-4 text-primary" />
                Installation complete
              </div>
              <p className="font-medium">
                Close this browser tab and tap the <strong>The Tracker</strong> icon on your home
                screen. The browser version stays locked on mobile.
              </p>
            </div>
          ) : embeddedBrowser && mobile ? (
            <div className="rounded-xl border border-border/60 bg-muted/30 p-4 text-xs text-muted-foreground space-y-2">
              <div className="font-semibold text-foreground flex items-center gap-1.5">
                <Compass className="h-4 w-4 text-primary" />
                Open in your browser first
              </div>
              <p className="font-medium">
                In-app browsers cannot install apps. Open this link in{" "}
                <strong>{isIOS ? "Safari" : "Chrome"}</strong> — use the menu (
                <strong>⋯</strong>) and tap <strong>Open in browser</strong> — then install from
                there.
              </p>
              <p className="break-all font-mono text-[11px]">
                {typeof window !== "undefined" ? window.location.href : ""}
              </p>
            </div>
          ) : isIOS ? (
            <div className="rounded-xl border border-border/60 bg-muted/30 p-4 text-xs text-muted-foreground space-y-2">
              <div className="font-semibold text-foreground flex items-center gap-1.5">
                <Share className="h-4 w-4 text-primary" />
                iOS (iPhone / iPad) installation steps:
              </div>
              <ol className="list-decimal space-y-1.5 ps-4 font-medium">
                <li>
                  Tap the <strong>Share</strong> button at the bottom of Safari.
                </li>
                <li>
                  Scroll down and select <strong>Add to Home Screen</strong> (
                  <PlusSquare className="inline h-3.5 w-3.5" />
                  ).
                </li>
                <li>
                  Tap <strong>Add</strong>, then launch The Tracker from your home screen.
                </li>
              </ol>
            </div>
          ) : edgeAndroid && !deferredPrompt ? (
            <div className="rounded-xl border border-border/60 bg-muted/30 p-4 text-xs text-muted-foreground space-y-2">
              <div className="font-semibold text-foreground flex items-center gap-1.5">
                <Compass className="h-4 w-4 text-primary" />
                Edge can only add a shortcut here
              </div>
              <p className="font-medium">
                Edge&rsquo;s <strong>Add to phone</strong> creates a home-screen shortcut that still
                opens in the browser — it is not an installed app. Open this page in{" "}
                <strong>Chrome</strong> and install from there to get the real app.
              </p>
              <p className="font-medium">
                In Edge you can also use menu (<strong>⋯</strong>) &rarr;{" "}
                <strong>Open in another app</strong> &rarr; <strong>Chrome</strong>.
              </p>
            </div>
          ) : isAndroid ? (
            <div className="rounded-xl border border-border/60 bg-muted/30 p-4 text-xs text-muted-foreground space-y-2">
              <div className="font-semibold text-foreground flex items-center gap-1.5">
                <Smartphone className="h-4 w-4 text-primary" />
                Android app installation:
              </div>
              {deferredPrompt ? (
                <p className="font-medium">
                  Tap <strong>Install App</strong> below, then open The Tracker from your home
                  screen.
                </p>
              ) : (
                <p className="font-medium">
                  Open your browser menu (<strong>⋮</strong>) and tap <strong>Install app</strong>{" "}
                  or <strong>Add to Home screen</strong>, then launch it from your home screen.
                </p>
              )}
            </div>
          ) : (
            <div className="rounded-xl border border-border/60 bg-muted/30 p-4 text-xs text-muted-foreground space-y-2">
              <div className="font-semibold text-foreground flex items-center gap-1.5">
                <Monitor className="h-4 w-4 text-primary" />
                Desktop app installation (Windows / Mac / Linux):
              </div>
              {deferredPrompt ? (
                <p className="font-medium">
                  Click <strong>Install Desktop App</strong> below to launch as a standalone desktop
                  application.
                </p>
              ) : (
                <ol className="list-decimal space-y-1.5 ps-4 font-medium">
                  <li>Look at your browser's address bar (top right corner).</li>
                  <li>
                    Click the <strong>Install / App icon</strong> (
                    <Download className="inline h-3.5 w-3.5 text-primary" />
                    ).
                  </li>
                  <li>
                    Click <strong>Install</strong> to add to your desktop/dock.
                  </li>
                </ol>
              )}
            </div>
          )}

          <div className="flex flex-col gap-2 pt-1">
            {deferredPrompt && (
              <Button
                className="w-full gap-2 font-bold shadow-md"
                onClick={handleInstall}
                disabled={installing}
              >
                <Download className="h-4 w-4" />
                {installing ? "Installing App..." : isDesktop ? "Install Desktop App" : "Install App"}
              </Button>
            )}

            {((embeddedBrowser && mobile) || edgeAndroid) && !awaitingLaunch && chromeIntentUrl && (
              <Button asChild variant="outline" className="w-full gap-2">
                <a href={chromeIntentUrl}>
                  <Compass className="h-4 w-4" />
                  Open in Chrome to install
                </a>
              </Button>
            )}

            {embeddedBrowser && mobile && !awaitingLaunch && (
              <Button variant="outline" className="w-full gap-2" onClick={handleCopyLink}>
                <Copy className="h-4 w-4" />
                {linkCopied ? "Link copied" : "Copy link"}
              </Button>
            )}

            {mandatory ? (
              <div className="space-y-1.5">
                <Button
                  variant="ghost"
                  className="w-full gap-2 text-xs text-muted-foreground hover:text-foreground"
                  onClick={handleRecheck}
                  disabled={rechecking}
                >
                  <RefreshCw className={cn("h-3.5 w-3.5", rechecking && "animate-spin")} />
                  {rechecking ? "Checking..." : "I've installed it — recheck"}
                </Button>
                {recheckFoundNothing && (
                  <p className="text-center text-[11px] text-muted-foreground">
                    Still not detected. A home-screen <strong>shortcut</strong> is not an install —{" "}
                    {isIOS ? (
                      <>
                        use <strong>Share</strong> &rarr; <strong>Add to Home Screen</strong> in
                        Safari, then open The Tracker from your home screen.
                      </>
                    ) : (
                      <>
                        use <strong>Install app</strong> in Chrome, then tap recheck again.
                      </>
                    )}
                  </p>
                )}
              </div>
            ) : (
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
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
