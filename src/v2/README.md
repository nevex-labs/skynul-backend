# Agente autónomo — stack definitivo

La carpeta **`src/v2/`** es la implementación canónica del pipeline de tareas (proveedor → LLM → ReAct → acciones → ciclo de vida). El antiguo `src/core/agent` fue retirado.

## API pública

Import único desde la raíz del módulo:

```ts
import {
  TaskManager,
  TaskStore,
  runTask,
  createLoopRegistry,
  readSecret,
  resolveProvider,
  dispatchChat,
  createAnalyticsRoutes,
  // …
} from '../../v2';
```

Los tests y código interno pueden seguir importando archivos concretos (`./task-manager`, etc.). Para capas nuevas expuestas al resto del repo, añadir el export en **`index.ts`**.

## Estructura

| Ruta | Rol |
|------|-----|
| `index.ts` | Barrel público |
| `provider-resolver.ts` | Layer 1 — `resolveProvider` |
| `provider-dispatch.ts` | Layer 2 — `dispatchChat` |
| `agent-loop.ts` | Layer 3 — ReAct (no reexportado en el barrel por tipos) |
| `task-runner.ts` | Layer 4 — `runTask` |
| `task-manager.ts` | Layer 5 — CRUD y shutdown hooks |
| `secret-reader.ts` | Lectura de `secrets` en PostgreSQL |
| `loop-registry.ts` | Modo → `LoopSetupFn` |
| `loops/` | Setups por modo (browser, code, cdp) |
| `engine/` | Motores (shell, browser) |
| `analytics/` | HTTP de overview montado desde `src/index.ts` |

## Reglas

1. **Sin dependencias** hacia un paquete `core/agent` (no existe).
2. **Un camino al LLM**: `resolveProvider` + `dispatchChat` + `readSecret`.
3. **Cada loop**: `actionExecutors`, `systemPrompt`, `initialHistory`; opcional `cleanup` y `formatObservation`.
4. **Tipos/UI compartidos** : `src/shared/` (p. ej. `mode-capabilities.ts`).
5. **Playwright**: implementación en `src/core/browser/`; adaptador en `engine/browser-playwright.ts`.

## Documentación

- **`SPECS.md`** — contexto y capas
- **`01-provider-resolution.md` … `05-task-manager.md`** — detalle por capa
- **`ENDPOINTS.md`** — HTTP cubierto y huecos

## Cómo extender

- Nuevo **modo** → `loops/<nombre>-setup.ts` + registro en la composición de rutas.
- Nuevo **motor** reutilizable → `engine/` o interfaces en el setup del modo.
- Nuevo **HTTP** ligado al agente → subcarpeta bajo `v2/` y export en `index.ts` si aplica.
