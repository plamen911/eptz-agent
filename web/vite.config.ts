import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// In development the API runs on its own port (npm run serve); in production the server serves dist/.
export default defineConfig({
  plugins: [react()],
  server: { proxy: { "/api": { target: "http://127.0.0.1:8787", changeOrigin: false } } },
  build: { outDir: "dist", sourcemap: true },
  test: { environment: "jsdom", setupFiles: ["./test/setup.ts"] },
});
