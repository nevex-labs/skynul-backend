// ── Task Capability IDs ───────────────────────────────────────────────────────

export type TaskCapabilityId =
  | 'browser.cdp'
  | 'app.launch'
  | 'polymarket.trading'
  | 'office.professional'
  | 'app.scripting';

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
];

// ── Task Status Flow ──────────────────────────────────────────────────────────
// pending_approval → approved → running → completed | failed | cancelled

export type TaskStatus = 'pending_approval' | 'approved' | 'running' | 'completed' | 'failed' | 'cancelled';

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
  // App scripting actions (require app.scripting capability)
  | { type: 'app_script'; app: string; script: string }
  // Long-term memory
  | { type: 'remember_fact'; fact: string }
  | { type: 'forget_fact'; factId: number }
  // Sub-agent identity — first action in a sub-agent task
  | { type: 'set_identity'; name: string; role?: string }
  | { type: 'generate_image'; prompt: string; size?: '1024x1024' | '1792x1024' | '1024x1792' };

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
};

// ── Task (the top-level entity) ───────────────────────────────────────────────

export type TaskSource = 'desktop' | 'telegram' | 'discord' | 'slack' | 'whatsapp' | 'signal';

export type TaskMode = 'browser' | 'code';

export type Task = {
  id: string;
  /** If present, this task was spawned from another task (sub-agent). */
  parentTaskId?: string;
  /** Optional display name for multi-agent UI. */
  agentName?: string;
  /** Optional role label for multi-agent UI (e.g. "Copy", "Imagen", "Browser"). */
  agentRole?: string;
  prompt: string;
  /** Optional local file paths attached by the user (absolute paths). */
  attachments?: string[];
  status: TaskStatus;
  mode: TaskMode;
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
};

// ── API payloads ─────────────────────────────────────────────────────────────

export type TaskCreateRequest = {
  prompt: string;
  capabilities: TaskCapabilityId[];
  /** Optional local file paths attached by the user (absolute paths). */
  attachments?: string[];
  mode?: TaskMode;
  maxSteps?: number;
  timeoutMs?: number;
  source?: TaskSource;
  parentTaskId?: string;
  agentName?: string;
  agentRole?: string;
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
