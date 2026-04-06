# HTTP — cobertura del agente (`src/v2`)

Este documento lista **qué rutas usan el stack en `src/v2/`**, qué rutas **usan otro pipeline**, y **huecos** de producto/API.

Prefijos: montaje en `src/index.ts` (`/api/...`).

---

## 1. Cubiertas por el stack definitivo

| Método | Ruta | Notas |
|--------|------|--------|
| GET | `/api/tasks` | Lista tareas; filtro por `userId` del JWT cuando aplica |
| GET | `/api/tasks/:id` | Detalle; oculta tarea si `userId` no coincide |
| POST | `/api/tasks` | Crea y **en seguida** aprueba y ejecuta (`create` + `approve`) |
| POST | `/api/tasks/:id/approve` | Ejecuta una tarea `pending` |
| POST | `/api/tasks/:id/cancel` | `abort` si está `running` |
| DELETE | `/api/tasks/:id` | Elimina del store en memoria |
| POST | `/api/tasks/:id/resume` | Continuación tras `completed` |
| GET | `/api/analytics/overview` | Métricas; tareas + schedules + paper |

---

## 2. Relacionadas con tareas pero **fuera** de `src/v2`

No usan `TaskManager` de este repo ni `resolveProvider` / `dispatchChat` de `src/v2`.

| Área | Rutas (ejemplos) | Comentario |
|------|------------------|------------|
| Chat genérico | `POST /api/ai/chat/send` | Provider vía `SettingsService` + `core/providers/dispatch` |
| ChatGPT / Ollama | `/api/ai/chatgpt/*`, `/api/ai/ollama/*` | Proxies / utilidades |
| Claves y proveedores | `/api/providers/*`, `/api/integrations/secrets/*` | Gestión de secrets; el agente lee DB con `secret-reader` |
| Agente (settings) | `/api/agent/policy/*`, `/api/agent/skills/*`, `/api/agent/capabilities` | Política y skills |
| Proyectos | `/api/tasks/projects/*` | CRUD proyectos y vínculo en DB |
| Schedules | `/api/schedules/*` | CRUD en DB; verificar worker → `taskManager` |
| Sistema | `/api/system/browser/*`, `/api/system/runtime` | Snapshots / runtime |
| Otros | wallet, auth, trading-providers, integraciones | — |

---

## 3. Huecos habituales

### 3.1 Contrato HTTP vs `TaskManager`

| Necesidad | Estado |
|-----------|--------|
| **Crear sin ejecutar** | `POST /api/tasks` siempre `create` + `approve`; falta variante solo `pending` o `?run=false` |
| **`maxSteps` por tarea** | Body admite `maxSteps`; `approve` usa `defaultMaxSteps` del manager |
| **`model`** | No cableado al dispatch (modelo fijo por proveedor en `provider-dispatch`) |
| **`attachments`** | POST los acepta; `create` no los persiste en el `Task` |
| **`agentSystemPrompt` / `agentAllowedTools`** | No pasan a `runTask` en `approve` |
| **PATCH tarea** | No existe |

### 3.2 Producto / DX

| Necesidad | Estado |
|-----------|--------|
| **Inferencia modo/capabilities** | Sin `POST /api/tasks/infer` (pendiente reimplementar en `src/v2`) |
| **Chat alineado al stack** | No hay `POST` único con `readSecret` + `resolveProvider` + `dispatchChat` |
| **Streaming** | Sin SSE/WS dedicado por `taskId` |
| **Persistencia** | Store en memoria |
| **Prefijo `/api/v2`** | Todo bajo `/api/tasks` |

### 3.3 Integración

| Necesidad | Estado |
|-----------|--------|
| **Schedules → tareas** | Worker debe usar `taskManager` de `routes/tasks` |
| **Canales** | Mismo singleton si disparan tareas |

---

## 4. Mantenimiento

- Cerrar huecos según 3.1–3.2.
- Nuevo HTTP del agente: implementar en `src/v2/` y exportar en `index.ts` si es API pública.
- Alcance y estructura: **`README.md`** en esta carpeta.
