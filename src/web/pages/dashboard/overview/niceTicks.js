export function niceTicks(max, count = 4) {
  const steps = Math.max(1, Math.round(Number(count) || 4));
  const safeMax = Number.isFinite(max) && max > 0 ? max : 0;
  const rawStep = safeMax / steps;

  let step = 1;
  if (rawStep > 1) {
    const pow = 10 ** Math.floor(Math.log10(rawStep));
    const frac = rawStep / pow;
    const scale = pow >= 10 ? [1, 2.5, 5, 10] : [1, 2, 5, 10];
    const mult = scale.find((m) => m + 1e-12 >= frac) ?? 10;
    step = Math.round(mult * pow);
  }

  return Array.from({ length: steps + 1 }, (_, i) => i * step);
}
