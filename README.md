<div align="center">

<img src=".github/logo-skynul-light.svg" alt="Skynul" width="280" />

### The open-source autonomous agent backend

[![CI](https://github.com/nevex-labs/skynul-backend/actions/workflows/ci.yml/badge.svg)](https://github.com/nevex-labs/skynul-backend/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-22%2B-339933?logo=node.js&logoColor=white)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![Hono](https://img.shields.io/badge/Hono-4.7-E36002?logo=hono&logoColor=white)](https://hono.dev)

[Website](https://www.skynul.com) · [Report Bug](https://github.com/nevex-labs/skynul-backend/issues) · [Request Feature](https://github.com/nevex-labs/skynul-backend/issues)

</div>

---

**Skynul Backend** is the API server that powers the Skynul agent platform. Give it a prompt and it autonomously executes steps — browsing the web, running shell commands, reading files — until the task is done.

This is the **backend only**. It exposes a REST + WebSocket API designed to be consumed by any frontend, CLI, or integration.

```
Prompt → LLM thinks → Action (click, shell, scrape, ...) → Observe → Repeat → Done
```

## Features

- **Two agent modes** — Browser (headless Chromium via Playwright) and Code (shell + filesystem)
- **9 LLM providers** — ChatGPT, Claude, Gemini, DeepSeek, Ollama, OpenRouter, Kimi, GLM, MiniMax
- **5 messaging channels** — Telegram, Discord, Slack, WhatsApp, Signal
- **Multi-task** — concurrent tasks that can communicate via `task_send` / `task_message`
- **Scheduled tasks** — cron-based recurring automation
- **Custom skills** — injectable system prompts that shape agent behavior
- **Input guards** — path sandboxing, SSRF protection, dangerous command filtering
- **API-first** — typed REST API with real-time WebSocket events

## Quick start

```bash
git clone https://github.com/nevex-labs/skynul-backend.git
cd skynul-backend
pnpm install
pnpm dev
```

The server starts on `http://localhost:3141`.

Set at least one LLM provider key:

```bash
export OPENAI_API_KEY=sk-...          # ChatGPT (default)
# or
export ANTHROPIC_API_KEY=sk-ant-...   # Claude
# or
export GEMINI_API_KEY=...             # Gemini
# or run Ollama locally                # no key needed
```

Try it:

```bash
# Health check
curl http://localhost:3141/ping

# Create a task
curl -X POST http://localhost:3141/api/tasks \
  -H 'Content-Type: application/json' \
  -d '{"prompt":"list files in the current directory","mode":"code","capabilities":["cmd.run"]}'

# List tasks
curl http://localhost:3141/api/tasks
```

## Architecture

```
src/
├── index.ts                    # Hono server, routes, WebSocket
├── middleware/
│   ├── auth.ts                 # Bearer token auth (optional)
│   └── cors.ts                 # Origin allowlist
├── routes/
│   ├── tasks/                  # Task CRUD, schedules, projects
│   ├── agent/                  # Skills, policy, dialogs
│   ├── ai/                     # Chat dispatch, Ollama status
│   ├── integrations/           # Channel management, secrets
│   └── system/                 # Runtime stats, browser snapshots
├── core/
│   ├── agent/
│   │   ├── task-runner.ts      # Orchestrates task execution
│   │   ├── task-manager.ts     # Creates, tracks, and manages tasks
│   │   ├── loops/
│   │   │   ├── agent-loop.ts   # Shared LLM → action → observe loop
│   │   │   ├── browser-loop.ts # Playwright-based browser automation
│   │   │   ├── cdp-loop.ts     # Chrome DevTools Protocol mode
│   │   │   └── code-loop.ts    # Shell + filesystem mode
│   │   ├── action-parser.ts    # Extracts JSON actions from LLM output
│   │   ├── action-executors.ts # Runs individual actions
│   │   ├── input-guard.ts      # Path sandbox, URL validation, shell filtering
│   │   ├── vision-dispatch.ts  # Routes to the right vision provider
│   │   └── web-scraper.ts      # Headless Chromium page scraper
│   ├── providers/
│   │   ├── dispatch.ts         # Provider router
│   │   ├── base-chat.ts        # Shared chat provider logic
│   │   ├── base-vision.ts      # Shared vision provider logic
│   │   ├── claude.ts           # Anthropic Claude
│   │   ├── gemini.ts           # Google Gemini
│   │   ├── deepseek.ts         # DeepSeek
│   │   ├── ollama.ts           # Local Ollama
│   │   ├── openrouter.ts       # OpenRouter (any model)
│   │   └── ...                 # kimi, glm, minimax + vision variants
│   ├── channels/
│   │   ├── telegram-channel.ts # Grammy bot
│   │   ├── discord-channel.ts  # Discord.js bot
│   │   ├── slack-channel.ts    # Slack Bolt
│   │   ├── whatsapp-channel.ts # whatsapp-web.js
│   │   ├── signal-channel.ts   # Signal CLI bridge
│   │   └── command-router.ts   # Parses /commands from any channel
│   └── stores/
│       ├── policy-store.ts     # Global settings
│       ├── skill-store.ts      # Custom system prompts
│       ├── schedule-store.ts   # Cron-based recurring tasks
│       ├── secret-store.ts     # Encrypted credential storage
│       └── schemas.ts          # Zod validation schemas
└── types/                      # Shared TypeScript types
```

## API

### Core

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/ping` | Health check |
| `WS` | `/ws` | Real-time task updates |

### Tasks `/api/tasks`

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/` | List all tasks |
| `GET` | `/:id` | Get task by ID |
| `POST` | `/` | Create and start a task |
| `POST` | `/:id/approve` | Approve a pending task |
| `POST` | `/:id/cancel` | Cancel a running task |
| `POST` | `/:id/message` | Send message to a running task |
| `DELETE` | `/:id` | Delete a task |
| `GET` | `/schedules` | List scheduled tasks |
| `POST` | `/schedules` | Create/update schedule |
| `DELETE` | `/schedules/:id` | Delete schedule |
| `PUT` | `/schedules/:id/toggle` | Toggle schedule on/off |
| `GET` | `/projects` | List projects |
| `POST` | `/projects` | Create project |
| `PUT` | `/projects/:id` | Update project |
| `DELETE` | `/projects/:id` | Delete project |

### Agent `/api/agent`

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/policy` | Get global settings |
| `PUT` | `/policy/provider` | Change LLM provider |
| `PUT` | `/policy/provider/model` | Change model |
| `PUT` | `/policy/capability` | Toggle capability |
| `PUT` | `/policy/theme` | Set theme |
| `PUT` | `/policy/language` | Set language |
| `PUT` | `/policy/workspace` | Set workspace root |
| `PUT` | `/policy/task-memory` | Toggle task memory |
| `PUT` | `/policy/task-auto-approve` | Toggle auto-approve |
| `GET` | `/skills` | List custom skills |
| `POST` | `/skills` | Create/update skill |
| `DELETE` | `/skills/:id` | Delete skill |
| `PUT` | `/skills/:id/toggle` | Toggle skill on/off |
| `POST` | `/skills/import` | Import skill from file |

### Integrations `/api/integrations`

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/channels` | List all channels with status |
| `GET` | `/channels/global` | Get global channel settings |
| `PUT` | `/channels/:id/enabled` | Enable/disable channel |
| `PUT` | `/channels/:id/credentials` | Set channel tokens |
| `POST` | `/channels/:id/pairing` | Generate pairing code |
| `DELETE` | `/channels/:id/pairing` | Unpair channel |
| `PUT` | `/channels/auto-approve` | Toggle channel auto-approve |
| `GET` | `/secrets/keys` | List stored secret keys |
| `GET` | `/secrets/:key` | Get secret value |
| `PUT` | `/secrets/:key` | Store a secret |
| `GET` | `/secrets/:key/exists` | Check if secret exists |

### System `/api/system`

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/runtime/stats` | CPU and memory usage |
| `GET` | `/browser/snapshots` | List browser snapshots |
| `POST` | `/browser/snapshots` | Save snapshot |
| `POST` | `/browser/snapshots/:id/restore` | Restore snapshot |
| `DELETE` | `/browser/snapshots/:id` | Delete snapshot |

## LLM providers

| Provider | Env var | Models |
|----------|---------|--------|
| ChatGPT | `OPENAI_API_KEY` | gpt-4.1, gpt-4.1-mini |
| Claude | `ANTHROPIC_API_KEY` | claude-opus-4-6, claude-sonnet-4-6 |
| Gemini | `GEMINI_API_KEY` | gemini-2.5-pro, gemini-2.5-flash |
| DeepSeek | `DEEPSEEK_API_KEY` | deepseek-chat, deepseek-reasoner |
| Ollama | _(local, no key)_ | llama3, mistral, codellama |
| OpenRouter | `OPENROUTER_API_KEY` | Any model via OpenRouter |
| Kimi | `KIMI_API_KEY` | moonshot-v1-* |
| GLM | `GLM_API_KEY` | glm-4v, glm-4 |
| MiniMax | `MINIMAX_API_KEY` | abab6.5s-chat |

Switch at runtime:

```bash
curl -X PUT http://localhost:3141/api/agent/policy/provider \
  -H 'Content-Type: application/json' -d '{"active":"claude"}'
```

## Messaging channels

| Channel | Library | Setup |
|---------|---------|-------|
| Telegram | grammy | Set bot token via API |
| Discord | discord.js | Set bot token, pair to channel |
| Slack | @slack/bolt | Set bot + app tokens |
| WhatsApp | whatsapp-web.js | Scan QR code via pairing |
| Signal | signal-cli | Configure bridge URL |

Users send messages in their channel, the agent creates a task, runs it, and replies with the result.

## Security

| Layer | Details |
|-------|---------|
| **Auth** | Set `SKYNUL_API_TOKEN` to require `Authorization: Bearer <token>`. Unset = no auth (local dev). |
| **CORS** | Localhost always allowed. Production origins via `SKYNUL_ALLOWED_ORIGINS`. |
| **Path sandbox** | File operations restricted to `$HOME`, `$CWD`, `/tmp`. Sensitive paths blocked (`.ssh`, `.env`, `id_rsa`). |
| **SSRF protection** | URLs validated against private IPs, localhost, `169.254.x.x` metadata endpoints. |
| **Shell filter** | Dangerous commands blocked (`rm -rf /`, `curl \| sh`, `mkfs`, etc). |
| **Error handling** | Stack traces hidden in production (`NODE_ENV=production`). |

## Deploy

### Fly.io

```bash
fly launch
fly deploy
fly secrets set OPENAI_API_KEY=sk-... SKYNUL_API_TOKEN=your-secret
```

### Docker

```bash
docker build -t skynul-backend .
docker run -p 3141:3141 -e OPENAI_API_KEY=sk-... skynul-backend
```

The app compiles TypeScript with tsup at build time and runs as plain Node.js in production (~281KB bundle).

## Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `SKYNUL_PORT` | `3141` | Server port |
| `SKYNUL_API_TOKEN` | _(none)_ | Bearer token for API auth |
| `SKYNUL_ALLOWED_ORIGINS` | _(none)_ | Comma-separated CORS origins |
| `SKYNUL_DATA_DIR` | `~/.skynul` | Persistent data directory |
| `NODE_ENV` | `development` | Set `production` to hide error details |

## Development

```bash
pnpm dev          # dev server with hot reload (tsx watch)
pnpm build        # compile TypeScript (tsup)
pnpm start        # run compiled output (node dist/index.js)
pnpm typecheck    # tsc --noEmit
pnpm lint         # biome check
pnpm lint:fix     # biome auto-fix
pnpm test         # vitest watch mode
pnpm test:run     # vitest single run
```

## Tech stack

| | |
|---|---|
| **Runtime** | Node.js 22+ |
| **Framework** | [Hono](https://hono.dev) |
| **Browser** | [Playwright](https://playwright.dev) |
| **Database** | SQLite via better-sqlite3, JSON files |
| **Validation** | Zod |
| **Linter** | Biome |
| **Tests** | Vitest |
| **Build** | tsup (esbuild) |

## Contributing

Contributions are welcome. Please open an issue first to discuss what you'd like to change.

1. Fork the repository
2. Create your branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes
4. Push to the branch
5. Open a Pull Request

## License

Distributed under the MIT License. See [LICENSE](LICENSE) for more information.

---

<div align="center">

Built by [Nevex](https://github.com/nevex-labs)

</div>
