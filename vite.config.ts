import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";
import { VitePWA } from "vite-plugin-pwa";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const disablePwaBuild = process.env.DISABLE_PWA_BUILD === "1";

  // Absolute origin used by `related_applications` so the browser can answer
  // `navigator.getInstalledRelatedApps()` — that call is what lets a plain
  // browser tab know the app is already installed. Override per environment
  // with PWA_ORIGIN when the deployment is served from another domain.
  const pwaOrigin = (
    process.env.PWA_ORIGIN ||
    (process.env.VERCEL_PROJECT_PRODUCTION_URL
      ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
      : "https://qtrp2ptracker.vercel.app")
  ).replace(/\/$/, "");

  return {
    define: {
      __APP_BUILD_ID__: JSON.stringify(
        process.env.VERCEL_GIT_COMMIT_SHA ||
          process.env.GITHUB_SHA ||
          process.env.CF_PAGES_COMMIT_SHA ||
          process.env.COMMIT_SHA ||
          new Date().toISOString()
      ),
    },
    server: {
      host: "::",
      port: 5000,
      hmr: {
        overlay: false,
      },
    },
    build: {
      // Prevent long/blocked gzip-size analysis in constrained CI environments.
      reportCompressedSize: false,
    },
    plugins: [
      react(),
      mode === "development" && componentTagger(),
      !disablePwaBuild &&
        VitePWA({
          registerType: "autoUpdate",
          injectRegister: "auto",
          includeAssets: ["favicon.ico?v=2", "favicon.png?v=2", "icon-192.png?v=2", "icon-512.png?v=2", "robots.txt"],
          workbox: {
            maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
            navigateFallbackDenylist: [
              /^\/auth\//,
              /^\/~oauth/,
              /^\/login/,
              /^\/signup/,
              /^\/reset-password/,
              /^\/verify-email/,
            ],
            clientsClaim: true,
            skipWaiting: true,
            cleanupOutdatedCaches: true,
            runtimeCaching: [
              {
                urlPattern: /^https:\/\/.*\.supabase\.co\/.*/i,
                handler: "NetworkFirst",
                options: {
                  cacheName: "supabase-api",
                  expiration: { maxEntries: 50, maxAgeSeconds: 60 },
                },
              },
            ],
          },
          manifest: {
            // Identity pinned to the existing start_url so already-installed
            // copies keep the same app id instead of being seen as new apps.
            id: "/?icon_v=2",
            name: "The Tracker",
            short_name: "The Tracker",
            description:
              "The Tracker — live market rates, deals & merchant management",
            theme_color: "#0f172a",
            background_color: "#0f172a",
            display: "standalone",
            // Chromium (Chrome and Edge alike) needs an unambiguous app display
            // intent to offer a real install instead of a bookmark/shortcut.
            display_override: ["standalone", "minimal-ui"],
            orientation: "portrait-primary",
            scope: "/",
            launch_handler: { client_mode: "navigate-existing" },
            categories: ["finance", "business", "productivity"],
            // Lets `getInstalledRelatedApps()` report this PWA as installed from
            // inside a normal browser tab. Both manifest URLs are listed because
            // the page has historically been served with a `?v=2` query on the
            // manifest link, and installs are keyed by the URL used at the time.
            related_applications: [
              { platform: "webapp", url: `${pwaOrigin}/manifest.webmanifest` },
              { platform: "webapp", url: `${pwaOrigin}/manifest.webmanifest?v=2` },
              { platform: "play", id: "com.taheito26sys.corerefactorinitiative" },
            ],
            prefer_related_applications: false,
            start_url: "/?icon_v=2",
            icons: [
              {
                src: "/icon-192.png?v=2",
                sizes: "192x192",
                type: "image/png",
                purpose: "any",
              },
              {
                src: "/icon-512.png?v=2",
                sizes: "512x512",
                type: "image/png",
                purpose: "any",
              },
              {
                src: "/icon-512.png?v=2",
                sizes: "512x512",
                type: "image/png",
                purpose: "maskable",
              },
            ],
          },
        }),
    ].filter(Boolean),
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
      dedupe: ["react", "react-dom"],
    },
  };
});
