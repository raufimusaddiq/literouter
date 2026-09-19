# Empezar

Pon en marcha LiteRouter en 5 minutos y comienza a enrutar solicitudes de IA de forma inteligente.

---

## Inicio rápido

### 1. Instalar

```bash
npm install -g 9router
```

**Requisitos:** Node.js 20+ ([Detalles de instalación](getting-started/installation.md))

### 2. Iniciar

```bash
9router
```

🎉 **El dashboard se abre automáticamente** en `http://localhost:20128`

- Contraseña por defecto: `123456` (cámbiala en el dashboard)
- API key generada automáticamente
- Listo para conectar proveedores

### 3. Conectar proveedores

Tienes 3 formas de conectar proveedores:

#### Opción A: OAuth (Proveedores de suscripción)

**Ideal para:** Claude Code, Codex, GitHub Copilot, Cursor

```
Dashboard → Providers → Connect [Provider]
→ Login OAuth → Refresh automático de token
→ Seguimiento de cuota habilitado
```

**Ejemplo: Claude Code**
1. Clic en "Connect Claude Code"
2. Inicia sesión con tu cuenta de Claude
3. Autoriza LiteRouter
4. ✅ ¡Listo! Usa el modelo: `cc/claude-opus-5`

#### Opción B: API Key (Proveedores baratos)

**Ideal para:** GLM, MiniMax, Kimi, OpenRouter

```
Dashboard → Providers → Add API Key
→ Selecciona proveedor
→ Pega API key
→ Guardar
```

**Ejemplo: GLM 5.1**
1. Regístrate en [Zhipu AI](https://open.bigmodel.cn/)
2. Obtén la API key del Coding Plan
3. Dashboard → Add API Key → Provider: `glm` → Pega la key
4. ✅ ¡Listo! Usa el modelo: `glm/glm-5.1`

#### Opción C: Proveedores gratis (Sin costo)

**Ideal para:** Kiro, OpenCode Free, Vertex AI

```
Dashboard → Providers → Connect [Free Provider]
→ Device code u OAuth
→ Uso ilimitado
```

**Ejemplo: Kiro**
1. Clic en "Connect Kiro"
2. Inicia sesión con AWS Builder ID, Google o GitHub
3. Autoriza
4. ✅ ¡Listo! Usa los modelos del tier gratuito: `kr/glm-5`, `kr/deepseek-3.2`, etc.

---

## 4. Usar en herramientas CLI

Apunta tu herramienta de codificación a LiteRouter:

### Cursor IDE

```
Settings → Models → Advanced:
  OpenAI API Base URL: http://localhost:20128/v1
  OpenAI API Key: [desde el dashboard de 9router]
  Model: cc/claude-opus-5
```

### Claude Desktop

Edita `~/.claude/config.json`:

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
API Key: [desde el dashboard]
Model: cc/claude-opus-5
```

### Codex CLI

```bash
export OPENAI_BASE_URL="http://localhost:20128"
export OPENAI_API_KEY="your-9router-api-key"

codex "your prompt"
```

---

## 5. Crear combos inteligentes (Opcional)

Los combos habilitan el fallback automático entre modelos:

```
Dashboard → Combos → Create New

Name: premium-coding
Models:
  1. cc/claude-opus-5 (Suscripción principal)
  2. glm/glm-5.1 (Respaldo barato, $0.6/1M)
  3. kr/glm-5 (Fallback gratis)

Usar en CLI: premium-coding
```

**Cómo funciona:**
1. Intenta primero Claude Opus (tu suscripción)
2. Si la cuota se agota → GLM 5.1 (ultra-barato)
3. Si llega al límite de presupuesto → Kiro / OpenCode Free / Vertex (gratis)
4. ¡Cero tiempo de inactividad, cambio automático!

---

## Modelos disponibles

### Modelos de suscripción (Maximiza primero)

**Claude Code (`cc/`)** - Pro/Max Suscripción:
- `cc/claude-opus-5` - Claude Opus 5
- `cc/claude-sonnet-5` - Claude Sonnet 5
- `cc/claude-haiku-4-5-20251001` - Claude 4.5 Haiku

**Codex (`cx/`)** - Plus/Pro Suscripción:
- `cx/gpt-5.5` - GPT-5.5
- `cx/gpt-5.4` - GPT-5.4
- `cx/gpt-5.3-codex` - GPT-5.3 Codex

**GitHub Copilot (`gh/`)** - Suscripción:
- `gh/gpt-5.4.4` - GPT-5.4
- `gh/claude-sonnet-4.6` - Claude Sonnet 4.6
- `gh/gemini-3.1-pro-preview` - Gemini 3.1 Pro

### Modelos baratos (Respaldo)

**GLM (`glm/`)** - $0.6/$2.2 por 1M:
- `glm/glm-5.1` - GLM 5.1
- `glm/glm-5` - GLM 5

**MiniMax (`minimax/`)** - $0.20/$1.00 por 1M:
- `minimax/MiniMax-M2.7` - MiniMax M2.7 (5h reset)

**Kimi (`kimi/`)** - $9/mes (10M tokens):
- `kimi/kimi-k2.5` - Kimi K2.5

### Modelos GRATIS (Emergencia)

**Kiro (`kr/`)** - nivel gratuito limitado a ~50 créditos/mes:
- `kr/glm-5` - GLM-5
- `kr/deepseek-3.2` - DeepSeek 3.2
- `kr/qwen3-coder-next` - Qwen3 Coder Next

**OpenCode Free (`oc/`)** - sin auth, la lista de modelos rota:
- `oc/<model-id>` - check `/v1/models` for the current list

**Vertex AI (`vertex/`)** - crédito de $300 para cuentas nuevas:
- `vertex/gemini-3.1-pro-preview` - Gemini 3.1 Pro
- `vertex/gemini-3-flash-preview` - Gemini 3 Flash

**Descontinuados:** los niveles gratuitos de iFlow, Qwen Code y Gemini CLI ya no funcionan. Ver [Free Providers](../providers/free.md).
---

## Estrategia de optimización de costos

### Presupuesto mensual: $10-20/mes

```
1. Usa el tier gratuito (Kiro / OpenCode Free / Vertex) para tareas rápidas
2. Usa la cuota de suscripción de Claude Code al máximo (ya pagas)
3. Fallback a GLM ($0.6/1M) cuando se agote la cuota
4. Emergencia: MiniMax M2.7 ($0.20/1M) o Kiro / OpenCode Free (gratis)

Ejemplo real (100M tokens/mes):
  30M vía Claude Code: $0 (suscripción)
  30M vía Claude Code: $0 (suscripción que ya tienes)
  8M vía GLM: $4.80
  2M vía MiniMax: $0.40
  Total: $5.20/mes + suscripciones existentes
```

### Estrategia de reinicio de cuota

```
Rutina diaria:
1. Mañana: Cuota fresca de Claude Code (reinicio 5h)
2. Tarde: Cambia a Gemini CLI (1K/día)
3. Noche: Cuota diaria de GLM (reinicio 10AM del día siguiente)
4. Madrugada: MiniMax (rolling 5h) o Kiro (gratis)

→ ¡Codifica 24/7 con costo extra mínimo!
```

---

## Próximos pasos

- [Detalles de instalación](getting-started/installation.md) - Requisitos, troubleshooting
- [Características](features/) - Explora seguimiento de cuota, combos, despliegue
- [FAQ](faq.md) - Preguntas y respuestas comunes
- [Troubleshooting](troubleshooting.md) - Soluciona problemas comunes

---

## ¿Necesitas ayuda?

- **Sitio web**: [ai-staging.investdx.biz.id](https://ai-staging.investdx.biz.id)
- **GitHub**: [github.com/decolua/9router](https://github.com/decolua/9router)
- **Issues**: [github.com/decolua/9router/issues](https://github.com/decolua/9router/issues)
