import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import {
  extractRouteFromAppUrl,
  getNativePlugin,
  getRuntimeMode,
  getRuntimePlatform,
  isNativeApp,
} from "@/platform/runtime";
import { isAuthCallbackUrl, mapIncomingAuthCallbackToRoute } from "@/features/auth/auth-redirects";

type ListenerHandle = { remove?: () => Promise<void> | void };

type AppUrlOpenPayload = { url?: string };

type AppPlugin = {
  addListener?: (
    eventName: "appUrlOpen",
    listener: (payload: AppUrlOpenPayload) => void
  ) => Promise<ListenerHandle> | ListenerHandle;
  getLaunchUrl?: () => Promise<AppUrlOpenPayload>;
};

type PushPermissionResult = { receive?: "granted" | "denied" | "prompt" };

type PushPlugin = {
  requestPermissions?: () => Promise<PushPermissionResult>;
  register?: () => Promise<void>;
};

async function initializeNativePushScaffold() {
  const pushPlugin = getNativePlugin<PushPlugin>("PushNotifications");
  if (!pushPlugin?.requestPermissions || !pushPlugin.register) return;

  try {
    const permission = await pushPlugin.requestPermissions();
    if (permission.receive === "granted") {
      await pushPlugin.register();
    }
  } catch {
    // Intentionally no-op: push setup is optional scaffolding for now.
  }
}

export function NativePlatformBootstrap() {
  const navigate = useNavigate();

  useEffect(() => {
    const runtimeMode = getRuntimeMode();
    const runtimePlatform = getRuntimePlatform();

    document.documentElement.dataset.runtimeMode = runtimeMode;
    document.documentElement.dataset.runtimePlatform = runtimePlatform;

    if (!isNativeApp()) return;

    void initializeNativePushScaffold();

    const appPlugin = getNativePlugin<AppPlugin>("App");
    if (!appPlugin?.addListener) return;

    let listenerHandle: ListenerHandle | null = null;

    const routeFromIncomingUrl = (url: string): string | null => {
      if (isAuthCallbackUrl(url)) {
        return mapIncomingAuthCallbackToRoute(url);
      }

      return extractRouteFromAppUrl(url);
    };

    const handleIncomingUrl = (url: string, source: "appUrlOpen" | "launchUrl") => {
      const targetRoute = routeFromIncomingUrl(url);
      console.info('[NativeBridge] Incoming app URL', {
        source,
        url,
        targetRoute,
        isAuthCallback: isAuthCallbackUrl(url),
      });

      if (targetRoute) {
        navigate(targetRoute, { replace: true });
      }
    };

    const setupListener = async () => {
      listenerHandle = await appPlugin.addListener?.("appUrlOpen", ({ url }) => {
        if (!url) return;
        handleIncomingUrl(url, "appUrlOpen");
      });

      const launchUrl = await appPlugin.getLaunchUrl?.();
      if (launchUrl?.url) {
        handleIncomingUrl(launchUrl.url, "launchUrl");
      }
    };

    void setupListener();

    return () => {
      void listenerHandle?.remove?.();
    };
  }, [navigate]);

  return null;
}
