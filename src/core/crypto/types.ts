import { z } from 'zod';

// ── Provider Types ─────────────────────────────────────────────────────────────

export type CryptoProviderId = 'coinbase' | 'manual' | 'transak' | 'ripio';

// ── Supported Assets & Networks ────────────────────────────────────────────────

export const SUPPORTED_STABLECOINS = ['USDT', 'USDC', 'DAI'] as const;
export type StablecoinAsset = (typeof SUPPORTED_STABLECOINS)[number];

export const STABLECOIN_NETWORKS = ['ethereum', 'polygon', 'arbitrum', 'optimism', 'base'] as const;
export type StablecoinNetwork = (typeof STABLECOIN_NETWORKS)[number];

// Network support matrix
export const STABLECOIN_NETWORK_SUPPORT: Record<StablecoinAsset, StablecoinNetwork[]> = {
  USDC: ['ethereum', 'polygon', 'arbitrum', 'optimism', 'base'],
  USDT: ['ethereum', 'polygon', 'arbitrum', 'optimism'],
  DAI: ['ethereum', 'polygon', 'arbitrum', 'optimism'],
};

// ── Domain Types ───────────────────────────────────────────────────────────────

export type CryptoBalance = {
  asset: StablecoinAsset;
  network: StablecoinNetwork;
  available: number;
  total: number;
};

export type CryptoAddress = {
  address: string;
  network: StablecoinNetwork;
  label?: string;
  verified: boolean;
};

export type CryptoTransferResult = {
  transferId: string;
  status: 'pending' | 'completed' | 'failed' | 'requires_confirmation';
  amount: number;
  asset: StablecoinAsset;
  network: StablecoinNetwork;
  destination: string;
  fee?: number;
  txHash?: string;
  createdAt: number;
};

export type CryptoTransferStatus = {
  transferId: string;
  status: 'pending' | 'completed' | 'failed';
  txHash?: string;
  updatedAt: number;
};

export type CryptoTransferHistoryEntry = {
  transferId: string;
  amount: number;
  asset: StablecoinAsset;
  network: StablecoinNetwork;
  destination: string;
  status: string;
  txHash?: string;
  fee?: number;
  createdAt: number;
};

// ── Validation Types ───────────────────────────────────────────────────────────

// Ethereum address regex (0x + 40 hex chars)
const ETH_ADDRESS_REGEX = /^0x[a-fA-F0-9]{40}$/;

export const EthereumAddressSchema = z
  .string()
  .regex(ETH_ADDRESS_REGEX, 'Invalid Ethereum address format. Must be 0x followed by 40 hex characters');

export const StablecoinAssetSchema = z.enum(SUPPORTED_STABLECOINS, {
  errorMap: () => ({ message: `Asset must be one of: ${SUPPORTED_STABLECOINS.join(', ')}` }),
});

export const StablecoinNetworkSchema = z.enum(STABLECOIN_NETWORKS, {
  errorMap: () => ({ message: `Network must be one of: ${STABLECOIN_NETWORKS.join(', ')}` }),
});

export const CryptoTransferRequestSchema = z
  .object({
    asset: z.string().transform((val) => val.toUpperCase()),
    amount: z
      .number()
      .positive('Amount must be positive')
      .min(1, 'Minimum amount is 1')
      .max(100_000, 'Maximum amount is 100,000'),
    destination: z.string(),
    network: z.string().transform((val) => val.toLowerCase()),
    provider: z.enum(['coinbase', 'manual', 'transak', 'ripio']),
    memo: z.string().optional(),
  })
  .superRefine((data, ctx) => {
    // Validate destination based on provider
    if (data.provider === 'coinbase' || data.provider === 'manual') {
      if (!ETH_ADDRESS_REGEX.test(data.destination)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Invalid Ethereum address format. Must be 0x followed by 40 hex characters',
          path: ['destination'],
        });
      }
    }
    // For transak and ripio, any string is allowed (CBU, alias, bank account, etc.)
  });

export type ValidatedCryptoTransfer = {
  asset: StablecoinAsset;
  amount: number;
  destination: string;
  network: StablecoinNetwork;
  provider: CryptoProviderId;
  memo?: string;
};

// ── Validation Functions ───────────────────────────────────────────────────────

/**
 * Validate and normalize a crypto transfer request.
 */
export function validateCryptoTransfer(params: unknown): ValidatedCryptoTransfer {
  const parsed = CryptoTransferRequestSchema.parse(params);

  // Additional validation: check network supports this asset
  const supportedNetworks = STABLECOIN_NETWORK_SUPPORT[parsed.asset as StablecoinAsset];
  if (!supportedNetworks.includes(parsed.network as StablecoinNetwork)) {
    throw new z.ZodError([
      {
        code: z.ZodIssueCode.custom,
        message: `${parsed.asset} is not supported on ${parsed.network}. Supported: ${supportedNetworks.join(', ')}`,
        path: ['network'],
      },
    ]);
  }

  return parsed as ValidatedCryptoTransfer;
}

/**
 * Validate just an Ethereum address.
 */
export function isValidEthereumAddress(address: string): boolean {
  return ETH_ADDRESS_REGEX.test(address);
}

/**
 * Check if asset is a supported stablecoin.
 */
export function isStablecoinAsset(asset: string): asset is StablecoinAsset {
  return SUPPORTED_STABLECOINS.includes(asset.toUpperCase() as StablecoinAsset);
}

/**
 * Get supported networks for a given stablecoin.
 */
export function getSupportedNetworks(asset: StablecoinAsset): StablecoinNetwork[] {
  return [...STABLECOIN_NETWORK_SUPPORT[asset]];
}

/**
 * Check if network supports a given stablecoin.
 */
export function isNetworkSupported(asset: StablecoinAsset, network: string): network is StablecoinNetwork {
  const supportedNetworks = STABLECOIN_NETWORK_SUPPORT[asset];
  return supportedNetworks.includes(network.toLowerCase() as StablecoinNetwork);
}
