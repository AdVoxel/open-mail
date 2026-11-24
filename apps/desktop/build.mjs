import { execFileSync, spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const desktopDir = dirname(fileURLToPath(import.meta.url));
const repo = resolve(desktopDir, "../..");

function git(args, fallback) {
  try {
    return execFileSync("git", ["-C", repo, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return fallback;
  }
}

const buildNumber = git(["rev-list", "--count", "HEAD"], "0");
const commit = git(["rev-parse", "--short", "HEAD"], "unknown");
const dirty = Boolean(git(["status", "--porcelain"], ""));
const npm = process.platform === "win32" ? "npm.cmd" : "npm";

function run(args, env = process.env) {
  const result = spawnSync(npm, args, { cwd: repo, env, stdio: "inherit", shell: process.platform === "win32" });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

run(["run", "export:web", "--workspace", "@mail-app/mobile"], {
  ...process.env,
  EXPO_PUBLIC_BUILD_NUMBER: buildNumber,
  EXPO_PUBLIC_BUILD_ID: `${commit}${dirty ? "+" : ""}`,
});
run(["run", "build:electron", "--workspace", "@mail-app/desktop"]);
