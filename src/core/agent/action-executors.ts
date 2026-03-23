/**
 * Action executors — pure functions that execute individual TaskAction types.
 * Extracted from TaskRunner to enable testing and reduce complexity.
 */

import os from 'os';
import { writeFile } from 'fs/promises';
import type { Task, TaskAction } from '../../types';
import { PolymarketClient } from '../polymarket-client';
import { generateImage } from '../providers/image-gen';
import type { AppBridge } from './app-bridge';
import { createExcelFromTsv } from './excel-writer';
import { sandboxPath, validateShellCommand } from './input-guard';
import type { TaskManager } from './task-manager';
import { deleteFact, formatObservationsForPrompt, getRecentObservations, saveObservation, saveFact, searchObservations } from './task-memory';
import {
  adjustPaperBalance,
  getPaperBalance,
  getPaperBalances,
  recordPaperTrade,
} from './paper-portfolio';
import { checkTradeAllowed, recordTradeVolume, openRiskPosition } from './risk-guard';
import { scrapeUrl } from './web-scraper';

export type ExecutorContext = {
  task: Task;
  taskManager: TaskManager | null;
  appBridge: AppBridge;
  pushUpdate: () => void;
  pushStatus: (msg: string) => void;
  paperMode?: boolean;
};

export type ExecutorResult = { ok: true; value: string } | { ok: false; error: string };

/** Truncate long text keeping head and tail. */
export function headTail(text: string, limit: number): string {
  if (text.length <= limit) return text;
  const head = Math.floor(limit * 0.6);
  const tail = limit - head;
  const omitted = text.length - head - tail;
  return `${text.slice(0, head)}\n\n[... ${omitted} chars omitted ...]\n\n${text.slice(text.length - tail)}`;
}

function makeResult(result: string, error?: string): ExecutorResult {
  return error ? { ok: false, error } : { ok: true, value: result };
}

function result(result: string): ExecutorResult {
  return { ok: true, value: result };
}

function errResult(error: string): ExecutorResult {
  return { ok: false, error };
}

/** Execute inter-task communication actions. */
export async function executeInterTaskAction(
  ctx: ExecutorContext,
  action: Extract<TaskAction, { type: 'task_list_peers' | 'task_send' | 'task_read' | 'task_message' }>
): Promise<ExecutorResult> {
  const tm = ctx.taskManager;
  if (!tm) return errResult('task manager not available for inter-task communication');

  switch (action.type) {
    case 'task_list_peers': {
      const all = tm.list();
      const peers = all
        .filter((t) => t.id !== ctx.task.id)
        .map((t) => ({ id: t.id, prompt: t.prompt.slice(0, 120), status: t.status }));
      return result(JSON.stringify(peers));
    }
    case 'task_send': {
      const res = await tm.spawnAndWait(action.prompt, ctx.task.capabilities, ctx.task.id, {
        agentName: action.agentName,
        agentRole: action.agentRole,
      });
      return result(`Sub-task ${res.taskId} ${res.status}: ${res.output}`);
    }
    case 'task_read': {
      const target = tm.get(action.taskId);
      if (!target) return errResult(`task ${action.taskId} not found`);
      return result(JSON.stringify({ id: target.id, status: target.status, summary: target.summary ?? null }));
    }
    case 'task_message': {
      try {
        tm.sendMessage(action.taskId, ctx.task.id, action.message);
        return result(`Message sent to ${action.taskId}`);
      } catch (e) {
        return errResult(String(e instanceof Error ? e.message : e));
      }
    }
  }
}

/** Execute fact memory actions. */
export function executeFactAction(
  ctx: ExecutorContext,
  action: Extract<TaskAction, { type: 'remember_fact' | 'forget_fact' }>
): ExecutorResult {
  switch (action.type) {
    case 'remember_fact': {
      if (!action.fact || typeof action.fact !== 'string') {
        return errResult('"fact" string required');
      }
      saveFact(action.fact);
      return result(`Remembered: "${action.fact}"`);
    }
    case 'forget_fact': {
      if (typeof action.factId !== 'number') return errResult('"factId" number required');
      deleteFact(action.factId);
      return result(`Forgot fact #${action.factId}`);
    }
  }
}

/** Execute knowledge memory actions. */
export function executeMemoryAction(
  _ctx: ExecutorContext,
  action: Extract<TaskAction, { type: 'memory_save' | 'memory_search' | 'memory_context' }>
): ExecutorResult {
  switch (action.type) {
    case 'memory_save': {
      if (!action.title || !action.content) return errResult('"title" and "content" are required');
      const id = saveObservation({
        title: action.title,
        content: action.content,
        obs_type: action.obs_type,
        project: action.project,
        topic_key: action.topic_key,
      });
      if (id < 0) return errResult('Failed to save observation');
      return result(`Observation saved (id=${id}): "${action.title}"`);
    }
    case 'memory_search': {
      if (!action.query) return errResult('"query" is required');
      const obs = searchObservations(action.query, {
        type_filter: action.type_filter,
        project: action.project,
        limit: action.limit,
      });
      if (obs.length === 0) return result('No matching observations found.');
      return result(formatObservationsForPrompt(obs));
    }
    case 'memory_context': {
      const obs = getRecentObservations({ project: action.project, limit: action.limit });
      if (obs.length === 0) return result('No observations in memory.');
      return result(formatObservationsForPrompt(obs));
    }
  }
}

/** Execute set_identity action. */
export function executeSetIdentity(
  ctx: ExecutorContext,
  action: Extract<TaskAction, { type: 'set_identity' }>
): ExecutorResult {
  const raw = action as Record<string, unknown>;
  if (raw.name && typeof raw.name === 'string') {
    ctx.task.agentName = raw.name as string;
  }
  if (raw.role && typeof raw.role === 'string') {
    ctx.task.agentRole = raw.role as string;
  }
  ctx.pushUpdate();
  return result(`Identity: ${ctx.task.agentName ?? ''}${ctx.task.agentRole ? ` (${ctx.task.agentRole})` : ''}`);
}

/** Execute image generation action. */
export async function executeGenerateImage(
  ctx: ExecutorContext,
  action: Extract<TaskAction, { type: 'generate_image' }>
): Promise<ExecutorResult> {
  const prompt = String(action.prompt ?? '');
  if (!prompt) return errResult('generate_image requires a prompt');
  const size = action.size ?? '1024x1024';
  try {
    const filePath = await generateImage(prompt, size);
    if (!ctx.task.attachments) ctx.task.attachments = [];
    ctx.task.attachments.push(filePath);
    ctx.pushUpdate();
    return result(`Image generated and saved to: ${filePath}`);
  } catch (e) {
    return errResult(String(e instanceof Error ? e.message : e));
  }
}

/** Execute shell command with timeout. */
export function executeShell(command: string, cwd?: string, timeoutMs?: number): Promise<ExecutorResult> {
  try {
    validateShellCommand(command);
  } catch (e) {
    return Promise.resolve(errResult(e instanceof Error ? e.message : String(e)));
  }
  return new Promise((resolve) => {
    const { exec } = require('child_process') as typeof import('child_process');
    const timeout = Math.min(timeoutMs ?? 120_000, 300_000);
    const child = exec(
      command,
      { timeout, maxBuffer: 1024 * 1024, cwd: cwd || undefined },
      (err: Error | null, stdout: string, stderr: string) => {
        const out = headTail(stdout.toString(), 4000);
        const errOut = stderr.toString().slice(0, 1000);
        if (err) {
          resolve(
            makeResult(`[Exit ${(err as NodeJS.ErrnoException).code ?? 1}] ${errOut || err.message}\n${out}`.trim())
          );
        } else {
          resolve(makeResult(errOut ? `${out}\n[stderr] ${errOut}` : out || '(no output)'));
        }
      }
    );
    child.stdin?.end();
  });
}

/** Execute file_read action. */
export async function executeFileRead(
  filePath: string,
  cwd?: string,
  offset?: number,
  limit?: number
): Promise<ExecutorResult> {
  let resolved: string;
  try {
    resolved = sandboxPath(filePath, cwd);
  } catch (e) {
    return errResult(e instanceof Error ? e.message : String(e));
  }
  const fs = await import('fs/promises');
  try {
    const content = await fs.readFile(resolved, 'utf-8');
    let lines = content.split('\n');
    const startLine = offset && offset > 0 ? offset - 1 : 0;
    if (limit && limit > 0) {
      lines = lines.slice(startLine, startLine + limit);
    } else if (startLine > 0) {
      lines = lines.slice(startLine);
    }
    const numbered = lines.map((line, i) => `${String(startLine + i + 1).padStart(6)}\t${line}`);
    return result(headTail(numbered.join('\n'), 8000));
  } catch (e) {
    return errResult(`[Error reading ${resolved}: ${e instanceof Error ? e.message : String(e)}]`);
  }
}

/** Execute file_write action. */
export async function executeFileWrite(filePath: string, content: string, cwd?: string): Promise<ExecutorResult> {
  let resolved: string;
  try {
    resolved = sandboxPath(filePath, cwd);
  } catch (e) {
    return errResult(e instanceof Error ? e.message : String(e));
  }
  const fs = await import('fs/promises');
  const pathMod = await import('path');
  try {
    await fs.mkdir(pathMod.dirname(resolved), { recursive: true });
    await fs.writeFile(resolved, content, 'utf-8');
    return result(`File written: ${resolved} (${content.length} bytes)`);
  } catch (e) {
    return errResult(`[Error writing ${resolved}: ${e instanceof Error ? e.message : String(e)}]`);
  }
}

/** Execute file_edit action. */
export async function executeFileEdit(
  filePath: string,
  oldStr: string,
  newStr: string,
  cwd?: string
): Promise<ExecutorResult> {
  let resolved: string;
  try {
    resolved = sandboxPath(filePath, cwd);
  } catch (e) {
    return errResult(e instanceof Error ? e.message : String(e));
  }
  const fs = await import('fs/promises');
  try {
    const content = await fs.readFile(resolved, 'utf-8');
    const count = content.split(oldStr).length - 1;
    if (count === 0) return errResult(`old_string not found in ${resolved}`);
    if (count > 1) return errResult(`old_string found ${count} times — must be unique. Add more context.`);
    const updated = content.replace(oldStr, newStr);
    await fs.writeFile(resolved, updated, 'utf-8');
    return result(`File edited: ${resolved} (replaced 1 occurrence)`);
  } catch (e) {
    return errResult(`[Error editing ${resolved}: ${e instanceof Error ? e.message : String(e)}]`);
  }
}

/** Execute file_list action. */
export function executeFileList(pattern: string, cwd?: string): Promise<ExecutorResult> {
  if (/[;&|`$()]/.test(pattern)) {
    return Promise.resolve(errResult('Invalid characters in file pattern'));
  }
  const { exec } = require('child_process') as typeof import('child_process');
  const execOpts = { timeout: 10_000, maxBuffer: 512 * 1024, cwd: cwd || undefined };
  return new Promise((resolve) => {
    const fdCmd = `fd --type f --glob '${pattern.replace(/'/g, "'\\''")}'`;
    exec(fdCmd, execOpts, (err: Error | null, stdout: string) => {
      if (!err && stdout.trim()) {
        resolve(result(headTail(stdout.trim(), 6000)));
        return;
      }
      const findCmd = `find . -type f -name '${pattern.replace(/'/g, "'\\''")}'`;
      exec(findCmd, execOpts, (err2: Error | null, stdout2: string) => {
        if (err2) {
          resolve(errResult(`[Error listing files: ${err2.message}]`));
          return;
        }
        resolve(result(stdout2.trim() || '(no files found)'));
      });
    });
  });
}

/** Execute file_search action. */
export function executeFileSearch(
  pattern: string,
  searchPath?: string,
  glob?: string,
  cwd?: string
): Promise<ExecutorResult> {
  if (/[;&|`$()]/.test(pattern) || (glob && /[;&|`$()]/.test(glob))) {
    return Promise.resolve(errResult('Invalid characters in search pattern'));
  }
  const { exec } = require('child_process') as typeof import('child_process');
  const execOpts = { timeout: 10_000, maxBuffer: 512 * 1024, cwd: cwd || undefined };
  return new Promise((resolve) => {
    const escapedPattern = pattern.replace(/'/g, "'\\''");
    const dir = searchPath || '.';
    const globFlag = glob ? ` --glob '${glob.replace(/'/g, "'\\''")}'` : '';
    const rgCmd = `rg -n --max-count 50 '${escapedPattern}' ${dir}${globFlag}`;
    exec(rgCmd, execOpts, (err: Error | null, stdout: string) => {
      if (!err || String((err as NodeJS.ErrnoException).code ?? '') === '1') {
        resolve(result((stdout || '').trim() || '(no matches found)'));
        return;
      }
      const grepGlob = glob ? ` --include='${glob.replace(/'/g, "'\\''")}'` : '';
      const grepCmd = `grep -rn '${escapedPattern}' ${dir}${grepGlob} | head -50`;
      exec(grepCmd, execOpts, (err2: Error | null, stdout2: string) => {
        if (err2 && !(err2 as NodeJS.ErrnoException)?.code) {
          resolve(errResult(`[Error searching: ${err2.message}]`));
          return;
        }
        resolve(result((stdout2 || '').trim() || '(no matches found)'));
      });
    });
  });
}

/** Execute Polymarket trading actions. */
export async function executePolymarketAction(ctx: ExecutorContext, action: TaskAction): Promise<ExecutorResult> {
  if (
    ![
      'polymarket_get_account_summary',
      'polymarket_get_trader_leaderboard',
      'polymarket_search_markets',
      'polymarket_place_order',
      'polymarket_close_position',
    ].includes(action.type)
  ) {
    return errResult(`Unknown polymarket action: ${(action as any).type}`);
  }

  const client = new PolymarketClient({ mode: ctx.paperMode ? 'paper' : 'live' });

  switch (action.type) {
    case 'polymarket_get_account_summary': {
      try {
        if (ctx.paperMode) {
          const paperBals = getPaperBalances();
          const usdcBal = getPaperBalance('USDC');
          ctx.task.summary = `[PAPER] Polymarket: Balance $${usdcBal.toFixed(2)}, 0 positions.`;
          const lines = paperBals.map((b) => `  ${b.asset}: ${b.amount}`);
          return result(
            `[PAPER] Balance: $${usdcBal.toFixed(2)}, 0 positions.\nPaper portfolio:\n${lines.join('\n')}`
          );
        }
        const summary = await client.getAccountSummary();
        const posLines = summary.positions.map(
          (p) =>
            `  ${p.marketTitle} [${p.outcome}] ${p.sizeShares} shares @ $${p.avgPriceUsd.toFixed(2)}, PnL $${p.pnlUsd.toFixed(2)}`
        );
        ctx.task.summary = `Polymarket: Balance $${summary.balanceUsd.toFixed(2)}, ${summary.positions.length} positions.`;
        return result(
          `Balance: $${summary.balanceUsd.toFixed(2)}, ${summary.positions.length} positions.` +
            (posLines.length > 0 ? '\n' + posLines.join('\n') : '')
        );
      } catch (e) {
        return errResult(String(e instanceof Error ? e.message : e));
      }
    }
    case 'polymarket_get_trader_leaderboard': {
      try {
        const traders = await client.getTopTraders({ limit: 10, timePeriod: 'MONTH', category: 'OVERALL' });
        const top = traders
          .slice(0, 5)
          .map((t) => `#${t.rank} ${t.userName || t.wallet.slice(0, 8)} PnL $${t.pnlUsd.toFixed(2)}`)
          .join('; ');
        ctx.task.summary = `Polymarket Leaderboard: ${top || 'no traders'}`;
        return result(`Leaderboard (MONTH): ${top || 'no traders found'}.`);
      } catch (e) {
        return errResult(String(e instanceof Error ? e.message : e));
      }
    }
    case 'polymarket_search_markets': {
      try {
        const raw = action as Extract<TaskAction, { type: 'polymarket_search_markets' }>;
        const markets = await client.searchMarkets(raw.query, raw.limit ?? 5);
        if (markets.length === 0) return result('No markets found.');
        const lines = markets.map((m) => {
          const tokens = m.tokens.map((t) => `${t.outcome}: ${t.tokenId} @ $${t.price.toFixed(3)}`).join(', ');
          return `${m.title} | vol: $${m.volume.toFixed(0)} | tokens: [${tokens}]`;
        });
        return result(lines.join('\n'));
      } catch (e) {
        return errResult(String(e instanceof Error ? e.message : e));
      }
    }
    case 'polymarket_place_order': {
      try {
        const raw = action as Extract<TaskAction, { type: 'polymarket_place_order' }>;
        if (ctx.paperMode) {
          const cost = raw.price * raw.size;
          adjustPaperBalance('USDC', -cost);
          const orderId = recordPaperTrade({
            task_id: ctx.task.id,
            venue: 'polymarket',
            action_type: 'polymarket_place_order',
            symbol: raw.tokenId.slice(0, 16),
            side: raw.side,
            price: raw.price,
            size: raw.size,
            amount_usd: cost,
          });
          return result(
            `[PAPER] Order placed (GTC): ${raw.side} ${raw.size} @ $${raw.price} on ${raw.tokenId.slice(0, 10)}... | orderId: ${orderId}`
          );
        }
        const cost = raw.price * raw.size;
        const riskCheck = checkTradeAllowed('polymarket', cost);
        if (!riskCheck.allowed) return errResult(`[RISK] ${riskCheck.reason}`);
        await client.placeOrder({
          tokenId: raw.tokenId,
          side: raw.side,
          price: raw.price,
          size: raw.size,
          tickSize: raw.tickSize,
          negRisk: raw.negRisk,
        });
        recordTradeVolume('polymarket', cost);
        openRiskPosition('polymarket', raw.tokenId.slice(0, 16), raw.side, cost, ctx.task.id);
        return result(`Order placed (GTC): ${raw.side} ${raw.size} @ $${raw.price} on ${raw.tokenId.slice(0, 10)}...`);
      } catch (e) {
        return errResult(String(e instanceof Error ? e.message : e));
      }
    }
    case 'polymarket_close_position': {
      try {
        const raw = action as Extract<TaskAction, { type: 'polymarket_close_position' }>;
        if (!raw.tokenId) return errResult('tokenId is required. Use polymarket_get_account_summary first.');
        if (ctx.paperMode) {
          const proceeds = (raw.size ?? 1) * 0.999;
          adjustPaperBalance('USDC', proceeds);
          const orderId = recordPaperTrade({
            task_id: ctx.task.id,
            venue: 'polymarket',
            action_type: 'polymarket_close_position',
            symbol: raw.tokenId.slice(0, 16),
            side: 'sell',
            size: raw.size,
            amount_usd: proceeds,
          });
          return result(`[PAPER] Position closed: ${raw.tokenId.slice(0, 10)}... size=${raw.size ?? 'full'} | orderId: ${orderId}`);
        }
        await client.closePosition({ tokenId: raw.tokenId, size: raw.size });
        return result(`Position closed: ${raw.tokenId.slice(0, 10)}... size=${raw.size ?? 'full'}`);
      } catch (e) {
        return errResult(String(e instanceof Error ? e.message : e));
      }
    }
    default:
      return errResult(`Unknown polymarket action`);
  }
}

/** Execute on-chain trading actions. */
export async function executeChainAction(ctx: ExecutorContext, action: TaskAction): Promise<ExecutorResult> {
  const raw = action as Record<string, unknown>;
  const chainId = typeof raw.chainId === 'number' ? raw.chainId : undefined;

  const chainTypes = [
    'chain_get_balance',
    'chain_get_token_balance',
    'chain_send_token',
    'chain_swap',
    'chain_get_tx_status',
  ];
  if (!chainTypes.includes(action.type)) {
    return errResult(`Unknown chain action: ${(action as any).type}`);
  }

  // ── Paper mode: simulate all chain operations without real clients ──────────
  if (ctx.paperMode) {
    switch (action.type) {
      case 'chain_get_balance': {
        const usdc = getPaperBalance('USDC');
        const eth = getPaperBalance('ETH');
        return result(`[PAPER] USDC balance: ${usdc} USDC | Native balance: ${eth} ETH`);
      }
      case 'chain_get_token_balance': {
        const a = action as Extract<TaskAction, { type: 'chain_get_token_balance' }>;
        const bal = getPaperBalance(a.tokenAddress);
        return result(`[PAPER] ${a.tokenAddress} balance: ${bal}`);
      }
      case 'chain_send_token': {
        const a = action as Extract<TaskAction, { type: 'chain_send_token' }>;
        adjustPaperBalance(a.tokenAddress, -Number(a.amount));
        const orderId = recordPaperTrade({
          task_id: ctx.task.id,
          venue: 'chain',
          action_type: 'chain_send_token',
          symbol: a.tokenAddress,
          side: 'send',
          amount_usd: Number(a.amount),
        });
        const hash = `0xpaper${orderId.replace(/-/g, '').slice(0, 40)}`;
        return result(`[PAPER] Token sent. Tx: ${hash} | Status: success`);
      }
      case 'chain_swap': {
        const a = action as Extract<TaskAction, { type: 'chain_swap' }>;
        const amtIn = Number(a.amountIn);
        adjustPaperBalance(a.tokenIn, -amtIn);
        adjustPaperBalance(a.tokenOut, amtIn); // 1:1 simulation
        const orderId = recordPaperTrade({
          task_id: ctx.task.id,
          venue: 'chain',
          action_type: 'chain_swap',
          symbol: `${a.tokenIn}->${a.tokenOut}`,
          size: amtIn,
        });
        const hash = `0xpaper${orderId.replace(/-/g, '').slice(0, 40)}`;
        return result(`[PAPER] Swap executed. Tx: ${hash} | Status: success | Block: 99999`);
      }
      case 'chain_get_tx_status': {
        const a = action as Extract<TaskAction, { type: 'chain_get_tx_status' }>;
        return result(`[PAPER] Tx ${a.txHash}: success (block 99999)`);
      }
      default:
        return errResult(`Unknown chain action`);
    }
  }

  const { ChainClient } = await import('../chain/chain-client');
  const client = new ChainClient(chainId);

  switch (action.type) {
    case 'chain_get_balance': {
      try {
        const [usdc, native] = await Promise.all([client.getBalance(), client.getNativeBalance()]);
        return result(`USDC balance: ${usdc.balance} USDC | Native balance: ${native.balance} ${native.symbol}`);
      } catch (e) {
        return errResult(String(e instanceof Error ? e.message : e));
      }
    }
    case 'chain_get_token_balance': {
      try {
        const a = action as Extract<TaskAction, { type: 'chain_get_token_balance' }>;
        const bal = await client.getTokenBalance(a.tokenAddress);
        return result(`${bal.symbol} balance: ${bal.balance} (${a.tokenAddress})`);
      } catch (e) {
        return errResult(String(e instanceof Error ? e.message : e));
      }
    }
    case 'chain_send_token': {
      try {
        const a = action as Extract<TaskAction, { type: 'chain_send_token' }>;
        const sendAmt = Number(a.amount);
        const riskCheck = checkTradeAllowed('chain', sendAmt);
        if (!riskCheck.allowed) return errResult(`[RISK] ${riskCheck.reason}`);
        const receipt = await client.sendToken(a.tokenAddress, a.to, a.amount);
        recordTradeVolume('chain', sendAmt);
        openRiskPosition('chain', a.tokenAddress, 'send', sendAmt, ctx.task.id);
        return result(
          `Token sent. Tx: ${receipt.hash} | Status: ${receipt.status}${receipt.blockNumber ? ` | Block: ${receipt.blockNumber}` : ''}`
        );
      } catch (e) {
        return errResult(String(e instanceof Error ? e.message : e));
      }
    }
    case 'chain_swap': {
      try {
        const a = action as Extract<TaskAction, { type: 'chain_swap' }>;
        const swapAmt = Number(a.amountIn);
        const riskCheck = checkTradeAllowed('chain', swapAmt);
        if (!riskCheck.allowed) return errResult(`[RISK] ${riskCheck.reason}`);
        const receipt = await client.swap({
          tokenIn: a.tokenIn,
          tokenOut: a.tokenOut,
          amountIn: a.amountIn,
          slippageBps: a.slippageBps,
        });
        recordTradeVolume('chain', swapAmt);
        openRiskPosition('chain', `${a.tokenIn}->${a.tokenOut}`, 'swap', swapAmt, ctx.task.id);
        return result(
          `Swap executed. Tx: ${receipt.hash} | Status: ${receipt.status}${receipt.blockNumber ? ` | Block: ${receipt.blockNumber}` : ''}`
        );
      } catch (e) {
        return errResult(String(e instanceof Error ? e.message : e));
      }
    }
    case 'chain_get_tx_status': {
      try {
        const a = action as Extract<TaskAction, { type: 'chain_get_tx_status' }>;
        const receipt = await client.getTxStatus(a.txHash);
        return result(
          `Tx ${a.txHash}: ${receipt.status}${receipt.blockNumber ? ` (block ${receipt.blockNumber})` : ''}`
        );
      } catch (e) {
        return errResult(String(e instanceof Error ? e.message : e));
      }
    }
    default:
      return errResult(`Unknown chain action`);
  }
}

/** Execute CEX trading actions. */
export async function executeCexAction(ctx: ExecutorContext, action: TaskAction): Promise<ExecutorResult> {
  const raw = action as Record<string, unknown>;
  const exchange = raw.exchange as 'binance' | 'coinbase' | undefined;

  const cexTypes = ['cex_get_balance', 'cex_place_order', 'cex_cancel_order', 'cex_get_positions', 'cex_withdraw'];
  if (!cexTypes.includes(action.type)) {
    return errResult(`Unknown CEX action: ${(action as any).type}`);
  }

  if (!exchange || !['binance', 'coinbase'].includes(exchange)) {
    return errResult(`Invalid or missing "exchange" field. Must be "binance" or "coinbase".`);
  }

  const { BinanceClient } = await import('../cex/binance-client');
  const { CoinbaseClient } = await import('../cex/coinbase-client');
  const { FeeService, FEE_USDC } = await import('../chain/fee-service');

  const mode = ctx.paperMode ? 'paper' : 'live';
  const client = exchange === 'binance' ? new BinanceClient({ mode }) : new CoinbaseClient({ mode });

  switch (action.type) {
    case 'cex_get_balance': {
      try {
        if (ctx.paperMode) {
          const paperBals = getPaperBalances();
          if (paperBals.length === 0) return result('[PAPER] No balances found.');
          const lines = paperBals.map((b) => `  ${b.asset}: ${b.amount} free, 0 locked`);
          return result(`[PAPER] ${exchange} balances:\n${lines.join('\n')}`);
        }
        const balances = await client.getBalances();
        if (balances.length === 0) return result('No balances found.');
        const lines = balances.map((b) => `  ${b.asset}: ${b.free} free, ${b.locked} locked`);
        return result(`${exchange} balances:\n${lines.join('\n')}`);
      } catch (e) {
        return errResult(String(e instanceof Error ? e.message : e));
      }
    }
    case 'cex_get_positions': {
      try {
        const positions = await client.getPositions();
        if (positions.length === 0) return result('No open positions.');
        const lines = positions.map(
          (p) => `  ${p.symbol} ${p.side} ${p.size} @ ${p.entryPrice}, PnL: ${p.unrealizedPnl}`
        );
        return result(`${exchange} positions:\n${lines.join('\n')}`);
      } catch (e) {
        return errResult(String(e instanceof Error ? e.message : e));
      }
    }
    case 'cex_place_order': {
      try {
        const a = action as Extract<TaskAction, { type: 'cex_place_order' }>;
        if (ctx.paperMode) {
          adjustPaperBalance('USDC', -a.amount);
          const orderId = recordPaperTrade({
            task_id: ctx.task.id,
            venue: exchange,
            action_type: 'cex_place_order',
            symbol: a.symbol,
            side: a.side,
            price: a.price,
            amount_usd: a.amount,
          });
          return result(
            `[PAPER] Order placed on ${exchange}: ${a.side} ${a.amount} ${a.symbol} | orderId: ${orderId} | status: FILLED`
          );
        }
        const riskCheck = checkTradeAllowed(exchange as 'binance' | 'coinbase', a.amount);
        if (!riskCheck.allowed) return errResult(`[RISK] ${riskCheck.reason}`);
        const netAmount = FeeService.deductFeeFromAmount(a.amount);
        if (netAmount <= 0) {
          return errResult(`Order amount too small after fee deduction (fee: ${FEE_USDC} USDC).`);
        }
        const res = await client.placeOrder({
          symbol: a.symbol,
          side: a.side,
          orderType: a.orderType,
          amount: netAmount,
          price: a.price,
        });
        recordTradeVolume(exchange as 'binance' | 'coinbase', a.amount);
        openRiskPosition(exchange as 'binance' | 'coinbase', a.symbol, a.side, a.amount, ctx.task.id);
        return result(
          `Order placed on ${exchange}: ${a.side} ${netAmount} ${a.symbol} | orderId: ${res.orderId} | status: ${res.status}`
        );
      } catch (e) {
        return errResult(String(e instanceof Error ? e.message : e));
      }
    }
    case 'cex_cancel_order': {
      try {
        const a = action as Extract<TaskAction, { type: 'cex_cancel_order' }>;
        if (exchange === 'binance') {
          await (client as any).cancelOrder(a.symbol ?? '', a.orderId);
        } else {
          await (client as any).cancelOrder(a.orderId);
        }
        return result(`Order ${a.orderId} cancelled on ${exchange}.`);
      } catch (e) {
        return errResult(String(e instanceof Error ? e.message : e));
      }
    }
    case 'cex_withdraw': {
      try {
        const a = action as Extract<TaskAction, { type: 'cex_withdraw' }>;
        const withdrawId = await client.withdraw(a.asset, a.amount, a.address, a.network);
        return result(`Withdrawal initiated on ${exchange}: ${withdrawId}`);
      } catch (e) {
        return errResult(String(e instanceof Error ? e.message : e));
      }
    }
    default:
      return errResult(`Unknown CEX action`);
  }
}

/** Resolve data URL attachments to temp files. */
export async function resolveAttachments(attachments?: string[]): Promise<{
  filePaths: string[];
  dataUrls: string[];
}> {
  const all = (attachments ?? []).filter((x) => typeof x === 'string');
  const filePaths: string[] = [];
  const dataUrls: string[] = [];
  for (const a of all) {
    if (a.startsWith('data:image/')) {
      dataUrls.push(a);
      const ext = a.startsWith('data:image/png') ? 'png' : 'jpg';
      const p = `${os.tmpdir()}/skynul-ref-${Date.now()}-${dataUrls.length}.${ext}`;
      const base64 = a.split(',')[1];
      await writeFile(p, Buffer.from(base64, 'base64'));
      filePaths.push(p);
    } else {
      filePaths.push(a);
    }
  }
  return { filePaths, dataUrls };
}
