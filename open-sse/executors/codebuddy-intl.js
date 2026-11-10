import { DefaultExecutor } from "./default.js";
import { dbg } from "../utils/debugLog.js";
import { parseCodeBuddyError } from "./codebuddy-error.js";

/**
 * CodeBuddyIntlExecutor — talks to https://www.codebuddy.ai/v2/chat/completions
 *
 * Same OpenAI-compatible-but-stream-only gateway behavior as codebuddy-cn:
 * non-stream requests are rejected, and reasoning is surfaced only when the
 * request carries the IDE's OpenAI-style reasoning params. Force stream and
 * mirror reasoning_summary exactly like CodeBuddyExecutor.
 */
export class CodeBuddyIntlExecutor extends DefaultExecutor {
  constructor() {
    super("codebuddy-intl");
  }

  transformRequest(model, body, stream, credentials) {
    const transformed = super.transformRequest(model, body, stream, credentials);
    transformed.stream = true;

    const eff = transformed.reasoning_effort;
    if (eff === "none" || eff === "off") {
      delete transformed.reasoning_effort;
    } else if (eff) {
      transformed.reasoning_summary = "auto";
    }

    // Tencent WAF flags third-party CLI agent identity strings (Claude Code, Cursor, etc.)
    // as unauthorized tooling / prompt injection and rejects/bans the account.
    // Neutralize only matching agent markers while preserving user system prompts.
    const NEUTRAL_PROMPT = "You are a helpful AI assistant that helps with software engineering tasks.";
    // CLI-identity markers only: generic template markers (<Role>, orchestration capabilities,
    // "you are an agent") are legitimate operator prompts and must not be replaced.
    const AGENT_PATTERN = /you are claude code|claude.?code.+official.+cli|anthropic.+official.+cli|anxthxropic.+official.+cli|you are (?:cursor|windsurf|cline|aider|continue|copilot|cody)|cc_entrypoint\s*=\s*(?:cli|vscode|jetbrains|gui)|claude.?code.+issues|give feedback.+claude.?code|OhMyOpenCode|<agent-identity>/i;

    // CodeBuddy rejects plain OpenAI shape (11101 invalid request): needs a
    // leading system prompt + user content as typed blocks, not a bare string.
    const source = Array.isArray(transformed.messages) ? transformed.messages : [];
    const clientSystemPrompts = source
      .filter((m) => m && ["system", "developer"].includes(m.role))
      .map((m) => {
        const text =
          typeof m.content === "string"
            ? m.content
            : Array.isArray(m.content)
              ? m.content.map((c) => c?.text || "").join("\n")
              : "";
        if (!text || !AGENT_PATTERN.test(text)) return text;
        // Replace only the lines that carry a CLI identity marker and keep the rest of the
        // operator's prompt (project rules, output contract, safety constraints).
        let replaced = 0;
        const kept = text.split("\n").map((line) => {
          if (!AGENT_PATTERN.test(line)) return line;
          replaced++;
          return NEUTRAL_PROMPT;
        });
        dbg("CODEBUDDY-INTL", `neutralized ${replaced} agent-identity line(s) in a client system prompt`);
        // Collapse consecutive neutral lines produced by adjacent matches.
        return kept.filter((line, i) => !(line === NEUTRAL_PROMPT && kept[i - 1] === NEUTRAL_PROMPT)).join("\n");
      })
      .filter(Boolean);

    const systemPromptText =
      clientSystemPrompts.length > 0
        ? clientSystemPrompts.join("\n\n")
        : "You are CodeBuddy Code.";

    transformed.messages = [{ role: "system", content: systemPromptText }];
    for (const message of source) {
      if (!message || typeof message !== "object" || ["system", "developer"].includes(message.role)) continue;
      if (message.role === "user" && typeof message.content === "string") {
        transformed.messages.push({ ...message, content: [{ type: "text", text: message.content }] });
      } else {
        transformed.messages.push({ ...message });
      }
    }

    return transformed;
  }
  parseError(response, bodyText) {
    return parseCodeBuddyError(bodyText) || super.parseError(response, bodyText);
  }
}

export default CodeBuddyIntlExecutor;
