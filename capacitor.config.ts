import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "app.lovable.b87c5fb9e33348908903e81584334e4b",
  appName: "happy-trader-hub",
  webDir: "dist",
  server: {
    url: "https://b87c5fb9-e333-4890-8903-e81584334e4b.lovableproject.com?forceHideBadge=true",
    cleartext: true,
    androidScheme: "https",
    iosScheme: "https",
  },
  plugins: {
    SplashScreen: {
      launchAutoHide: true,
    },
    PushNotifications: {
      presentationOptions: ["badge", "sound", "alert"],
    },
  },
};

export default config;
