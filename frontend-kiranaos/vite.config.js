import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  return {
    plugins: [react()],
    define: {
      "import.meta.env.REACT_APP_API_BASE": JSON.stringify(env.REACT_APP_API_BASE || "http://localhost:3300"),
    },
    server: { port: 5173, host: true },
  };
});
