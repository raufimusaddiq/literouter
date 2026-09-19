# Proveedores de suscripción - Maximiza tu valor

Maximiza tus suscripciones de IA existentes con seguimiento inteligente de cuota y fallback automático. ¡Usa cada bit de tu suscripción antes de que se reinicie!

---

## Resumen

Los proveedores del nivel de suscripción son tu opción **principal** - ya estás pagando por ellos, así que obtén el valor completo:

- ✅ **Claude Code** (Pro/Max) - Claude 4.5 Opus/Sonnet/Haiku
- ✅ **OpenAI Codex** (Plus/Pro) - GPT 5.2 Codex, GPT 5.1 Codex Max
- ✅ **GitHub Copilot** - GPT-5, Claude 4.5, Gemini 3
- ✅ **Antigravity** (Google) - Gemini 3 Pro, Claude Sonnet 4.5

**Estrategia:** Úsalos primero, rastrea la cuota en tiempo real, fallback al barato/gratis cuando se agote.

---

## Claude Code (Pro/Max)

### Precios

| Plan | Costo mensual | Reinicio de cuota | Modelos |
|------|--------------|-------------|--------|
| Pro | $20 | 5 horas + semanal | Opus, Sonnet, Haiku |
| Max | $100 | 5 horas + semanal | Opus, Sonnet, Haiku |

### Configuración

**Paso 1: Conectar vía Dashboard**

```bash
9router
# Se abre el dashboard → Providers → Connect Claude Code
```

**Paso 2: Login OAuth**

- Clic en "Connect Claude Code"
- El navegador abre → Inicia sesión en Claude.ai
- Auto-refresh de token habilitado
- Comienza el seguimiento de cuota

**Paso 3: Usar en CLI**

```
Model: cc/claude-opus-5
       cc/claude-sonnet-5
       cc/claude-haiku-4-5-20251001
```

### Modelos disponibles

| ID del modelo | Descripción | Ideal para |
|----------|-------------|----------|
| `cc/claude-opus-5` | Claude 4.5 Opus | Tareas complejas, arquitectura |
| `cc/claude-sonnet-5` | Claude 4.5 Sonnet | Velocidad/calidad equilibrada |
| `cc/claude-haiku-4-5-20251001` | Claude 4.5 Haiku | Respuestas rápidas |

### Pro Tips

- **Usa Opus para tareas complejas** - Decisiones de arquitectura, refactoring
- **Usa Sonnet por velocidad** - Ediciones rápidas, generación de código
- **Rastrea cuota por modelo** - El dashboard muestra uso por modelo
- **Reinicio de 5 horas** - Cuota fresca cada 5 horas + reinicio semanal

---

## OpenAI Codex (Plus/Pro)

### Precios

| Plan | Costo mensual | Reinicio de cuota | Modelos |
|------|--------------|-------------|--------|
| Plus | $20 | 5 horas + semanal | GPT 5.2, GPT 5.1 |
| Pro | $200 | 5 horas + semanal | GPT 5.2 Codex, GPT 5.1 Max |

### Configuración

**Paso 1: Conectar vía Dashboard**

```bash
9router
# Dashboard → Providers → Connect Codex
```

**Paso 2: Login OAuth**

- Clic en "Connect Codex"
- El navegador abre `http://localhost:1455`
- Inicia sesión en la cuenta de OpenAI
- Auto-refresh de token habilitado

**Paso 3: Usar en CLI**

```
Model: cx/gpt-5.5
       cx/gpt-5.4
       cx/gpt-5.5
       cx/gpt-5.1-codex
```

### Modelos disponibles

| ID del modelo | Descripción | Ideal para |
|----------|-------------|----------|
| `cx/gpt-5.5` | GPT 5.2 Codex | Último modelo de codificación |
| `cx/gpt-5.4` | GPT 5.1 Codex Max | Contexto máximo |
| `cx/gpt-5.5` | GPT 5.2 | Tareas generales |
| `cx/gpt-5.1-codex` | GPT 5.1 Codex | Codificación estable |

### Pro Tips

- **Cuota rolling de 5 horas** - Cuota fresca cada 5 horas
- **Reinicio semanal** - Reinicio completo de cuota cada semana
- **Nivel Pro** - 10× más cuota que Plus

---

## Gemini CLI (descontinuado)

**El nivel gratuito de Gemini CLI cerró el 2026-06-18.** La entrada del provider sigue en el catálogo pero marcada como deprecada, y las peticiones a modelos `gc/` fallarán. No construyas un combo alrededor de ella.

Si quieres Gemini sin coste en una cuenta nueva de Google Cloud, usa **Vertex AI**. Ver [Free Providers](./free.md).

---

## GitHub Copilot

### Precios

| Plan | Costo mensual | Reinicio de cuota | Modelos |
|------|--------------|-------------|--------|
| Individual | $10 | Mensual (día 1) | GPT-5, Claude 4.5, Gemini 3 |
| Business | $19 | Mensual (día 1) | GPT-5, Claude 4.5, Gemini 3 |

### Configuración

**Paso 1: Conectar vía Dashboard**

```bash
9router
# Dashboard → Providers → Connect GitHub
```

**Paso 2: OAuth vía GitHub**

- Clic en "Connect GitHub"
- El navegador abre → Inicia sesión en GitHub
- Autoriza GitHub Copilot
- Auto-refresh de token habilitado

**Paso 3: Usar en CLI**

```
Model: gh/gpt-5.4
       gh/gpt-5.4.4
       gh/claude-sonnet-4.6
       gh/gemini-3.1-pro-preview
```

### Modelos disponibles

| ID del modelo | Descripción | Ideal para |
|----------|-------------|----------|
| `gh/gpt-5.4` | GPT-5 | Último modelo de OpenAI |
| `gh/gpt-5.4.4` | GPT-5.1 Codex Max | Contexto máximo |
| `gh/claude-sonnet-4.6` | Claude 4.5 Sonnet | Calidad de Anthropic |
| `gh/gemini-3.1-pro-preview` | Gemini 3 Pro | Calidad de Google |

### Pro Tips

- **Reinicio mensual** - Reinicio completo de cuota el 1ro del mes
- **Múltiples modelos** - Accede a GPT, Claude, Gemini en una suscripción
- **Nivel Business** - Mayor cuota para equipos

---

## Antigravity (Cuenta Google)

### Precios

| Plan | Costo mensual | Cuota | Modelos |
|------|--------------|-------|--------|
| FREE | $0 | Similar al nivel gratis de Kiro | Gemini 3 Pro, Claude Sonnet 4.5 |

### Configuración

**Paso 1: Conectar vía Dashboard**

```bash
9router
# Dashboard → Providers → Connect Antigravity
```

**Paso 2: OAuth de Google**

- Clic en "Connect Antigravity"
- El navegador abre → Inicia sesión en cuenta Google
- Otorga permisos
- Auto-refresh de token habilitado

**Paso 3: Usar en CLI**

```
Model: ag/gemini-3-pro-high
       ag/claude-sonnet-4-5
       ag/claude-sonnet-4-5
```

### Modelos disponibles

| ID del modelo | Descripción | Ideal para |
|----------|-------------|----------|
| `ag/gemini-3-pro-high` | Gemini 3 Pro High | Respuestas de alta calidad |
| `ag/claude-sonnet-4-5` | Claude Sonnet 4.5 | Calidad de Anthropic |
| `ag/claude-sonnet-4-5` | Claude Opus 4.5 Thinking | Razonamiento complejo |

### Pro Tips

- **Nivel gratis** - Sin costo con cuenta Google
- **Acceso a Claude** - Claude Sonnet/Opus gratis
- **Cuota similar al nivel gratis de Kiro** - Límites diarios/mensuales

---

## Comparación de precios

| Proveedor | Costo mensual | Reinicio de cuota | Valor |
|----------|--------------|-------------|-------|
| **Claude Code Pro** | $20 | 5 horas + semanal | ⭐⭐⭐⭐⭐ Mejor calidad |
| **Claude Code Max** | $100 | 5 horas + semanal | ⭐⭐⭐⭐⭐ Mayor cuota |
| **Codex Plus** | $20 | 5 horas + semanal | ⭐⭐⭐⭐ Buen valor |
| **Codex Pro** | $200 | 5 horas + semanal | ⭐⭐⭐⭐⭐ 10× cuota |
| **GitHub Copilot** | $10-19 | Mensual (día 1) | ⭐⭐⭐⭐ Multi-modelo |
| **Antigravity** | **$0** | Diario + Mensual | ⭐⭐⭐⭐ ¡Claude GRATIS! |

---

## Ejemplo de uso

### Configuración en Cursor IDE

```
Settings → Models → Advanced:
  OpenAI API Base URL: http://localhost:20128/v1
  OpenAI API Key: [desde el dashboard de 9router]
  Model: cc/claude-opus-5
```

### Crear combo (Recomendado)

```
Dashboard → Combos → Create New

Name: premium-coding
Models:
  1. vertex/gemini-3-flash-preview (GRATIS, usar primero)
  2. cc/claude-opus-5 (Suscripción)
  3. cx/gpt-5.5 (Respaldo de suscripción)

Usar en CLI: premium-coding
```

**Resultado:** Maximiza el nivel gratis → Usa suscripción → Fallback automático

---

## Seguimiento de cuota

LiteRouter rastrea la cuota en tiempo real:

- **Consumo de tokens** - Tokens de entrada/salida por solicitud
- **Cuenta regresiva de reinicio** - Tiempo hasta el próximo reinicio de cuota
- **Porcentaje de uso** - Cuánta cuota se ha usado
- **Fallback automático** - Cambia al siguiente nivel cuando se agota

**Vista del dashboard:**

```
Claude Code Pro
├─ Cuota: 75% usada
├─ Reinicio: 2h 15m (5 horas)
├─ Reinicio semanal: 3 días
└─ Fallback: glm/glm-5.1 (nivel barato)
```

---

## Mejores prácticas

### 1. Usa el nivel gratis primero

```
Prioridad:
2. Antigravity (Claude GRATIS)
3. Claude Code/Codex (suscripciones de pago)
```

### 2. Rastrea la cuota diariamente

- Revisa el dashboard cada mañana
- Planifica tareas pesadas según reinicios de cuota
- Usa el nivel barato/gratis para tareas no críticas

### 3. Crea combos inteligentes

```
Ejemplo de combo:
1. vertex/gemini-3-flash-preview (GRATIS principal)
2. cc/claude-opus-5 (Tareas complejas)
3. glm/glm-5.1 (Respaldo barato)
4. kr/glm-5 (Fallback GRATIS)
```

### 4. Optimiza por tiempo

```
Mañana: Cuota fresca de 5 horas (Claude/Codex)
Tarde: créditos gratis de Kiro
Noche: Cuota de suscripción
Madrugada: Nivel barato/gratis
```

---

## Solución de problemas

### "Cuota agotada"

**Solución:**
- Verifica el rastreador de cuota del dashboard
- Espera el reinicio (5 horas o diario)
- Usa fallback de combo al nivel barato/gratis

### "Token OAuth expirado"

**Solución:**
- Auto-refresh por LiteRouter
- Si hay problemas: Dashboard → Provider → Reconnect

### "Rate limiting"

**Solución:**
- Cuota de suscripción agotada
- Agrega fallback: `cc/claude-opus-5 → glm/glm-5.1`
- Usa el nivel gratis: `kr/glm-5`

---

## Próximos pasos

- **Configurar respaldo barato:** [Proveedores baratos](./cheap.md)
- **Agregar fallback gratis:** [Proveedores gratis](./free.md)
- **Crear combos:** Dashboard → Combos → Create New
