# 9Router — Agent Skills

Drop-in skills for any AI agent (Claude, Cursor, ChatGPT, custom SDK). Just **copy a link** below and paste it to your AI — it will fetch the skill and use 9Router for you.

> Tip: start with the **9router** entry skill — it covers setup for the retained chat gateway.

## Skills

| Capability | Copy link below and paste to your AI |
|---|---|
| **Entry / Setup** (start here) | https://raw.githubusercontent.com/decolua/9router/refs/heads/master/skills/9router/SKILL.md |
| Chat / code-gen | https://raw.githubusercontent.com/decolua/9router/refs/heads/master/skills/9router-chat/SKILL.md |

## How to use

Paste to your AI (Claude, Cursor, ChatGPT, …):

```
Read this skill and use it: https://raw.githubusercontent.com/decolua/9router/refs/heads/master/skills/9router/SKILL.md
```

Then ask normally for chat or code generation.

## Configure your shell once

```bash
export NINEROUTER_URL="http://localhost:20128"   # local default, or your VPS / tunnel URL
export NINEROUTER_KEY="sk-..."                   # from Dashboard → Keys (only if requireApiKey=true)
```

Verify: `curl $NINEROUTER_URL/api/health` → `{"ok":true}`.

## Links

- Source: https://github.com/decolua/9router
- Dashboard: https://9router.com
