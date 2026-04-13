import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.taheito26sys.corerefactorinitiative",
  appName: "Core Refactor Initiative",
  webDir: "dist",
  server: {
    // url: "https://b87c5fb9-e333-4890-8903-e81584334e4b.lovableproject.com?forceHideBadge=true",
    cleartext: true,
    androidScheme: "https",
    iosScheme: "https",
  },
  plugins: {
    SplashScreen: {
      launchAutoHide: true,
      backgroundColor: "#0f172a",
      androidScaleType: "CENTER_CROP",
      showSpinner: true,
      androidSpinnerStyle: "large",
      iosSpinnerStyle: "large",
      spinnerColor: "#3b82f6",
    },
    PushNotifications: {
      presentationOptions: ["badge", "sound", "alert"],
    },
    StatusBar: {
      style: "LIGHT",
      backgroundColor: "#0f172a",
      overlaysWebView: false,
    },
    Keyboard: {
      resize: "body",
      style: "DARK",
    },
  },
  android: {
    allowMixedContent: true,
    captureInput: true,
  },
};

export default config;
