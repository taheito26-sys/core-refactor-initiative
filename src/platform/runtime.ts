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

// An installed app can be launched in any of these display modes depending on
// the manifest's `display` / `display_override` and the launching browser.
// A plain home-screen *shortcut* opens in `browser` mode and matches none of
// them — which is exactly the distinction the install gate relies on.
const APP_DISPLAY_MODES = [
  "standalone",
  "minimal-ui",
  "fullscreen",
  "window-controls-overlay",
] as const;

export function isInstalledPwa(): boolean {
  if (typeof window === "undefined") return false;

  const media = APP_DISPLAY_MODES.some(
    (mode) => window.matchMedia?.(`(display-mode: ${mode})`).matches ?? false
  );

  // iOS Safari home-screen apps.
  const navigatorStandalone =
    typeof navigator !== "undefined" && "standalone" in navigator
      ? Boolean((navigator as Navigator & { standalone?: boolean }).standalone)
      : false;

  // Android WebAPK launches set an `android-app://` referrer.
  const webApkReferrer =
    typeof document !== "undefined" && document.referrer.startsWith("android-app://");

  return media || navigatorStandalone || webApkReferrer;
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
