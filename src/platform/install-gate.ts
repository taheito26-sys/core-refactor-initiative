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

/** Reads the build-time kill switch; mobile enforcement is on by default. */
export function isMobileInstallEnforced(): boolean {
  const raw = import.meta.env?.VITE_FORCE_MOBILE_INSTALL;
  if (raw === undefined || raw === null || raw === "") return true;
  const value = String(raw).toLowerCase();
  return value !== "false" && value !== "0" && value !== "off";
}

export function evaluateInstallGate(input: InstallGateInput): InstallGateDecision {
  const { deviceKind, isNative, isStandalone, verifiedInstall, skipped, enforceMobile } = input;

  // Already running as an app — never gate.
  if (isNative || isStandalone) {
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
