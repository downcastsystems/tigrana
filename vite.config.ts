import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

function plasmaPatchVersion(): Plugin {
  const patchPath = fileURLToPath(new URL("./patches/@cruxgarden+plasma-ui+0.3.0.patch", import.meta.url));
  const version = createHash("sha256").update(readFileSync(patchPath)).digest("hex").slice(0, 12);
  return {
    // Vite includes plugin names in its dependency cache key. Hash file contents:
    // its built-in patch detection only checks the patches directory's mtime.
    name: `tigrana-plasma-patch-${version}`,
    configureServer(server) {
      server.watcher.add(patchPath);
      const onChange = (path: string) => {
        if (path === patchPath) void server.restart();
      };
      server.watcher.on("change", onChange);
      server.httpServer?.once("close", () => server.watcher.off("change", onChange));
    },
  };
}

export default defineConfig({
  plugins: [react(), plasmaPatchVersion()],
  clearScreen: false,
  server: {
    port: 1422,
    strictPort: true,
  },
});
