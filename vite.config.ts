import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Relative base so the built site works from any path (GitHub Pages subdir).
  base: "./",
  worker: {
    format: "es",
  },
});
