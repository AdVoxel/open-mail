import { defineConfig } from "electron-vite";

// Only the main process is built here; the UI is the Expo web app (apps/mobile).
export default defineConfig({
  main: {},
});
