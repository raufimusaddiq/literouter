
export const QODER_OPENAPI_BASE = "https://openapi.qoder.sh";
export const QODER_CHAT_BASE = "https://api3.qoder.sh";
export const QODER_CHAT_BASE_ALT = "https://api2.qoder.sh";

export const QODER_LOGIN_URL = "https://qoder.com/device/selectAccounts";

export const QODER_DEVICE_TOKEN_URL = `${QODER_OPENAPI_BASE}/api/v1/deviceToken/poll`;
export const QODER_USERINFO_URL = `${QODER_OPENAPI_BASE}/api/v1/userinfo`;

export const QODER_JOB_TOKEN_EXCHANGE_URL = `${QODER_OPENAPI_BASE}/api/v1/jobToken/exchange`;

export const QODER_CHAT_SIG_PATH = "/api/v2/service/pro/sse/agent_chat_generation";
export const QODER_CHAT_URL = `${QODER_CHAT_BASE}/algo${QODER_CHAT_SIG_PATH}?FetchKeys=llm_model_result&AgentId=agent_common`;
export const QODER_CHAT_URL_ENCODED = `${QODER_CHAT_URL}&Encode=1`;
export const QODER_MODEL_LIST_URL = `${QODER_CHAT_BASE}/algo/api/v2/model/list`;
export const QODER_IMAGE_UPLOAD_SIG_PATH = "/api/v2/image/upload";

export const QODER_MAX_PAYLOAD_BYTES = 6 * 1024 * 1024;
export const QODER_INLINE_FALLBACK_MAX_BYTES = 512 * 1024;

export const QODER_CONTEXT_TIER_HEADROOM = 0.15;
export const QODER_CONTEXT_TIER_ENV = "QODER_CONTEXT_TIER";
export const QODER_CONTEXT_TIER_MODES = Object.freeze({ AUTO: "auto", MAX: "max", DEFAULT: "default" });

export function qoderInferenceBase(credentials) {
  const raw = credentials?.apiKey || credentials?.accessToken;
  if (
    typeof raw === "string" &&
    !raw.startsWith("pt-") &&
    (raw.startsWith("jt-") || (credentials?.accessToken || "").startsWith("jt-"))
  ) {
    return QODER_CHAT_BASE_ALT;
  }
  return QODER_CHAT_BASE;
}

export const QODER_IDE_VERSION = "1.0.0";
export const QODER_CLIENT_TYPE = "5";
export const QODER_DATA_POLICY = "disagree";
export const QODER_LOGIN_VERSION = "v2";
export const QODER_MACHINE_OS = "x86_64_windows";
export const QODER_MACHINE_TYPE = "5";

export const QODER_MODEL_MAP = {
  auto: "auto",
  ultimate: "ultimate",
  performance: "performance",
  efficient: "efficient",
  lite: "lite",
  qmodel: "qmodel",
  qfmodel: "qfmodel",
  qmodel_latest: "qmodel_latest",
  qmodel_38max: "qmodel_38max",
  dmodel: "dmodel",
  dfmodel: "dfmodel",
  gmodel: "gmodel",
  gfmodel: "gfmodel",
  kmodel: "kmodel",
  mmodel: "mmodel",
};

export const QODER_RSA_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDA8iMH5c02LilrsERw9t6Pv5Nc
4k6Pz1EaDicBMpdpxKduSZu5OANqUq8er4GM95omAGIOPOh+Nx0spthYA2BqGz+l
6HRkPJ7S236FZz73In/KVuLnwI8JJ2CbuJap8kvheCCZpmAWpb/cPx/3Vr/J6I17
XcW+ML9FoCI6AOvOzwIDAQAB
-----END PUBLIC KEY-----`;
