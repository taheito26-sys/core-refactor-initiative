/**
 * Install gate policy.
 *
 * Decides whether the app must block the UI until it is running as an
 * installed app (Capacitor native shell or an installed PWA launched from the
 * home screen).
 *
 * Policy:
 * - Native shell / installed PWA  → no gate at all.
 * - Mobile browser (iOS/Android)  → HARD gate: install is mandatory, there is
 *   no "continue in browser" escape and a previously stored skip is ignored.
 * - Desktop browser               → SOFT gate: install is encouraged, the user
 *   may continue in the browser.
 *
 * The mobile enforcement can be switched off at build time with
 * `VITE_FORCE_MOBILE_INSTALL=false` (kill switch for browsers that cannot
 * install a PWA at all).
 */

export type DeviceKind = "ios" | "android" | "desktop";

/** How strongly the gate is applied for the current runtime. */
export type GateEnforcement = "none" | "soft" | "hard";

/**
 * What the user still has to do:
 * - `install`         → the app is not installed yet.
 * - `awaiting-launch` → installation was confirmed, but this tab is still a
 *   browser tab; the user must reopen the app from the home screen.
 */
export type GateStage = "install" | "awaiting-launch";

export interface InstallGateInput {
  /**
   * Whether a user session is active. The gate only runs after login — an
   * anonymous visitor must be able to reach the login screen, and there is
   * nothing to protect until someone is signed in.
   */
  isAuthenticated: boolean;
  deviceKind: DeviceKind;
  /** Running inside the Capacitor native shell. */
  isNative: boolean;
  /** Running as an installed PWA (standalone display mode). */
  isStandalone: boolean;
  /** A previous `appinstalled` event / verified install was recorded. */
  verifiedInstall: boolean;
  /** The user previously chose "continue in browser". */
  skipped: boolean;
  /** Whether mandatory mobile installation is enabled. */
  enforceMobile: boolean;
}

export interface InstallGateDecision {
  /** Render the blocking install screen. */
  blocked: boolean;
  enforcement: GateEnforcement;
  stage: GateStage;
  /** The user may bypass the gate and keep using the browser. */
  canContinueInBrowser: boolean;
}

const IN_APP_BROWSER_PATTERNS = [
  /FBAN|FBAV|FB_IAB/i, // Facebook
  /Instagram/i,
  /Messenger/i,
  /Line\//i,
  /Twitter/i,
  /WhatsApp/i,
  /Snapchat/i,
  /TikTok|BytedanceWebview/i,
  /GSA\//i, // Google app
  /; wv\)/i, // generic Android WebView
];

export function detectDeviceKind(userAgent: string): DeviceKind {
  if (/iphone|ipod/i.test(userAgent)) return "ios";
  if (/ipad/i.test(userAgent)) return "ios";
  // iPadOS 13+ reports a desktop Safari UA; touch points disambiguate it.
  if (
    /macintosh/i.test(userAgent) &&
    typeof navigator !== "undefined" &&
    (navigator.maxTouchPoints ?? 0) > 1
  ) {
    return "ios";
  }
  if (/android/i.test(userAgent)) return "android";
  return "desktop";
}

export function isMobileDevice(deviceKind: DeviceKind): boolean {
  return deviceKind === "ios" || deviceKind === "android";
}

/**
 * Embedded browsers (Facebook, Instagram, Android WebView, …) cannot install a
 * PWA, so the gate has to tell the user to reopen the link in Chrome/Safari.
 */
export function isInAppBrowser(userAgent: string): boolean {
  return IN_APP_BROWSER_PATTERNS.some((pattern) => pattern.test(userAgent));
}

/** Chromium-based Edge on any platform (`Edg/`, `EdgA/`, `EdgiOS/`). */
export function isEdgeBrowser(userAgent: string): boolean {
  return /Edg(A|iOS)?\//.test(userAgent);
}

/**
 * Edge on Android. Its "Add to phone" path can produce a plain home-screen
 * shortcut rather than a real installed app (no WebAPK), which still opens in
 * a browser tab and therefore never satisfies the gate. When Edge does not
 * offer a real install prompt we hand the user off to Chrome.
 */
export function isEdgeAndroid(userAgent: string): boolean {
  return /EdgA\//.test(userAgent);
}

/**
 * Builds an Android intent URL that reopens the current page in Chrome, which
 * mints a real WebAPK install instead of a shortcut.
 */
export function buildChromeIntentUrl(href: string): string | null {
  try {
    const parsed = new URL(href);
    if (parsed.protocol !== "https:") return null;
    return `intent://${parsed.host}${parsed.pathname}${parsed.search}#Intent;scheme=https;package=com.android.chrome;end`;
  } catch {
    return null;
  }
}

type RelatedApplication = { platform?: string; id?: string; url?: string };

type NavigatorWithRelatedApps = Navigator & {
  getInstalledRelatedApps?: () => Promise<RelatedApplication[]>;
};

/**
 * Asks the browser whether this PWA (or the companion Android app) is already
 * installed on the device. This is the only reliable signal from inside a
 * normal browser tab — `display-mode: standalone` is false there even when the
 * app *is* installed, which is why a plain re-check kept reporting "not
 * installed". Requires `related_applications` in the manifest; resolves false
 * where the API is unavailable (notably iOS Safari).
 */
export async function detectRelatedAppInstalled(): Promise<boolean> {
  if (typeof navigator === "undefined") return false;
  const nav = navigator as NavigatorWithRelatedApps;
  if (typeof nav.getInstalledRelatedApps !== "function") return false;

  try {
    const apps = await nav.getInstalledRelatedApps();
    return Array.isArray(apps) && apps.length > 0;
  } catch {
    return false;
  }
}

/** Reads the build-time kill switch; mobile enforcement is on by default. */
export function isMobileInstallEnforced(): boolean {
  const raw = import.meta.env?.VITE_FORCE_MOBILE_INSTALL;
  if (raw === undefined || raw === null || raw === "") return true;
  const value = String(raw).toLowerCase();
  return value !== "false" && value !== "0" && value !== "off";
}

export function evaluateInstallGate(input: InstallGateInput): InstallGateDecision {
  const { isAuthenticated, deviceKind, isNative, isStandalone, verifiedInstall, skipped, enforceMobile } =
    input;

  // Before login the gate stays out of the way: the user has to be able to
  // reach and complete the sign-in flow in the browser.
  // Already running as an app — never gate either.
  if (!isAuthenticated || isNative || isStandalone) {
    return {
      blocked: false,
      enforcement: "none",
      stage: "install",
      canContinueInBrowser: true,
    };
  }

  const mobile = isMobileDevice(deviceKind);

  if (mobile && enforceMobile) {
    // Mandatory: neither a stored skip nor a recorded install lets the user
    // stay in the mobile browser — they must relaunch from the home screen.
    return {
      blocked: true,
      enforcement: "hard",
      stage: verifiedInstall ? "awaiting-launch" : "install",
      canContinueInBrowser: false,
    };
  }

  // Desktop (and mobile when enforcement is disabled): encourage, don't force.
  return {
    blocked: !verifiedInstall && !skipped,
    enforcement: "soft",
    stage: verifiedInstall ? "awaiting-launch" : "install",
    canContinueInBrowser: true,
  };
}
