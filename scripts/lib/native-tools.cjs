const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

function resolveTool(name, candidates, args = ["version"]) {
  const direct = spawnSync(name, args, { encoding: "utf8" });
  if (!direct.error && direct.status === 0) {
    return name;
  }

  for (const candidate of candidates) {
    if (!candidate || !fs.existsSync(candidate)) {
      continue;
    }
    const result = spawnSync(candidate, args, { encoding: "utf8" });
    if (!result.error && result.status === 0) {
      return candidate;
    }
  }

  return name;
}

function resolveGo() {
  return resolveTool("go", [
    "C:\\Program Files\\Go\\bin\\go.exe",
    path.join(os.homedir(), "sdk", "go", "bin", "go.exe"),
  ]);
}

function resolveWails() {
  return resolveTool("wails", [
    path.join(os.homedir(), "go", "bin", "wails.exe"),
  ]);
}

module.exports = {
  resolveGo,
  resolveWails,
};
