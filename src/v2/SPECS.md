# Agent stack — Specs (`src/v2`)

Canonical architecture for autonomous tasks lives in **`src/v2/`**. See **`README.md`** (module entry) and **`ENDPOINTS.md`** (HTTP surface).

## Context

The wider codebase historically had multiple sources of truth for provider resolution:
- `policy.provider.active` (in policy table)
- `secrets` table (PostgreSQL)
- `config.providers` (`.env` variables, unused)
- `ProviderSecretsService` (duplicate service, unused)

This causes confusion: a user's policy may say "chatgpt" but their API key is stored for "gemini" in the secrets table. The system falls back unpredictably.

## Goal

A clean, layered architecture with **one source of truth**: the `secrets` table in PostgreSQL.

## Rules

1. **One entry point to LLM**: `dispatchChat(provider, messages, userId)`
2. **One provider resolver**: `resolveProvider(userId)` → returns `ProviderId`
3. **Source of truth**: `secrets` table only
4. **No fallback**: if no provider has an API key → throw error
5. **No `openaiModel`**: each provider uses its own configured model
6. **No policy-provider coupling**: policy is for behavior settings only (capabilities, memory, etc.)

## Layers (bottom to top)

```
┌──────────────────────────────────────────────────┐
│  LAYER 5: Task Manager                            │
│  - CRUD tasks, lifecycle management               │
│  - Calls resolveProvider() to get provider        │
│  - Passes provider + task to TaskRunner           │
└──────────────────┬───────────────────────────────┘
                   │
                   ▼
┌──────────────────────────────────────────────────┐
│  LAYER 4: Task Runner                             │
│  - Orchestrates execution for a single task       │
│  - Receives provider (already resolved)           │
│  - Selects the correct loop (browser/code/cdp)    │
│  - Passes provider to the loop                    │
└──────────────────┬───────────────────────────────┘
                   │
                   ▼
┌──────────────────────────────────────────────────┐
│  LAYER 3: Agent Loops (ReAct)                     │
│  - THINK → ACT → OBSERVE cycle                    │
│  - Calls dispatchChat() for LLM interaction       │
│  - Executes actions via Tool Registry             │
│  - Manages history, context, compaction           │
└──────────────────┬───────────────────────────────┘
                   │
                   ▼
┌──────────────────────────────────────────────────┐
│  LAYER 2: Provider Dispatch                       │
│  - dispatchChat(provider, messages, userId)       │
│  - Reads API key from secrets table               │
│  - Routes to the correct provider implementation  │
│  - Returns raw text response                      │
└──────────────────┬───────────────────────────────┘
                   │
                   ▼
┌──────────────────────────────────────────────────┐
│  LAYER 1: Provider Resolution                     │
│  - resolveProvider(userId) → ProviderId           │
│  - Queries secrets table for available keys       │
│  - Returns first provider with a valid key        │
│  - Throws if no provider configured               │
└──────────────────────────────────────────────────┘
```

## Spec per Layer

See individual spec files:
- `01-provider-resolution.md`
- `02-provider-dispatch.md`
- `03-agent-loop.md`
- `04-task-runner.md`
- `05-task-manager.md`
