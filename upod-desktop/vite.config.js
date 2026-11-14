import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
// The phone app's source, reused as-is — this directory lives inside the
// phone app's repo, so that is one level up. Nothing is copied or forked:
// a change made for Android lands here on the next build.
const APP_SRC = path.resolve(here, "..", "src");

export default defineConfig({
  root: here,
  base: "./",
  plugins: [react()],
  resolve: {
    alias: {
      // Every Capacitor import in the app source is answered by a
      // desktop shim with the same API surface. This is the whole port:
      // the React code never learns it moved.
      "@capacitor/core": path.resolve(here, "src/shims/capacitor-core.js"),
      "@capacitor/filesystem/dist/esm/definitions": path.resolve(here, "src/shims/filesystem.js"),
      "@capacitor/filesystem": path.resolve(here, "src/shims/filesystem.js"),
      "@capacitor/preferences": path.resolve(here, "src/shims/preferences.js"),
      "@capacitor/app": path.resolve(here, "src/shims/app.js"),
      "@capacitor/haptics": path.resolve(here, "src/shims/haptics.js"),
      "@capacitor/splash-screen": path.resolve(here, "src/shims/splash-screen.js"),
      "@capgo/capacitor-media-session": path.resolve(here, "src/shims/media-session.js"),
      "@app": APP_SRC,
    },
  },
  server: {
    port: 5180,
    strictPort: true,
    fs: {
      // The entry imports from ../upod/src, which is outside this root.
      allow: [here, path.resolve(here, "..")],
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      external: ["react-native-fs"],
      input: {
        index: path.resolve(here, "index.html"),
        smoke: path.resolve(here, "smoke.html"),
      },
    },
    chunkSizeWarningLimit: 1500,
  },
});
