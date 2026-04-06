# Layer 5: Task Manager

## Purpose

High-level task lifecycle management: CRUD operations, task creation with inference, approval flow, and coordination with the TaskRunner. **Does NOT know about providers, models, or LLM internals.**

## Contract

```typescript
interface TaskManager {
  /**
   * Create a new task from a user request.
   * 
   * If capabilities are not provided, runs inference to determine:
   * - mode (browser/code)
   * - runner type
   * - capabilities
   */
  create(request: TaskCreateRequest): Promise<Task>;
  
  /**
   * Approve a task for execution.
   * Resolves the provider, creates a TaskRunner, and starts execution.
   */
  approve(taskId: string): Promise<Task>;
  
  /**
   * List tasks (optionally filtered by user).
   */
  list(userId?: number): Task[];
  
  /**
   * Get a task by ID.
   */
  get(taskId: string): Task | undefined;
  
  /**
   * Abort a running task.
   */
  abort(taskId: string): void;
  
  /**
   * Resume a paused task (chat continuation).
   */
  resume(taskId: string, message: string): Promise<Task>;
}

interface TaskCreateRequest {
  /** User's prompt */
  prompt: string;
  
  /** Optional: explicitly set mode */
  mode?: TaskMode;
  
  /** Optional: explicitly set capabilities */
  capabilities?: TaskCapabilityId[];
  
  /** Optional: user ID for multi-tenant isolation */
  userId?: number;
  
  /** Optional: whether to run inference (default: true) */
  infer?: boolean;
  
  /** Optional: attachment file paths */
  attachments?: string[];
  
  /** Optional: model override */
  model?: string;
}
```

## Task Creation Flow

```
TaskManager.create(request)
  │
  ├─ 1. Generate task ID, set status='pending'
  │
  ├─ 2. If request.infer !== false AND capabilities not provided:
  │     │
  │     └─ runInference(request.prompt, request.attachments)
  │          │
  │          ├─ resolveProvider(userId)     ← Layer 1
  │          ├─ dispatchChat(provider, ...)  ← Layer 2 (LLM classification)
  │          └─ Fallback to rules if LLM fails
  │
  ├─ 3. Store task
  │
  └─ 4. Return task
```

## Task Approval Flow

```
TaskManager.approve(taskId)
  │
  ├─ 1. Get task, validate status='pending'
  │
  ├─ 2. resolveProvider(task.userId)        ← Layer 1
  │     └─ Returns ProviderId (or throws)
  │
  ├─ 3. Build system prompt
  │     ├─ Base prompt (agent behavior)
  │     ├─ Skills context
  │     ├─ Memory context
  │     └─ Feedback context
  │
  ├─ 4. Create TaskRunner with:
  │     ├─ task
  │     ├─ provider (from step 2)
  │     ├─ systemPrompt (from step 3)
  │     └─ callbacks (onUpdate, etc.)
  │
  ├─ 5. Set status='running'
  │
  ├─ 6. runner.run()                         ← Layer 4
  │     └─ ReAct loop executes               ← Layer 3
  │
  └─ 7. Return final task state
```

## What This Layer Does NOT Do

- Does NOT call LLMs directly (delegates to Layer 2 via inference)
- Does NOT read API keys
- Does NOT know about provider resolution internals
- Does NOT manage conversation history
- Does NOT execute actions
- Does NOT parse LLM responses

## Dependencies

- `resolveProvider()` from Layer 1 (for approval flow)
- Inferencia de capabilities: pendiente en v2 (el código legacy fue retirado)
- `TaskRunner` from Layer 4 (for execution)
- Task storage (JSON files or database)

## File

```
src/v2/task-manager.ts  ← New implementation
```

The v2 version:
- Removes `policy?.provider.active` references
- Removes `openaiModel` parameter
- Uses `resolveProvider()` for provider resolution
- Provider resolution happens at approval time, not creation time
