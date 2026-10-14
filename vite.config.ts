import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// One dev server runs the React app and the Worker (with local D1 and R2) together.
export default defineConfig({
  plugins: [react(), tailwindcss(), cloudflare()],
});
