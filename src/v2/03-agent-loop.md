# Layer 3: Agent Loop (ReAct Pattern)

## Purpose

The core execution loop that implements the **ReAct pattern** (Reason + Act) for autonomous task execution. This is where the LLM thinks, decides on an action, the runtime executes it, and the result feeds back into the next iteration.

## The ReAct Cycle

```
┌─────────────────────────────────────────────────────────────┐
│                     ONE TURN (iteration)                     │
│                                                              │
│  Input: systemPrompt + history[] + provider + userId        │
│                                                              │
│  1. THINK     → callVision(provider, systemPrompt, history)  │
│                 LLM returns: thought + action request        │
│                                                              │
│  2. ACT       → executeAction(action)                        │
│                 Runtime executes: browser, shell, etc.       │
│                                                              │
│  3. OBSERVE   → result (success or error)                    │
│                 Append to history as user message            │
│                                                              │
│  4. CHECK     → action.type === 'done' | 'fail' | continue   │
│                 If continue → next turn                      │
│                 If done/fail → exit loop                     │
│                                                              │
│  Output: Task with steps[], status, summary/error            │
└─────────────────────────────────────────────────────────────┘
```

## Contract

```typescript
interface AgentLoop {
  /**
   * Run the ReAct loop for a task.
   * 
   * @param opts - Configuration for the loop execution.
   * @returns Task - The task with all steps recorded and final status.
   */
  run(opts: LoopOpts): Promise<Task>;
}

interface LoopOpts {
  /** Task being executed */
  task: Task;
  
  /** Resolved provider (from Layer 1) */
  provider: ProviderId;
  
  /** System prompt that defines agent behavior and tools */
  systemPrompt: string;
  
  /** Optional compact version of system prompt for context pressure */
  systemPromptCompact?: string;
  
  /** Callbacks for action execution and status updates */
  callbacks: LoopCallbacks;
  
  /** Maximum number of steps before forcing termination */
  maxSteps: number;
  
  /** Optional context window override (tokens) */
  contextWindowOverride?: number;
}

interface LoopCallbacks {
  /** Execute an action requested by the LLM */
  executeAction(action: TaskAction): Promise<string | undefined>;
  
  /** Record a completed step */
  recordStep(step: TaskStep): void;
  
  /** Push status update to UI */
  pushStatus(msg: string): void;
  
  /** Check if task was aborted */
  isAborted(): boolean;
  
  /** Optional: stream partial thinking text */
  pushThinking?(taskId: string, stepIndex: number, partial: string): void;
  
  /** Optional: restrict which actions are allowed */
  allowedTools?: string[];
}
```

## Action Types

The LLM can request these actions in its response:

| Action | Description | Execution |
|--------|-------------|-----------|
| `done` | Task completed successfully | Exit loop, set status=completed |
| `fail` | Task cannot continue | Exit loop, set status=failed |
| `browser.click` | Click element in browser | Browser loop |
| `browser.type` | Type text in browser | Browser loop |
| `browser.navigate` | Navigate to URL | Browser loop |
| `browser.screenshot` | Take screenshot | Browser loop |
| `cmd.run` | Run shell command | Code loop |
| `fs.read` | Read file | Code loop |
| `fs.write` | Write file | Code loop |
| `net.http` | Make HTTP request | Code loop |
| `monitor_position` | Check trading position | Trading loop |
| `user_message` | User sent a message | Inject into history |

## Context Management

The loop manages conversation history with these strategies:

| Level | Trigger | Action |
|-------|---------|--------|
| 0 | Normal | Full history, full system prompt |
| 1 | Context > 60% | Reduce images from 4 to 2 |
| 2 | Context > 80% | Use compact system prompt, snip oldest messages |
| 3 | Context > 90% | LLM-driven auto-compact (summarize history) |
| Fallback | Context error | Attempt recovery with aggressive compaction |

## What This Layer Does NOT Do

- Does NOT resolve which provider to use (receives it as input)
- Does NOT read API keys from anywhere
- Does NOT manage task lifecycle (create, approve, complete)
- Does NOT know about the secrets table
- Does NOT decide which loop mode to use (browser/code/cdp)

## Dependencies

- `dispatchChat()` from Layer 2 (single LLM entry point)
- `action-parser.ts` (parse LLM response into actions)
- `context-budget.ts` (calculate token usage)
- `compaction/` (context management strategies)
- `history-manager.ts` (history manipulation utilities)

## File

```
src/v2/agent-loop.ts  ← New implementation
```

The v2 version:
- Removes `openaiModel` parameter entirely
- Uses `dispatchChat()` as the only LLM call mechanism
- Each provider manages its own model internally
