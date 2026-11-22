import { createHash } from "crypto";
import {
  KIRO_IDE_VERSION,
  KIRO_SDK_VERSION,
  KIRO_AGENT_OS,
  KIRO_AGENT_OS_VERSION,
  KIRO_NODE_VERSION,
  KIRO_SDK_CLIENTS,
} from "../config/kiroClient.js";

export function buildKiroIdentityHeaders(credentials, client = "runtime") {
  const seed =
    credentials?.providerSpecificData?.clientId
    || credentials?.refreshToken
    || credentials?.providerSpecificData?.profileArn
    || credentials?.apiKey
    || credentials?.accessToken
    || "kiro-anonymous";
  const machineId = createHash("sha256").update(String(seed)).digest("hex");
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
