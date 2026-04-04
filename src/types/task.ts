// ── Orchestrator Plan ─────────────────────────────────────────────────────────

export type OrchestratorSubtask = {
  /** Temporary label used for dependency references (e.g. "research-1"). */
  id: string;
  prompt: string;
  role: string;
  mode?: TaskMode;
  capabilities?: TaskCapabilityId[];
  /** Labels of subtasks that must complete before this one starts. */
  dependsOn?: string[];
};

export type OrchestratorPlan = {
  objective: string;
  constraints: string[];
  subtasks: OrchestratorSubtask[];
  successCriteria: string[];
  failureCriteria: string[];
  risks: string[];
};

// ── Task Capability IDs ───────────────────────────────────────────────────────

export const TASK_CAPABILITY_IDS = [
  'browser.cdp',
  'app.launch',
  'polymarket.trading',
  'office.professional',
  'app.scripting',
  'onchain.trading',
  'cex.trading',
] as const;

export type TaskCapabilityId = (typeof TASK_CAPABILITY_IDS)[number];

export const ALL_TASK_CAPABILITIES: Array<{
  id: TaskCapabilityId;
  title: string;
  desc: string;
}> = [
  { id: 'browser.cdp', title: 'Browser', desc: 'Control Chrome via Playwright (CDP).' },
  { id: 'app.launch', title: 'Launch Apps', desc: 'Open applications on your computer.' },
  {
    id: 'polymarket.trading',
    title: 'Polymarket Trading',
    desc: 'Trade on Polymarket via a dedicated API client (no screen control).',
  },
  {
    id: 'office.professional',
    title: 'Office Pro',
    desc: 'Professional formatting expertise for Excel, Word, and PowerPoint.',
  },
  {
    id: 'app.scripting',
    title: 'App Scripting',
    desc: 'Run scripts inside desktop apps (Illustrator, Photoshop, After Effects, Blender, Unreal).',
  },
  {
    id: 'onchain.trading',
    title: 'On-Chain Trading',
    desc: 'Trade on DEXs and manage on-chain assets (EVM).',
  },
  {
    id: 'cex.trading',
    title: 'CEX Trading',
    desc: 'Trade on centralized exchanges (Binance, Coinbase).',
  },
];

// ── Task Status Flow ──────────────────────────────────────────────────────────
// pending_approval → approved → running → completed | failed | cancelled
//                                      └→ monitoring → completed | failed

export type TaskStatus =
  | 'pending_approval'
  | 'approved'
  | 'running'
  | 'shutting_down'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'monitoring';

// ── Task Actions (model output) ───────────────────────────────────────────────

export type TaskAction =
  // Desktop / screen agent actions
  | { type: 'click'; x: number; y: number; button?: 'left' | 'right' | 'middle' }
  | { type: 'double_click'; x: number; y: number }
  | { type: 'type'; text: string }
  | { type: 'key'; combo: string }
  | { type: 'scroll'; x: number; y: number; direction: 'up' | 'down'; amount?: number }
  | { type: 'move'; x: number; y: number }
  | { type: 'launch'; app: string }
  | { type: 'wait'; ms: number }
  | { type: 'web_scrape'; url: string; instruction: string }
  | { type: 'save_to_excel'; filename: string; filter?: string }
  | { type: 'shell'; command: string; cwd?: string; timeout?: number }
  | { type: 'upload_file'; selector: string; filePaths: string[] }
  | { type: 'done'; summary: string }
  | { type: 'fail'; reason: string }
  | { type: 'user_message'; text: string }
  // Polymarket trading actions (require polymarket.trading capability)
  | { type: 'polymarket_get_account_summary' }
  | { type: 'polymarket_get_trader_leaderboard' }
  | { type: 'polymarket_search_markets'; query: string; limit?: number }
  | {
      type: 'polymarket_place_order';
      tokenId: string;
      side: 'buy' | 'sell';
      price: number;
      size: number;
      tickSize?: string;
      negRisk?: boolean;
    }
  | {
      type: 'polymarket_close_position';
      tokenId: string;
      size?: number;
    }
  | {
      type: 'monitor_position';
      /** Which venue: polymarket, cex, onchain */
      venue: 'polymarket' | 'cex' | 'onchain';
      /** Token/position identifier to monitor */
      tokenId: string;
      /** Entry price (for PnL calculation) */
      entryPrice: number;
      /** Size of the position */
      size: number;
      /** Take profit: close when price reaches this (0-1 for polymarket) */
      takeProfitPrice: number;
      /** Stop loss: close when price drops to this */
      stopLossPrice: number;
      /** Check interval in ms (default 300000 = 5 min) */
      intervalMs?: number;
      /** Max monitoring duration in ms (default 7 days) */
      maxDurationMs?: number;
      /** Side of the position */
      side: 'buy' | 'sell';
    }
  // Code mode file operations
  | { type: 'file_read'; path: string; offset?: number; limit?: number; cwd?: string }
  | { type: 'file_write'; path: string; content: string; cwd?: string }
  | { type: 'file_edit'; path: string; old_string: string; new_string: string; cwd?: string }
  | { type: 'file_list'; pattern: string; cwd?: string }
  | { type: 'file_search'; pattern: string; path?: string; glob?: string; cwd?: string }
  // Inter-task communication
  | { type: 'task_list_peers' }
  | { type: 'task_send'; prompt: string; agentName?: string; agentRole?: string }
  | { type: 'task_read'; taskId: string }
  | { type: 'task_message'; taskId: string; message: string }
  // Orchestrator actions
  | { type: 'plan'; plan: OrchestratorPlan }
  | {
      type: 'task_spawn';
      prompt: string;
      mode?: TaskMode;
      capabilities?: TaskCapabilityId[];
      agentName?: string;
      agentRole?: string;
      /** Max steps for the child task. Defaults are: Research=30, Risk=15, Executor=50, Monitor=20. */
      maxSteps?: number;
      /** Override the model for this child task (within the active provider). */
      model?: string;
    }
  | { type: 'task_wait'; taskIds: string[]; timeoutMs?: number }
  | {
      type: 'task_spawn_batch';
      tasks: Array<{
        prompt: string;
        mode?: TaskMode;
        capabilities?: TaskCapabilityId[];
        agentName?: string;
        agentRole?: string;
        maxSteps?: number;
        model?: string;
      }>;
    }
  // App scripting actions (require app.scripting capability)
  | { type: 'app_script'; app: string; script: string }
  // Long-term memory (facts)
  | { type: 'remember_fact'; fact: string }
  | { type: 'forget_fact'; factId: number }
  // Knowledge memory (structured observations)
  | {
      type: 'memory_save';
      title: string;
      content: string;
      obs_type?: string;
      project?: string;
      topic_key?: string;
    }
  | { type: 'memory_search'; query: string; type_filter?: string; project?: string; limit?: number }
  | { type: 'memory_context'; project?: string; limit?: number }
  // Sub-agent identity — first action in a sub-agent task
  | { type: 'set_identity'; name: string; role?: string }
  | { type: 'generate_image'; prompt: string; size?: '1024x1024' | '1792x1024' | '1024x1792' }
  // On-chain trading actions (require onchain.trading capability)
  | { type: 'chain_get_balance'; chainId?: number }
  | { type: 'chain_get_token_balance'; chainId?: number; tokenAddress: string }
  | { type: 'chain_send_token'; chainId?: number; tokenAddress: string; to: string; amount: string }
  | { type: 'chain_swap'; chainId?: number; tokenIn: string; tokenOut: string; amountIn: string; slippageBps?: number }
  | { type: 'chain_get_tx_status'; chainId?: number; txHash: string }
  | { type: 'chain_get_allowance'; chainId?: number; tokenAddress?: string }
  | { type: 'chain_get_smart_wallet'; chainId?: number }
  // CEX trading actions (require cex.trading capability)
  | { type: 'cex_get_balance'; exchange: import('./trading').CexExchangeId }
  | {
      type: 'cex_place_order';
      exchange: import('./trading').CexExchangeId;
      symbol: string;
      side: 'buy' | 'sell';
      orderType: 'market' | 'limit';
      amount: number;
      price?: number;
    }
  | { type: 'cex_cancel_order'; exchange: import('./trading').CexExchangeId; orderId: string; symbol?: string }
  | { type: 'cex_get_positions'; exchange: import('./trading').CexExchangeId }
  | { type: 'cex_get_ticker'; exchange: 'binance' | 'coinbase'; symbol: string }
  | {
      type: 'cex_withdraw';
      exchange: import('./trading').CexExchangeId;
      asset: string;
      amount: number;
      address: string;
      network: string;
    };

// ── Task Step (one turn of the agent loop) ────────────────────────────────────

export type TaskStep = {
  index: number;
  timestamp: number;
  /** Base64 PNG screenshot taken before this action. */
  screenshotBase64: string;
  /** Action the model decided on. */
  action: TaskAction;
  /** Model reasoning / thought (optional). */
  thought?: string;
  /** Result text from API actions (polymarket, etc.). */
  result?: string;
  /** Error if action execution failed. */
  error?: string;
  /** Context window usage ratio at the time of this step (0.0–1.0). */
  contextPct?: number;
  /** Detailed context token info for this step. */
  contextTokens?: {
    used: number;
    max: number;
    /** true = character-based estimate; false = provider-reported */
    estimated: boolean;
  };
};

// ── Task (the top-level entity) ───────────────────────────────────────────────

export type TaskSource = 'desktop' | 'telegram' | 'discord' | 'slack' | 'whatsapp' | 'signal';

export type TaskMode = 'browser' | 'code';

// The concrete execution loop selected by the backend.
// This is derived from { mode, capabilities }.
export type TaskRunnerId = 'browser' | 'code' | 'cdp' | 'orchestrator';

export type Task = {
  id: string;
  /** Owner user ID for multi-user isolation */
  userId?: number;
  /** If present, this task was spawned from another task (sub-agent). */
  parentTaskId?: string;
  /** Optional display name for multi-agent UI. */
  agentName?: string;
  /** Optional role label for multi-agent UI (e.g. "Copy", "Imagen", "Browser"). */
  agentRole?: string;
  /** Reference to an agent definition from AgentRegistry (e.g. "researcher", "executor"). */
  agent?: string;
  prompt: string;
  /** Optional local file paths attached by the user (absolute paths). */
  attachments?: string[];
  status: TaskStatus;
  mode: TaskMode;
  /** The backend-selected execution loop. */
  runner: TaskRunnerId;
  capabilities: TaskCapabilityId[];
  steps: TaskStep[];
  /** Best-effort token usage (only available for some providers). */
  usage?: { inputTokens: number; outputTokens: number };
  createdAt: number;
  updatedAt: number;
  /** Max steps before auto-stopping. */
  maxSteps: number;
  /** Hard timeout in ms. */
  timeoutMs: number;
  /** Error message if failed. */
  error?: string;
  /** Summary from the model when done. */
  summary?: string;
  /** Where the task was created from. Channels only notify for their own tasks. */
  source?: TaskSource;
  /** Structured plan produced by orchestrator agents. */
  plan?: OrchestratorPlan;
  /** IDs of child tasks spawned by this orchestrator. */
  childTaskIds?: string[];
  /** Per-task model override within the active provider. Falls back to policy model if not set. */
  model?: string;
  /** If true, skip memory/facts injection (set for orchestrator children that already have context). */
  skipMemory?: boolean;
  /** Active position monitor config. Set when agent delegates to system-level monitoring. */
  monitor?: {
    venue: 'polymarket' | 'cex' | 'onchain';
    tokenId: string;
    entryPrice: number;
    size: number;
    takeProfitPrice: number;
    stopLossPrice: number;
    intervalMs: number;
    maxDurationMs: number;
    side: 'buy' | 'sell';
    startedAt: number;
  };
};

// ── API payloads ─────────────────────────────────────────────────────────────

export type TaskCreateRequest = {
  prompt: string;
  /**
   * Task-scoped capabilities. If omitted/empty, the backend may infer sensible defaults.
   */
  capabilities?: TaskCapabilityId[];
  /** Optional local file paths attached by the user (absolute paths). */
  attachments?: string[];
  mode?: TaskMode;
  /** If true (default server-side), infer mode/capabilities when not provided. */
  infer?: boolean;
  /** How to infer mode/capabilities when infer=true. */
  inferStrategy?: 'auto' | 'rules' | 'llm';
  maxSteps?: number;
  timeoutMs?: number;
  source?: TaskSource;
  parentTaskId?: string;
  agentName?: string;
  agentRole?: string;
  /** Reference to an agent definition from AgentRegistry (e.g. "researcher", "executor"). */
  agent?: string;
  /** If true, uses the orchestrator runner to plan and delegate to sub-agents. */
  orchestrate?: boolean;
  /** Override the model for this task within the active provider. */
  model?: string;
  /** If true, skip memory/facts injection (used for orchestrator children that already have context). */
  skipMemory?: boolean;
};

export type TaskInferRequest = {
  prompt: string;
  attachments?: string[];
  strategy?: 'auto' | 'rules' | 'llm';
};

export type TaskInferResponse = {
  mode: TaskMode;
  runner: TaskRunnerId;
  capabilities: TaskCapabilityId[];
  source: 'rules' | 'llm';
  confidence: number;
};

export type TaskCreateResponse = {
  task: Task;
};

export type TaskApproveRequest = {
  taskId: string;
};

export type TaskCancelRequest = {
  taskId: string;
};

export type TaskGetRequest = {
  taskId: string;
};

export type TaskListResponse = {
  tasks: Task[];
};

export type TaskUpdateEvent = {
  task: Task;
};
