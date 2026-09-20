// Stable executor module boundary.
// Specialized executors are loaded lazily by runtime.js; keeping getExecutor
// exported from this historical path preserves mocks/import compatibility.
export {
  getExecutor,
  hasSpecializedExecutor,
  clearExecutorCache,
  __executorLoaders,
} from "./runtime.js";

export { BaseExecutor } from "./base.js";
export { DefaultExecutor } from "./default.js";
