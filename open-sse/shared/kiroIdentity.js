import { pbkdf2Sync } from "crypto";
import {
  KIRO_IDE_VERSION,
  KIRO_SDK_VERSION,
  KIRO_AGENT_OS,
  KIRO_AGENT_OS_VERSION,
  KIRO_NODE_VERSION,
  KIRO_SDK_CLIENTS,
} from "../config/kiroClient.js";

export const KIRO_MACHINE_ID_KEY = "literouter-kiro-machine-id";
const MACHINE_ID_CACHE_MAX = 256;
const machineIds = new Map();

export function deriveKiroMachineId(seed) {
  const cached = machineIds.get(seed);
  if (cached) return cached;
  const id = pbkdf2Sync(seed, KIRO_MACHINE_ID_KEY, 1000, 32, "sha256").toString("hex");
  if (machineIds.size >= MACHINE_ID_CACHE_MAX) machineIds.delete(machineIds.keys().next().value);
  machineIds.set(seed, id);
  return id;
}

export function buildKiroIdentityHeaders(credentials, client = "runtime") {
  const seed =
    credentials?.providerSpecificData?.clientId
    || credentials?.refreshToken
    || credentials?.providerSpecificData?.profileArn
    || credentials?.apiKey
    || credentials?.accessToken
    || "kiro-anonymous";
  const machineId = deriveKiroMachineId(String(seed));
  const { api, metrics } = KIRO_SDK_CLIENTS[client] || KIRO_SDK_CLIENTS.runtime;
  const identity = `KiroIDE-${KIRO_IDE_VERSION}-${machineId}`;

  return {
    "User-Agent":
      `aws-sdk-js/${KIRO_SDK_VERSION} ua/2.1 ` +
      `os/${KIRO_AGENT_OS}#${KIRO_AGENT_OS_VERSION} ` +
      `lang/js md/nodejs#${KIRO_NODE_VERSION} ` +
      `api/${api}#${KIRO_SDK_VERSION} m/${metrics} ${identity}`,
    "x-amz-user-agent": `aws-sdk-js/${KIRO_SDK_VERSION} ${identity}`,
  };
}
