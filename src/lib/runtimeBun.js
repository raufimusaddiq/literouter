export function bunCommand(versions = process.versions) {
  if (!versions.bun) return { command: null, env: { BUN_BE_BUN: "1" } };
  return { command: process.execPath, env: { BUN_BE_BUN: "1" } };
}
