import { resolveDataDir, describeDataDir } from "../../cli/hooks/dataDir.js";

const resolved = resolveDataDir({ warn: (m) => console.warn(m) });

export const DATA_DIR = resolved.dir;
export const DATA_DIR_NOTICE = describeDataDir(resolved);
