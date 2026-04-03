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

export type DeployTokenParams = {
  name: string;
  symbol: string;
  supply: string; // total supply as integer string, e.g. "1000000000000"
};

export type DeployTokenResult = {
  hash: string;
  contractAddress: string;
  explorerUrl: string;
};

export type SwapParams = {
  tokenIn: string;
  tokenOut: string;
  amountIn: string;
  slippageBps?: number;
};

export type CexBalance = {
  asset: string;
  free: number;
  locked: number;
};

export type CexPosition = {
  symbol: string;
  side: 'long' | 'short';
  size: number;
  entryPrice: number;
  markPrice: number;
  unrealizedPnl: number;
};

export type CexOrder = {
  symbol: string;
  side: 'buy' | 'sell';
  orderType: 'market' | 'limit';
  amount: number;
  price?: number;
};
