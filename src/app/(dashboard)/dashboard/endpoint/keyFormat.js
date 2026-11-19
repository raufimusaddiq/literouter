export function maskKey(fullKey) {
  if (!fullKey || fullKey.length <= 10) return fullKey || "";
  return `${fullKey.slice(0, 6)}…${fullKey.slice(-4)}`;
}

export function relativeTime(iso, now = Date.now()) {
  if (!iso) return "—";
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "—";
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  return `${Math.round(h / 24)} d ago`;
}

// Default order: last used desc, never-used last (then by name).
export function sortKeysByLastUsed(keys, usage) {
  const ts = (k) => {
    const v = usage?.[k.id]?.lastUsed;
    return v ? new Date(v).getTime() : -1;
  };
  return [...keys].sort((a, b) => ts(b) - ts(a) || String(a.name).localeCompare(String(b.name)));
}
