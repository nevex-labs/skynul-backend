export type PolymarketPosition = {
  marketId: string;
  marketTitle: string;
  outcome: string;
  sizeShares: number;
  avgPriceUsd: number;
  pnlUsd: number;
};

export type PolymarketAccountSummary = {
  balanceUsd: number;
  positions: PolymarketPosition[];
};

export type PolymarketTrader = {
  rank: number;
  userName: string;
  wallet: string;
  pnlUsd: number;
  volumeUsd: number;
};

export type PolymarketTradingMode = 'paper' | 'live';

export type PolymarketClientOpts = {
  mode?: PolymarketTradingMode;
};

/**
 * Thin facade for talking to Polymarket.
 *
 * IMPORTANT: in this initial version, all methods are safe no-ops unless you
 * implement the live API integration yourself. By default the client runs in
 * "paper" mode and never touches real funds.
 */
export class PolymarketClient {
  private readonly mode: PolymarketTradingMode;

  constructor(opts: PolymarketClientOpts = {}) {
    this.mode = opts.mode ?? 'paper';
  }

  /**
   * Lazily construct a live Polymarket CLOB client using environment variables.
   *
   * This uses the official @polymarket/clob-client + ethers Wallet, but both are
   * imported dynamically so the app still builds even if you haven't installed
   * those packages yet.
   *
   * Required env vars when mode === 'live':
   * - POLYMARKET_PRIVATE_KEY      (exported from polymarket.com/settings)
   * - POLYMARKET_FUNDER_ADDRESS   (proxy/funder address shown en tu perfil)
   * - POLYMARKET_SIGNATURE_TYPE   (0, 1 o 2; docs de Polymarket, default 2)
   */
  private async getLiveSdkClient(): Promise<unknown> {
    const { getSecret } = await import('./stores/secret-store');
    const pk = (await getSecret('POLYMARKET_PRIVATE_KEY')) ?? process.env.POLYMARKET_PRIVATE_KEY;
    const funder = (await getSecret('POLYMARKET_FUNDER_ADDRESS')) ?? process.env.POLYMARKET_FUNDER_ADDRESS;
    const sigTypeRaw = (await getSecret('POLYMARKET_SIGNATURE_TYPE')) ?? process.env.POLYMARKET_SIGNATURE_TYPE ?? '2';

    if (!pk) {
      throw new Error('POLYMARKET_PRIVATE_KEY is not set. Configure it in Settings → Secrets.');
    }
    if (!funder) {
      throw new Error('POLYMARKET_FUNDER_ADDRESS is not set. Configure it in Settings → Secrets.');
    }

    const signatureType = Number.parseInt(sigTypeRaw, 10);
    if (!Number.isFinite(signatureType)) {
      throw new Error('POLYMARKET_SIGNATURE_TYPE must be 0, 1 or 2 (see Polymarket CLOB docs).');
    }

    // Dynamic imports to avoid hard dependency at build time.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { ClobClient } = (await import('@polymarket/clob-client')) as any;
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { Wallet } = (await import('ethers')) as any;

    const signer = new Wallet(pk);

    // Ethers v6 compatibility: @polymarket/clob-client expects a signer with
    // a _signTypedData method (ethers v5). In ethers v6 this is exposed as
    // signTypedData, so we provide a small shim.
    const anySigner = signer as any;
    if (typeof anySigner._signTypedData !== 'function' && typeof anySigner.signTypedData === 'function') {
      anySigner._signTypedData = (...args: unknown[]) => anySigner.signTypedData(...args);
    }

    const apiUrl = process.env.POLYMARKET_CLOB_URL ?? 'https://clob.polymarket.com';
    const chainId = Number.parseInt(process.env.POLYMARKET_CHAIN_ID ?? '137', 10);

    // 1) Derive API credentials (L2) using the private key
    const tempClient = new ClobClient(apiUrl, chainId, signer);
    const apiCreds = await tempClient.createOrDeriveApiKey();

    // 2) Full trading client (L2 creds + signature type + funder)
    const client = new ClobClient(apiUrl, chainId, signer, apiCreds, signatureType, funder);
    return client;
  }

  /**
   * Return current account balance and open positions.
   *
   * In live mode we:
   * - Validate env + SDK wiring via getLiveSdkClient().
   * - Fetch current positions from the public Data API (read‑only).
   */
  async getAccountSummary(): Promise<PolymarketAccountSummary> {
    if (this.mode === 'paper') {
      // Placeholder: empty simulated account.
      return {
        balanceUsd: 0,
        positions: [],
      };
    }

    // LIVE MODE: read positions via public Data API.
    const { getSecret } = await import('./stores/secret-store');
    const funder = (await getSecret('POLYMARKET_FUNDER_ADDRESS')) ?? process.env.POLYMARKET_FUNDER_ADDRESS;
    if (!funder) {
      throw new Error('POLYMARKET_FUNDER_ADDRESS is not set. Configure it in Settings → Secrets.');
    }

    const fetchFn: typeof fetch | undefined = (globalThis as any).fetch;
    if (!fetchFn) {
      throw new Error('Global fetch is not available in this runtime; cannot query Polymarket Data API.');
    }

    const url = `https://data-api.polymarket.com/positions?user=${encodeURIComponent(funder)}&limit=500`;
    const res = await fetchFn(url);
    if (!res.ok) {
      throw new Error(`Failed to fetch Polymarket positions (status ${res.status}).`);
    }

    const raw = await res.json();
    const rawPositions: any[] = Array.isArray(raw) ? raw : Array.isArray(raw?.positions) ? raw.positions : [];

    const positions: PolymarketPosition[] = rawPositions.map((p) => {
      const size = Number(p.size ?? p.tokens ?? p.tokenCount ?? 0) || 0;
      const avgPrice = Number(p.avgPrice ?? p.avg_price ?? p.price ?? 0) || 0;
      const pnl = Number(p.cashPnl ?? p.cash_pnl ?? p.pnl ?? 0) || 0;

      return {
        marketId: String(p.marketId ?? p.market_id ?? p.conditionId ?? p.condition_id ?? ''),
        marketTitle: String(p.title ?? p.marketTitle ?? p.market_title ?? p.market?.title ?? ''),
        outcome: String(p.outcome ?? p.token?.outcome ?? p.tokenName ?? ''),
        sizeShares: size,
        avgPriceUsd: avgPrice,
        pnlUsd: pnl,
      };
    });

    // Fetch USDC balance on-chain via Polygon RPC (balanceOf call)
    let balanceUsd = 0;
    try {
      const USDC = '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174';
      const addr = funder.toLowerCase().replace('0x', '').padStart(64, '0');
      const rpcRes = await fetchFn('https://rpc-mainnet.matic.quiknode.pro', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'eth_call',
          params: [{ to: USDC, data: `0x70a08231${addr}` }, 'latest'],
        }),
      });
      if (rpcRes.ok) {
        const rpcData = (await rpcRes.json()) as any;
        if (rpcData.result) {
          balanceUsd = Number(BigInt(rpcData.result)) / 1e6;
        }
      }
    } catch (e) {
      console.error('[Polymarket] balance fetch failed:', e);
    }

    return {
      balanceUsd,
      positions,
    };
  }

  /**
   * Fetch top traders from the Polymarket leaderboard (read‑only, no auth).
   *
   * This uses the public data API:
   *   GET /v1/leaderboard?category=OVERALL&timePeriod=MONTH&orderBy=PNL&limit=...
   */
  async getTopTraders(
    opts: { limit?: number; category?: string; timePeriod?: 'DAY' | 'WEEK' | 'MONTH' | 'ALL' } = {}
  ): Promise<PolymarketTrader[]> {
    const fetchFn: typeof fetch | undefined = (globalThis as any).fetch;
    if (!fetchFn) {
      throw new Error('Global fetch is not available in this runtime; cannot query Polymarket leaderboard.');
    }

    const limit = Math.min(Math.max(opts.limit ?? 10, 1), 50);
    const category = opts.category ?? 'OVERALL';
    const timePeriod = opts.timePeriod ?? 'MONTH';

    const url = `https://data-api.polymarket.com/v1/leaderboard?category=${encodeURIComponent(
      category
    )}&timePeriod=${encodeURIComponent(timePeriod)}&orderBy=PNL&limit=${limit}`;

    const res = await fetchFn(url);
    if (!res.ok) {
      throw new Error(`Failed to fetch Polymarket leaderboard (status ${res.status}).`);
    }

    const raw = await res.json();
    const entries: any[] = Array.isArray(raw?.ranks) ? raw.ranks : Array.isArray(raw) ? raw : [];

    return entries.map((e, idx): PolymarketTrader => {
      const rank = Number(e.rank ?? idx + 1) || idx + 1;
      const pnl = Number(e.pnl ?? e.profit ?? 0) || 0;
      const vol = Number(e.vol ?? e.volume ?? 0) || 0;

      return {
        rank,
        userName: String(e.userName ?? e.username ?? e.name ?? ''),
        wallet: String(e.proxyWallet ?? e.user ?? e.address ?? ''),
        pnlUsd: pnl,
        volumeUsd: vol,
      };
    });
  }

  /**
   * Search markets by keyword. Returns condition/token IDs needed for trading.
   *
   * Strategy:
   * 1. Try gamma-api by exact slug (works for slugs like "nba-gsw-nop-2026-02-24").
   * 2. Fetch trending/active events from Polymarket home SSR and filter by query keywords.
   */
  async searchMarkets(
    query: string,
    limit = 5
  ): Promise<
    Array<{
      conditionId: string;
      slug: string;
      title: string;
      tokens: Array<{ tokenId: string; outcome: string; price: number }>;
      volume: number;
      active: boolean;
    }>
  > {
    const fetchFn: typeof fetch | undefined = (globalThis as any).fetch;
    if (!fetchFn) throw new Error('Global fetch not available');

    // 1) Try exact slug match on gamma-api
    let events: any[] = [];
    try {
      const slugUrl = `https://gamma-api.polymarket.com/events?closed=false&limit=${limit}&slug=${encodeURIComponent(query)}`;
      const slugRes = await fetchFn(slugUrl);
      if (slugRes.ok) {
        const slugEvents = await slugRes.json();
        if (Array.isArray(slugEvents) && slugEvents.length > 0) events = slugEvents;
      }
    } catch {
      /* ignore */
    }

    // 2) Fetch active events by volume and filter by keywords locally
    if (events.length === 0) {
      try {
        const activeUrl = `https://gamma-api.polymarket.com/events?closed=false&limit=200&order=volume24hr&ascending=false`;
        const activeRes = await fetchFn(activeUrl);
        if (activeRes.ok) {
          const allEvents = await activeRes.json();
          if (Array.isArray(allEvents)) {
            const words = query
              .toLowerCase()
              .split(/\s+/)
              .filter((w) => w.length > 2);
            // First try: all words match
            events = allEvents.filter((e: any) => {
              const text = `${e.title ?? ''} ${e.slug ?? ''} ${e.description ?? ''}`.toLowerCase();
              return words.every((w: string) => text.includes(w));
            });
            // Fallback: any word matches
            if (events.length === 0 && words.length > 1) {
              events = allEvents.filter((e: any) => {
                const text = `${e.title ?? ''} ${e.slug ?? ''} ${e.description ?? ''}`.toLowerCase();
                return words.some((w: string) => text.includes(w));
              });
            }
          }
        }
      } catch {
        /* ignore */
      }
    }

    // Flatten events → markets with clobTokenIds
    const results: Array<{
      conditionId: string;
      slug: string;
      title: string;
      tokens: Array<{ tokenId: string; outcome: string; price: number }>;
      volume: number;
      active: boolean;
    }> = [];

    for (const evt of events) {
      const markets = evt.markets ?? [];
      for (const m of markets) {
        let tids: string[] = [];
        if (typeof m.clobTokenIds === 'string') {
          try {
            tids = JSON.parse(m.clobTokenIds);
          } catch {
            /* */
          }
        } else if (Array.isArray(m.clobTokenIds)) {
          tids = m.clobTokenIds;
        }
        let outcomes: string[] = [];
        if (typeof m.outcomes === 'string') {
          try {
            outcomes = JSON.parse(m.outcomes);
          } catch {
            /* */
          }
        } else if (Array.isArray(m.outcomes)) {
          outcomes = m.outcomes;
        }
        let prices: number[] = [];
        if (typeof m.outcomePrices === 'string') {
          try {
            prices = JSON.parse(m.outcomePrices).map(Number);
          } catch {
            /* */
          }
        }

        if (tids.length === 0) continue;

        // Only include markets with at least one token priced 0.10-0.90 (tradeable range)
        const hasTradeablePrice = prices.some((p) => p >= 0.1 && p <= 0.9);
        if (!hasTradeablePrice && prices.length > 0) continue;

        results.push({
          conditionId: String(m.conditionId ?? ''),
          slug: String(m.slug ?? ''),
          title: String(m.question ?? ''),
          tokens: tids.map((tid, i) => ({
            tokenId: tid,
            outcome: outcomes[i] ?? `Outcome ${i}`,
            price: prices[i] ?? 0,
          })),
          volume: Number(m.volume ?? 0),
          active: m.active !== false && m.closed !== true,
        });
      }
    }
    // Sort by volume (most liquid first) so agent picks tradeable markets
    results.sort((a, b) => b.volume - a.volume);
    return results.slice(0, limit);
  }

  /**
   * Place a new order.
   *
   * In paper mode this is currently a no-op; you can extend it to record
   * simulated trades. In live mode you MUST implement the actual HTTP/API
   * call to Polymarket here.
   */
  async placeOrder(params: {
    tokenId: string;
    side: 'buy' | 'sell';
    price: number;
    size: number;
    tickSize?: string;
    negRisk?: boolean;
  }): Promise<void> {
    if (this.mode === 'paper') {
      // No-op for now; safe by default.
      return;
    }

    // Live mode: submit order via CLOB SDK.
    const client = (await this.getLiveSdkClient()) as any;
    const sdk = (await import('@polymarket/clob-client')) as any;
    const Side = sdk.Side;
    const OrderType = sdk.OrderType;

    const sideEnum = params.side === 'buy' ? Side.BUY : Side.SELL;
    const tickSize = params.tickSize ?? '0.001';
    const negRisk = params.negRisk ?? false;

    await client.createAndPostOrder(
      {
        tokenID: params.tokenId,
        price: params.price,
        side: sideEnum,
        size: params.size,
      },
      { tickSize, negRisk },
      OrderType.GTC
    );
  }

  /**
   * Get current midpoint price for a token. Used by position monitor.
   */
  async getTokenPrice(tokenId: string): Promise<number | null> {
    if (this.mode === 'paper') return null; // Paper mode doesn't track live prices

    try {
      const client = (await this.getLiveSdkClient()) as any;
      const book = await client.getOrderBook(tokenId);
      if (!book) return null;

      const bestBid = book.bids?.[0]?.price;
      const bestAsk = book.asks?.[0]?.price;

      if (bestBid && bestAsk) return (Number(bestBid) + Number(bestAsk)) / 2;
      if (bestBid) return Number(bestBid);
      if (bestAsk) return Number(bestAsk);
      return null;
    } catch {
      return null;
    }
  }

  /**
   * Close or reduce an existing position.
   */
  async closePosition(params: { tokenId: string; size?: number }): Promise<void> {
    if (this.mode === 'paper') {
      // No-op for now; safe by default.
      return;
    }

    // Implemented as a sell order mirroring the given token size.
    const client = (await this.getLiveSdkClient()) as any;
    const sdk = (await import('@polymarket/clob-client')) as any;
    const Side = sdk.Side;
    const OrderType = sdk.OrderType;

    // If size is not provided, the model is expected to have determined
    // the full position size off-chain.
    const size = params.size ?? 0;
    if (!size || size <= 0) return;

    // Best-effort close at max valid price (0.999)
    const price = 0.999;

    await client.createAndPostOrder(
      {
        tokenID: params.tokenId,
        price,
        side: Side.SELL,
        size,
      },
      { tickSize: '0.001', negRisk: false },
      OrderType.FOK
    );
  }
}
