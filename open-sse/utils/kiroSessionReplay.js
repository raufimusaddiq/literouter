import { MEMORY_CONFIG } from "../config/runtimeConfig.js";
import { createTtlLruMap } from "./ttlLruMap.js";

const sessionStartStore = createTtlLruMap("kiro:sessionStart", {
  maxSize: 5000,
  ttlMs: MEMORY_CONFIG.sessionTtlMs,
  cleanupIntervalMs: MEMORY_CONFIG.sessionCleanupIntervalMs,
});

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function sessionKey(connectionId, conversationId) {
  return `${connectionId || ""}:${conversationId || ""}`;
}

function ensureUserMessageModelId(message, modelId) {
  if (message?.userInputMessage && !message.userInputMessage.modelId && modelId) {
    message.userInputMessage.modelId = modelId;
  }
  return message;
}

function ensureHistoryModelIds(history, modelId) {
  for (const item of history || []) {
    ensureUserMessageModelId(item, modelId);
  }
  return history;
}

function prefixUserMessage(message, contentPrefix, modelId) {
  const out = clone(message) || { userInputMessage: { content: "" } };
  if (!out.userInputMessage) out.userInputMessage = { content: "" };
  ensureUserMessageModelId(out, modelId);
  if (contentPrefix) {
    const content = out.userInputMessage.content || "";
    out.userInputMessage.content = content
      ? `${contentPrefix}\n\n${content}`
      : contentPrefix;
  }
  return out;
}

function findFirstUserIndex(history) {
  return history.findIndex((item) => item?.userInputMessage);
}

function hasToolResults(message) {
  return !!message?.userInputMessage?.userInputMessageContext?.toolResults?.length;
}

function canReplaceSessionStart(history, firstUserIndex) {
  return firstUserIndex === 0 && !hasToolResults(history[firstUserIndex]);
}

function rememberSessionStart(key, entry) {
  sessionStartStore.set(key, entry);
}

export function applyKiroSessionReplay({
  conversationId,
  connectionId,
  modelId,
  systemPrompt = "",
  contentPrefix = "",
  currentContentPrefix = "",
  history = [],
  currentMessage,
} = {}) {
  const key = sessionKey(connectionId, conversationId);
  const existing = conversationId ? sessionStartStore.get(key) : null;
  const baseHistory = clone(history) || [];
  const baseCurrent = clone(currentMessage) || { userInputMessage: { content: "" } };

  if (existing && existing.modelId === modelId && existing.systemPrompt === systemPrompt) {
    const firstUserIndex = findFirstUserIndex(baseHistory);
    const sessionStart = ensureUserMessageModelId(clone(existing.sessionStart), modelId);
    if (canReplaceSessionStart(baseHistory, firstUserIndex)) {
      baseHistory[firstUserIndex] = sessionStart;
    } else {
      baseHistory.unshift(sessionStart);
      if (baseHistory.length === 1) {
        baseHistory.push({ assistantResponseMessage: { content: "..." } });
      }
    }
    return {
      history: ensureHistoryModelIds(baseHistory, modelId),
      currentMessage: prefixUserMessage(baseCurrent, currentContentPrefix, modelId),
      replayed: true,
    };
  }

  const firstUserIndex = findFirstUserIndex(baseHistory);
  let sessionStart;
  let nextCurrent = ensureUserMessageModelId(baseCurrent, modelId);
  if (canReplaceSessionStart(baseHistory, firstUserIndex)) {
    sessionStart = prefixUserMessage(baseHistory[firstUserIndex], contentPrefix, modelId);
    baseHistory[firstUserIndex] = clone(sessionStart);
    nextCurrent = prefixUserMessage(baseCurrent, currentContentPrefix, modelId);
  } else if (firstUserIndex >= 0) {
    sessionStart = prefixUserMessage(
      { userInputMessage: { content: "", modelId } },
      contentPrefix,
      modelId
    );
    baseHistory.unshift(clone(sessionStart));
    nextCurrent = prefixUserMessage(baseCurrent, currentContentPrefix, modelId);
  } else {
    sessionStart = prefixUserMessage(baseCurrent, contentPrefix, modelId);
    nextCurrent = clone(sessionStart);
  }

  if (conversationId) {
    rememberSessionStart(key, {
      sessionStart: clone(sessionStart),
      modelId,
      systemPrompt,
    });
  }

  return {
    history: ensureHistoryModelIds(baseHistory, modelId),
    currentMessage: nextCurrent,
    replayed: false,
  };
}

export function clearKiroSessionReplayStore() {
  sessionStartStore.clear();
}
