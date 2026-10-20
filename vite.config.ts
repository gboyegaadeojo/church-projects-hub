import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

// One dev server runs the React app and the Worker (with local D1 and R2) together.
// Pinned to 5174: the Google OAuth redirect URI is http://localhost:5174/api/auth/callback,
// so the server must fail rather than silently move to another port.
// CPH_STATE_DIR points the local D1/R2 somewhere else: the e2e server uses its own throwaway
// database (e2e/support/prepare-db.ts), so test users never appear in your dev data.
const stateDir = process.env.CPH_STATE_DIR;
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    cloudflare({ persistState: stateDir ? { path: stateDir } : true }),
    // PWA (NFR-20, NFR-21): installable, and the app shell plus the last-viewed My Work, boards and tasks
    // work offline. API reads are network-first, so online people always get fresh data; the cached copy is
    // only used when the network is gone. Writes are never cached (and are disabled offline in the app).
    // Sign-out clears the API cache (src/lib/session.ts), so a shared device doesn't keep someone's data.
    VitePWA({
      registerType: "autoUpdate",
      injectRegister: null,
      manifest: {
        name: "Church Projects Hub",
        short_name: "Projects Hub",
        description: "Work tracker for Immanuel Fellowship Church volunteer teams.",
        start_url: "/work",
        scope: "/",
        display: "standalone",
        theme_color: "#2563eb",
        background_color: "#ffffff",
        icons: [
          { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
          { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,png,svg,ico,webmanifest}"],
        navigateFallback: "/index.html",
        navigateFallbackDenylist: [/^\/api\//],
        cleanupOutdatedCaches: true,
        runtimeCaching: [
          {
            urlPattern: ({ url, request }) =>
              request.method === "GET" &&
              /^\/api\/(auth\/me|me\/work|projects|projects\/by-key\/[^/]+|projects\/\d+\/(board|saved-filters)|tasks\/by-key\/[^/]+|tasks\/\d+)$/.test(
                url.pathname,
              ),
            handler: "NetworkFirst",
            options: {
              cacheName: "cph-api",
              networkTimeoutSeconds: 6,
              expiration: { maxEntries: 200, maxAgeSeconds: 7 * 24 * 60 * 60 },
              cacheableResponse: { statuses: [200] },
            },
          },
        ],
      },
    }),
  ],
  server: { port: 5174, strictPort: true },
});
