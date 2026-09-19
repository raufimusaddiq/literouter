# Welcome to LiteRouter

**Use Claude, Codex, and Gemini from $0.20/1M tokens • Free tiers where they still exist**

LiteRouter is an AI model router that maximizes your subscription value and minimizes costs through intelligent routing and automatic fallback.

---

## What is LiteRouter?

LiteRouter is a smart proxy that sits between your coding tools (Cursor, Cline, Claude Desktop) and AI providers. It automatically routes requests to the best available model based on quota, cost, and availability.

**Stop wasting money:**
- ❌ Subscription quota expires unused every month
- ❌ Rate limits stop you mid-coding
- ❌ Expensive APIs ($20-50/month per provider)
- ❌ Manual switching between providers

**Start maximizing value:**
- ✅ **Maximize Subscriptions** - Track and use every bit of Claude Code, Codex, GitHub Copilot quota
- ✅ **FREE Available** - Kiro, OpenCode Free, and Google Vertex AI
- ✅ **Ultra-Cheap Backup** - GLM ($0.60/1M), MiniMax ($0.20/1M), Kimi ($9/month flat)
- ✅ **Smart Fallback** - Subscription → Cheap → Free, automatic switching

---

## Key Features

### 🔄 Smart 3-Tier Fallback

```
Setup once, never stop coding:

Tier 1 (SUBSCRIPTION): Claude Code → Codex → GitHub Copilot
  ↓ quota exhausted
Tier 2 (CHEAP): GLM → MiniMax → Kimi
  ↓ budget limit
Tier 3 (FREE): Kiro → OpenCode Free → Vertex AI

→ Automatic switching, zero downtime!
```

### 📊 Quota Tracking

- Real-time token consumption per provider
- Reset countdown (5-hour, daily, weekly, monthly)
- Cost estimation for paid tiers
- Monthly spending reports

### 🎯 Universal CLI Support

Works with any tool that supports custom OpenAI endpoints:

✅ **Cursor** • **Cline** • **Claude Desktop** • **Codex** • **RooCode** • **Continue** • **Any OpenAI-compatible tool**

### 💰 Cost Optimization

**Real example (100M tokens/month):**
```
60M via Kiro: ~$0 (free credits)
30M via Claude Code: $0 (subscription you already have)
8M via GLM: $4.80
2M via MiniMax: $0.40
Total: $5.20/month vs $2000 on ChatGPT API!
```

---

## Why Choose LiteRouter?

### Maximize Subscriptions

Already paying for Claude Code ($20-100/month) or Codex ($20-200/month)? Get full value:

- Track quota usage in real-time
- Auto-switch when quota resets (5-hour, weekly)
- Use every token before it expires
- GitHub Copilot: quota shared with your existing subscription

### Ultra-Cheap Backup

When subscription quota runs out, pay pennies:

| Provider | Cost per 1M tokens | Reset |
|----------|-------------------|-------|
| **GLM** | $0.60 input / $2.20 output | Daily 10:00 AM |
| **MiniMax** | $0.20 input / $1.00 output | 5-hour rolling |
| **Kimi** | $9/month (10M tokens) | Monthly |

**~90% cheaper than ChatGPT API ($20/1M)!**

### Free Forever Fallback

Emergency backup when everything else is quota-limited:

- **Kiro**: Claude and Qwen models, free tier capped at ~50 credits/month (AWS Builder ID / Google / GitHub)
- **OpenCode Free**: no auth, model list auto-fetched from upstream and changes without notice
- **Vertex AI**: Gemini models on the $300 new-account Google Cloud credit (use the Vertex AI Studio endpoint)

**Discontinued free tiers:** iFlow, Qwen Code, and Gemini CLI shut down their free tiers in 2026. They are no longer recommended, and Gemini CLI is marked deprecated in the provider catalog.

---

## Quick Start

Get started in 2 minutes:

```bash
# Install globally
npm install -g 9router

# Start (dashboard opens automatically)
9router
```

🎉 **Dashboard opens** → Connect providers → Start coding!

**Use in your CLI tool:**

```
Endpoint: http://localhost:20128/v1
API Key: [from dashboard]
Model: cc/claude-opus-5
```

[→ Full Getting Started Guide](getting-started.md)

---

## Use Cases

### For Individual Developers

- Maximize your Claude Code/Codex subscription
- Use Kiro's free monthly credits for non-critical work
- Fallback to ultra-cheap models ($0.20/1M)
- Code 24/7 without rate limits

### For Teams

- Deploy on VPS/Cloud for shared access
- Track team spending in real-time
- Set budget limits per tier
- Centralized provider management

### For Mobile/Remote Coding

- Use cloud deployment (https://ai.investdx.biz.id)
- Access from iPad, phone, anywhere
- No localhost limitations
- Cloudflare edge network (300+ locations)

---

## What's Next?

- [Getting Started](getting-started.md) - Install and configure in 5 minutes
- [Installation Guide](getting-started/installation.md) - Detailed setup instructions
- [Features](features/) - Explore all capabilities
- [FAQ](faq.md) - Common questions

---

<div align="center">
  <sub>Built with ❤️ for developers maximizing AI value</sub>
</div>
