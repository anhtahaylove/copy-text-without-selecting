const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { PROJECT_ROOT } = require("./lib/release-utils.cjs");

function listScriptFiles(rootDir) {
  const files = [];

  function visit(currentDir) {
    const children = fs.readdirSync(currentDir, { withFileTypes: true }).sort(function (left, right) {
      return left.name.localeCompare(right.name);
    });

    for (const child of children) {
      const absoluteChild = path.join(currentDir, child.name);
      if (child.isDirectory()) {
        visit(absoluteChild);
        continue;
      }

      if (absoluteChild.endsWith(".js") || absoluteChild.endsWith(".cjs")) {
        files.push(absoluteChild);
      }
    }
  }

  visit(rootDir);
  return files;
}

function main() {
  const sourceFiles = listScriptFiles(path.join(PROJECT_ROOT, "src"));
  const scriptFiles = listScriptFiles(path.join(PROJECT_ROOT, "scripts"));
  const filesToCheck = sourceFiles.concat(scriptFiles);

  for (const filePath of filesToCheck) {
    execFileSync(process.execPath, ["--check", filePath], {
      stdio: "pipe",
    });
  }

  console.log(`Syntax check passed for ${filesToCheck.length} file(s).`);
}

if (require.main === module) {
  main();
}

module.exports = { main };
