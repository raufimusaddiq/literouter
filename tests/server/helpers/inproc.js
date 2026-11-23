import { vi } from "#test/vi";
import { useTempDataDirAtLoad } from "../../helpers/tempDataDir.js";
import { mockBootCollaborators } from "../../helpers/bootMocks.js";

export async function loadServerModule(prefix) {
  useTempDataDirAtLoad(prefix);
  mockBootCollaborators();
  vi.resetModules();
  return import("../../../src/server/index.js");
}
