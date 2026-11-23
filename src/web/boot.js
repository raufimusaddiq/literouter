function isValidZone(zone) {
  if (typeof zone !== "string" || !zone) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

function defaultZone() {
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return isValidZone(zone) ? zone : "UTC";
  } catch {
    return "UTC";
  }
}

function readRaw() {
  if (typeof window === "undefined" || !window) return {};
  const raw = window.__LR_BOOT__;
  return raw && typeof raw === "object" ? raw : {};
}

export function getBoot() {
  const raw = readRaw();
  return {
    timeZone: isValidZone(raw.timeZone) ? raw.timeZone : defaultZone(),
    gaId: typeof raw.gaId === "string" && raw.gaId ? raw.gaId : null,
    requireLogin: typeof raw.requireLogin === "boolean" ? raw.requireLogin : true,
    locale: typeof raw.locale === "string" && raw.locale ? raw.locale : "en",
  };
}
