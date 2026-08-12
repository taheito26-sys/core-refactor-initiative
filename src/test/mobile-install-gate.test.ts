import { describe, it, expect } from "vitest";
import {
  detectDeviceKind,
  evaluateInstallGate,
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
