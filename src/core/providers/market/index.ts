/**
 * Market Data Provider — Price feeds and token analytics
 *
 * Multi-source aggregator for:
 * - Token prices (real-time)
 * - Liquidity data
 * - Trading volume
 * - Holder distribution
 * - Trending tokens
 */

// ── Types ────────────────────────────────────────────────────────────────────

export type ChainId = 'base' | 'base-sepolia' | 'solana' | 'ethereum';

export interface TokenPrice {
  token: string;
  symbol: string;
  priceUsd: number;
  priceChange24h: number;
  timestamp: number;
}

export interface LiquidityInfo {
  token: string;
  totalLiquidityUsd: number;
  pairAddress?: string;
  dex: string;
}

export interface TokenInfo {
  address: string;
  symbol: string;
  name: string;
  chainId: ChainId;
  priceUsd: number;
  marketCap?: number;
  liquidityUsd: number;
  volume24h: number;
  uniqueHolders: number;
  topHolders: Array<{
    address: string;
    percent: number;
  }>;
  ageMinutes: number;
  mintAuthority?: boolean;
  freezeAuthority?: boolean;
  devWallet?: string;
  devHoldingPercent?: number;
}

export interface TrendingToken {
  rank: number;
  token: string;
  symbol: string;
  priceUsd: number;
  priceChange24h: number;
  volume24h: number;
  liquidityUsd: number;
  socialVelocity?: number; // Mentions per hour
}

export interface MarketDataConfig {
  chainId: ChainId;
  apiKey?: string;
  rpcUrl?: string;
}

// ── Provider Interface ───────────────────────────────────────────────────────

export interface MarketDataProvider {
  readonly name: string;
  readonly chainId: ChainId;

  // Prices
  getPrice(token: string): Promise<TokenPrice>;
  getPrices(tokens: string[]): Promise<TokenPrice[]>;

  // Token analysis
  getTokenInfo(token: string): Promise<TokenInfo>;
  getLiquidity(token: string): Promise<LiquidityInfo>;

  // Discovery
  getTrendingTokens(limit?: number): Promise<TrendingToken[]>;
  getNewLaunches(minutes?: number): Promise<TokenInfo[]>;
}

// ── DexScreener Provider (Multi-chain) ───────────────────────────────────────

export class DexScreenerProvider implements MarketDataProvider {
  readonly name = 'DexScreener';
  readonly chainId: ChainId;

  private baseUrl = 'https://api.dexscreener.com/latest';

  constructor(config: MarketDataConfig) {
    this.chainId = config.chainId;
  }

  async getPrice(token: string): Promise<TokenPrice> {
    const response = await fetch(`${this.baseUrl}/dex/tokens/${token}`);
    if (!response.ok) throw new Error(`DexScreener error: ${response.status}`);

    const data = await response.json();
    const pair = data.pairs?.[0];
    if (!pair) throw new Error('No price data found');

    return {
      token,
      symbol: pair.baseToken?.symbol || 'UNKNOWN',
      priceUsd: Number.parseFloat(pair.priceUsd),
      priceChange24h: Number.parseFloat(pair.priceChange?.h24 || '0'),
      timestamp: Date.now(),
    };
  }

  async getPrices(tokens: string[]): Promise<TokenPrice[]> {
    // DexScreener doesn't support batch, fetch sequentially
    const prices: TokenPrice[] = [];
    for (const token of tokens) {
      try {
        const price = await this.getPrice(token);
        prices.push(price);
      } catch (e) {
        // Skip failed tokens
      }
    }
    return prices;
  }

  async getTokenInfo(token: string): Promise<TokenInfo> {
    const response = await fetch(`${this.baseUrl}/dex/tokens/${token}`);
    if (!response.ok) throw new Error(`DexScreener error: ${response.status}`);

    const data = await response.json();
    const pair = data.pairs?.[0];
    if (!pair) throw new Error('No token data found');

    return {
      address: token,
      symbol: pair.baseToken?.symbol || 'UNKNOWN',
      name: pair.baseToken?.name || 'Unknown',
      chainId: this.chainId,
      priceUsd: Number.parseFloat(pair.priceUsd),
      marketCap: pair.marketCap ? Number.parseFloat(pair.marketCap) : undefined,
      liquidityUsd: Number.parseFloat(pair.liquidity?.usd || '0'),
      volume24h: Number.parseFloat(pair.volume?.h24 || '0'),
      uniqueHolders: 0, // DexScreener doesn't provide this
      topHolders: [],
      ageMinutes: pair.pairCreatedAt ? Math.floor((Date.now() - pair.pairCreatedAt) / 60000) : 0,
    };
  }

  async getLiquidity(token: string): Promise<LiquidityInfo> {
    const response = await fetch(`${this.baseUrl}/dex/tokens/${token}`);
    const data = await response.json();
    const pair = data.pairs?.[0];

    return {
      token,
      totalLiquidityUsd: Number.parseFloat(pair?.liquidity?.usd || '0'),
      pairAddress: pair?.pairAddress,
      dex: pair?.dexId || 'unknown',
    };
  }

  async getTrendingTokens(limit = 10): Promise<TrendingToken[]> {
    // DexScreener trending endpoint
    const chainMap: Record<ChainId, string> = {
      base: 'base',
      'base-sepolia': 'base',
      solana: 'solana',
      ethereum: 'ethereum',
    };

    const chain = chainMap[this.chainId];
    const response = await fetch(`${this.baseUrl}/dex/search?q= trending ${chain}`);

    if (!response.ok) {
      // Fallback: return empty list
      return [];
    }

    const data = await response.json();
    return (data.pairs || []).slice(0, limit).map((pair: any, index: number) => ({
      rank: index + 1,
      token: pair.baseToken?.address || pair.pairAddress,
      symbol: pair.baseToken?.symbol || 'UNKNOWN',
      priceUsd: Number.parseFloat(pair.priceUsd),
      priceChange24h: Number.parseFloat(pair.priceChange?.h24 || '0'),
      volume24h: Number.parseFloat(pair.volume?.h24 || '0'),
      liquidityUsd: Number.parseFloat(pair.liquidity?.usd || '0'),
    }));
  }

  async getNewLaunches(_minutes = 60): Promise<TokenInfo[]> {
    // DexScreener doesn't have a direct new launches endpoint
    // Would need to filter by pairCreatedAt
    return [];
  }
}

// ── Birdeye Provider (Solana) ────────────────────────────────────────────────

export class BirdeyeProvider implements MarketDataProvider {
  readonly name = 'Birdeye';
  readonly chainId: ChainId = 'solana';

  private apiKey: string;
  private baseUrl = 'https://public-api.birdeye.so';

  constructor(config: MarketDataConfig) {
    this.chainId = config.chainId;
    this.apiKey = config.apiKey || '';

    if (this.chainId !== 'solana') {
      throw new Error('Birdeye only supports Solana');
    }
  }

  private async fetch<T>(endpoint: string): Promise<T> {
    const response = await fetch(`${this.baseUrl}${endpoint}`, {
      headers: {
        'X-API-KEY': this.apiKey,
      },
    });

    if (!response.ok) throw new Error(`Birdeye error: ${response.status}`);
    return response.json() as Promise<T>;
  }

  async getPrice(token: string): Promise<TokenPrice> {
    const data = await this.fetch<any>(`/public/price?address=${token}`);

    return {
      token,
      symbol: data.data?.symbol || 'UNKNOWN',
      priceUsd: data.data?.value || 0,
      priceChange24h: data.data?.priceChange24h || 0,
      timestamp: Date.now(),
    };
  }

  async getPrices(tokens: string[]): Promise<TokenPrice[]> {
    // Birdeye supports batch via multiple requests or specific endpoint
    const prices: TokenPrice[] = [];
    for (const token of tokens) {
      try {
        const price = await this.getPrice(token);
        prices.push(price);
      } catch (e) {
        // Skip failed
      }
    }
    return prices;
  }

  async getTokenInfo(token: string): Promise<TokenInfo> {
    const data = await this.fetch<any>(`/public/token_meta?address=${token}`);
    const overview = await this.fetch<any>(`/public/token_overview?address=${token}`);

    return {
      address: token,
      symbol: data.data?.symbol || 'UNKNOWN',
      name: data.data?.name || 'Unknown',
      chainId: 'solana',
      priceUsd: overview.data?.price || 0,
      marketCap: overview.data?.mc,
      liquidityUsd: overview.data?.liquidity || 0,
      volume24h: overview.data?.v24hUSD || 0,
      uniqueHolders: overview.data?.holder || 0,
      topHolders: [], // Would need separate call
      ageMinutes: 0, // Would need to calculate from creation time
    };
  }

  async getLiquidity(token: string): Promise<LiquidityInfo> {
    const overview = await this.fetch<any>(`/public/token_overview?address=${token}`);

    return {
      token,
      totalLiquidityUsd: overview.data?.liquidity || 0,
      dex: 'Raydium/Orca', // Birdeye aggregates multiple DEXs
    };
  }

  async getTrendingTokens(limit = 10): Promise<TrendingToken[]> {
    const data = await this.fetch<any>('/defi/token_trending?sort_by=rank&sort_type=asc&offset=0&limit=' + limit);

    return (data.data?.tokens || []).map((token: any, index: number) => ({
      rank: index + 1,
      token: token.address,
      symbol: token.symbol,
      priceUsd: token.price,
      priceChange24h: token.priceChange24h,
      volume24h: token.volume24h,
      liquidityUsd: token.liquidity,
    }));
  }

  async getNewLaunches(minutes = 60): Promise<TokenInfo[]> {
    // Birdeye has new listing endpoint
    const data = await this.fetch<any>(
      `/defi/v2/tokens/new_listing?time_from=${Date.now() - minutes * 60000}&time_to=${Date.now()}`
    );

    return (data.data?.tokens || []).map((token: any) => ({
      address: token.address,
      symbol: token.symbol,
      name: token.name,
      chainId: 'solana',
      priceUsd: token.price,
      liquidityUsd: token.liquidity,
      volume24h: token.volume24h,
      uniqueHolders: token.holder || 0,
      topHolders: [],
      ageMinutes: Math.floor((Date.now() - token.createdAt) / 60000),
    }));
  }
}

// ── Factory ──────────────────────────────────────────────────────────────────

export function createMarketDataProvider(chainId: ChainId, config?: { apiKey?: string }): MarketDataProvider {
  switch (chainId) {
    case 'solana':
      return new BirdeyeProvider({ chainId, apiKey: config?.apiKey });
    case 'base':
    case 'base-sepolia':
    case 'ethereum':
      return new DexScreenerProvider({ chainId });
    default:
      throw new Error(`No provider available for chain: ${chainId}`);
  }
}
