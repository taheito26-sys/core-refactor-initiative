export type RuntimePlatform = "web" | "android" | "ios";

interface CapacitorBridge {
  isNativePlatform?: () => boolean;
  getPlatform?: () => string;
}

declare global {
  interface Window {
    Capacitor?: CapacitorBridge;
  }
}

function getBridge(): CapacitorBridge | undefined {
  if (typeof window === "undefined") return undefined;
  return window.Capacitor;
}

export function isNativeApp(): boolean {
  const bridge = getBridge();
  if (!bridge) return false;

  if (typeof bridge.isNativePlatform === "function") {
    return bridge.isNativePlatform();
  }

  const platform = bridge.getPlatform?.();
  return platform === "android" || platform === "ios";
}

export function getRuntimePlatform(): RuntimePlatform {
  const platform = getBridge()?.getPlatform?.();
  if (platform === "android" || platform === "ios") return platform;
  return "web";
}

export function isAndroid(): boolean {
  return getRuntimePlatform() === "android";
}

export function isIOS(): boolean {
  return getRuntimePlatform() === "ios";
}

export function isWebBrowser(): boolean {
  return !isNativeApp();
}
