import fs from "node:fs";

export const MAX_RAW_SAMPLES = 200;

export function capSamples(items, max = MAX_RAW_SAMPLES) {
  if (!Array.isArray(items)) return [];
  if (items.length <= max) return items.slice();
  const out = [];
  const step = (items.length - 1) / (max - 1);
  for (let i = 0; i < max; i++) out.push(items[Math.round(i * step)]);
  return out;
}

export function slimRun(run, max = MAX_RAW_SAMPLES) {
  return { report: run.report, sampleCount: run.results?.length ?? 0, samples: capSamples(run.results, max) };
}

function safeWrite(file, produce) {
  try {
    fs.writeFileSync(file, produce());
    return { path: file, ok: true };
  } catch (e) {
    return { path: file, ok: false, error: e?.message || String(e) };
  }
}

export function writeReports(base, mdLines, out, { quiet = false } = {}) {
  const results = [
    safeWrite(`${base}.md`, () => mdLines.join("\n")),
    safeWrite(`${base}.json`, () => JSON.stringify(out, null, 2)),
  ];
  for (const r of results) if (!quiet || !r.ok) console.log(r.ok ? `wrote ${r.path}` : `FAILED to write ${r.path}: ${r.error}`);
  return results;
}
