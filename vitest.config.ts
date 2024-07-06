import { defineConfig } from "vitest/config";
import swc from "unplugin-swc";

export default defineConfig({
  optimizeDeps: {
    esbuildOptions: {
      tsconfig: "./tsconfig.json",
    },
  },
  plugins: [swc.vite()],
});
