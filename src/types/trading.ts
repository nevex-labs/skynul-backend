export type CexExchangeId = 'binance' | 'coinbase' | 'okx' | 'bybit' | 'kucoin' | 'gate' | 'htx' | 'mexc' | 'cryptocom';

export type CexExchangeScope = {
  spot: boolean;
  futures: boolean;
  /** Dangerous. Keep false by default. */
  withdraw: boolean;
};

export type CexExchangeSettings = {
  enabled: boolean;
  scopes: CexExchangeScope;
};

export type DexEvmSettings = {
  /** Enabled EVM chainIds for on-chain trading. */
  enabledChainIds: number[];
  /** Default chainId used when user doesn't specify. */
  defaultChainId: number;
};

export type DexNonEvmSettings = {
  enabled: boolean;
};

export type TradingSettings = {
  version: 1;
  cex: {
    defaultExchange: CexExchangeId;
    exchanges: Record<CexExchangeId, CexExchangeSettings>;
  };
  dex: {
    evm: DexEvmSettings;
    solana: DexNonEvmSettings;
    bitcoin: DexNonEvmSettings;
  };
};

export const DEFAULT_TRADING_SETTINGS: TradingSettings = {
  version: 1,
  cex: {
    defaultExchange: 'binance',
    exchanges: {
      binance: { enabled: true, scopes: { spot: true, futures: false, withdraw: false } },
      coinbase: { enabled: true, scopes: { spot: true, futures: false, withdraw: false } },
      okx: { enabled: false, scopes: { spot: true, futures: false, withdraw: false } },
      bybit: { enabled: false, scopes: { spot: true, futures: false, withdraw: false } },
      kucoin: { enabled: false, scopes: { spot: true, futures: false, withdraw: false } },
      gate: { enabled: false, scopes: { spot: true, futures: false, withdraw: false } },
      htx: { enabled: false, scopes: { spot: true, futures: false, withdraw: false } },
      mexc: { enabled: false, scopes: { spot: true, futures: false, withdraw: false } },
      cryptocom: { enabled: false, scopes: { spot: true, futures: false, withdraw: false } },
    },
  },
  dex: {
    evm: {
      enabledChainIds: [8453, 42161],
      defaultChainId: 8453,
    },
    solana: { enabled: false },
    bitcoin: { enabled: false },
  },
};
