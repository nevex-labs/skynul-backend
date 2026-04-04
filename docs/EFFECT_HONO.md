# 🔄 Integración Effect + Hono

Patrón para usar Effect en endpoints HTTP con manejo de errores tipado.

## 🏗️ Arquitectura

```
Endpoints (Hono)
    ↓
Effect Handler (con mapeo de errores)
    ↓
Servicios (Effect.Context)
    ↓
Layers (Database, Crypto, etc.)
```

## 🎯 Principios Clave

1. **Errores manejados ANTES de salir de Effect**: Cada endpoint usa `Effect.catchAll` para mapear errores de dominio a `HttpResponse`.

2. **Adapter sin lógica**: El adapter `createEffectRoute` solo ejecuta el Effect y devuelve la respuesta. No maneja errores.

3. **Tipado completo**: Los errores de dominio (`SecretNotFoundError`, `DatabaseError`) se convierten a códigos HTTP específicos.

## 📖 Ejemplo Básico

```typescript
import { Effect } from "effect";
import { createEffectRoute, Http } from "../../lib/hono-effect";
import { AppLayer } from "../../config/layers";
import { SecretService } from "../../services/secrets";

const handler = createEffectRoute(AppLayer);

// Handler con manejo de errores
.get("/:key", handler((c) =>
  Effect.gen(function* () {
    const secrets = yield* SecretService;
    const value = yield* secrets.get(1, c.req.param("key"));
    return Http.ok({ value });
  }).pipe(
    // Mapeamos TODOS los errores antes de salir
    Effect.catchAll((error) => Effect.succeed(
      error._tag === "SecretNotFoundError" 
        ? Http.notFound() 
        : Http.internalError()
    ))
  )
))
```

## 🔧 Mapeo de Errores

### Patrón Recomendado

```typescript
const handleError = (error: any): HttpResponse => {
  switch (error._tag) {
    case "SecretNotFoundError":
      return Http.notFound(`Secret "${error.keyName}"`);
    case "ValidationError":
      return Http.badRequest(error.message);
    case "DatabaseError":
      console.error("DB Error:", error.cause);
      return Http.internalError();
    default:
      return Http.internalError();
  }
};

// Uso
Effect.gen(function* () {
  // ... lógica
}).pipe(
  Effect.catchAll((error) => Effect.succeed(handleError(error)))
)
```

### Errores HTTP Disponibles

```typescript
Http.ok(body)              // 200
Http.created(body)         // 201
Http.noContent()           // 204
Http.badRequest(msg)       // 400
Http.unauthorized()        // 401
Http.notFound(msg)         // 404
Http.conflict(msg)         // 409
Http.internalError(msg)    // 500
```

## 🧪 Testing

```typescript
import { Layer } from "effect";

// Mock de servicios para tests
const MockSecretService = Layer.succeed(
  SecretService,
  SecretService.of({
    get: () => Effect.succeed("mock-value"),
    set: () => Effect.succeed(mockMetadata),
    delete: () => Effect.succeed(undefined),
    list: () => Effect.succeed([]),
  })
);

// Test del endpoint
const TestLayer = Layer.merge(MockSecretService, MockDatabase);
const testHandler = createEffectRoute(TestLayer);
```

## 📁 Estructura de Archivos

```
src/
├── lib/
│   └── hono-effect.ts          # Adapter y helpers HTTP
├── config/
│   └── layers.ts               # Layer combinado de la app
├── services/
│   └── secrets/
│       ├── tag.ts              # Context.Tag
│       ├── layer.ts            # Implementación
│       └── http/
│           └── errors.ts       # Mapeo de errores
└── routes/
    └── integrations/
        └── secrets.ts          # Endpoints con Effect
```

## ✅ Checklist

- [ ] Todos los errores mapeados antes de salir de Effect
- [ ] `Effect.catchAll` o `Effect.catchTags` en cada endpoint
- [ ] No hay try/catch de JavaScript en los handlers
- [ ] Servicios inyectados vía `yield* SecretService`
- [ ] Layer proporcionado al adapter

## 🚀 Migración desde Código Viejo

### Antes (JSON files + async/await):
```typescript
.get('/:key', async (c) => {
  const key = c.req.param('key');
  const value = await getSecret(key);  // Puede throw
  return c.json({ value });
})
```

### Después (Effect):
```typescript
.get('/:key', handler((c) =>
  Effect.gen(function* () {
    const secrets = yield* SecretService;
    const value = yield* secrets.get(1, c.req.param('key'));
    return Http.ok({ value });
  }).pipe(
    Effect.catchAll((error) => Effect.succeed(
      error._tag === 'SecretNotFoundError' 
        ? Http.notFound() 
        : Http.internalError()
    ))
  )
))
```

## 🎭 Ventajas

1. **Errores tipados**: No más `catch (e: any)`
2. **Manejo explícito**: Cada error se mapea deliberadamente
3. **Testeable**: Podés mockear servicios fácilmente
4. **Composición**: Los servicios se combinan con Layers
5. **Lifecycle**: Recursos (DB, pools) se limpian automáticamente
