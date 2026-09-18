// Shim → re-export from new SQLite-based DB layer (src/lib/db/)
export {
  statsEmitter, trackPendingRequest, getActiveRequests,
  saveRequestUsage, getUsageHistory, getUsageStats, getChartData,
  appendRequestLog, getRecentLogs,
  saveRequestDetail, getRequestDetails, getRequestDetailById,
  flushRequestDetails,
  ensureRequestDetailShutdownHandler,
} from "@/lib/db/index.js";

// Register the bounded-buffer drain at import time. Importing this shim is
// enough to guarantee a SIGTERM drain exists in every bundled server entry.
ensureRequestDetailShutdownHandler();
