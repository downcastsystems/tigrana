#!/usr/bin/env node
import { cp, mkdir, readdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDir, "..");
const defaultSourceDir = path.join(projectRoot, "src-tauri", "target", "release", "bundle", "macos");

const [destinationArg = projectRoot, sourceDirArg = defaultSourceDir] = process.argv.slice(2);
const destinationDir = path.resolve(process.cwd(), destinationArg);
const sourceDir = path.resolve(process.cwd(), sourceDirArg);

async function main() {
  const entries = await readdir(sourceDir, { withFileTypes: true }).catch((error) => {
    if (error?.code === "ENOENT") {
      throw new Error(`No Tauri macOS bundle directory found at ${sourceDir}. Build the app first.`);
    }
    throw error;
  });
  const appNames = entries
    .filter((entry) => entry.isDirectory() && entry.name.endsWith(".app"))
    .map((entry) => entry.name)
    .sort();

  if (appNames.length === 0) {
    throw new Error(`No .app bundles found in ${sourceDir}. Build the app first.`);
  }

  await mkdir(destinationDir, { recursive: true });

  for (const appName of appNames) {
    const source = path.join(sourceDir, appName);
    const destination = path.join(destinationDir, appName);
    await assertDirectory(source);
    await rm(destination, { recursive: true, force: true });
    await cp(source, destination, { recursive: true, preserveTimestamps: true });
    console.log(`Copied ${source} -> ${destination}`);
  }
}

async function assertDirectory(target) {
  const info = await stat(target);
  if (!info.isDirectory()) {
    throw new Error(`${target} is not a directory.`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
