import { defineConfig } from "electron-vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  main: {
    build: {
      externalizeDeps: {
        // Workspace packages ship as TypeScript source, so bundle them...
        exclude: ["@mail-app/server", "@mail-app/core"],
        // ...but keep their npm dependencies as normal runtime requires.
        include: ["@anthropic-ai/sdk", "imapflow", "mailparser", "nodemailer", "zod"],
      },
    },
  },
  renderer: {
    plugins: [react()],
  },
});
