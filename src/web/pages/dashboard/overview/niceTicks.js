const MULTIPLIERS = [1, 2, 2.5, 5, 10];

export function niceTicks(max, count = 4, { integer = true } = {}) {
  const steps = Math.max(1, Math.round(Number(count) || 4));
  const safeMax = Number.isFinite(max) && max > 0 ? max : 0;
  const rawStep = safeMax / steps;

  let step = 1;
  if (integer) {
    if (rawStep > 1) {
      const pow = 10 ** Math.floor(Math.log10(rawStep));
      const frac = rawStep / pow;
      const mult = MULTIPLIERS.find((m) => Number.isInteger(m * pow) && m + 1e-12 >= frac) ?? 10;
      step = mult * pow;
    }
    return Array.from({ length: steps + 1 }, (_, i) => i * step);
  }

  if (rawStep > 0) {
    const pow = 10 ** Math.floor(Math.log10(rawStep));
    const frac = rawStep / pow;
    const mult = MULTIPLIERS.find((m) => m + 1e-12 >= frac) ?? 10;
    step = mult * pow;
  }

  return Array.from({ length: steps + 1 }, (_, i) => Number((i * step).toPrecision(12)));
}
