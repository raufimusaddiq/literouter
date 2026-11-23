export function bunCommand() {
  return { command: process.execPath, env: { BUN_BE_BUN: "1" } };
}
