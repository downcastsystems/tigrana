import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

function dependencyPatchVersions(): Plugin {
  const patchDirectory = fileURLToPath(new URL("./patches/", import.meta.url));
  const patchPaths = readdirSync(patchDirectory).filter(name => name.endsWith(".patch")).sort().map(name => `${patchDirectory}${name}`);
  const hash = createHash("sha256");
  for (const path of patchPaths) hash.update(path).update(readFileSync(path));
  const version = hash.digest("hex").slice(0, 12);
  return {
    // Vite includes plugin names in its dependency cache key. Hash file contents:
    // its built-in patch detection only checks the patches directory's mtime.
    name: `tigrana-dependency-patches-${version}`,
    configureServer(server) {
      server.watcher.add(patchPaths);
      const onChange = (path: string) => {
        if (patchPaths.includes(path)) void server.restart();
      };
      server.watcher.on("change", onChange);
      server.httpServer?.once("close", () => server.watcher.off("change", onChange));
    },
  };
}

function pdfImportResources(): Plugin {
  const root = fileURLToPath(new URL("./node_modules/pdfjs-dist/", import.meta.url));
  return {
    name: "pdf-import-resources",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const match = /^\/pdfjs\/(cmaps|wasm)\/([a-zA-Z0-9_.-]+)$/.exec(req.url ?? "");
        if (!match) { next(); return; }
        try {
          res.setHeader("Content-Type", match[2].endsWith(".js") ? "text/javascript" : "application/octet-stream");
          res.end(readFileSync(`${root}${match[1]}/${match[2]}`));
        } catch { res.statusCode = 404; res.end(); }
      });
    },
    generateBundle() {
      for (const directory of ["cmaps", "wasm"]) {
        for (const name of readdirSync(`${root}${directory}`)) {
          this.emitFile({ type: "asset", fileName: `pdfjs/${directory}/${name}`, source: readFileSync(`${root}${directory}/${name}`) });
        }
      }
    },
  };
}

export default defineConfig({
  plugins: [react(), dependencyPatchVersions(), pdfImportResources()],
  worker: { format: "es" },
  clearScreen: false,
  server: {
    port: 1422,
    strictPort: true,
  },
});
