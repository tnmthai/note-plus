const { execSync } = require("child_process");
const path = require("path");

exports.default = async function (context) {
  const rcedit = path.join(
    process.env.LOCALAPPDATA,
    "electron-builder",
    "Cache",
    "winCodeSign",
    "860292627",
    "rcedit-x64.exe"
  );
  const exe = path.join(context.appOutDir, "Note+.exe");
  const icon = path.join(__dirname, "src", "icon.ico");

  console.log("Patching exe metadata with rcedit...");
  execSync(`"${rcedit}" "${exe}" --set-icon "${icon}"`);
  execSync(`"${rcedit}" "${exe}" --set-version-string "FileDescription" "Note+ - A lightweight text editor"`);
  execSync(`"${rcedit}" "${exe}" --set-version-string "ProductName" "Note+"`);
  execSync(`"${rcedit}" "${exe}" --set-version-string "CompanyName" "Thai Tran"`);
  execSync(`"${rcedit}" "${exe}" --set-version-string "OriginalFilename" "Note+.exe"`);
  execSync(`"${rcedit}" "${exe}" --set-file-version "1.1.0"`);
  execSync(`"${rcedit}" "${exe}" --set-product-version "1.1.0"`);
  console.log("Exe patched successfully.");
};
