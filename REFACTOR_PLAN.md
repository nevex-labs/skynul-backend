# Plan de Refactorización - ActionExecutors

## Estado Actual

```
action-executors.ts (~877 líneas)
├── browser actions (line 103+)
├── file actions (line 226+)
├── image actions (line 179+)  
├── inter-task actions (line 67+)
├── fact/memory actions (line 106+)
├── polymarket actions (line 361+) ← TRADING - disabled
├── chain actions (line 508+)     ← TRADING - disabled
└── cex actions (line 649+)       ← TRADING - disabled
```

## Problemas

1. **800+ líneas en un archivo** - Viola SRP
2. **Trading mezclado con core** - No debería estar
3. **task-memory async** -调用 sin await
4. **Imports mezclados** - 20+ imports

## Estructura Objetivo

```
src/core/agent/
├── task-manager.ts         # CRUD + persistencia
├── task-runner.ts        # Loop de ejecución  
├── action-executors.ts    #solo routing/mediador
│
├── executors/
│   ├── index.ts        # exports de todos, routing por tipo
│   ├── browser.ts    # click, type, navigate, screenshot
│   ├── file.ts      # read, write, edit
│   ├── image.ts     # generate-image
│   ├── inter-task.ts # task_list, task_send, etc
│   ├── memory.ts   # remember_fact, memory_save, search
│   │
│   └── disabled/    # Código removed (no incluido en build)
│       ├── polymarket.ts
│       ├── chain.ts
│       └── cex.ts
```

## Beneficios

| Aspecto | Antes | Después |
|--------|-------|--------|
| Líneas por archivo | 877 | ~100 c/u |
| SRP | ✗ | ✓ |
| Testing | difícil | fácil |
| Trading disable | code cleanup | archivo excluido |
| TypeScript errors | 23 | 0 |

## Plan de Implementación

### Paso 1: Crear estructura de directorios
```
mkdir -p src/core/agent/executors/disabled
```

### Paso 2: Mover ejecutores uno por uno

**browser.ts** (~100 líneas)
- `executeBrowserAction()`

**file.ts** (~80 líneas)
- `executeFileRead()`
- `executeFileWrite()`
- `executeFileEdit()`

**image.ts** (~30 líneas)
- `executeGenerateImage()`

**inter-task.ts** (~50 líneas)
- `executeInterTaskAction()`

**memory.ts** (~100 líneas - requiere async fix)
- `executeFactAction()`
- `executeMemoryAction()`

### Paso 3: Routing central
```typescript
// action-executors.ts (~50 líneas)
import type { Task, TaskAction } from '../../types';
import { executeBrowserAction } from './executors/browser';
import { executeFileAction } from './executors/file';
// ...

export async function executeAction(ctx: ExecutorContext, action: TaskAction): Promise<ExecutorResult> {
  switch (action.type) {
    case 'click': case 'type': case 'navigate':
      return executeBrowserAction(ctx, action);
    // ...
  }
}
```

### Paso 4: Fix async de task-memory
```typescript
// memory.ts ahora es async
export async function executeMemoryAction(...) {
  const obs = await searchObservations(...);  // ✓ await
}
```

### Paso 5: Eliminar trading de build
```typescript
// executors/disabled/polymarket.ts
// No se importa en index.ts - excluido del build
```

## Orden de Implementación

1. Crear `src/core/agent/executors/`
2. Mover browser, file, image, inter-task
3. Mover memory (con fix async)
4. Crear routing central en action-executors.ts
5. Mover trading a disabled/ y dejar de importar
6. Verificar compile
7. Correr tests

## Criterios de Éxito

- [ ] action-executors.ts < 200 líneas
- [ ] Cada executor < 150 líneas
- [ ] 0 errores de TypeScript
- [ ] Tests pasan
- [ ] Trading excluido del build

## Decisiones Tomadas

| Decisión | Resolution |
|---------|----------|
| ExecutorContext | Opción A (contexto gordo) +1 dependencia inyectada. Por ahora OK. |
| TaskAction location | src/types/task.ts ✅ Ya correcto |
| inter-task dependency | Usa ctx.taskManager ✅ Inyectado, no import |
| Trading disabled | Carpeta disabled/, no code flags ✅ |