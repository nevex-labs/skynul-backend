# Plan de Migración a Effect.js

**Documento de Tracking:** Estado actual y plan de migración incremental a Effect.js

**Fecha:** 2025-04-01  
**Status:** Fase 1 - Coexistencia (En progreso)

---

## 📊 Estado General

| Métrica | Valor |
|---------|-------|
| **Total de módulos** | ~45 |
| **Migrados** | 3 |
| **En progreso** | 0 |
| **Pendientes** | 42 |
| **Tests actuales** | 1023 passing |
| **Cobertura Effect** | ~7% |

**Tiempo estimado total:** 6-8 semanas (2 desarrolladores)  
**Tiempo restante:** 5-7 semanas

---

## ✅ COMPLETADO (3 módulos)

### 1. Servicios Base (`src/core/effect/`)
**Status:** ✅ Producción  
**Esfuerzo:** 2 días  
**Archivos:**
- `services.ts` - Logger, Config, errores tipados
- `services.test.ts` - 5 tests

**Valor:** Base para todo lo demás

### 2. Cancellation System (`src/core/effect/cancellation.ts`)
**Status:** ✅ Producción  
**Esfuerzo:** 1 día  
**Archivos:**
- `cancellation.ts` - Fibers, cancelación
- `cancellation.test.ts` - 10 tests

**Valor:** Cancelación robusta de tareas

### 3. Shell Execution con Effect (`src/core/agent/action-executors.ts`)
**Status:** ✅ Coexistencia  
**Esfuerzo:** 1 día  
**Archivos:**
- Funciones nuevas en `action-executors.ts`
- `action-executors-effect.test.ts` - 10 tests

**Valor:** Primer executor con Effect disponible

---

## 🚧 EN PROGRESO (0 módulos)

Nada actualmente en progreso.

---

## ⏳ PENDIENTES (42 módulos)

### 🔴 PRIORIDAD ALTA (Core del sistema)

#### 1. Tool Execution Paralelo
**Módulo:** `src/core/agent/loops/agent-loop.ts`  
**Esfuerzo estimado:** 3 días  
**Bloquea:** Concurrencia real  
**Valor:** 5x mejora en performance de I/O  
**Descripción:**
- Reemplazar ejecución serial de tools
- Implementar `Effect.forEach` con concurrencia
- Máximo 5 tools en paralelo

#### 2. DI para TaskManager
**Módulo:** `src/core/agent/task-manager.ts`  
**Esfuerzo estimado:** 4 días  
**Bloquea:** Testing sin mocks  
**Valor:** Tests unitarios simples  
**Descripción:**
- Reemplazar `LoopCallbacks` con Layer
- Crear `TaskManagerService`
- Inyección de dependencias tipada

#### 3. Error Recovery Composable
**Módulo:** `src/core/agent/loops/agent-loop.ts` (errores)  
**Esfuerzo estimado:** 2 días  
**Bloquea:** Mejor UX de errores  
**Valor:** Errores manejables y trackeables  
**Descripción:**
- Reemplazar try/catch anidados
- `Effect.catchTag` para cada tipo de error
- Retry automático con backoff

#### 4. Memory Operations
**Módulo:** `src/core/agent/task-memory.ts`  
**Esfuerzo estimado:** 2 días  
**Bloquea:** Consistencia de datos  
**Valor:** Operaciones atómicas  
**Descripción:**
- Envolver operaciones SQLite
- Transacciones con Effect
- Mejor manejo de errores de BD

### 🟡 PRIORIDAD MEDIA (Executors y Providers)

#### 5. File Operations
**Módulos:** 
- `src/core/agent/action-executors.ts` (file_read, file_write)
**Esfuerzo estimado:** 2 días  
**Valor:** Operaciones de archivo seguras  
**Descripción:**
- `readFileEffect`, `writeFileEffect`
- Validación de paths integrada
- Rollback automático en errores

#### 6. Web Scraping
**Módulo:** `src/core/agent/web-scraper.ts`  
**Esfuerzo estimado:** 1.5 días  
**Valor:** Scraping con timeout y retry  
**Descripción:**
- `scrapeUrlEffect`
- Timeouts automáticos
- Retry con backoff exponencial

#### 7. Vision Dispatch
**Módulo:** `src/core/agent/vision-dispatch.ts`  
**Esfuerzo estimado:** 2 días  
**Valor:** LLM calls robustas  
**Descripción:**
- `callVisionEffect`
- Rate limiting automático
- Circuit breaker

#### 8. Background Process Integration
**Módulo:** `src/core/agent/process-registry.ts`  
**Esfuerzo estimado:** 1.5 días  
**Valor:** Procesos background más robustos  
**Descripción:**
- Integrar ProcessRegistry con Effect
- Cancelación automática de fibers
- Cleanup garantizado

#### 9. Browser Operations
**Módulo:** `src/core/agent/loops/browser-loop.ts`  
**Esfuerzo estimado:** 3 días  
**Valor:** Browser automation más estable  
**Descripción:**
- Envolver operaciones de Playwright
- Manejo de timeouts
- Recursos liberados automáticamente

#### 10. Trading Operations
**Módulos:**
- `src/core/agent/paper-portfolio.ts`
- `src/core/agent/risk-guard.ts`
**Esfuerzo estimado:** 2 días  
**Valor:** Trading más seguro  
**Descripción:**
- Transacciones atómicas
- Rollback en errores
- Validaciones previas

### 🟢 PRIORIDAD BAJA (API y CLI)

#### 11. Hono Routes (Parcial)
**Módulos:** `src/routes/**/*.ts`  
**Esfuerzo estimado:** 3 días  
**Valor:** Consistencia en API  
**Descripción:**
- Algunos routes pueden beneficiarse
- No es prioritario (Hono ya es simple)

#### 12. CLI Components
**Módulos:** `src/cli/**/*.tsx`  
**Esfuerzo estimado:** 2 días  
**Valor:** Mejor manejo de estado en CLI  
**Descripción:**
- Ink + Effect pueden funcionar bien
- No es prioritario

#### 13-42. Módulos misceláneos
**Lista:** Stores, providers menores, utilidades  
**Esfuerzo estimado:** 8-10 días  
**Valor:** Menor, migrar cuando se toquen  
**Descripción:**
- Migrar on-demand cuando haya cambios
- No migrar por migrar

---

## 📅 Timeline Sugerido

### Semana 1 (Actual)
- ✅ Base Effect instalada
- ✅ Cancelación implementada
- ✅ Shell con Effect disponible
- **Enfoque:** Estabilizar base

### Semana 2
- 🔴 Tool Execution Paralelo (#1)
- 🔴 Error Recovery (#3)
- **Enfoque:** Core del sistema

### Semana 3
- 🔴 DI para TaskManager (#2)
- 🔴 Memory Operations (#4)
- **Enfoque:** Testing y arquitectura

### Semana 4
- 🟡 File Operations (#5)
- 🟡 Web Scraping (#6)
- 🟡 Vision Dispatch (#7)
- **Enfoque:** Executors principales

### Semana 5
- 🟡 Background Process (#8)
- 🟡 Browser Operations (#9)
- 🟡 Trading (#10)
- **Enfoque:** Sistemas secundarios

### Semana 6-7
- 🟢 API Routes (opcional)
- 🟢 CLI (opcional)
- 🟢 Misceláneos
- **Enfoque:** Limpieza y documentación

### Semana 8
- 📝 Documentación
- 🧪 Tests de integración
- 📊 Benchmarks finales
- **Enfoque:** Cierre

---

## 🎯 Decisiones Pendientes

### 1. ¿Migrar Hono routes?
**Recomendación:** NO prioritario  
**Razón:** Hono ya es simple y funciona bien  
**Acción:** Evaluar caso por caso

### 2. ¿Migrar React/Ink CLI?
**Recomendación:** NO prioritario  
**Razón:** React maneja su propio estado  
**Acción:** Solo si hay problemas reales

### 3. ¿Cuándo deprecar código viejo?
**Recomendación:** Cuando 80% esté migrado  
**Estimado:** Mes 3 (Junio 2025)  
**Acción:** Agregar @deprecated tags

---

## 📈 Métricas de Éxito

### Migración Completa Cuando:
- [ ] 80% de módulos core migrados
- [ ] 100% tests pasando
- [ ] Documentación actualizada
- [ ] 0 errores de tipo en TypeScript
- [ ] Benchmarks muestran mejora o neutralidad
- [ ] Team comfortable con Effect

### Beneficios Esperados:
- **Testing:** 50% menos código de mocks
- **Errores:** 90% de errores manejados en compile time
- **Concurrencia:** 3-5x mejora en operaciones I/O paralelas
- **Debugging:** Logs estructurados automáticos
- **Mantenibilidad:** Menos código boilerplate

---

## 🚨 Riesgos y Mitigaciones

| Riesgo | Probabilidad | Impacto | Mitigación |
|--------|--------------|---------|------------|
| Curva de aprendizaje lenta | Media | Alto | Pair programming, documentación |
| Overhead de performance | Baja | Medio | Benchmarks constantes |
| Bugs en migración | Media | Alto | Tests exhaustivos, migración gradual |
| Team resiste cambio | Baja | Alto | Demostrar valor, no forzar |

---

## 📝 Notas

- **No eliminar código viejo** hasta que todo esté migrado
- **Coexistencia es la clave** - ambos sistemas funcionan
- **Migrar módulos críticos primero** - donde Effect aporta más valor
- **Documentar decisiones** - por qué Effect en X pero no en Y

---

**Actualizado por:** [Nombre]  
**Próxima revisión:** Semana 2  
**Issues relacionados:** #14, #31
