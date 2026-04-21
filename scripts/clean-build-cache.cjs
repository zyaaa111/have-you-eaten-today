const fs = require("fs");
const path = require("path");

const root = process.cwd();
const tsBuildInfoPath = path.join(root, "tsconfig.tsbuildinfo");

try {
  if (fs.existsSync(tsBuildInfoPath)) {
    fs.rmSync(tsBuildInfoPath, { force: true });
  }
} catch (error) {
  console.warn("[clean-build-cache] failed to remove tsconfig.tsbuildinfo:", error);
}
