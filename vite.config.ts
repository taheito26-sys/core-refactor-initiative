import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";
import { VitePWA } from "vite-plugin-pwa";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const disablePwaBuild = process.env.DISABLE_PWA_BUILD === "1";

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
          includeAssets: ["favicon.svg", "robots.txt"],
          workbox: {
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
            name: "P2P Tracker",
            short_name: "P2P Tracker",
            description:
              "P2P Trading Platform — live market rates, deals & merchant management",
            theme_color: "#0f172a",
            background_color: "#0f172a",
            display: "standalone",
            start_url: "/",
            icons: [
              {
                src: "/favicon.svg",
                sizes: "any",
                type: "image/svg+xml",
                purpose: "any maskable",
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
