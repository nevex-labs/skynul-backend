import type { ChainConfig } from './types';

const CHAINS: ChainConfig[] = [
  {
    chainId: 84532,
    name: 'Base Sepolia',
    rpcUrl: 'https://sepolia.base.org',
    explorerUrl: 'https://sepolia.basescan.org',
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    usdcAddress: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
    usdcDecimals: 6,
    testnet: true,
  },
  {
    chainId: 8453,
    name: 'Base',
    rpcUrl: 'https://mainnet.base.org',
    explorerUrl: 'https://basescan.org',
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    usdcAddress: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    usdcDecimals: 6,
    dexRouterAddress: '0x2626664c2603336E57B271c5C0b26F421741e481', // Uniswap v3 SwapRouter02
    testnet: false,
  },
  {
    chainId: 42161,
    name: 'Arbitrum One',
    rpcUrl: 'https://arb1.arbitrum.io/rpc',
    explorerUrl: 'https://arbiscan.io',
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    usdcAddress: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
    usdcDecimals: 6,
    testnet: false,
  },
];

const CHAIN_MAP = new Map<number, ChainConfig>(CHAINS.map((c) => [c.chainId, c]));

export function getChainConfig(chainId: number): ChainConfig | undefined {
  return CHAIN_MAP.get(chainId);
}

export function getAllChains(): ChainConfig[] {
  return CHAINS;
}

export function getDefaultChainId(): number {
  return 84532; // Base Sepolia
}
