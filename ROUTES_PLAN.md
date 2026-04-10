# Propuesta Final - Convenciones Drizzle + Hono

## Drizzle Conventions (schema)
```typescript
// ✅ Un dominio = un archivo
src/db/schema/
├── tasks.ts      // tabla: tasks
├── skills.ts    // tabla: skills
├── channels.ts   // tabla: channel_configs
└── index.ts     // re-export todo
```

## Hono Conventions (routes)
```typescript
// ✅ Un recurso = un router agrupado
src/api/
├── tasks.ts      // /api/tasks
│   ├── GET /       → list
│   ├── POST /      → create
│   ├── GET /:id   → get
│   └── ...
│
├── skills.ts     // /api/skills
│   ├── GET /       → list
│   └── POST /      → create
│
└── channels.ts  // /api/channels
    ├── GET /       → list
    └── POST /      → create

// ✅ Handlers directos, no controller
tasks.get('/', (c) => c.json(tasks))
tasks.post('/', async (c) => { ... })

// ✅ basePath() para prefijos
const api = new Hono().basePath('/api')
api.route('/tasks', tasks)

// ✅ Middleware directo
app.use('/api/*', authMiddleware)
```

## Estructura Final Propuesta

```
src/
├── index.ts                 # app principal
│
├── auth/
│   ├── router.ts         # /auth/* (SIWE)
│   └── middleware.ts    # JWT verify
│
├── api/
│   ├── tasks/
│   │   └── router.ts    # /api/tasks (5 endpoints)
│   │
│   ├── skills/
│   │   └── router.ts   # /api/skills (3 endpoints)
│   │
│   └── channels/
│       └── router.ts    # /api/channels (2 endpoints)
│
└── db/
    ├── schema/
    │   ├── tasks.ts
    │   ├── skills.ts
    │   ├── channels.ts
    │   └── index.ts
    │
    └── queries/
        ├── tasks.ts
        ├── skills.ts
        └── channels.ts
```

## Beneficios

| Convention | Why |
|------------|-----|
| 1 archivo x dominio | Easy de encontrar, Easy de testear |
| app.route() | Organizar sin controllers |
| handlers directos | El router infiere tipos automáticamente |
| schema/index.ts | Drizzle Kit lo necesita |
| $inferSelect/Insert | Tipos automáticos desde el schema |
| basePath('/api') | Prefijo común sin duplicar |

## Resumen

| Métrica | Cantidad |
|---------|----------|
| Archivos routes | 4 (auth + 3 api) |
| Endpoints | 11 |
| Tablas DB | 5 (tasks, skills, channels, users, secrets) |