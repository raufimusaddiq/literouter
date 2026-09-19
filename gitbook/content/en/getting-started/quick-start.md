# Getting Started

Get LiteRouter running in 5 minutes and start routing AI requests intelligently.

---

## Quick Start

### 1. Install

```bash
npm install -g 9router
```

**Requirements:** Node.js 20+ ([Installation details](getting-started/installation.md))

### 2. Start

```bash
9router
```

🎉 **Dashboard opens automatically** at `http://localhost:20128`

- Default password: `123456` (change in dashboard)
- API key generated automatically
- Ready to connect providers

### 3. Connect Providers

You have 3 ways to connect providers:

#### Option A: OAuth (Subscription Providers)

**Best for:** Claude Code, Codex, GitHub Copilot, Cursor

```
Dashboard → Providers → Connect [Provider]
→ OAuth login → Auto token refresh
→ Quota tracking enabled
```

**Example: Claude Code**
1. Click "Connect Claude Code"
2. Login with your Claude account
3. Authorize LiteRouter
4. ✅ Done! Use model: `cc/claude-opus-5`

#### Option B: API Key (Cheap Providers)

**Best for:** GLM, MiniMax, Kimi, OpenRouter

```
Dashboard → Providers → Add API Key
→ Select provider
→ Paste API key
→ Save
```

**Example: GLM**
1. Sign up at [Zhipu AI](https://open.bigmodel.cn/)
2. Get API key from Coding Plan
3. Dashboard → Add API Key → Provider: `glm` → Paste key
4. ✅ Done! Use model: `glm/glm-5.1`

#### Option C: Free Providers (No Cost)

**Best for:** Kiro, OpenCode Free, Vertex AI

```
Dashboard → Providers → Connect [Free Provider]
→ OAuth, service account, or no auth at all
→ Free within a monthly credit cap
```

**Example: Kiro**
1. Click "Connect Kiro"
2. Sign in with AWS Builder ID, Google, or GitHub
3. Authorize
4. ✅ Done! Use `kr/glm-5`, `kr/deepseek-3.2`, and the rest of the Kiro catalog.

**Example: OpenCode Free**
1. Click "Connect OpenCode Free"
2. No login required (passthrough proxy)
3. ✅ Done! Use `oc/<model-id>` with the list auto-fetched from upstream.

---

## 4. Use in CLI Tools

Point your coding tool to LiteRouter:

### Cursor IDE

```
Settings → Models → Advanced:
  OpenAI API Base URL: http://localhost:20128/v1
  OpenAI API Key: [from LiteRouter dashboard]
  Model: cc/claude-opus-5
```

### Claude Desktop

Edit `~/.claude/config.json`:

```json
{
  "anthropic_api_base": "http://localhost:20128/v1",
  "anthropic_api_key": "your-literouter-api-key"
}
```

### Cline / Continue / RooCode

```
Provider: OpenAI Compatible
Base URL: http://localhost:20128/v1
API Key: [from dashboard]
Model: cc/claude-opus-5
```

### Codex CLI

```bash
export OPENAI_BASE_URL="http://localhost:20128"
export OPENAI_API_KEY="your-9router-api-key"

codex "your prompt"
```

---

## 5. Create Smart Combos (Optional)

Combos enable automatic fallback between models:

```
Dashboard → Combos → Create New

Name: premium-coding
Models:
  1. cc/claude-opus-5 (Subscription primary)
  2. glm/glm-5.1 (Cheap backup, $0.6/1M)
  3. kr/glm-5 (Free credit fallback)

Use in CLI: premium-coding
```

**How it works:**
1. Tries Claude Opus first (your subscription)
2. If quota exhausted → GLM (ultra-cheap)
3. If budget limit → Kiro free credits
4. Zero downtime, automatic switching!

---

## Available Models

### Subscription Models (Maximize First)

**Claude Code (`cc/`)** - Pro/Max subscription:
- `cc/claude-opus-5` - Claude Opus 5
- `cc/claude-sonnet-5` - Claude Sonnet 5
- `cc/claude-haiku-4-5-20251001` - Claude 4.5 Haiku

**Codex (`cx/`)** - Plus/Pro subscription:
- `cx/gpt-5.5` - GPT-5.5
- `cx/gpt-5.4` - GPT-5.4
- `cx/gpt-5.3-codex` - GPT-5.3 Codex

**GitHub Copilot (`gh/`)** - Subscription:
- `gh/gpt-5.4` - GPT-5.4
- `gh/claude-sonnet-4.6` - Claude Sonnet 4.6

### Cheap Models (Backup)

**GLM (`glm/`)** - $0.6/$2.2 per 1M:
- `glm/glm-5.1` - GLM 5.1 (daily reset 10AM)
- `glm/glm-5` - GLM 5

**MiniMax (`minimax/`)** - $0.20/$1.00 per 1M:
- `minimax/MiniMax-M2.7` - MiniMax M2.7 (5h reset)

**Kimi (`kimi/`)** - $9/month (10M tokens):
- `kimi/kimi-k2.5` - Kimi K2.5

### FREE Models (Emergency)

**Kiro (`kr/`)** - free tier capped at ~50 credits/month:
- `kr/glm-5` - GLM-5
- `kr/deepseek-3.2` - DeepSeek 3.2
- `kr/glm-5` - Claude Sonnet 4.5

**OpenCode Free (`oc/`)** - no auth, model list rotates:
- `oc/<model-id>` - check `/v1/models` for the current list

**Vertex AI (`vertex/`)** - $300 new-account credit:
- `vertex/gemini-3.1-pro-preview` - Gemini 3.1 Pro
- `vertex/gemini-3-flash-preview` - Gemini 3 Flash

**Discontinued:** iFlow, Qwen Code, and Gemini CLI free tiers no longer work. See [Free Providers](../providers/free.md).

---

## Cost Optimization Strategy

### Monthly Budget: $10-20/month

```
1. Use Claude Code subscription quota fully (you already pay)
2. Fallback to GLM ($0.6/1M) when quota out
3. Emergency: MiniMax M2.7 ($0.20/1M)
4. Last resort: Kiro / Vertex AI free credits

Real example (100M tokens/month):
  30M via Claude Code: $0 (subscription you already have)
  8M via GLM: $4.80
  2M via MiniMax: $0.40
  remainder via Kiro / Vertex credits: $0 extra
  Total: $5.20/month + existing subscriptions
```

### Quota Reset Strategy

```
Daily routine:
1. Morning: Fresh Claude Code quota (5h reset)
2. Afternoon: Kiro free credits
3. Evening: GLM daily quota (reset 10AM next day)
4. Late night: MiniMax (5h rolling)

→ Code 24/7 with minimal extra cost!
```

---

## Next Steps

- [Installation Details](getting-started/installation.md) - Requirements, troubleshooting
- [Features](features/) - Explore quota tracking, combos, deployment
- [FAQ](faq.md) - Common questions and answers
- [Troubleshooting](troubleshooting.md) - Fix common issues

---

## Need Help?

- **Website**: [ai-staging.investdx.biz.id](https://ai-staging.investdx.biz.id)
- **GitHub**: [github.com/decolua/9router](https://github.com/decolua/9router)
- **Issues**: [github.com/decolua/9router/issues](https://github.com/decolua/9router/issues)
