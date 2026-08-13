import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  base: "./",
  plugins: [react()],
  server: {
    watch: {
      ignored: ["**/.chrome-profile/**", "**/artifacts/**"],
    },
  },
  build: {
    target: "es2022",
    sourcemap: true,
  },
});
