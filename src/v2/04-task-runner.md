# Layer 4: Task Runner

## Purpose

Thin orchestrator that receives a task with a **resolved provider** and delegates to the correct execution loop based on the task's mode and runner type.

## Contract

```typescript
interface TaskRunner {
  /**
   * Execute a task by delegating to the appropriate loop.
   * 
   * @returns Task - The task with all steps recorded and final status.
   */
  run(): Promise<Task>;
  
  /**
   * Abort the running task.
   */
  abort(): void;
}

interface TaskRunnerOpts {
  /** Task to execute */
  task: Task;
  
  /** Resolved provider (from Layer 1) */
  provider: ProviderId;
  
  /** Context from memory recall */
  memoryContext?: string;
  
  /** Task manager reference for updates */
  taskManager?: TaskManager | null;
  
  /** Task ID for tracking */
  taskId?: string;
  
  /** Whether paper trading mode is enabled */
  paperMode?: boolean;
  
  /** Agent system prompt to prepend */
  agentSystemPrompt?: string;
  
  /** Allowed tools from agent definition */
  agentAllowedTools?: string[];
}
```

## Runner Selection

The TaskRunner selects the correct loop based on the task's runner type:

```
TaskRunner.run()
  │
  ├─ runner === 'browser'    → browser-loop
  ├─ runner === 'code'       → code-loop
  ├─ runner === 'cdp'        → cdp-loop
  ├─ runner === 'orchestrator' → orchestrator-loop
  └─ runner === 'streaming'  → streaming-loop
```

Each loop receives:
- `provider` (already resolved)
- `systemPrompt` (built from task context)
- `history` (initial messages)
- `callbacks` (executeAction, recordStep, pushStatus, isAborted)
- `task` (for tracking)

## Responsibilities

1. **Build the system prompt** for the task (inject skills, memory, context)
2. **Initialize the history** with system + user messages
3. **Create action executors** for the task's capabilities
4. **Select the correct loop** based on runner type
5. **Run the loop** and return the final task state
6. **Handle errors** and set task status accordingly

## What This Layer Does NOT Do

- Does NOT resolve which provider to use (receives it as input)
- Does NOT read API keys
- Does NOT manage task CRUD operations
- Does NOT decide which provider to use
- Does NOT know about the secrets table

## Action Executors

The TaskRunner creates a registry of action executors based on the task's capabilities:

```
TaskRunner
  │
  ├─ buildExecutorContext()
  │    │
  │    ├─ capabilities: ['browser.cdp', 'cmd.run', 'fs.read']
  │    │
  │    └─ Returns ExecutorContext with:
  │         - browser: BrowserEngine (if browser.cdp)
  │         - shell: ShellSandbox (if cmd.run)
  │         - filesystem: fs module (if fs.read/fs.write)
  │         - http: fetch wrapper (if net.http)
  │         - trading: PolymarketClient (if polymarket.trading)
  │         - etc.
  │
  └─ Pass ExecutorContext to the selected loop
```

## Dependencies

- `LoopOpts` and `AgentLoop` from Layer 3
- `ProviderId` from shared types
- Action executors (`action-executors.ts`)
- Loop implementations (`loops/`)

## File

```
src/v2/task-runner.ts  ← New implementation
```

The v2 version:
- Removes `openaiModel` from opts (replaced by `provider`)
- Provider is required, not optional
- No default provider fallback
