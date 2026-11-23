const { execSync } = require("child_process");

function copyToClipboard(text) {
  try {
    const platform = process.platform;
    
    if (platform === "darwin") {
      execSync("pbcopy", { input: text });
    } else if (platform === "win32") {
      execSync("clip", { input: text });
    } else {
      try {
        execSync("xclip -selection clipboard", { input: text });
      } catch {
        execSync("xsel --clipboard --input", { input: text });
      }
    }
    return true;
  } catch (error) {
    return false;
  }
}

module.exports = { copyToClipboard };
