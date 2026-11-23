import { resolveDataDir, describeDataDir } from "../../cli/hooks/dataDir.js";

const resolved = resolveDataDir({ warn: (m) => console.warn(m) });

console.log(describeDataDir(resolved));

export const DATA_DIR = resolved.dir;
