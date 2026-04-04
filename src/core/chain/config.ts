import type { ChainConfig } from './types';

// ERC-4337 EntryPoint v0.7.0 (same address across all chains)
const ENTRY_POINT_V07 = '0x0000000071727De22E5E9d8BAf0edAc6f37da032';

// Pimlico bundler endpoints (free tier)
const PIMLICO_BUNDLER_BASE = 'https://api.pimlico.io/v2/8453/rpc?apikey=';
const PIMLICO_BUNDLER_ARBITRUM = 'https://api.pimlico.io/v2/42161/rpc?apikey=';
const PIMLICO_BUNDLER_BASE_SEPOLIA = 'https://api.pimlico.io/v2/84532/rpc?apikey=';

// Pimlico paymaster endpoints (USDC gas)
const PIMLICO_PAYMASTER_BASE = 'https://api.pimlico.io/v2/8453/rpc?apikey=';
const PIMLICO_PAYMASTER_ARBITRUM = 'https://api.pimlico.io/v2/42161/rpc?apikey=';
const PIMLICO_PAYMASTER_BASE_SEPOLIA = 'https://api.pimlico.io/v2/84532/rpc?apikey=';

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
    // AA
    bundlerUrl: PIMLICO_BUNDLER_BASE_SEPOLIA,
    paymasterUrl: PIMLICO_PAYMASTER_BASE_SEPOLIA,
    entryPointAddress: ENTRY_POINT_V07,
  },
  {
    chainId: 8453,
    name: 'Base',
    rpcUrl: 'https://mainnet.base.org',
    explorerUrl: 'https://basescan.org',
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    usdcAddress: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    usdcDecimals: 6,
    dexRouterAddress: '0x2626664c2603336E57B271c5C0b26F421741e481',
    testnet: false,
    // AA
    bundlerUrl: PIMLICO_BUNDLER_BASE,
    paymasterUrl: PIMLICO_PAYMASTER_BASE,
    entryPointAddress: ENTRY_POINT_V07,
    skynulRouterAddress: process.env.SKYNUL_ROUTER_BASE,
  },
  {
    chainId: 1,
    name: 'Ethereum',
    rpcUrl: 'https://rpc.ankr.com/eth',
    explorerUrl: 'https://etherscan.io',
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    usdcAddress: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
    usdcDecimals: 6,
    testnet: false,
    // AA deferred — high gas costs on Ethereum mainnet
  },
  {
    chainId: 56,
    name: 'BNB Chain',
    rpcUrl: 'https://bsc-dataseed.binance.org',
    explorerUrl: 'https://bscscan.com',
    nativeCurrency: { name: 'BNB', symbol: 'BNB', decimals: 18 },
    usdcAddress: '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d',
    usdcDecimals: 6,
    testnet: false,
    // AA deferred — pending Pimlico support verification
  },
  {
    chainId: 137,
    name: 'Polygon',
    rpcUrl: 'https://polygon-rpc.com',
    explorerUrl: 'https://polygonscan.com',
    nativeCurrency: { name: 'MATIC', symbol: 'MATIC', decimals: 18 },
    usdcAddress: '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174',
    usdcDecimals: 6,
    testnet: false,
    // AA deferred — pending Pimlico support verification
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
    // AA
    bundlerUrl: PIMLICO_BUNDLER_ARBITRUM,
    paymasterUrl: PIMLICO_PAYMASTER_ARBITRUM,
    entryPointAddress: ENTRY_POINT_V07,
    skynulRouterAddress: process.env.SKYNUL_ROUTER_ARBITRUM,
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

/** Get chains that have AA support (bundler + paymaster configured) */
export function getAAChains(): ChainConfig[] {
  return CHAINS.filter((c) => c.bundlerUrl && c.paymasterUrl && c.entryPointAddress);
}
