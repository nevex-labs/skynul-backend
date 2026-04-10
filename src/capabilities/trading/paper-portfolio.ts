import { createAsyncExclusive } from '../../core/util/async-exclusive';

const STARTING_USDC = 10_000;

const _priceState = new Map<string, { price: number; ts: number }>();

function _simulatePrice(key: string, entryPrice: number): number {
  const now = Date.now();
  const state = _priceState.get(key);
  if (state) {
    const elapsed = now - state.ts;
    const steps = Math.floor(elapsed / 5000);
    if (steps > 0) {
      let price = state.price;
      for (let i = 0; i < Math.min(steps, 20); i++) {
        const step = (Math.random() - 0.5) * 0.006;
        price *= 1 + step;
      }
      price = Math.max(entryPrice * 0.7, Math.min(entryPrice * 1.3, price));
      _priceState.set(key, { price, ts: now });
      return price;
    }
    return state.price;
  }
  const initial = entryPrice * (1 + (Math.random() - 0.5) * 0.002);
  _priceState.set(key, { price: initial, ts: now });
  return initial;
}

type PaperBlob = {
  balances: PaperBalance[];
  trades: PaperTrade[];
  nextTradeId: number;
};

let _testPaper: PaperBlob | null = null;

const runPaper = createAsyncExclusive();

function emptyPaper(): PaperBlob {
  return { balances: [], trades: [], nextTradeId: 1 };
}

function _normalizePaper(raw: unknown): PaperBlob {
  if (!raw || typeof raw !== 'object') return emptyPaper();
  const o = raw as Partial<PaperBlob>;
  return {
    balances: Array.isArray(o.balances) ? o.balances : [],
    trades: Array.isArray(o.trades) ? o.trades : [],
    nextTradeId: typeof o.nextTradeId === 'number' && o.nextTradeId > 0 ? o.nextTradeId : 1,
  };
}

let inMemoryPaper: PaperBlob | null = null;

async function loadPaper(): Promise<PaperBlob> {
  if (inMemoryPaper) return inMemoryPaper;
  inMemoryPaper = emptyPaper();
  return inMemoryPaper;
}

async function persistPaper(b: PaperBlob): Promise<void> {
  inMemoryPaper = b;
}

async function ensureSeedBlob(b: PaperBlob): Promise<void> {
  const usdc = b.balances.find((x) => x.asset === 'USDC');
  if (!usdc) {
    const now = Date.now();
    b.balances.push({ asset: 'USDC', amount: STARTING_USDC, updated_at: now });
    await persistPaper(b);
  }
}

export type PaperBalance = {
  asset: string;
  amount: number;
  updated_at: number;
};

export type PaperTradeInput = {
  task_id?: string;
  venue: string;
  action_type: string;
  symbol?: string;
  side?: string;
  price?: number;
  size?: number;
  amount_usd?: number;
};

export type PaperTrade = {
  id: number;
  task_id?: string;
  venue: string;
  action_type: string;
  symbol?: string;
  side?: string;
  price?: number;
  size?: number;
  amount_usd?: number;
  order_id: string;
  status: string;
  created_at: number;
};

export type PaperPortfolioSummary = {
  balances: PaperBalance[];
  totalUsd: number;
  tradeCount: number;
  recentTrades: PaperTrade[];
};

export type PaperPosition = {
  symbol: string;
  venue: string;
  side: string;
  totalShares: number;
  avgPrice: number;
  totalCost: number;
  currentPrice: number;
  pnlUsd: number;
};

export async function getPaperBalance(asset: string): Promise<number> {
  return runPaper(async () => {
    const b = await loadPaper();
    await ensureSeedBlob(b);
    const row = b.balances.find((x) => x.asset === asset);
    return row?.amount ?? 0;
  });
}

export async function getPaperBalances(): Promise<PaperBalance[]> {
  return runPaper(async () => {
    const b = await loadPaper();
    await ensureSeedBlob(b);
    return b.balances.filter((x) => x.amount > 0).sort((a, c) => a.asset.localeCompare(c.asset));
  });
}

export async function adjustPaperBalance(asset: string, delta: number): Promise<void> {
  await runPaper(async () => {
    const b = await loadPaper();
    await ensureSeedBlob(b);
    const now = Date.now();
    const row = b.balances.find((x) => x.asset === asset);
    if (row) {
      row.amount += delta;
      row.updated_at = now;
    } else {
      b.balances.push({ asset, amount: delta, updated_at: now });
    }
    await persistPaper(b);
  });
}

type TradeEntry = { shares: number; cost: number; side: string; venue: string };

function accumulateTrade(entry: TradeEntry, t: PaperTrade): void {
  const units = t.size ?? t.amount_usd ?? 0;
  if (t.action_type.includes('close') || t.side === 'sell') {
    entry.shares -= units;
    entry.cost -= t.amount_usd ?? 0;
  } else {
    entry.shares += units;
    entry.cost += t.amount_usd ?? 0;
  }
}

async function fetchCurrentPrice(symbol: string, key: string, avgPrice: number, venue: string): Promise<number> {
  if (venue === 'polymarket') return _simulatePrice(key, avgPrice);
  try {
    let res = await fetch(`https://api.binance.com/api/v3/ticker/price?symbol=${symbol}`);
    if (!res.ok) res = await fetch(`https://fapi.binance.com/fapi/v1/ticker/price?symbol=${symbol}`);
    if (res.ok) {
      const data = await res.json();
      return Number.parseFloat(data.price);
    }
    return _simulatePrice(key, avgPrice);
  } catch {
    return _simulatePrice(key, avgPrice);
  }
}

export async function getPaperPositions(venue?: string): Promise<PaperPosition[]> {
  const trades = await runPaper(async () => {
    const b = await loadPaper();
    await ensureSeedBlob(b);
    return [...b.trades];
  });
  let sorted = [...trades].sort((a, c) => a.created_at - c.created_at);
  if (venue) sorted = sorted.filter((t) => t.venue === venue);

  const map = new Map<string, TradeEntry>();
  for (const t of sorted) {
    if (!t.symbol) continue;
    const key = `${t.venue}:${t.symbol}`;
    const entry = map.get(key) ?? { shares: 0, cost: 0, side: t.side ?? 'buy', venue: t.venue };
    accumulateTrade(entry, t);
    map.set(key, entry);
  }

  const positions: PaperPosition[] = [];
  for (const [key, v] of map) {
    if (v.shares > 0.001) {
      const symbol = key.split(':')[1] ?? key;
      const avgPrice = v.cost / v.shares;
      const currentPrice = await fetchCurrentPrice(symbol, key, avgPrice, v.venue);
      positions.push({
        symbol,
        venue: v.venue,
        side: v.side,
        totalShares: v.shares,
        avgPrice,
        totalCost: v.cost,
        currentPrice,
        pnlUsd: (currentPrice - avgPrice) * v.shares,
      });
    }
  }
  return positions;
}

export async function recordPaperTrade(input: PaperTradeInput): Promise<string> {
  return runPaper(async () => {
    const b = await loadPaper();
    await ensureSeedBlob(b);
    const orderId = `paper-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const id = b.nextTradeId++;
    b.trades.push({
      id,
      task_id: input.task_id,
      venue: input.venue,
      action_type: input.action_type,
      symbol: input.symbol,
      side: input.side,
      price: input.price,
      size: input.size,
      amount_usd: input.amount_usd,
      order_id: orderId,
      status: 'FILLED',
      created_at: Date.now(),
    });
    await persistPaper(b);
    return orderId;
  });
}

export async function getPaperTrades(opts: { venue?: string; limit?: number } = {}): Promise<PaperTrade[]> {
  return runPaper(async () => {
    const b = await loadPaper();
    await ensureSeedBlob(b);
    let rows = [...b.trades];
    if (opts.venue) rows = rows.filter((t) => t.venue === opts.venue);
    rows.sort((a, c) => c.created_at - a.created_at || c.id - a.id);
    return rows.slice(0, opts.limit ?? 50);
  });
}

export async function getPaperPortfolioSummary(): Promise<PaperPortfolioSummary> {
  return runPaper(async () => {
    const b = await loadPaper();
    await ensureSeedBlob(b);
    const balances = b.balances.filter((x) => x.amount > 0).sort((a, c) => a.asset.localeCompare(c.asset));
    const totalUsd = balances.reduce((sum, x) => {
      if (x.asset === 'USDC' || x.asset === 'USDT' || x.asset === 'DAI') return sum + x.amount;
      return sum;
    }, 0);
    const tradeCount = b.trades.length;
    const recentTrades = [...b.trades].sort((a, c) => c.created_at - a.created_at || c.id - a.id).slice(0, 10);
    return { balances, totalUsd, tradeCount, recentTrades };
  });
}

export async function resetPaperPortfolio(startingUsdc = STARTING_USDC): Promise<void> {
  await runPaper(async () => {
    const now = Date.now();
    const b = emptyPaper();
    b.balances = [{ asset: 'USDC', amount: startingUsdc, updated_at: now }];
    b.nextTradeId = 1;
    await persistPaper(b);
  });
}

export function _initPaperDbForTest(): void {
  _testPaper = emptyPaper();
}
