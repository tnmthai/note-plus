const { execSync } = require("child_process");
const path = require("path");
const fs = require("fs");

exports.default = async function (context) {
  // Find rcedit - check common locations
  const baseDir = path.join(process.env.LOCALAPPDATA, "electron-builder", "Cache", "winCodeSign");
  let rcedit;

  // Check direct location
  const directPath = path.join(baseDir, "rcedit-x64.exe");
  if (fs.existsSync(directPath)) {
    rcedit = directPath;
  } else {
    // Search in subdirectories
    const dirs = fs.readdirSync(baseDir).filter(d => fs.statSync(path.join(baseDir, d)).isDirectory());
    for (const dir of dirs) {
      const p = path.join(baseDir, dir, "rcedit-x64.exe");
      if (fs.existsSync(p)) {
        rcedit = p;
        break;
      }
    }
  }

  if (!rcedit) {
    console.log("rcedit not found, skipping icon patching");
    return;
  }

  const exe = path.join(context.appOutDir, "Note+.exe");
  const icon = path.join(__dirname, "src", "icon.ico");

  if (!fs.existsSync(icon)) {
    console.log("icon.ico not found, skipping");
    return;
  }

  console.log("Patching exe metadata with rcedit...");
  execSync(`"${rcedit}" "${exe}" --set-icon "${icon}"`);
  execSync(`"${rcedit}" "${exe}" --set-version-string "FileDescription" "Note+ - A lightweight text editor"`);
  execSync(`"${rcedit}" "${exe}" --set-version-string "ProductName" "Note+"`);
  execSync(`"${rcedit}" "${exe}" --set-version-string "CompanyName" "Thai Tran"`);
  execSync(`"${rcedit}" "${exe}" --set-version-string "OriginalFilename" "Note+.exe"`);
  execSync(`"${rcedit}" "${exe}" --set-file-version "1.2.0"`);
  execSync(`"${rcedit}" "${exe}" --set-product-version "1.2.0"`);
  console.log("Exe patched successfully.");
};
