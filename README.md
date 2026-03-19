# Skynul Backend

Self-hosted autonomous agent platform. Runs tasks in browser automation mode (Playwright/CDP) or code mode (shell + filesystem), with multi-provider LLM support and messaging channel integrations.

```
  ███████╗██╗  ██╗██╗   ██╗███╗   ██╗██╗   ██╗██╗
  ██╔════╝██║ ██╔╝╚██╗ ██╔╝████╗  ██║██║   ██║██║
  ███████╗█████╔╝  ╚████╔╝ ██╔██╗ ██║██║   ██║██║
  ╚════██║██╔═██╗   ╚██╔╝  ██║╚██╗██║██║   ██║██║
  ███████║██║  ██╗   ██║   ██║ ╚████║╚██████╔╝███████╗
  ╚══════╝╚═╝  ╚═╝   ╚═╝   ╚═╝  ╚═══╝ ╚═════╝ ╚══════╝
```

## What it does

An agent receives a prompt, then autonomously executes steps until the task is complete:

```
Prompt → LLM thinks → Action (click, shell, scrape, ...) → Observe result → Repeat → Done
```

**Two agent modes:**
- **Browser** — headless Chromium via Playwright. Navigates pages, clicks elements, fills forms, scrapes content.
- **Code** — shell commands + filesystem. Reads/writes files, runs scripts, searches codebases.

**Multi-task:** tasks run concurrently and can communicate with each other via `task_send` / `task_message`.

## Quick start

```bash
pnpm install
pnpm dev          # starts on http://localhost:3141
```

Set at least one LLM provider key:

```bash
export OPENAI_API_KEY=sk-...        # for ChatGPT (default provider)
# or
export ANTHROPIC_API_KEY=sk-ant-... # for Claude
# or
export GEMINI_API_KEY=...           # for Gemini
# or run Ollama locally              # no key needed
```

Test it:

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
│   │   ├── action-executors.ts # Runs individual actions (shell, file I/O, etc.)
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
│       ├── policy-store.ts     # Global settings (provider, capabilities, theme)
│       ├── skill-store.ts      # Custom system prompts
│       ├── schedule-store.ts   # Cron-based recurring tasks
│       ├── secret-store.ts     # Encrypted credential storage
│       └── schemas.ts          # Zod validation schemas
└── types.ts                    # Shared TypeScript types
```

## API endpoints

### Core

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/ping` | Health check |
| `WS` | `/ws` | Real-time task updates |

### Tasks — `/api/tasks`

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/` | List all tasks |
| `GET` | `/:id` | Get task by ID |
| `POST` | `/` | Create and start a task |
| `POST` | `/:id/approve` | Approve a pending task |
| `POST` | `/:id/cancel` | Cancel a running task |
| `POST` | `/:id/message` | Send a message to a running task |
| `DELETE` | `/:id` | Delete a task |
| `GET` | `/schedules` | List scheduled tasks |
| `POST` | `/schedules` | Create/update schedule |
| `GET` | `/projects` | List projects |
| `POST` | `/projects` | Create project |

### Agent — `/api/agent`

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/policy` | Get global settings |
| `PUT` | `/policy/provider` | Change LLM provider |
| `PUT` | `/policy/provider/model` | Change model |
| `PUT` | `/policy/capability` | Toggle capability (fs.read, cmd.run, etc.) |
| `GET` | `/skills` | List custom skills |
| `POST` | `/skills` | Create/update skill |
| `POST` | `/skills/import` | Import skill from .json/.md file |

### Integrations — `/api/integrations`

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/channels` | List all channels with status |
| `PUT` | `/channels/:id/credentials` | Set channel tokens |
| `PUT` | `/channels/:id/enabled` | Enable/disable channel |
| `POST` | `/channels/:id/pairing` | Generate pairing code |
| `GET` | `/secrets/keys` | List stored secret keys |
| `PUT` | `/secrets/:key` | Store a secret |

### System — `/api/system`

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/runtime/stats` | CPU and memory usage |
| `GET` | `/browser/snapshots` | List browser snapshots |

## LLM providers

| Provider | Env var | Models |
|----------|---------|--------|
| ChatGPT | `OPENAI_API_KEY` | gpt-4.1, gpt-4.1-mini, ... |
| Claude | `ANTHROPIC_API_KEY` | claude-opus-4-6, claude-sonnet-4-6, ... |
| Gemini | `GEMINI_API_KEY` | gemini-2.5-pro, gemini-2.5-flash, ... |
| DeepSeek | `DEEPSEEK_API_KEY` | deepseek-chat, deepseek-reasoner |
| Ollama | _(local, no key)_ | llama3, mistral, codellama, ... |
| OpenRouter | `OPENROUTER_API_KEY` | Any model via OpenRouter |
| Kimi | `KIMI_API_KEY` | moonshot-v1-* |
| GLM | `GLM_API_KEY` | glm-4v, glm-4 |
| MiniMax | `MINIMAX_API_KEY` | abab6.5s-chat |

Switch provider at runtime:

```bash
curl -X PUT http://localhost:3141/api/agent/policy/provider \
  -H 'Content-Type: application/json' -d '{"active":"claude"}'
```

## Messaging channels

The agent can receive tasks and respond through:

| Channel | Library | Setup |
|---------|---------|-------|
| Telegram | grammy | Set bot token via `/api/integrations/channels/telegram/credentials` |
| Discord | discord.js | Set bot token, pair to a channel |
| Slack | @slack/bolt | Set bot + app tokens |
| WhatsApp | whatsapp-web.js | Scan QR code via pairing |
| Signal | signal-cli | Configure Signal CLI bridge URL |

Users send messages in their channel, the agent creates a task, runs it, and replies with the result.

## Security

- **Auth**: Set `SKYNUL_API_TOKEN` to require `Authorization: Bearer <token>` on all endpoints (except `/ping` and `/ws`). Unset = local dev mode, no auth.
- **CORS**: Only `localhost`, Electron (no origin), and origins in `SKYNUL_ALLOWED_ORIGINS` (comma-separated) are allowed.
- **Input guards**: File operations are sandboxed to home/cwd/tmp. Sensitive paths (`.ssh`, `.env`, `id_rsa`) are blocked. URLs are validated against SSRF (private IPs, metadata endpoints). Shell commands are filtered for dangerous patterns.
- **Error handling**: Stack traces are hidden in production (`NODE_ENV=production`).

## Deploy (Fly.io)

```bash
fly launch             # first time
fly deploy             # subsequent deploys
fly secrets set OPENAI_API_KEY=sk-... SKYNUL_API_TOKEN=your-secret
```

The app compiles TypeScript with tsup at build time and runs as plain Node.js in production.

## Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `SKYNUL_PORT` | `3141` | Server port |
| `SKYNUL_API_TOKEN` | _(none)_ | Bearer token for auth (unset = no auth) |
| `SKYNUL_ALLOWED_ORIGINS` | _(none)_ | Comma-separated allowed CORS origins |
| `SKYNUL_DATA_DIR` | `~/.skynul` | Persistent data directory |
| `NODE_ENV` | `development` | Set to `production` to hide error details |

## Commands

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

- **Runtime**: Node.js 22+
- **Framework**: [Hono](https://hono.dev) (lightweight, fast, typed)
- **Browser automation**: [Playwright](https://playwright.dev)
- **Database**: SQLite via better-sqlite3 (projects), JSON files (policy, skills, schedules)
- **Validation**: Zod
- **Linter**: Biome
- **Tests**: Vitest
- **Build**: tsup (esbuild)
