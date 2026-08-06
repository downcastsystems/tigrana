import { readFileSync, writeFileSync } from "node:fs";

const bump = process.argv[2];
const allowedBumps = new Set(["patch", "minor", "major"]);

if (!allowedBumps.has(bump)) {
  console.error("Usage: node scripts/bump-version.mjs <patch|minor|major>");
  process.exit(1);
}

const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));
const writeJson = (path, value) => {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
};

const packageJson = readJson("package.json");
const packageLock = readJson("package-lock.json");
const tauriConfig = readJson("src-tauri/tauri.conf.json");
const cargoToml = readFileSync("src-tauri/Cargo.toml", "utf8");
const cargoLock = readFileSync("src-tauri/Cargo.lock", "utf8");

const cargoPackagePattern = /(\[package\][\s\S]*?^version = ")[^"]+("\s*$)/m;
const cargoLockPackagePattern = /(\[\[package\]\]\s*\nname = "tigrana"\s*\nversion = ")[^"]+("\s*$)/m;
const cargoVersion = cargoToml.match(cargoPackagePattern)?.[0].match(/version = "([^"]+)"/)?.[1];
const cargoLockVersion = cargoLock.match(cargoLockPackagePattern)?.[0].match(/version = "([^"]+)"/)?.[1];
const currentVersion = packageJson.version;

const currentVersions = {
  "package.json": currentVersion,
  "package-lock.json": packageLock.version,
  "package-lock.json root package": packageLock.packages?.[""]?.version,
  "src-tauri/tauri.conf.json": tauriConfig.version,
  "src-tauri/Cargo.toml": cargoVersion,
  "src-tauri/Cargo.lock": cargoLockVersion,
};

const mismatches = Object.entries(currentVersions).filter(([, version]) => version !== currentVersion);
if (mismatches.length > 0) {
  console.error("Version files are out of sync:");
  for (const [path, version] of Object.entries(currentVersions)) {
    console.error(`  ${path}: ${version ?? "missing"}`);
  }
  process.exit(1);
}

const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(currentVersion);
if (!match) {
  console.error(`Current version is not stable SemVer: ${currentVersion}`);
  process.exit(1);
}

let [, major, minor, patch] = match.map(Number);
if (bump === "major") {
  major += 1;
  minor = 0;
  patch = 0;
} else if (bump === "minor") {
  minor += 1;
  patch = 0;
} else {
  patch += 1;
}

const nextVersion = `${major}.${minor}.${patch}`;

packageJson.version = nextVersion;
packageLock.version = nextVersion;
packageLock.packages[""].version = nextVersion;
tauriConfig.version = nextVersion;

writeJson("package.json", packageJson);
writeJson("package-lock.json", packageLock);
writeJson("src-tauri/tauri.conf.json", tauriConfig);
writeFileSync(
  "src-tauri/Cargo.toml",
  cargoToml.replace(cargoPackagePattern, (_match, prefix, suffix) => `${prefix}${nextVersion}${suffix}`),
);
writeFileSync(
  "src-tauri/Cargo.lock",
  cargoLock.replace(cargoLockPackagePattern, (_match, prefix, suffix) => `${prefix}${nextVersion}${suffix}`),
);

process.stdout.write(nextVersion);
