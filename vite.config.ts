import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// One dev server runs the React app and the Worker (with local D1 and R2) together.
// Pinned to 5174: the Google OAuth redirect URI is http://localhost:5174/api/auth/callback,
// so the server must fail rather than silently move to another port.
export default defineConfig({
  plugins: [react(), tailwindcss(), cloudflare()],
  server: { port: 5174, strictPort: true },
});
