import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig(({ command }) => ({
  base: "./",
  plugins: [
    react(),
    {
      name: "mobile-shell",
      generateBundle(_options, bundle) {
        const icons = JSON.parse(
          readFileSync(resolve(__dirname, "public/mobile-icons.json"), "utf8"),
        );
        for (const size of ["192", "512"])
          this.emitFile({
            type: "asset",
            fileName: "icon-" + size + ".png",
            source: Buffer.from(icons[size], "base64"),
          });
        this.emitFile({
          type: "asset",
          fileName: "mobile-shell.json",
          source: JSON.stringify(
            Object.keys(bundle)
              .filter(
                (p) =>
                  p.startsWith("assets/") &&
                  /\.(js|css|woff2|png|svg)$/.test(p),
              )
              .map((p) => "/" + p),
          ),
        });
      },
    },
    {
      name: "development-csp",
      transformIndexHtml(html) {
        return command === "serve"
          ? html.replace(
              "script-src 'self'",
              "script-src 'self' 'unsafe-inline'",
            )
          : html;
      },
    },
  ],
  server: { host: "127.0.0.1", port: 5173, strictPort: true },
  build: {
    rollupOptions: {
      input: {
        desktop: resolve(__dirname, "index.html"),
        mobile: resolve(__dirname, "mobile.html"),
      },
      output: { manualChunks: { charts: ["recharts"] } },
    },
  },
}));
