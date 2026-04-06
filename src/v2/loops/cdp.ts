import type { LoopSetupFn, LoopSetupResult } from '../loop-registry';
import type { TaskAction } from '../task-runner';

export interface TradingClient {
  getBalance(): Promise<{ ok: boolean; value: string; error?: string }>;
  getTicker(symbol: string): Promise<{ ok: boolean; value: string; error?: string }>;
  placeOrder(params: Record<string, unknown>): Promise<{ ok: boolean; value: string; error?: string }>;
  cancelOrder(orderId: string): Promise<{ ok: boolean; value: string; error?: string }>;
  getPositions(): Promise<{ ok: boolean; value: string; error?: string }>;
}

export interface ChainClient {
  getBalance(address: string): Promise<{ ok: boolean; value: string; error?: string }>;
  getTokenBalance(address: string, token: string): Promise<{ ok: boolean; value: string; error?: string }>;
  sendToken(to: string, amount: string, token?: string): Promise<{ ok: boolean; value: string; error?: string }>;
  swap(params: Record<string, unknown>): Promise<{ ok: boolean; value: string; error?: string }>;
}

export type CdpLoopOpts = {
  tradingClient?: TradingClient;
  chainClient?: ChainClient;
  paperMode?: boolean;
};

export function createCdpLoopSetup(opts: CdpLoopOpts = {}): LoopSetupFn {
  return (task): LoopSetupResult => {
    const actionExecutors: Record<string, (action: TaskAction) => Promise<string | undefined>> = {
      wait: async (action) => {
        await new Promise((r) => setTimeout(r, (action as any).ms ?? 1000));
        return undefined;
      },
    };

    if (opts.tradingClient) {
      const t = opts.tradingClient;
      actionExecutors.cex_get_balance = async () => {
        const res = await t.getBalance();
        return res.ok ? res.value : `[Error: ${res.error}]`;
      };
      actionExecutors.cex_get_ticker = async (action) => {
        const res = await t.getTicker((action as any).symbol as string);
        return res.ok ? res.value : `[Error: ${res.error}]`;
      };
      actionExecutors.cex_place_order = async (action) => {
        const res = await t.placeOrder(action as Record<string, unknown>);
        return res.ok ? res.value : `[Error: ${res.error}]`;
      };
      actionExecutors.cex_cancel_order = async (action) => {
        const res = await t.cancelOrder((action as any).orderId as string);
        return res.ok ? res.value : `[Error: ${res.error}]`;
      };
      actionExecutors.cex_get_positions = async () => {
        const res = await t.getPositions();
        return res.ok ? res.value : `[Error: ${res.error}]`;
      };
    }

    if (opts.chainClient) {
      const c = opts.chainClient;
      actionExecutors.chain_get_balance = async (action) => {
        const res = await c.getBalance((action as any).address as string);
        return res.ok ? res.value : `[Error: ${res.error}]`;
      };
      actionExecutors.chain_get_token_balance = async (action) => {
        const res = await c.getTokenBalance((action as any).address as string, (action as any).token as string);
        return res.ok ? res.value : `[Error: ${res.error}]`;
      };
      actionExecutors.chain_send_token = async (action) => {
        const res = await c.sendToken(
          (action as any).to as string,
          (action as any).amount as string,
          (action as any).token as string
        );
        return res.ok ? res.value : `[Error: ${res.error}]`;
      };
      actionExecutors.chain_swap = async (action) => {
        const res = await c.swap(action as Record<string, unknown>);
        return res.ok ? res.value : `[Error: ${res.error}]`;
      };
    }

    const parts: string[] = [
      `You are an autonomous API agent. Execute the user's task using API calls only.`,
      `You have NO browser access. Do NOT use navigate, click, type, or shell.`,
      `Respond with JSON: {"thought": "...", "action": {"type": "...", ...}}`,
      `When done: {"action": {"type": "done", "summary": "..."}}`,
      `When failing: {"action": {"type": "fail", "reason": "..."}}`,
      `\nACT NOW. Start with an API call (e.g. check balance). Do NOT respond with questions or "done".`,
    ];

    if (task.capabilities.length > 0) {
      parts.push(`\nAvailable capabilities: ${task.capabilities.join(', ')}`);
    }

    if (opts.paperMode) {
      parts.push('\n⚠️ PAPER TRADING MODE: All trades are simulated. Do not use real funds.');
    }

    const systemPrompt = parts.join('\n');

    const initialHistory = [
      {
        role: 'user' as const,
        content: `Task: ${task.prompt}\n\nACT NOW. Start with an API call.`,
      },
    ];

    return { actionExecutors, systemPrompt, initialHistory };
  };
}
