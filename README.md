# skynul-backend

Backend services for Skynul — multi-channel agent platform (Telegram, WhatsApp, Discord, Slack, Signal).

## Quick Start

```bash
pnpm install
pnpm dev
```

## API Structure

```
/api/tasks          → task management, schedules, projects
/api/ai            → chat dispatch, providers (chatgpt, ollama)
/api/agent         → skills, policy settings, dialogs
/api/integrations  → channels (telegram, discord, etc), secrets
/api/system        → browser snapshots, runtime stats
```

## Commands

```bash
pnpm dev          # start dev server
pnpm typecheck    # TypeScript check
pnpm lint         # biome check
pnpm lint:fix     # biome fix
pnpm test         # vitest watch
pnpm test:run     # vitest single run
```
