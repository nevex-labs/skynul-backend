# 🗄️ Arquitectura de Base de Datos - Skynul

Sistema de persistencia con **PostgreSQL + Drizzle ORM + Effect**

## 🏗️ Arquitectura

```
src/
├── infrastructure/
│   └── db/
│       ├── schema/           # Definición de tablas (Drizzle)
│       │   ├── users.ts
│       │   ├── secrets.ts
│       │   └── index.ts
│       └── migrations/       # Migraciones generadas
│
├── services/                 # Capa de servicios Effect
│   ├── database/            # Database Layer (scoped)
│   ├── crypto/              # Crypto Layer (effect)
│   └── secrets/             # Business Logic Layer
│
└── examples/
    └── database-usage.ts    # Ejemplo completo
```

## 🚀 Inicio Rápido

### 1. Levantar PostgreSQL

```bash
# Solo PostgreSQL
npm run db:up

# PostgreSQL + pgAdmin (UI web en http://localhost:5050)
npm run db:admin
```

### 2. Configurar Variables de Entorno

```bash
# .env
DATABASE_URL=postgres://skynul:skynul_password@localhost:5432/skynul
MASTER_KEY=tu-master-key-super-segura-de-32-caracteres-minimo
```

### 3. Ejecutar Migraciones

```bash
pnpm db:migrate
```

### 4. Probar el Ejemplo

```bash
npx tsx src/examples/database-usage.ts
```

## 📦 Servicios Effect

### DatabaseService (Layer.scoped)

Maneja el pool de conexiones PostgreSQL con lifecycle automático:

```typescript
import { DatabaseService, DatabaseLive } from "./services/database";

const program = Effect.gen(function* () {
  const db = yield* DatabaseService;
  // El pool se cierra automáticamente al terminar
});
```

**Características:**
- `Layer.scoped`: El pool se cierra limpio cuando el programa termina
- Configurable vía `Config` de Effect
- Connection pooling automático

### CryptoService (Layer.effect)

Encriptación AES-256-GCM:

```typescript
import { CryptoService, CryptoLive } from "./services/crypto";

const program = Effect.gen(function* () {
  const crypto = yield* CryptoService;
  const encrypted = yield* crypto.encrypt("mi-api-key");
  const decrypted = yield* crypto.decrypt(encrypted);
});
```

### SecretService (Layer.effect)

CRUD de secrets encriptados:

```typescript
import { SecretService, SecretServiceLive } from "./services/secrets";

const program = Effect.gen(function* () {
  const secrets = yield* SecretService;
  
  // Guardar
  yield* secrets.set({
    userId: 1,
    keyName: "gemini.apiKey",
    value: "AIzaSy..."
  });
  
  // Recuperar (desencriptado automático)
  const apiKey = yield* secrets.get(1, "gemini.apiKey");
});
```

## 🔗 Composición de Layers

```typescript
import { Layer } from "effect";

// Grafo de dependencias
const AppLayer = SecretServiceLive.pipe(
  Layer.provide(CryptoLive),      // SecretService depende de Crypto
  Layer.provide(DatabaseLive)     // Crypto y SecretService dependen de Database
);

// Ejecutar
const runnable = program.pipe(Effect.provide(AppLayer));
Effect.runPromise(runnable);
```

## 🧪 Testing

```typescript
// Mock completo
const TestLayer = Layer.succeed(
  SecretService,
  SecretService.of({
    get: () => Effect.succeed("mock-key"),
    set: () => Effect.succeed(mockMetadata),
    delete: () => Effect.succeed(undefined),
    list: () => Effect.succeed([]),
  })
);

// Ejecutar test
const testProgram = program.pipe(Effect.provide(TestLayer));
Effect.runPromise(testProgram);
```

## 📝 Comandos Disponibles

| Comando | Descripción |
|---------|-------------|
| `npm run db:up` | Levantar PostgreSQL |
| `npm run db:down` | Detener PostgreSQL |
| `npm run db:admin` | Levantar PostgreSQL + pgAdmin |
| `pnpm db:migrate` | Aplicar migraciones SQL |
| `pnpm db:studio` | Drizzle Studio |

## 🔐 Seguridad

- **Master Key**: Variable de entorno `MASTER_KEY` (32+ caracteres)
- **Encriptación**: AES-256-GCM con IV y AuthTag
- **Formato**: `iv:authTag:encryptedData`
- **Database**: Contraseñas nunca se guardan en texto plano

## 🔄 Migraciones

1. Nuevo cambio: nuevo `NNNN_nombre.sql` + entrada en `meta/_journal.json` (y snapshot si usás `drizzle-kit generate`).
2. `pnpm db:migrate`

**Baseline único (`0000_baseline.sql`):** en una DB nueva vacía basta con `pnpm db:migrate`. Si tenías historial viejo de `drizzle.__drizzle_migrations`, en local podés `DROP SCHEMA public CASCADE; CREATE SCHEMA public; DROP SCHEMA IF EXISTS drizzle CASCADE;` y volver a migrar (solo datos locales).

## 📊 Schema Actual

### Users
```sql
id: serial (PK)
email: varchar(255) unique
createdAt: timestamp
updatedAt: timestamp
```

### Secrets
```sql
id: serial (PK)
userId: integer (FK → users.id)
keyName: varchar(255)
encryptedValue: text
createdAt: timestamp
updatedAt: timestamp

UNIQUE(userId, keyName)
```
