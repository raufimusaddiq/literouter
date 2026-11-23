#!/usr/bin/env node

const { ensureRuntime } = require("./runtime");

ensureRuntime({ silent: false })
  .then((res) => {
    if (res.ok || res.skipped === "ready") console.log("[9router] runtime deps ready");
    else console.warn(`[9router] runtime warm-up skipped: ${res.reason || res.skipped}`);
  })
  .catch((e) => console.warn(`[9router] runtime warm-up skipped: ${e.message}`))
  .finally(() => process.exit(0));
