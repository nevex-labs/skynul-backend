# Eliminaciones / traslados (estructura)

## Carpeta `src/routes/integrations/`

- **Eliminada por completo** (2026-04-07).
- **Antes:** `GET/PUT ...` bajo `/api/integrations/channels` y `/api/integrations/trading`.
- **Ahora:** mismas rutas lógicas bajo prefijos directos:
  - `/api/channels/*` → `src/routes/channels.ts` (exporta `channelManager`).
  - `/api/trading/*` → `src/routes/trading.ts` (`/settings`, `/providers`, etc.).

## Histórico reciente (misma línea de simplificación)

- `src/routes/integrations/secrets.ts`: HTTP duplicado frente a `src/db/queries/secrets.ts` + `src/core/secrets/service.ts`; ruta eliminada antes del cierre de `integrations/`.
- `src/core/stores/` (cuando existía): sustituido por `db/queries` + blobs en `secrets` (`readJsonStore` / `writeJsonStore`, `JsonStoreKey`).

Actualizar clientes HTTP que aún apunten a `/api/integrations/...`.

## Capas (`routes` → `services` → `db/queries` / `core`)

- **`src/routes/`** — HTTP: validación de entrada, llamadas a `services/`, respuesta.
- **`src/services/`** — Orquestación y reglas: varias lecturas/escrituras, uso de `core/`, condicionales.
- **`src/db/queries/`** — Persistencia (SQL / secretos), sin lógica de producto.
- **`src/core/`** — Infra: agent, browser, chain, providers, canales (implementación).

Dependencia permitida: `routes` → `services` → (`db/queries` y/o `core`). No al revés.
