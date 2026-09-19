# Proveedores gratis - Fallback de cero costo

Respaldo de emergencia cuando todo lo demás está limitado por cuota. ¡Codifica 24/7 con cero costo!

---

## Resumen

Los proveedores del nivel gratis son tu **fallback** cuando se agota la cuota de suscripción y la del nivel barato:

- 🆓 **Kiro** - familias Claude y Qwen, nivel gratuito limitado a ~50 créditos/mes
- 🆓 **OpenCode Free** - sin auth, la lista de modelos se obtiene del upstream
- 🆓 **Vertex AI** - Gemini sobre el crédito de $300 de una cuenta nueva de Google Cloud

**Estrategia:** Úsalos como respaldo de emergencia. Los niveles gratuitos tienen tope, así que trátalos como desbordamiento y no como fuente principal permanente.

---

Kiro (Claude con crédito mensual gratuito)

### Precios

| Plan | Coste mensual | Modelos | Cuota |
|------|--------------|--------|-------|
| FREE | $0 | familias Claude y Qwen | ~50 créditos/mes |
| Pro | $20 | mismo catálogo | 1.000 créditos |

**Nota:** Kiro pasó a un modelo de pago en septiembre de 2025. Las cuentas nuevas reciben además 500 créditos de prueba durante los primeros 30 días. El alias `kr/` expone el catálogo completo; ejecuta `/v1/models` para ver qué alcanza realmente tu cuenta.

### 设置

**Paso 1: Conectar desde el panel**

```bash
9router
# Dashboard → Providers → Connect Kiro
```

**Paso 2: AWS Builder ID u OAuth**

- Elige AWS Builder ID (recomendado), Google o GitHub
- Concede permisos
- La renovación automática de token queda activa

**Paso 3: Usar en la CLI**

```
Model: kr/glm-5
       kr/deepseek-3.2
       kr/qwen3-coder-next
```

### Consejos

- **AWS Builder ID** - la ruta de configuración más sencilla
- **Los créditos se comparten** entre todos los modelos de la cuenta, así que un día intenso con Claude puede agotar el mes
- **Consulta la cuota en el panel** antes de enrutar trabajo de producción aquí

---

## OpenCode Free (sin auth)

### 设置

```bash
9router
# Dashboard → Providers → Connect OpenCode Free
```

```
Model: oc/<model-id>
```

**Nota:** la lista de modelos gratuitos rota. Algunas entradas son promociones limitadas y desaparecen sin aviso, así que nunca codifiques IDs `oc/` en un combo de producción del que dependas.

---

## Vertex AI (crédito de $300 para cuentas nuevas)

### 设置

1. Crea un proyecto de Google Cloud y habilita la API de Vertex AI.
2. Crea una cuenta de servicio y descarga la clave JSON.
3. Panel → Connect Vertex AI → sube el JSON.

```
Model: vertex/gemini-3.1-pro-preview
       vertex/gemini-3-flash-preview
       vertex/gemini-2.5-flash
```

**Nota:** desde marzo de 2026 el endpoint de la API de Gemini ya no consume el crédito de $300. Apunta el provider al endpoint de **Vertex AI Studio** en su lugar.

---

## Niveles gratuitos descontinuados

Estos aparecían antes en este documento y ya no funcionan. No construyas un combo alrededor de ellos:

| Provider | Status |
|----------|--------|
| **iFlow** | Pasó a pago en 2026 |
| **Qwen Code** | El nivel gratuito de OAuth se descontinuó el 2026-04-15 |
| **Gemini CLI** | El servicio cerró el 2026-06-18; sigue en el catálogo pero marcado como deprecado |
---

## Comparación de características

| Proveedor | Modelos | Mejor modelo | Configuración | Cuota |
|----------|--------|------------|-------|-------|
| **Kiro** | catálogo completo | familias Claude / Qwen | AWS Builder ID, Google o GitHub | ~50 créditos/mes |
| **OpenCode Free** | rota | passthrough | ninguna | promocional |
| **Vertex AI** | 4+ | Gemini 3.1 Pro | JSON de cuenta de servicio | $300 / 90 días |

**Ganador:** Kiro por amplitud, Vertex por un Gemini de contexto largo sin coste mientras dura el crédito.

---

## Ejemplo de uso

### Configuración en Cursor IDE

```
Settings → Models → Advanced:
  OpenAI API Base URL: http://localhost:20128/v1
  OpenAI API Key: [desde el dashboard de 9router]
  Model: kr/glm-5
```

### Crear combo (Recomendado)

```
Dashboard → Combos → Create New

Name: free-combo
Models:
  1. kr/glm-5 (Kiro principal)
  2. vertex/gemini-3.1-pro-preview (Qwen respaldo)
  3. kr/glm-5 (Kiro calidad)

Usar en CLI: free-combo
```

**Resultado:** ¡Cero costo, máximo uptime!

---

## Estrategia de fallback completa

### Combo completo de 3 niveles

```
Dashboard → Combos → Create New

Name: complete-fallback
Models:
  1. vertex/gemini-3-flash-preview (Suscripción GRATIS)
  2. cc/claude-opus-5 (Suscripción de pago)
  3. glm/glm-5.1 (Respaldo barato, $0.6/1M)
  4. minimax/MiniMax-M2.7 (Más barato, $0.2/1M)
  5. kr/glm-5 (Fallback GRATIS)
  6. kr/glm-5 (Calidad GRATIS)

Usar en CLI: complete-fallback
```

**Resultado:**
- Nivel 1: Suscripción de pago (Claude Code, Codex)
- Nivel 2: Suscripción de pago (Claude Code)
- Nivel 3: Respaldo barato (GLM, MiniMax)
- Nivel 3: crédito gratis (Kiro, Vertex AI)

**¡Nunca dejes de codificar!**

---

## Mejores prácticas

### 1. Úsalos como respaldo de emergencia

```
Prioridad:
1. Nivel de suscripción (maximiza cuota de pago)
2. Nivel barato (centavos por 1M tokens)
3. Nivel GRATIS (ilimitado, cero costo)

Usa el nivel gratis solo cuando:
- Cuota de suscripción agotada
- Límite de presupuesto alcanzado
- Pruebas/tareas no críticas
```

### 2. Elige el modelo correcto

```
Razonamiento complejo: kr/glm-5
Codificación rápida: vertex/gemini-3-flash-preview
Mejor calidad: kr/glm-5
Contexto largo: minimax/MiniMax-M2.7
Tareas de visión: vertex/gemini-3-flash-preview
```

### 3. Crea un combo solo-gratis

```
Para codificación de cero costo:

Name: zero-cost
Models:
  1. kr/glm-5 (Mejor calidad)
  2. kr/glm-5 (Tareas complejas)
  3. vertex/gemini-3.1-pro-preview (Codificación rápida)

¡Costo: $0 para siempre!
```

### 4. Prueba antes de producción

```
Usa el nivel gratis para:
- Probar prompts
- Prototipar características
- Aprender nuevos frameworks
- Tareas no críticas

Guarda la cuota de pago para:
- Código de producción
- Refactoring complejo
- Características críticas
```

---

## Ejemplos reales

### Ejemplo 1: Estudiante/Aprendiz (Cero presupuesto)

```
Configuración:
1. kr/glm-5 (Mejor calidad)
2. kr/glm-5 (Razonamiento complejo)
3. vertex/gemini-3.1-pro-preview (Codificación rápida)

Costo mensual: $0
Uso: Ilimitado

Perfecto para:
- Aprender a programar
- Proyectos personales
- Tareas/asignaciones
```

### Ejemplo 2: Freelancer (Consciente del presupuesto)

```
Configuración:
1. vertex/gemini-3-flash-preview (crédito gratis)
2. glm/glm-5.1 (Respaldo barato, $0.6/1M)
3. kr/glm-5 (Fallback GRATIS)

Costo mensual: $5-10
Uso: 100M+ tokens

Perfecto para:
- Proyectos de cliente (nivel de pago)
- Pruebas (nivel gratis)
- Respaldo de emergencia
```

### Ejemplo 3: Usuario intensivo (Maximiza todo)

```
Configuración:
1. vertex/gemini-3-flash-preview (crédito gratis)
2. cc/claude-opus-5 (Suscripción $20-100)
3. cx/gpt-5.5 (Suscripción $20-200)
4. glm/glm-5.1 (Barato $0.6/1M)
5. minimax/MiniMax-M2.7 (Más barato $0.2/1M)
6. kr/glm-5 (GRATIS ilimitado)
7. kr/glm-5 (Calidad GRATIS)

Costo mensual: $40-320 (suscripciones) + $10-20 (nivel barato)
Uso: 500M+ tokens

Perfecto para:
- Desarrollo profesional
- Proyectos de equipo
- Codificación 24/7
```

---

## Comparación de costos

### Escenario: 100M tokens/mes

**Opción 1: Solo ChatGPT API**
```
100M × $20/1M = $2,000/mes
```

**Opción 2: Solo nivel gratis de LiteRouter**
```
100M vía nivel gratis = $0/mes
Ahorros: $2,000/mes (100%)
```

**Opción 3: Estrategia completa de LiteRouter**
```
30M vía Claude Code (suscripción): $0
30M vía Claude Code (suscripción): $0 extra
8M vía GLM (barato): $4.80
2M vía MiniMax (barato): $0.40
Total: $4.80/mes + suscripciones que ya tienes
Ahorros: $1,995/mes (99.76%)
```

---

## Solución de problemas

### "OAuth failed"

**Solución:**
- Verifica la conexión a internet
- Prueba otro navegador
- Limpia la caché del navegador
- Reconecta en el dashboard

### "Modelo no disponible"

**Solución:**
- Verifica que el proveedor esté conectado en el dashboard
- Verifica que el token OAuth sea válido
- Reconecta el proveedor si es necesario

### "Respuestas lentas"

**Solución:**
- El nivel gratis puede tener menor prioridad
- Úsalo durante horas off-peak
- Cambia a otro proveedor gratis
- Mejora al nivel barato para velocidad

---

## Limitaciones

### Consideraciones del nivel gratis

- **Velocidad** - Puede ser más lento que los niveles de pago
- **Prioridad** - Menor prioridad en horas pico
- **Rate limits** - Posible rate-limiting (pero cuota ilimitada)
- **Disponibilidad** - Puede tener tiempo de inactividad ocasional

**Solución:** ¡Usa la estrategia de fallback de 3 niveles para confiabilidad!

---

## Próximos pasos

- **Configurar suscripciones:** [Proveedores de suscripción](./subscription.md)
- **Agregar respaldo barato:** [Proveedores baratos](./cheap.md)
- **Crear combos:** Dashboard → Combos → Create New
- **Empezar a codificar:** Usa el combo `complete-fallback` para máxima confiabilidad
