# Subscription Providers - Tối đa hóa Giá trị

Tối đa hóa subscription AI hiện có với quota tracking thông minh và auto fallback. Dùng hết mọi quota subscription trước khi reset!

---

## Tổng quan

Provider tier subscription là lựa chọn **chính** - bạn đã trả tiền cho chúng, hãy lấy đầy đủ giá trị:

- ✅ **Claude Code** (Pro/Max) - Claude 4.5 Opus/Sonnet/Haiku
- ✅ **OpenAI Codex** (Plus/Pro) - GPT 5.2 Codex, GPT 5.1 Codex Max
- ✅ **GitHub Copilot** - GPT-5, Claude 4.5, Gemini 3
- ✅ **Antigravity** (Google) - Gemini 3 Pro, Claude Sonnet 4.5

**Chiến lược:** Dùng đầu tiên, theo dõi quota thời gian thực, fallback sang cheap/free khi hết.

---

## Claude Code (Pro/Max)

### Pricing

| Plan | Chi phí Hàng tháng | Quota Reset | Models |
|------|--------------|-------------|--------|
| Pro | $20 | 5 giờ + Hàng tuần | Opus, Sonnet, Haiku |
| Max | $100 | 5 giờ + Hàng tuần | Opus, Sonnet, Haiku |

### Setup

**Bước 1: Kết nối qua Dashboard**

```bash
9router
# Dashboard opens → Providers → Connect Claude Code
```

**Bước 2: Đăng nhập OAuth**

- Click "Connect Claude Code"
- Browser mở → Đăng nhập Claude.ai
- Auto token refresh được bật
- Quota tracking bắt đầu

**Bước 3: Dùng trong CLI**

```
Model: cc/claude-opus-5
       cc/claude-sonnet-5
       cc/claude-haiku-4-5-20251001
```

### Model có sẵn

| Model ID | Mô tả | Tốt nhất cho |
|----------|-------------|----------|
| `cc/claude-opus-5` | Claude 4.5 Opus | Task phức tạp, kiến trúc |
| `cc/claude-sonnet-5` | Claude 4.5 Sonnet | Cân bằng tốc độ/chất lượng |
| `cc/claude-haiku-4-5-20251001` | Claude 4.5 Haiku | Phản hồi nhanh |

### Mẹo Pro

- **Dùng Opus cho task phức tạp** - Quyết định kiến trúc, refactoring
- **Dùng Sonnet cho tốc độ** - Edit nhanh, tạo code
- **Theo dõi quota mỗi model** - Dashboard hiển thị usage mỗi model
- **Reset 5 giờ** - Quota mới mỗi 5 giờ + reset hàng tuần

---

## OpenAI Codex (Plus/Pro)

### Pricing

| Plan | Chi phí Hàng tháng | Quota Reset | Models |
|------|--------------|-------------|--------|
| Plus | $20 | 5 giờ + Hàng tuần | GPT 5.2, GPT 5.1 |
| Pro | $200 | 5 giờ + Hàng tuần | GPT 5.2 Codex, GPT 5.1 Max |

### Setup

**Bước 1: Kết nối qua Dashboard**

```bash
9router
# Dashboard → Providers → Connect Codex
```

**Bước 2: Đăng nhập OAuth**

- Click "Connect Codex"
- Browser mở đến `http://localhost:1455`
- Đăng nhập tài khoản OpenAI
- Auto token refresh được bật

**Bước 3: Dùng trong CLI**

```
Model: cx/gpt-5.5
       cx/gpt-5.4
       cx/gpt-5.5
       cx/gpt-5.1-codex
```

### Model có sẵn

| Model ID | Mô tả | Tốt nhất cho |
|----------|-------------|----------|
| `cx/gpt-5.5` | GPT 5.2 Codex | Model coding mới nhất |
| `cx/gpt-5.4` | GPT 5.1 Codex Max | Context tối đa |
| `cx/gpt-5.5` | GPT 5.2 | Task chung |
| `cx/gpt-5.1-codex` | GPT 5.1 Codex | Coding ổn định |

### Mẹo Pro

- **Quota rolling 5 giờ** - Quota mới mỗi 5 giờ
- **Reset hàng tuần** - Reset quota đầy đủ hàng tuần
- **Tier Pro** - Quota gấp 10× Plus

---

## Gemini CLI (đã ngừng)

**Free tier của Gemini CLI đã đóng ngày 2026-06-18.** Entry provider vẫn còn trong catalog nhưng đánh dấu deprecated, và request tới model `gc/` sẽ thất bại. Đừng xây combo dựa trên nó.

Nếu muốn Gemini miễn phí trên tài khoản Google Cloud mới, dùng **Vertex AI**. Xem [Free Providers](./free.md).

---

## GitHub Copilot

### Pricing

| Plan | Chi phí Hàng tháng | Quota Reset | Models |
|------|--------------|-------------|--------|
| Individual | $10 | Hàng tháng (ngày 1) | GPT-5, Claude 4.5, Gemini 3 |
| Business | $19 | Hàng tháng (ngày 1) | GPT-5, Claude 4.5, Gemini 3 |

### Setup

**Bước 1: Kết nối qua Dashboard**

```bash
9router
# Dashboard → Providers → Connect GitHub
```

**Bước 2: OAuth qua GitHub**

- Click "Connect GitHub"
- Browser mở → Đăng nhập GitHub
- Authorize GitHub Copilot
- Auto token refresh được bật

**Bước 3: Dùng trong CLI**

```
Model: gh/gpt-5.4
       gh/gpt-5.4.4
       gh/claude-sonnet-4.6
       gh/gemini-3.1-pro-preview
```

### Model có sẵn

| Model ID | Mô tả | Tốt nhất cho |
|----------|-------------|----------|
| `gh/gpt-5.4` | GPT-5 | Model OpenAI mới nhất |
| `gh/gpt-5.4.4` | GPT-5.1 Codex Max | Context tối đa |
| `gh/claude-sonnet-4.6` | Claude 4.5 Sonnet | Chất lượng Anthropic |
| `gh/gemini-3.1-pro-preview` | Gemini 3 Pro | Chất lượng Google |

### Mẹo Pro

- **Reset hàng tháng** - Reset quota đầy đủ vào ngày 1 hàng tháng
- **Nhiều model** - Truy cập GPT, Claude, Gemini trong một subscription
- **Tier Business** - Quota cao hơn cho team

---

## Antigravity (Tài khoản Google)

### Pricing

| Plan | Chi phí Hàng tháng | Quota | Models |
|------|--------------|-------|--------|
| FREE | $0 | Tương tự free tier Kiro | Gemini 3 Pro, Claude Sonnet 4.5 |

### Setup

**Bước 1: Kết nối qua Dashboard**

```bash
9router
# Dashboard → Providers → Connect Antigravity
```

**Bước 2: Google OAuth**

- Click "Connect Antigravity"
- Browser mở → Đăng nhập tài khoản Google
- Cấp quyền
- Auto token refresh được bật

**Bước 3: Dùng trong CLI**

```
Model: ag/gemini-3-pro-high
       ag/claude-sonnet-4-5
       ag/claude-sonnet-4-5
```

### Model có sẵn

| Model ID | Mô tả | Tốt nhất cho |
|----------|-------------|----------|
| `ag/gemini-3-pro-high` | Gemini 3 Pro High | Phản hồi chất lượng cao |
| `ag/claude-sonnet-4-5` | Claude Sonnet 4.5 | Chất lượng Anthropic |
| `ag/claude-sonnet-4-5` | Claude Opus 4.5 Thinking | Reasoning phức tạp |

### Mẹo Pro

- **Free tier** - Không phí với tài khoản Google
- **Truy cập Claude** - Claude Sonnet/Opus miễn phí
- **Quota tương tự free tier Kiro** - Giới hạn hàng ngày/tháng

---

## So sánh Giá

| Provider | Chi phí Hàng tháng | Quota Reset | Giá trị |
|----------|--------------|-------------|-------|
| **Claude Code Pro** | $20 | 5 giờ + Hàng tuần | ⭐⭐⭐⭐⭐ Chất lượng tốt nhất |
| **Claude Code Max** | $100 | 5 giờ + Hàng tuần | ⭐⭐⭐⭐⭐ Quota cao nhất |
| **Codex Plus** | $20 | 5 giờ + Hàng tuần | ⭐⭐⭐⭐ Giá trị tốt |
| **Codex Pro** | $200 | 5 giờ + Hàng tuần | ⭐⭐⭐⭐⭐ Quota 10× |
| **GitHub Copilot** | $10-19 | Hàng tháng (ngày 1) | ⭐⭐⭐⭐ Đa model |
| **Antigravity** | **$0** | Hàng ngày + Hàng tháng | ⭐⭐⭐⭐ Claude MIỄN PHÍ! |

---

## Ví dụ Sử dụng

### Setup Cursor IDE

```
Settings → Models → Advanced:
  OpenAI API Base URL: http://localhost:20128/v1
  OpenAI API Key: [from 9router dashboard]
  Model: cc/claude-opus-5
```

### Tạo Combo (Khuyên dùng)

```
Dashboard → Combos → Create New

Name: premium-coding
Models:
  1. vertex/gemini-3-flash-preview (FREE, use first)
  2. cc/claude-opus-5 (Subscription)
  3. cx/gpt-5.5 (Subscription backup)

Use in CLI: premium-coding
```

**Kết quả:** Tối đa free tier → Dùng subscription → Auto fallback

---

## Quota Tracking

LiteRouter theo dõi quota thời gian thực:

- **Tiêu thụ token** - Tokens input/output mỗi request
- **Đếm ngược reset** - Thời gian đến lần reset tiếp theo
- **Phần trăm usage** - Đã dùng bao nhiêu quota
- **Auto fallback** - Chuyển sang tier sau khi hết

**Dashboard view:**

```
Claude Code Pro
├─ Quota: 75% used
├─ Reset: 2h 15m (5-hour)
├─ Weekly reset: 3 days
└─ Fallback: glm/glm-5.1 (cheap tier)
```

---

## Best Practices

### 1. Dùng Free Tier Trước

```
Priority:
2. Antigravity (FREE Claude)
3. Claude Code/Codex (paid subscriptions)
```

### 2. Theo dõi Quota Hàng ngày

- Kiểm tra dashboard mỗi sáng
- Lên kế hoạch task nặng quanh thời gian reset quota
- Dùng cheap/free tier cho task không quan trọng

### 3. Tạo Smart Combos

```
Example combo:
1. vertex/gemini-3-flash-preview (FREE primary)
2. cc/claude-opus-5 (Complex tasks)
3. glm/glm-5.1 (Cheap backup)
4. kr/glm-5 (FREE fallback)
```

### 4. Tối ưu theo Thời gian

```
Morning: Fresh 5-hour quota (Claude/Codex)
Afternoon: credit miễn phí của Kiro
Evening: Subscription quota
Night: Cheap/free tier
```

---

## Troubleshooting

### "Quota exhausted"

**Giải pháp:**
- Kiểm tra quota tracker trong dashboard
- Đợi reset (5 giờ hoặc hàng ngày)
- Dùng combo fallback sang cheap/free tier

### "OAuth token expired"

**Giải pháp:**
- Auto-refresh bởi LiteRouter
- Nếu vẫn lỗi: Dashboard → Provider → Reconnect

### "Rate limiting"

**Giải pháp:**
- Hết quota subscription
- Thêm fallback: `cc/claude-opus-5 → glm/glm-5.1`
- Dùng free tier: `kr/glm-5`

---

## Bước tiếp theo

- **Setup cheap backup:** [Cheap Providers](./cheap.md)
- **Thêm free fallback:** [Free Providers](./free.md)
- **Tạo combos:** Dashboard → Combos → Create New
