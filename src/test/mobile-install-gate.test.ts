import { describe, it, expect, afterEach } from "vitest";
import {
  buildChromeIntentUrl,
  detectDeviceKind,
  detectRelatedAppInstalled,
  evaluateInstallGate,
  isEdgeAndroid,
  isEdgeBrowser,
  isInAppBrowser,
  isMobileDevice,
  type InstallGateInput,
} from "@/platform/install-gate";

const IPHONE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
const ANDROID_UA =
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36";
const DESKTOP_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

function gate(overrides: Partial<InstallGateInput> = {}) {
  return evaluateInstallGate({
    isAuthenticated: true,
    deviceKind: "android",
    isNative: false,
    isStandalone: false,
    verifiedInstall: false,
    skipped: false,
    enforceMobile: true,
    ...overrides,
  });
}

describe("install gate — device detection", () => {
  it("classifies mobile and desktop user agents", () => {
    expect(detectDeviceKind(IPHONE_UA)).toBe("ios");
    expect(detectDeviceKind(ANDROID_UA)).toBe("android");
    expect(detectDeviceKind(DESKTOP_UA)).toBe("desktop");
  });

  it("treats iOS and Android as mobile, desktop as not", () => {
    expect(isMobileDevice("ios")).toBe(true);
    expect(isMobileDevice("android")).toBe(true);
    expect(isMobileDevice("desktop")).toBe(false);
  });

  it("detects in-app browsers that cannot install a PWA", () => {
    expect(isInAppBrowser(`${IPHONE_UA} [FBAN/FBIOS;FBAV/450.0]`)).toBe(true);
    expect(isInAppBrowser(`${ANDROID_UA} Instagram 300.0.0.0`)).toBe(true);
    expect(
      isInAppBrowser(
        "Mozilla/5.0 (Linux; Android 14; Pixel 8; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/126.0.0.0 Mobile Safari/537.36",
      ),
    ).toBe(true);
    expect(isInAppBrowser(ANDROID_UA)).toBe(false);
    expect(isInAppBrowser(IPHONE_UA)).toBe(false);
  });
});

describe("install gate — only after login", () => {
  it.each(["ios", "android", "desktop"] as const)(
    "never blocks a signed-out visitor on %s",
    (deviceKind) => {
      const decision = gate({ deviceKind, isAuthenticated: false });

      expect(decision.blocked).toBe(false);
      expect(decision.enforcement).toBe("none");
    },
  );

  it("blocks a mobile browser as soon as the user is signed in", () => {
    expect(gate({ deviceKind: "android", isAuthenticated: false }).blocked).toBe(false);
    expect(gate({ deviceKind: "android", isAuthenticated: true }).blocked).toBe(true);
  });
});

describe("install gate — mobile enforcement", () => {
  it.each(["ios", "android"] as const)("hard-blocks a %s browser", (deviceKind) => {
    const decision = gate({ deviceKind });

    expect(decision.blocked).toBe(true);
    expect(decision.enforcement).toBe("hard");
    expect(decision.stage).toBe("install");
    expect(decision.canContinueInBrowser).toBe(false);
  });

  it("ignores a previously stored skip on mobile", () => {
    const decision = gate({ deviceKind: "ios", skipped: true });

    expect(decision.blocked).toBe(true);
    expect(decision.canContinueInBrowser).toBe(false);
  });

  it("keeps blocking the browser tab after install and asks for a relaunch", () => {
    const decision = gate({ deviceKind: "android", verifiedInstall: true });

    expect(decision.blocked).toBe(true);
    expect(decision.stage).toBe("awaiting-launch");
    expect(decision.canContinueInBrowser).toBe(false);
  });

  it("lets the installed PWA through once launched standalone", () => {
    const decision = gate({ deviceKind: "android", isStandalone: true, verifiedInstall: true });

    expect(decision.blocked).toBe(false);
    expect(decision.enforcement).toBe("none");
  });

  it("never gates the Capacitor native shell", () => {
    const decision = gate({ deviceKind: "ios", isNative: true });

    expect(decision.blocked).toBe(false);
    expect(decision.enforcement).toBe("none");
  });

  it("falls back to a soft prompt when the kill switch is off", () => {
    const decision = gate({ deviceKind: "android", enforceMobile: false });

    expect(decision.enforcement).toBe("soft");
    expect(decision.canContinueInBrowser).toBe(true);

    expect(gate({ deviceKind: "android", enforceMobile: false, skipped: true }).blocked).toBe(false);
  });
});

describe("install gate — desktop stays optional", () => {
  it("prompts but allows continuing in the browser", () => {
    const decision = gate({ deviceKind: "desktop" });

    expect(decision.blocked).toBe(true);
    expect(decision.enforcement).toBe("soft");
    expect(decision.canContinueInBrowser).toBe(true);
  });

  it("stops prompting once skipped or installed", () => {
    expect(gate({ deviceKind: "desktop", skipped: true }).blocked).toBe(false);
    expect(gate({ deviceKind: "desktop", verifiedInstall: true }).blocked).toBe(false);
  });
});

const EDGE_ANDROID_UA = `${ANDROID_UA.replace("Chrome/126.0.0.0", "Chrome/126.0.0.0")} EdgA/126.0.0.0`;
const EDGE_DESKTOP_UA = `${DESKTOP_UA} Edg/126.0.0.0`;

describe("install gate — Edge handling", () => {
  it("recognises Edge on Android and on the desktop", () => {
    expect(isEdgeAndroid(EDGE_ANDROID_UA)).toBe(true);
    expect(isEdgeBrowser(EDGE_ANDROID_UA)).toBe(true);
    expect(isEdgeBrowser(EDGE_DESKTOP_UA)).toBe(true);

    // Desktop Edge installs a real app, so it must not take the Android path.
    expect(isEdgeAndroid(EDGE_DESKTOP_UA)).toBe(false);
    expect(isEdgeAndroid(ANDROID_UA)).toBe(false);
    expect(isEdgeBrowser(ANDROID_UA)).toBe(false);
  });

  it("still classifies Edge on Android as an Android device", () => {
    expect(detectDeviceKind(EDGE_ANDROID_UA)).toBe("android");
  });

  it("builds a Chrome intent URL that preserves path and query", () => {
    expect(buildChromeIntentUrl("https://qtrp2ptracker.vercel.app/trading/cash?tab=1")).toBe(
      "intent://qtrp2ptracker.vercel.app/trading/cash?tab=1#Intent;scheme=https;package=com.android.chrome;end",
    );
  });

  it("refuses to build an intent URL for non-https or malformed input", () => {
    expect(buildChromeIntentUrl("http://insecure.example.com/")).toBeNull();
    expect(buildChromeIntentUrl("not a url")).toBeNull();
  });
});

describe("install gate — installed-app detection from a browser tab", () => {
  const nav = navigator as Navigator & { getInstalledRelatedApps?: () => Promise<unknown[]> };

  afterEach(() => {
    delete nav.getInstalledRelatedApps;
  });

  it("reports false when the browser does not support the API", async () => {
    delete nav.getInstalledRelatedApps;
    await expect(detectRelatedAppInstalled()).resolves.toBe(false);
  });

  it("reports true when the browser knows the app is installed", async () => {
    nav.getInstalledRelatedApps = async () => [
      { platform: "webapp", url: "https://qtrp2ptracker.vercel.app/manifest.webmanifest" },
    ];
    await expect(detectRelatedAppInstalled()).resolves.toBe(true);
  });

  it("reports false for an empty result and swallows API errors", async () => {
    nav.getInstalledRelatedApps = async () => [];
    await expect(detectRelatedAppInstalled()).resolves.toBe(false);

    nav.getInstalledRelatedApps = async () => {
      throw new Error("NotAllowedError");
    };
    await expect(detectRelatedAppInstalled()).resolves.toBe(false);
  });

  it("unblocks the gate once detection has stamped a verified install", () => {
    // Detection feeds `verifiedInstall`, which moves the user off the
    // "install me" screen and onto "open the app you already installed".
    expect(gate({ deviceKind: "android", verifiedInstall: false }).stage).toBe("install");
    expect(gate({ deviceKind: "android", verifiedInstall: true }).stage).toBe("awaiting-launch");
  });
});
