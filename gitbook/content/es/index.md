# Bienvenido a LiteRouter

**Usa Claude, Codex, Gemini GRATIS • Alternativas ultra-baratas desde $0.20/1M tokens**

LiteRouter es un router de modelos de IA que maximiza el valor de tus suscripciones y minimiza los costos mediante enrutamiento inteligente y fallback automático.

---

## ¿Qué es LiteRouter?

LiteRouter es un proxy inteligente que se sitúa entre tus herramientas de codificación (Cursor, Cline, Claude Desktop) y los proveedores de IA. Enruta automáticamente las solicitudes al mejor modelo disponible según la cuota, el costo y la disponibilidad.

**Deja de desperdiciar dinero:**
- ❌ La cuota de suscripción expira sin usar cada mes
- ❌ Los límites de tasa te detienen a mitad de la codificación
- ❌ APIs costosas ($20-50/mes por proveedor)
- ❌ Cambio manual entre proveedores

**Empieza a maximizar el valor:**
- ✅ **Maximiza tus suscripciones** - Rastrea y usa cada bit de cuota de Claude Code, Codex, GitHub Copilot
- ✅ **GRATIS disponible** - Kiro, OpenCode Free y Google Vertex AI
- ✅ **Respaldo ultra-barato** - GLM ($0.60/1M), MiniMax ($0.20/1M), Kimi ($9/mes fijo)
- ✅ **Fallback inteligente** - Suscripción → Barato → Gratis, cambio automático

---

## Características clave

### 🔄 Fallback inteligente de 3 niveles

```
Configura una vez, nunca dejes de codificar:

Nivel 1 (SUSCRIPCIÓN): Claude Code → Codex → GitHub Copilot
  ↓ cuota agotada
Nivel 2 (BARATO): GLM 5.1 → MiniMax M2.7 → Kimi
  ↓ límite de presupuesto
Nivel 3 (GRATIS): Kiro → OpenCode Free → Vertex AI

→ Cambio automático, sin tiempo de inactividad!
```

### 📊 Seguimiento de cuota

- Consumo de tokens en tiempo real por proveedor
- Cuenta regresiva de reinicio (5 horas, diario, semanal, mensual)
- Estimación de costos para niveles de pago
- Reportes de gasto mensual

### 🎯 Soporte universal de CLI

Funciona con cualquier herramienta que soporte endpoints personalizados de OpenAI:

✅ **Cursor** • **Cline** • **Claude Desktop** • **Codex** • **RooCode** • **Continue** • **Cualquier herramienta compatible con OpenAI**

### 💰 Optimización de costos

**Ejemplo real (100M tokens/mes):**
```
30M vía Claude Code: $0 (suscripción)
30M vía Claude Code: $0 (suscripción que ya tienes)
8M vía GLM: $4.80
2M vía MiniMax: $0.40
Total: $5.20/mes vs $2000 en ChatGPT API!
```

---

## ¿Por qué elegir LiteRouter?

### Maximiza tus suscripciones

¿Ya pagas Claude Code ($20-100/mes) o Codex ($20-200/mes)? Obtén el valor completo:

- Rastrea el uso de cuota en tiempo real
- Cambio automático cuando se reinicia la cuota (5 horas, semanal)
- Usa cada token antes de que expire
- GitHub Copilot: cuota compartida con tu suscripción existente

### Respaldo ultra-barato

Cuando se agota la cuota de suscripción, paga centavos:

| Proveedor | Costo por 1M tokens | Reinicio |
|----------|-------------------|-------|
| **GLM 5.1** | $0.60 entrada / $2.20 salida | Diario 10:00 AM |
| **MiniMax M2.7** | $0.20 entrada / $1.00 salida | 5 horas rolling |
| **Kimi** | $9/mes (10M tokens) | Mensual |

**~90% más barato que ChatGPT API ($20/1M)!**

### Fallback con crédito gratuito

Respaldo de emergencia cuando todo lo demás está limitado por cuota:

- **Kiro**: familias Claude y Qwen, nivel gratuito limitado a ~50 créditos/mes (AWS Builder ID / Google / GitHub)
- **OpenCode Free**: sin auth, la lista de modelos se obtiene del upstream y cambia sin aviso
- **Vertex AI**: Gemini sobre el crédito de $300 de una cuenta nueva de Google Cloud (usa el endpoint Vertex AI Studio)

**Niveles gratuitos descontinuados:** iFlow, Qwen Code y Gemini CLI cerraron sus niveles gratuitos en 2026. Gemini CLI queda marcado como deprecado en el catálogo.

---

## Inicio rápido

Comienza en 2 minutos:

```bash
# Instala globalmente
npm install -g 9router

# Inicia (el dashboard se abre automáticamente)
9router
```

🎉 **Se abre el dashboard** → Conecta proveedores → ¡Empieza a codificar!

**Úsalo en tu herramienta CLI:**

```
Endpoint: http://localhost:20128/v1
API Key: [desde el dashboard]
Model: cc/claude-opus-5
```

[→ Guía completa para empezar](getting-started.md)

---

## Casos de uso

### Para desarrolladores individuales

- Maximiza tu suscripción de Claude Code/Codex
- Usa los créditos mensuales gratuitos de Kiro para trabajo no crítico
- Fallback a modelos ultra-baratos ($0.20/1M)
- Codifica 24/7 sin límites de tasa

### Para equipos

- Despliega en VPS/Cloud para acceso compartido
- Rastrea el gasto del equipo en tiempo real
- Establece límites de presupuesto por nivel
- Gestión centralizada de proveedores

### Para codificación móvil/remota

- Usa el despliegue en la nube (https://ai-staging.investdx.biz.id)
- Accede desde iPad, teléfono, donde sea
- Sin limitaciones de localhost
- Red edge de Cloudflare (300+ ubicaciones)

---

## ¿Qué sigue?

- [Empezar](getting-started.md) - Instala y configura en 5 minutos
- [Guía de instalación](getting-started/installation.md) - Instrucciones detalladas
- [Características](features/) - Explora todas las capacidades
- [FAQ](faq.md) - Preguntas comunes

---

<div align="center">
  <sub>Construido con ❤️ para desarrolladores que maximizan el valor de la IA</sub>
</div>
