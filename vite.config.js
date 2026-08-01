import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// Ensure Vite is aware of the /BruCafe/ subdirectory
export default defineConfig({
  plugins: [react(), tailwindcss()],
  base: "/bru_cafe/", // Ensure the frontend is aware of its base path

  server: {
    proxy: {
      "/api": {
        target: "http://localhost:3002", // Proxy requests to BruCafe backend on port 3002
        changeOrigin: true,
      },
    },
  },
});
