import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const serverPort = process.env.PORT || 4000;

export default defineConfig({
  base: "./",
  plugins: [react()],
  server: {
    proxy: {
      "/api": `http://localhost:${serverPort}`
    }
  }
});
