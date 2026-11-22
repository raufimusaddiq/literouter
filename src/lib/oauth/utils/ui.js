import ora from "ora";

/**
 * UI Helper Functions
 */

export function spinner(text) {
  return ora(text);
}
