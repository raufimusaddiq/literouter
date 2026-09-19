# 免费提供商 - 零成本回退

当其他一切都受配额限制时的应急备用。零成本 24/7 编码!

---

## 概览

免费层提供商是订阅和低价配额都耗尽时的 **回退**:

- 🆓 **Kiro** - Claude 与 Qwen 系列, 免费层上限约 50 额度/月
- 🆓 **OpenCode Free** - 无需认证, 模型列表从上游自动获取
- 🆓 **Vertex AI** - 新建 Google Cloud 账号的 $300 额度上运行 Gemini

**策略:** 作为应急备用使用。免费层有上限, 请当作溢出而非固定主力。

---

Kiro(每月免费额度中的 Claude)

### 定价

| 方案 | 月费 | 模型 | 配额 |
|------|--------------|--------|-------|
| 免费 | $0 | Claude 与 Qwen 系列 | ~50 额度/月 |
| Pro | $20 | 同一目录 | 1,000 额度 |

**注意:** Kiro 自 2025 年 9 月起改为付费模式。新账号前 30 天另有 500 试用额度。`kr/` 别名暴露完整目录; 运行 `/v1/models` 查看你的账号实际可用范围。

### 设置

**第一步: 通过仪表盘连接**

```bash
9router
# Dashboard → Providers → Connect Kiro
```

**第二步: AWS Builder ID 或 OAuth**

- 选择 AWS Builder ID(推荐)、Google 或 GitHub
- 授予权限
- 自动刷新 token 已启用

**第三步: 在 CLI 中使用**

```
Model: kr/glm-5
       kr/deepseek-3.2
       kr/qwen3-coder-next
```

### 提示

- **AWS Builder ID** - 最省事的接入路径
- **额度共享** 于账号下所有模型, 因此重度使用 Claude 一天就可能耗尽整月额度
- **先在仪表盘查看配额**, 再把生产流量路由到这里

---

## OpenCode Free(无需认证)

### 设置

```bash
9router
# Dashboard → Providers → Connect OpenCode Free
```

```
Model: oc/<model-id>
```

**注意:** 免费模型列表会轮换。部分条目是限时促销, 会无预告消失, 不要把 `oc/` 的 ID 硬编码进你依赖的生产组合。

---

## Vertex AI(新账号 $300 额度)

### 设置

1. 创建 Google Cloud 项目并启用 Vertex AI API。
2. 创建服务账号并下载 JSON 密钥。
3. 仪表盘 → Connect Vertex AI → 上传 JSON。

```
Model: vertex/gemini-3.1-pro-preview
       vertex/gemini-3-flash-preview
       vertex/gemini-2.5-flash
```

**注意:** 自 2026 年 3 月起 Gemini API 端点不再消耗 $300 额度。请把 provider 指向 **Vertex AI Studio** 端点。

---

## 已停用的免费层

以下 provider 曾出现在本文档中, 现已无法使用, 不要围绕它们构建组合:

| Provider | Status |
|----------|--------|
| **iFlow** | 2026 年转为付费 |
| **Qwen Code** | 免费 OAuth 层于 2026-04-15 停用 |
| **Gemini CLI** | 服务于 2026-06-18 关闭; 仍在目录中但标记为已弃用 |
---

## 特性对比

| 提供商 | 模型 | 最佳模型 | 设置方式 | 配额 |
|----------|--------|------------|-------|-------|
| **Kiro** | 完整目录 | Claude / Qwen 系列 | AWS Builder ID、Google 或 GitHub | ~50 额度/月 |
| **OpenCode Free** | 轮换 | 直通 | 无 | 限时促销 |
| **Vertex AI** | 4+ | Gemini 3.1 Pro | 服务账号 JSON | $300 / 90 天 |

**赢家:** 广度看 Kiro, 零成本长上下文 Gemini 看 Vertex。

---

## 使用示例

### Cursor IDE 设置

```
Settings → Models → Advanced:
  OpenAI API Base URL: http://localhost:20128/v1
  OpenAI API Key: [从 9router 仪表盘获取]
  Model: kr/glm-5
```

### 创建组合(推荐)

```
仪表盘 → 组合 → 新建

名称: free-combo
模型:
  1. kr/glm-5 (Kiro 主力)
  2. vertex/gemini-3.1-pro-preview (Qwen 备用)
  3. kr/glm-5 (Kiro 质量)

CLI 中使用: free-combo
```

**结果:** 零成本,最大在线!

---

## 完整回退策略

### 完整 3 层组合

```
仪表盘 → 组合 → 新建

名称: complete-fallback
模型:
  1. vertex/gemini-3-flash-preview (免费订阅)
  2. cc/claude-opus-5 (付费订阅)
  3. glm/glm-5.1 (低价备用, 每 1M $0.6)
  4. minimax/MiniMax-M2.7 (最便宜, 每 1M $0.2)
  5. kr/glm-5 (免费回退)
  6. kr/glm-5 (免费质量)

CLI 中使用: complete-fallback
```

**结果:**
- 第 1 层: 付费订阅(Claude Code、Codex)
- 第 2 层: 付费订阅(Claude Code)
- 第 3 层: 低价备用(GLM、MiniMax)
- 第 3 层: 免费额度(Kiro、Vertex AI)

**永不停码!**

---

## 最佳实践

### 1. 作为应急备用

```
优先级:
1. 订阅层(最大化付费配额)
2. 低价层(每 1M tokens 几分钱)
3. 免费层(无限,零成本)

仅在以下情况使用免费层:
- 订阅配额耗尽
- 预算上限达到
- 测试/非关键任务
```

### 2. 选择合适的模型

```
复杂推理: kr/glm-5
快速编码: vertex/gemini-3-flash-preview
最佳质量: kr/glm-5
长上下文: minimax/MiniMax-M2.7
视觉任务: vertex/gemini-3-flash-preview
```

### 3. 创建仅免费组合

```
零成本编码:

名称: zero-cost
模型:
  1. kr/glm-5 (最佳质量)
  2. kr/glm-5 (复杂任务)
  3. vertex/gemini-3.1-pro-preview (快速编码)

成本: 永远 $0!
```

### 4. 上生产前先测试

```
用免费层来:
- 测试 prompt
- 原型功能
- 学习新框架
- 非关键任务

把付费配额留给:
- 生产代码
- 复杂重构
- 关键功能
```

---

## 真实案例

### 案例 1:学生/学习者(零预算)

```
设置:
1. kr/glm-5 (最佳质量)
2. kr/glm-5 (复杂推理)
3. vertex/gemini-3.1-pro-preview (快速编码)

月成本: $0
用量: 无限

适合:
- 学习编程
- 个人项目
- 作业/任务
```

### 案例 2:自由职业(预算敏感)

```
设置:
1. vertex/gemini-3-flash-preview (免费额度)
2. glm/glm-5.1 (低价备用, 每 1M $0.6)
3. kr/glm-5 (免费回退)

月成本: $5-10
用量: 100M+ tokens

适合:
- 客户项目(付费层)
- 测试(免费层)
- 应急备用
```

### 案例 3:重度用户(全部最大化)

```
设置:
1. vertex/gemini-3-flash-preview (免费额度)
2. cc/claude-opus-5 (订阅 $20-100)
3. cx/gpt-5.5 (订阅 $20-200)
4. glm/glm-5.1 (低价 每 1M $0.6)
5. minimax/MiniMax-M2.7 (最便宜 每 1M $0.2)
6. kr/glm-5 (免费无限)
7. kr/glm-5 (免费质量)

月成本: $40-320(订阅)+ $10-20(低价层)
用量: 500M+ tokens

适合:
- 专业开发
- 团队项目
- 24/7 编码
```

---

## 成本对比

### 场景:每月 100M tokens

**方案 1:仅 ChatGPT API**
```
100M × $20/1M = $2,000/月
```

**方案 2:仅 LiteRouter 免费层**
```
100M 通过免费层 = $0/月
节省: $2,000/月 (100%)
```

**方案 3:LiteRouter 完整策略**
```
30M 通过 Claude Code(订阅): $0
30M 通过 Claude Code(订阅): 无额外费用
8M 通过 GLM(低价): $4.80
2M 通过 MiniMax(低价): $0.40
合计: $4.80/月 + 你已有的订阅
节省: $1,995/月 (99.76%)
```

---

## 故障排除

### "OAuth failed"

**方案:**
- 检查网络连接
- 尝试其他浏览器
- 清除浏览器缓存
- 在仪表盘重新连接

### "Model not available"

**方案:**
- 检查仪表盘中提供商已连接
- 确认 OAuth token 有效
- 必要时重新连接提供商

### "Slow responses"

**方案:**
- 免费层优先级较低
- 在非高峰时段使用
- 切换到其他免费提供商
- 升级到低价层以提速

---

## 限制

### 免费层注意事项

- **速度** - 可能慢于付费层
- **优先级** - 高峰期优先级较低
- **速率限制** - 可能限速(但配额无限)
- **可用性** - 偶尔可能宕机

**方案:** 使用 3 层回退策略保障可靠性!

---

## 下一步

- **设置订阅:** [订阅型提供商](./subscription.md)
- **添加低价备用:** [低价提供商](./cheap.md)
- **创建组合:** 仪表盘 → 组合 → 新建
- **开始编码:** 使用 `complete-fallback` 组合最大化可靠性
