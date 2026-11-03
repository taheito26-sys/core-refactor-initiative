import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.taheito26sys.corerefactorinitiative",
  appName: "The Tracker",
  webDir: "dist",
  server: {
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
