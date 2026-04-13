import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";
import { VitePWA } from "vite-plugin-pwa";

const disablePwaBuild = process.env.DISABLE_PWA === "true";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  define: {
    __APP_BUILD_ID__: JSON.stringify(
      `${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${Math.random().toString(36).slice(2, 8)}`
    ),
  },
  server: {
    host: "0.0.0.0",
    port: 3000,
    allowedHosts: [
      "all",
      ".emergentagent.com",
      ".emergentcf.cloud",
      ".preview.emergentagent.com",
    ],
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
}));
