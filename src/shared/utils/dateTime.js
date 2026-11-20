// One app timezone for server and UI. The server's effective zone (TZ) is
// handed to the client by the dashboard layout (TimezoneProvider), so SSR and
// client render identical text and every viewer sees the deployment's zone.
let appTimeZone = null;

export function getServerTimeZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

export function setAppTimeZone(tz) {
  if (!tz) return;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    appTimeZone = tz;
  } catch {
    // invalid zone: keep the previous one
  }
}

export function getAppTimeZone() {
  return appTimeZone || getServerTimeZone();
}

function toDate(value) {
  const d = value instanceof Date ? value : new Date(value);
  return Number.isFinite(d.getTime()) ? d : null;
}

function fmt(value, options, timeZone, locale = "en-US") {
  const d = toDate(value);
  if (!d) return "";
  return new Intl.DateTimeFormat(locale, { ...options, timeZone: timeZone || getAppTimeZone() }).format(d);
}

export function formatDateTime(value, timeZone, options) {
  return fmt(value, options || {
    year: "numeric", month: "numeric", day: "numeric",
    hour: "numeric", minute: "2-digit", second: "2-digit", hour12: false,
  }, timeZone);
}

export function formatTime(value, timeZone, options) {
  return fmt(value, options || { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }, timeZone);
}

export function formatDate(value, timeZone, options) {
  return fmt(value, options || { year: "numeric", month: "numeric", day: "numeric" }, timeZone);
}

/** Short zone label, e.g. "GMT+7" (Asia/Jakarta) or "UTC". */
export function formatZoneLabel(timeZone, at = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: timeZone || getAppTimeZone(), timeZoneName: "short" }).formatToParts(at);
  return parts.find((p) => p.type === "timeZoneName")?.value || "";
}
