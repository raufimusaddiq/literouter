# Free Providers - Zero Cost Fallback

Emergency backup when everything else is quota-limited. Code 24/7 with zero cost!

---

## Overview

Free tier providers are your **fallback** when subscription and cheap quota exhausted:

- 🆓 **Kiro** - Claude and Qwen models, free tier capped at ~50 credits/month
- 🆓 **OpenCode Free** - no auth required, model list auto-fetched upstream
- 🆓 **Vertex AI** - Gemini models on the $300 new-account Google Cloud credit

**Strategy:** Use as emergency backup. Free tiers are capped or promotional, so treat them as overflow rather than a permanent primary.

---

## Kiro (Claude on a free monthly credit)

### Pricing

| Plan | Monthly Cost | Models | Quota |
|------|--------------|--------|-------|
| FREE | $0 | Claude and Qwen families | ~50 credits/month |
| Pro | $20 | same catalog | 1,000 credits |
| Pro+ / Pro Max / Power | $40 / $100 / $200 | same catalog | 2,000 / 5,000 / 10,000 credits |

**Note:** Kiro moved to a paid model in Sep 2025. New accounts also get 500 trial credits in the first 30 days. The `kr/` alias exposes the full catalog; run `/v1/models` to see what your account can actually reach.

### Setup

**Step 1: Connect via Dashboard**

```bash
9router
# Dashboard → Providers → Connect Kiro
```

**Step 2: AWS Builder ID or OAuth**

- Click "Connect Kiro"
- Choose login method:
  - AWS Builder ID (recommended)
  - Google account
  - GitHub account
- Grant permissions
- Auto token refresh enabled

**Step 3: Use in CLI**

```
Model: kr/glm-5
       kr/deepseek-3.2
       kr/qwen3-coder-next
```

### Pro Tips

- **AWS Builder ID** - easiest setup path
- **Credits are shared** across every model on the account, so a heavy Claude day can drain the month
- **Check quota in the dashboard** before routing production work here

---

## OpenCode Free (no auth)

### Setup

```bash
9router
# Dashboard → Providers → Connect OpenCode Free
```

No login. LiteRouter acts as a passthrough proxy and the model list is fetched from upstream.

```
Model: oc/<model-id>
```

**Note:** the free model list rotates. Some entries are limited-time promotions and disappear without notice, so never hard-code `oc/` IDs into a production combo you depend on.

---

## Vertex AI ($300 new-account credit)

### Setup

1. Create a Google Cloud project and enable the Vertex AI API.
2. Create a service account and download the JSON key.
3. Dashboard → Connect Vertex AI → upload the JSON.

```
Model: vertex/gemini-3.1-pro-preview
       vertex/gemini-3-flash-preview
       vertex/gemini-2.5-flash
```

**Note:** since Mar 2026 the Gemini API endpoint no longer consumes the $300 credit. Point the provider at the **Vertex AI Studio** endpoint instead.

---

## Discontinued free tiers

These used to be documented here and no longer work. Do not build a combo around them:

| Provider | Status |
|----------|--------|
| **iFlow** | Moved to paid in 2026 |
| **Qwen Code** | Free OAuth tier discontinued 2026-04-15 |
| **Gemini CLI** | Service shut down 2026-06-18; still present in the catalog but flagged deprecated |

---

## Feature Comparison

| Provider | Models | Best Model | Setup | Quota |
|----------|--------|------------|-------|-------|
| **Kiro** | full catalog | Claude / Qwen families | AWS Builder ID, Google, or GitHub | ~50 credits/month |
| **OpenCode Free** | rotates | passthrough | none | promotional |
| **Vertex AI** | 4+ | Gemini 3.1 Pro | service account JSON | $300 / 90 days |

**Winner:** Kiro for breadth, Vertex for a long-context Gemini at zero cost while the credit lasts.

---

## Usage Example

### Cursor IDE Setup

```
Settings → Models → Advanced:
  OpenAI API Base URL: http://localhost:20128/v1
  OpenAI API Key: [from LiteRouter dashboard]
  Model: kr/glm-5
```

### Create Combo (Recommended)

```
Dashboard → Combos → Create New

Name: free-combo
Models:
  1. kr/glm-5 (Kiro primary)
  2. vertex/gemini-3-flash-preview (Vertex backup)
  3. oc/<model-id> (OpenCode Free overflow)

Use in CLI: free-combo
```

**Result:** Zero cost, maximum uptime!

---

## Full Fallback Strategy

### Complete 3-Tier Combo

```
Dashboard → Combos → Create New

Name: complete-fallback
Models:
  1. cc/claude-opus-5 (Paid subscription)
  2. cx/gpt-5.5 (Paid subscription)
  3. glm/glm-5.1 (Cheap backup, $0.6/1M)
  4. minimax/MiniMax-M2.7 (Cheapest, $0.2/1M)
  5. kr/glm-5 (FREE credit)
  6. vertex/gemini-3-flash-preview (FREE credit)

Use in CLI: complete-fallback
```

**Result:**
- Tier 1: Paid subscription (Claude Code, Codex)
- Tier 2: Cheap backup (GLM, MiniMax)
- Tier 3: FREE credit (Kiro, Vertex AI)

**Never stop coding!**

---

## Best Practices

### 1. Use as Emergency Backup

```
Priority:
1. Subscription tier (maximize paid quota)
2. Cheap tier (pennies per 1M tokens)
3. FREE tier (unlimited, zero cost)

Only use free tier when:
- Subscription quota exhausted
- Budget limit reached
- Testing/non-critical tasks
```

### 2. Choose Right Model

```
Cheap reasoning: glm/glm-5.1
Fast coding: vertex/gemini-3-flash-preview
Free credit: kr/glm-5
Long context: minimax/MiniMax-M2.7
Promotional overflow: oc/<model-id>
```

### 3. Create Free-Only Combo

```
For zero-cost coding:

Name: zero-cost
Models:
  1. kr/glm-5 (Kiro credit)
  2. vertex/gemini-3.1-pro-preview (Vertex credit)
  3. oc/<model-id> (OpenCode Free)

Cost: $0 while the credits last!
```

### 4. Test Before Production

```
Use free tier to:
- Test prompts
- Prototype features
- Learn new frameworks
- Non-critical tasks

Save paid quota for:
- Production code
- Complex refactoring
- Critical features
```

---

## Real-World Examples

### Example 1: Student/Learner (Zero Budget)

```
Setup:
1. kr/glm-5 (Kiro credit)
2. vertex/gemini-3.1-pro-preview (Vertex credit)
3. oc/<model-id> (OpenCode Free)

Monthly cost: $0
Usage: bounded by the monthly credit caps

Perfect for:
- Learning to code
- Personal projects
- Homework/assignments
```

### Example 2: Freelancer (Budget-Conscious)

```
Setup:
1. glm/glm-5.1 (Cheap primary, $0.6/1M)
2. vertex/gemini-3-flash-preview (FREE credit)
3. kr/glm-5 (FREE credit fallback)

Monthly cost: $5-10
Usage: 100M+ tokens

Perfect for:
- Client projects (paid tier)
- Testing (free tier)
- Emergency backup
```

### Example 3: Heavy User (Maximize Everything)

```
Setup:
1. cc/claude-opus-5 (Subscription $20-100)
2. cx/gpt-5.5 (Subscription $20-200)
3. glm/glm-5.1 (Cheap $0.6/1M)
4. minimax/MiniMax-M2.7 (Cheapest $0.2/1M)
5. kr/glm-5 (FREE credit)
6. vertex/gemini-3.1-pro-preview (FREE credit)

Monthly cost: $40-320 (subscriptions) + $10-20 (cheap tier)
Usage: 500M+ tokens

Perfect for:
- Professional development
- Team projects
- 24/7 coding
```

---

## Cost Comparison

### Scenario: 100M tokens/month

**Option 1: ChatGPT API Only**
```
100M × $20/1M = $2,000/month
```

**Option 2: LiteRouter Free Tier Only**
```
100M via free tier = $0 while credits last
Realistically capped well below 100M/month by Kiro credits and the Vertex balance
```

**Option 3: LiteRouter Complete Strategy**
```
30M via Claude Code (subscription): $0 extra
8M via GLM (cheap): $4.80
2M via MiniMax (cheap): $0.40
remainder via Kiro / Vertex credits: $0 extra
Total: $4.80/month + subscriptions you already have
Savings: $1,995/month (99.76%)
```

---

## Troubleshooting

### "OAuth failed"

**Solution:**
- Check internet connection
- Try different browser
- Clear browser cache
- Reconnect in dashboard

### "Model not available"

**Solution:**
- Check provider connected in dashboard
- Verify OAuth token valid
- Reconnect provider if needed

### "Slow responses"

**Solution:**
- Free tier may have lower priority
- Use during off-peak hours
- Switch to different free provider
- Upgrade to cheap tier for speed

---

## Limitations

### Free Tier Considerations

- **Speed** - May be slower than paid tiers
- **Priority** - Lower priority during peak hours
- **Quota** - Capped, not unlimited: Kiro gives ~50 credits/month and Vertex runs off a $300 balance
- **Rotation** - OpenCode Free's model list changes without notice
- **Availability** - May have occasional downtime

**Solution:** Use 3-tier fallback strategy for reliability!

---

## Next Steps

- **Setup subscriptions:** [Subscription Providers](./subscription.md)
- **Add cheap backup:** [Cheap Providers](./cheap.md)
- **Create combos:** Dashboard → Combos → Create New
- **Start coding:** Use `complete-fallback` combo for maximum reliability
