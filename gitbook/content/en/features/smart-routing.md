# Smart Routing & Auto Fallback

LiteRouter automatically routes your requests through the best available provider using a 3-tier fallback system. Never stop coding due to quota limits or rate limiting.

---

## How It Works

LiteRouter uses intelligent routing to maximize your existing subscriptions, minimize costs, and ensure 24/7 availability:

```
Request → LiteRouter → Check Tier 1 (Subscription)
                     ↓ quota exhausted
                     Check Tier 2 (Cheap)
                     ↓ budget limit
                     Check Tier 3 (Free)
                     ↓
                     Response
```

### 3-Tier Fallback System

**Tier 1: SUBSCRIPTION (Primary)**
- Claude Code (Pro/Max)
- OpenAI Codex (Plus/Pro)
- GitHub Copilot (Individual/Business)
- Antigravity (Google)

**Goal**: Maximize value from subscriptions you already pay for.

**Tier 2: CHEAP (Backup)**
- GLM ($0.60/1M input)
- MiniMax ($0.20/1M input)
- Kimi ($9/month flat)

**Goal**: Ultra-cheap backup when subscription quota runs out (~90% cheaper than ChatGPT API).

**Tier 3: FREE (Emergency)**
- Kiro (~50 free credits/month)
- OpenCode Free (no auth, rotating list)
- Vertex AI ($300 new-account credit)

**Goal**: Near-zero-cost fallback while credits last.

---

## Automatic Switching

LiteRouter monitors quota in real-time and switches providers automatically:

### Scenario 1: Subscription Quota Exhausted

```
User request → cc/claude-opus-5
               ↓ quota exhausted (5-hour limit reached)
               Auto switch → glm/glm-5.1
               ↓ daily quota exhausted
               Auto switch → minimax/MiniMax-M2.7
               ↓ 5-hour quota exhausted
               Auto switch → kr/glm-5 (FREE)
               ↓
               Response delivered ✅
```

**Result**: Zero downtime, seamless experience.

### Scenario 2: Rate Limiting

```
User request → cx/gpt-5.5
               ↓ rate limited (too many requests)
               Auto switch → glm/glm-5.1
               ↓
               Response delivered ✅
```

### Scenario 3: Provider Unavailable

```
User request → cc/claude-opus-5
               ↓ provider error (503)
               Auto switch → next available model
               ↓
               Response delivered ✅
```

---

## Model Selection Logic

LiteRouter selects the best model based on:

1. **Quota availability** - Check if provider has remaining quota
2. **Cost tier** - Prefer subscription → cheap → free
3. **Reset timing** - Consider when quota resets
4. **Provider health** - Skip providers with errors

### Priority Order Example

For a request to `cc/claude-opus-5`:

```
1. Check Claude Code quota
   ✅ Available → Use cc/claude-opus-5
   ❌ Exhausted → Continue to step 2

2. Check fallback tier (if configured)
   ✅ GLM quota available → Use glm/glm-5.1
   ❌ Exhausted → Continue to step 3

3. Check free tier
   ✅ Kiro credits available → Use kr/glm-5
   ❌ All exhausted → Return quota error
```

---

## Configuration Options

### Dashboard Settings

**1. Enable/Disable Auto Fallback**

```
Dashboard → Settings → Smart Routing
→ Toggle "Auto Fallback" ON/OFF
```

- **ON** (default): Automatic tier switching
- **OFF**: Strict mode, return error if primary model unavailable

**2. Set Budget Limits**

```
Dashboard → Settings → Budget Control
→ Daily limit: $5
→ Monthly limit: $50
```

When budget reached, LiteRouter automatically switches to free tier.

**3. Configure Fallback Order**

```
Dashboard → Settings → Fallback Priority
→ Drag to reorder providers within each tier
```

Example custom order:
```
Tier 1: Claude Code → Codex → GitHub Copilot
Tier 2: MiniMax → GLM → Kimi
Tier 3: Kiro → Vertex AI → OpenCode Free
```

**4. Quota Reset Notifications**

```
Dashboard → Settings → Notifications
→ Email when quota resets
→ Alert when 80% quota used
```

---

## Examples

### Example 1: Basic Auto Fallback

**Setup:**
```
Model: cc/claude-opus-5
Fallback: Auto (default 3-tier)
```

**Behavior:**
```
Morning (fresh quota):
  Request → cc/claude-opus-5 ✅

Afternoon (quota exhausted):
  Request → glm/glm-5.1 ✅ (auto switched)

Evening (GLM quota out):
  Request → minimax/MiniMax-M2.7 ✅ (auto switched)

Late night (all paid quota out):
  Request → kr/glm-5 ✅ (free credits)
```

**Cost**: ~$5-10/month extra (mostly covered by subscription).

### Example 2: Budget-Conscious Routing

**Setup:**
```
Dashboard → Settings:
  Daily budget: $2
  Monthly budget: $20
  Fallback: Enabled
```

**Behavior:**
```
Day 1-15 (within budget):
  Requests → glm/glm-5.1 (cheap tier)
  Cost: $1.50/day

Day 16 (budget reached):
  Requests → kr/glm-5 (free tier)
  Cost: $0

Next month (budget resets):
  Requests → glm/glm-5.1 again
```

**Result**: Never exceed $20/month, always available.

### Example 3: Subscription-Only Mode

**Setup:**
```
Dashboard → Settings:
  Auto Fallback: OFF
  Strict mode: ON
```

**Behavior:**
```
Request → cc/claude-opus-5
  ✅ Quota available → Success
  ❌ Quota exhausted → Return error (no fallback)
```

**Use case**: When you only want to use paid subscriptions, no extra costs.

### Example 4: Free-Only Mode

**Setup:**
```
Model: kr/glm-5
Fallback: vertex/gemini-3-flash-preview → oc/<model-id>
```

**Behavior:**
```
All requests → Free-credit tier only
Cost: $0 while credits last
```

**Use case**: Personal projects, learning, experimentation.

---

## Best Practices

### 1. Maximize Subscription Value

```
Strategy:
- Set subscription models as Tier 1
- Monitor quota usage in dashboard
- Use cheap tier only when subscription exhausted
```

**Example combo:**
```
cc/claude-opus-5 → glm/glm-5.1 → kr/glm-5
```

### 2. Optimize for Cost

```
Strategy:
- Use subscription quota first
- Fallback to GLM/MiniMax (ultra-cheap)
- Emergency: Kiro free credits
```

**Example combo:**
```
vertex/gemini-3-flash-preview → glm/glm-5.1 → kr/glm-5
```

### 3. Optimize for Quality

```
Strategy:
- Use best models (Claude Opus 5, GPT-5.5)
- Fallback to good cheap models (GLM 5.1)
- Last resort: free credits
```

**Example combo:**
```
cc/claude-opus-5 → cx/gpt-5.5 → glm/glm-5.1
```

### 4. 24/7 Availability

```
Strategy:
- Always include free tier in fallback
- Monitor quota reset times
- Distribute usage across providers
```

**Example combo:**
```
cc/claude-opus-5 → glm/glm-5.1 → minimax/MiniMax-M2.7 → kr/glm-5
```

**Result**: Never run out of quota, code anytime.

---

## Quota Reset Strategy

Plan your usage around quota reset times:

| Provider | Quota Reset | Strategy |
|----------|-------------|----------|
| **Claude Code** | 5-hour + weekly | Use in morning, fresh quota |
| **Codex** | 5-hour + weekly | Use after Claude quota out |
| **Kiro** | Monthly (~50 credits) | Budget across the month |
| **GLM** | Daily 10:00 AM | Use evening, resets next morning |
| **MiniMax** | 5-hour rolling | Use anytime, tracks rolling window |
| **Vertex AI / OpenCode Free** | $300 balance / rotating list | Emergency backup |

**Daily routine example:**
```
08:00 - 13:00: Claude Code (fresh 5h quota)
13:00 - 18:00: Kiro free credits
18:00 - 22:00: GLM (cheap, resets 10AM)
22:00 - 08:00: MiniMax (5h rolling)
```

---

## Monitoring & Alerts

### Dashboard Quota Tracker

```
Dashboard → Quota Overview:
  Claude Code: 2.5h / 5h remaining (50%)
  Gemini CLI: 450 / 1000 requests today
  GLM 5.1: 5M / 10M tokens (resets in 8h)
  MiniMax: 3M / 5M tokens (rolling 5h)
```

### Real-Time Notifications

```
Dashboard → Notifications:
  ⚠️ Claude Code quota 80% used (1h remaining)
  ✅ GLM 5.1 quota reset (10M tokens available)
  💰 Daily budget 50% used ($2.50 / $5)
```

### Usage Analytics

```
Dashboard → Analytics:
  Today: 50M tokens
    - 30M via Claude Code (subscription)
    - 15M via GLM 5.1 ($9)
- 5M via Kiro free credits

  Cost: $9 (vs $1000 on ChatGPT API)
  Savings: 99%
```

---

## Troubleshooting

**Issue: "All providers quota exhausted"**

**Solution:**
1. Check dashboard quota tracker
2. Wait for quota reset (see countdown)
3. Add free tier to fallback chain
4. Or increase budget limit

**Issue: "Too many fallback switches"**

**Solution:**
1. Check if primary provider is down
2. Increase quota limits (upgrade subscription)
3. Use cheaper primary model (GLM instead of Claude)

**Issue: "Unexpected costs"**

**Solution:**
1. Dashboard → Analytics → Review usage
2. Set daily/monthly budget limits
3. Switch to free tier for non-critical tasks
4. Use combos with free fallback

---

## Related

- [Combos](./combos.md) - Create custom fallback chains
- [Quota Tracking](./quota-tracking.md) - Monitor usage and costs
