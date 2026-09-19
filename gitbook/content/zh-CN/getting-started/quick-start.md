# 入门指南

5 分钟启动 LiteRouter,开始智能路由 AI 请求。

---

## 快速开始

### 1. 安装

```bash
npm install -g 9router
```

**要求:** Node.js 20+([安装详情](getting-started/installation.md))

### 2. 启动

```bash
9router
```

🎉 **仪表盘自动打开** 地址为 `http://localhost:20128`

- 默认密码:`123456`(在仪表盘中修改)
- API key 自动生成
- 可立即连接提供商

### 3. 连接提供商

有 3 种方式连接提供商:

#### 方式 A:OAuth(订阅型提供商)

**适用于:** Claude Code、Codex、GitHub Copilot、Cursor

```
仪表盘 → 提供商 → 连接 [提供商]
→ OAuth 登录 → 自动刷新 token
→ 启用配额跟踪
```

**示例:Claude Code**
1. 点击 "Connect Claude Code"
2. 用你的 Claude 账户登录
3. 授权 LiteRouter
4. ✅ 完成!使用模型:`cc/claude-opus-5`

#### 方式 B:API Key(低价提供商)

**适用于:** GLM、MiniMax、Kimi、OpenRouter

```
仪表盘 → 提供商 → 添加 API Key
→ 选择提供商
→ 粘贴 API key
→ 保存
```

**示例:GLM 5.1**
1. 在 [Zhipu AI](https://open.bigmodel.cn/) 注册
2. 从 Coding Plan 获取 API key
3. 仪表盘 → 添加 API Key → 提供商:`glm` → 粘贴 key
4. ✅ 完成!使用模型:`glm/glm-5.1`

#### 方式 C:免费提供商(零成本)

**适用于:** Kiro、OpenCode Free、Vertex AI

```
仪表盘 → 提供商 → 连接 [免费提供商]
→ 设备码或 OAuth
→ 无限使用
```

**示例:Kiro**
1. 点击 "Connect Kiro"
2. 用 AWS Builder ID、Google 或 GitHub 登录
3. 授权
4. ✅ 完成!使用 `kr/glm-5`、`kr/deepseek-3.2` 等 Kiro 目录下的模型

---

## 4. 在 CLI 工具中使用

将你的编码工具指向 LiteRouter:

### Cursor IDE

```
Settings → Models → Advanced:
  OpenAI API Base URL: http://localhost:20128/v1
  OpenAI API Key: [从 9router 仪表盘获取]
  Model: cc/claude-opus-5
```

### Claude Desktop

编辑 `~/.claude/config.json`:

```json
{
  "anthropic_api_base": "http://localhost:20128/v1",
  "anthropic_api_key": "your-9router-api-key"
}
```

### Cline / Continue / RooCode

```
Provider: OpenAI Compatible
Base URL: http://localhost:20128/v1
API Key: [从仪表盘获取]
Model: cc/claude-opus-5
```

### Codex CLI

```bash
export OPENAI_BASE_URL="http://localhost:20128"
export OPENAI_API_KEY="your-9router-api-key"

codex "your prompt"
```

---

## 5. 创建智能组合(可选)

组合(Combos)可在多个模型之间实现自动回退:

```
仪表盘 → 组合 → 新建

名称: premium-coding
模型:
  1. cc/claude-opus-5 (订阅主力)
  2. glm/glm-5.1 (低价备用, $0.6/1M)
  3. kr/glm-5 (免费回退)

CLI 中使用: premium-coding
```

**工作原理:**
1. 先尝试 Claude Opus(你的订阅)
2. 配额耗尽 → GLM 5.1(超低价)
3. 预算上限 → Kiro 免费额度
4. 零停机,自动切换!

---

## 可用模型

### 订阅型模型(优先使用)

**Claude Code (`cc/`)** - Pro/Max 订阅:
- `cc/claude-opus-5` - Claude Opus 5
- `cc/claude-sonnet-5` - Claude Sonnet 5
- `cc/claude-haiku-4-5-20251001` - Claude 4.5 Haiku

**Codex (`cx/`)** - Plus/Pro 订阅:
- `cx/gpt-5.5` - GPT-5.5
- `cx/gpt-5.4` - GPT-5.4
- `cx/gpt-5.3-codex` - GPT-5.3 Codex

**GitHub Copilot (`gh/`)** - 订阅:
- `gh/gpt-5.4.4` - GPT-5.4
- `gh/claude-sonnet-4.6` - Claude Sonnet 4.6
- `gh/gemini-3.1-pro-preview` - Gemini 3.1 Pro

### 低价模型(备用)

**GLM (`glm/`)** - 每 1M $0.6/$2.2:
- `glm/glm-5.1` - GLM 5.1
- `glm/glm-5` - GLM 5

**MiniMax (`minimax/`)** - 每 1M $0.20/$1.00:
- `minimax/MiniMax-M2.7` - MiniMax M2.7 (5h reset)

**Kimi (`kimi/`)** - $9/月(10M tokens):
- `kimi/kimi-k2.5` - Kimi K2.5

### 免费模型(应急)

**Kiro (`kr/`)** - 免费层上限约 50 额度/月:
- `kr/glm-5` - GLM-5
- `kr/deepseek-3.2` - DeepSeek 3.2
- `kr/qwen3-coder-next` - Qwen3 Coder Next

**OpenCode Free (`oc/`)** - 无需认证, 模型列表轮换:
- `oc/<model-id>` - check `/v1/models` for the current list

**Vertex AI (`vertex/`)** - 新账号 $300 额度:
- `vertex/gemini-3.1-pro-preview` - Gemini 3.1 Pro
- `vertex/gemini-3-flash-preview` - Gemini 3 Flash

**已停用:** iFlow、Qwen Code 和 Gemini CLI 的免费层已不可用。详见 [免费 Provider](../providers/free.md)。
---

## 成本优化策略

### 月度预算:$10-20/月

```
1. 用 Claude Code 订阅配额处理重要任务
2. 用足 Claude Code 订阅配额(你已经付费了)
3. 配额用完后回退到 GLM(每 1M $0.6)
4. 应急: MiniMax M2.7(每 1M $0.20)

真实案例(每月 100M tokens):
  30M 通过 Claude Code: $0(订阅)
  30M 通过 Claude Code: $0(你已有的订阅)
  8M 通过 GLM: $4.80
  2M 通过 MiniMax: $0.40
  合计: $5.20/月 + 已有订阅
```

### 配额重置策略

```
日常安排:
1. 早上: 全新的 Claude Code 配额(5h 重置)
2. 下午: 切换到 Gemini CLI(每日 1K)
3. 晚上: GLM 每日配额(次日 10AM 重置)
4. 深夜: MiniMax(5h 滚动)

→ 24/7 编码,几乎零额外成本!
```

---

## 下一步

- [安装详情](getting-started/installation.md) - 要求与故障排除
- [功能特性](features/) - 探索配额跟踪、组合、部署
- [常见问题](faq.md) - 常见问题与解答
- [故障排除](troubleshooting.md) - 解决常见问题

---

## 需要帮助?

- **网站**: [ai-staging.investdx.biz.id](https://ai-staging.investdx.biz.id)
- **GitHub**: [github.com/decolua/9router](https://github.com/decolua/9router)
- **Issues**: [github.com/decolua/9router/issues](https://github.com/decolua/9router/issues)
