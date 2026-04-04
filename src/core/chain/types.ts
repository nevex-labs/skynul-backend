export type ChainConfig = {
  chainId: number;
  name: string;
  rpcUrl: string;
  explorerUrl: string;
  nativeCurrency: { name: string; symbol: string; decimals: number };
  usdcAddress: string;
  usdcDecimals: number;
  dexRouterAddress?: string;
  testnet: boolean;
  // AA (Account Abstraction) fields
  bundlerUrl?: string;
  paymasterUrl?: string;
  skynulRouterAddress?: string;
  entryPointAddress?: string;
};

export type TokenBalance = {
  symbol: string;
  address: string;
  balance: string;
  balanceRaw: string;
  decimals: number;
};

export type TxReceipt = {
  hash: string;
  status: 'success' | 'failed' | 'pending';
  blockNumber?: number;
};

export type SwapParams = {
  tokenIn: string;
  tokenOut: string;
  amountIn: string;
  slippageBps?: number;
};
