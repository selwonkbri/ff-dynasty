import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// The engine lives outside web/ (../lib/engine), shared with the old Next app
// and its tests. These aliases match the repo root tsconfig's paths.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@lib": fileURLToPath(new URL("../lib", import.meta.url)),
      "@db": fileURLToPath(new URL("../db", import.meta.url)),
    },
  },
  server: { fs: { allow: [".."] } },
});
