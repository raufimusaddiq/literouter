const BYTES_PER_MB = 1_000_000;
const DEFAULT_MAX_MB = 150;

export function assertImageSize(sizeBytes, maxMb) {
  const size = typeof sizeBytes === "string" && sizeBytes.trim() !== "" ? Number(sizeBytes) : sizeBytes;
  if (typeof size !== "number" || !Number.isFinite(size) || size < 0) {
    throw new Error(`image size is not a number: ${String(sizeBytes)}`);
  }
  const mb = Number((size / BYTES_PER_MB).toFixed(1));
  if (size > maxMb * BYTES_PER_MB) throw new Error(`image is ${mb.toFixed(1)} MB, limit ${maxMb} MB`);
  return { mb };
}

function inspectSize(image) {
  const run = Bun.spawnSync(["docker", "image", "inspect", image, "--format", "{{.Size}}"], { stdout: "pipe", stderr: "pipe" });
  if (run.exitCode !== 0) throw new Error(`docker image inspect ${image} failed: ${run.stderr.toString().trim()}`);
  return run.stdout.toString().trim();
}

if (import.meta.main) {
  try {
    const argv = process.argv.slice(2);
    const maxIndex = argv.indexOf("--max-mb");
    const maxMb = maxIndex === -1 ? DEFAULT_MAX_MB : Number(argv[maxIndex + 1]);
    if (!Number.isFinite(maxMb) || maxMb <= 0) throw new Error("--max-mb needs a positive number");
    const image = argv.find((arg, index) => !arg.startsWith("--") && argv[index - 1] !== "--max-mb");
    if (!image) throw new Error("usage: check-image-size.mjs <image> [--max-mb 150]");
    const { mb } = assertImageSize(inspectSize(image), maxMb);
    console.log(`size_mb=${mb}`);
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
