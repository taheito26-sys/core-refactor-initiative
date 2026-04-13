export type RuntimePlatform = "web" | "android" | "ios";
export type RuntimeMode = "browser-web" | "pwa" | "capacitor-native";

type CapacitorBridge = {
  isNativePlatform?: () => boolean;
  getPlatform?: () => string;
  Plugins?: Record<string, unknown>;
};

declare global {
  interface Window {
    Capacitor?: CapacitorBridge;
  }
}

function getCapacitorBridge(): CapacitorBridge | undefined {
  if (typeof window === "undefined") return undefined;
  return window.Capacitor;
}

export function getRuntimePlatform(): RuntimePlatform {
  const bridge = getCapacitorBridge();
  const platform = bridge?.getPlatform?.();

  if (platform === "android" || platform === "ios") {
    return platform;
  }

  return "web";
}

export function isNativeApp(): boolean {
  const bridge = getCapacitorBridge();

  if (!bridge) return false;
  if (typeof bridge.isNativePlatform === "function") {
    return bridge.isNativePlatform();
  }

  const platform = bridge.getPlatform?.();
  return platform === "android" || platform === "ios";
}

export function isAndroid(): boolean {
  return isNativeApp() && getRuntimePlatform() === "android";
}

export function isIOS(): boolean {
  return isNativeApp() && getRuntimePlatform() === "ios";
}

export function isInstalledPwa(): boolean {
  if (typeof window === "undefined") return false;

  const media = window.matchMedia?.("(display-mode: standalone)").matches ?? false;
  const navigatorStandalone =
    typeof navigator !== "undefined" && "standalone" in navigator
      ? Boolean((navigator as Navigator & { standalone?: boolean }).standalone)
      : false;

  return media || navigatorStandalone;
}

export function isWebBrowser(): boolean {
  return !isNativeApp();
}

export function getRuntimeMode(): RuntimeMode {
  if (isNativeApp()) return "capacitor-native";
  if (isInstalledPwa()) return "pwa";
  return "browser-web";
}

export function extractRouteFromAppUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    const path = parsed.pathname || "/";
    const normalizedPath = path.startsWith("/") ? path : `/${path}`;
    const suffix = `${parsed.search}${parsed.hash}`;
    return `${normalizedPath}${suffix}`;
  } catch {
    return null;
  }
}

export function getNativePlugin<T = unknown>(pluginName: string): T | null {
  if (!isNativeApp()) return null;
  const bridge = getCapacitorBridge();
  const plugin = bridge?.Plugins?.[pluginName];

  return (plugin as T | undefined) ?? null;
}
