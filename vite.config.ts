import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// One dev server runs the React app and the Worker (with local D1 and R2) together.
// Pinned to 5174: the Google OAuth redirect URI is http://localhost:5174/api/auth/callback,
// so the server must fail rather than silently move to another port.
// CPH_STATE_DIR points the local D1/R2 somewhere else: the e2e server uses its own throwaway
// database (e2e/support/prepare-db.ts), so test users never appear in your dev data.
const stateDir = process.env.CPH_STATE_DIR;
export default defineConfig({
  plugins: [react(), tailwindcss(), cloudflare({ persistState: stateDir ? { path: stateDir } : true })],
  server: { port: 5174, strictPort: true },
});
