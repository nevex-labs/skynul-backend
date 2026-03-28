import type { CryptoProvider } from './crypto-provider';
import type {
  CryptoAddress,
  CryptoBalance,
  CryptoTransferHistoryEntry,
  CryptoTransferResult,
  CryptoTransferStatus,
} from './types';
import { STABLECOIN_NETWORK_SUPPORT, isNetworkSupported, isStablecoinAsset } from './types';

const TRANSAK_BASE = 'https://api.transak.com';
const TRANSAK_BASE_STAGING = 'https://api-stg.transak.com';

type CryptoMode = 'paper' | 'live';

// Network name mappings for Transak API
const NETWORK_TO_TRANSAK: Record<string, string> = {
  ethereum: 'ethereum',
  polygon: 'polygon',
  arbitrum: 'arbitrum',
  optimism: 'optimism',
  base: 'base',
};

// Asset mapping (Transak uses uppercase symbols)
const ASSET_TO_TRANSAK: Record<string, string> = {
  USDT: 'USDT',
  USDC: 'USDC',
  DAI: 'DAI',
};

export class TransakOffRamp implements CryptoProvider {
  private readonly mode: CryptoMode;

  constructor(opts?: { mode?: CryptoMode }) {
    this.mode = opts?.mode ?? 'paper';
  }

  private async getCredentials(): Promise<{ apiKey: string; apiSecret: string }> {
    const { getSecret } = await import('../stores/secret-store');
    const apiKey = (await getSecret('TRANSAK_API_KEY')) ?? process.env.TRANSAK_API_KEY;
    const apiSecret = (await getSecret('TRANSAK_API_SECRET')) ?? process.env.TRANSAK_API_SECRET;

    if (!apiKey || !apiSecret) {
      throw new Error('TRANSAK_API_KEY and TRANSAK_API_SECRET are not set. Configure them in Settings → Trading.');
    }
    return { apiKey, apiSecret };
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const { apiKey, apiSecret } = await this.getCredentials();
    const baseUrl = process.env.TRANSAK_ENV === 'staging' ? TRANSAK_BASE_STAGING : TRANSAK_BASE;
    const url = `${baseUrl}${path}`;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiSecret}`,
      'x-api-key': apiKey,
    };

    const res = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Transak API error ${res.status}: ${err}`);
    }
    return res.json() as Promise<T>;
  }

  async getBalance(): Promise<CryptoBalance[]> {
    if (this.mode === 'paper') {
      // Paper mode returns mock balances for ARS off-ramp testing
      return [
        { asset: 'USDT', network: 'ethereum', available: 1000, total: 1000 },
        { asset: 'USDC', network: 'ethereum', available: 500, total: 500 },
        { asset: 'USDT', network: 'polygon', available: 250, total: 250 },
        { asset: 'DAI', network: 'ethereum', available: 100, total: 100 },
      ];
    }

    // Transak doesn't have a direct balance endpoint for off-ramp.
    // In a real scenario, you'd query your own wallet balances.
    // For now, return empty array (or integrate with a wallet client).
    return [];
  }

  async getAddresses(): Promise<CryptoAddress[]> {
    if (this.mode === 'paper') {
      // These are the deposit addresses where users send crypto for off-ramp.
      // In a real implementation, these would be provided by Transak per user.
      return [
        {
          address: '0x742d35Cc6634C0532935334AdCb2f44d923604d5',
          network: 'ethereum',
          label: 'Transak Deposit (ETH)',
          verified: true,
        },
        {
          address: '0x742d35Cc6634C0532935334AdCb2f44d923604d5',
          network: 'polygon',
          label: 'Transak Deposit (Polygon)',
          verified: true,
        },
      ];
    }

    // In production, Transak provides deposit addresses per user/order.
    // We can't fetch a static list. Return empty array.
    return [];
  }

  async sendTransfer(params: {
    amount: number;
    asset: string;
    destination: string;
    network: string;
    memo?: string;
  }): Promise<CryptoTransferResult> {
    const { amount, asset, destination, network, memo } = params;

    // Validate inputs
    if (!isStablecoinAsset(asset)) {
      throw new Error(`Unsupported asset: ${asset}. Supported: USDT, USDC, DAI`);
    }

    if (!isNetworkSupported(asset, network)) {
      const supported = STABLECOIN_NETWORK_SUPPORT[asset];
      throw new Error(`${asset} is not supported on ${network}. Supported: ${supported.join(', ')}`);
    }

    const transakNetwork = NETWORK_TO_TRANSAK[network];
    if (!transakNetwork) {
      throw new Error(`Unsupported network: ${network}`);
    }

    const transakAsset = ASSET_TO_TRANSAK[asset];
    if (!transakAsset) {
      throw new Error(`Unsupported asset mapping for ${asset}`);
    }

    if (this.mode === 'paper') {
      const transferId = `paper-transak-${Date.now()}`;
      // Simulate off-ramp: user sends crypto, we will later pay ARS to bank account.
      // Return pending status because the order needs to be processed.
      return {
        transferId,
        status: 'pending',
        amount,
        asset: asset as CryptoBalance['asset'],
        network: network as CryptoBalance['network'],
        destination, // This is the user's bank account CBU/alias in ARS
        createdAt: Date.now(),
      };
    }

    // In live mode, we create a Transak sell order.
    // The destination parameter should be the user's bank account identifier (CBU/alias).
    // We'll need to create a quote first, then create order.
    // However, the CryptoProvider interface expects a simple sendTransfer.
    // For simplicity, we'll treat destination as the bank account identifier.
    // We'll need to implement the full flow later.
    // For now, throw an error indicating not implemented.
    throw new Error('Transak off-ramp live mode not yet implemented. Please use paper mode for testing.');
  }

  async getTransferStatus(transferId: string): Promise<CryptoTransferStatus> {
    if (this.mode === 'paper') {
      // Simulate order completion after some time
      const isCompleted = transferId.includes('completed') || Date.now() % 2 === 0;
      return {
        transferId,
        status: isCompleted ? 'completed' : 'pending',
        updatedAt: Date.now(),
      };
    }

    // In live mode, we'd query Transak's order status endpoint.
    // For now, throw not implemented.
    throw new Error('Transak off-ramp live mode not yet implemented.');
  }

  async getTransferHistory(limit = 10): Promise<CryptoTransferHistoryEntry[]> {
    if (this.mode === 'paper') {
      return [
        {
          transferId: 'paper-transak-history-1',
          amount: 100,
          asset: 'USDT',
          network: 'ethereum',
          destination: 'CBU: 1234567890123456789012',
          status: 'completed',
          fee: 1.5,
          createdAt: Date.now() - 86400000,
        },
        {
          transferId: 'paper-transak-history-2',
          amount: 50,
          asset: 'USDC',
          network: 'polygon',
          destination: 'ALIAS: juan.perez',
          status: 'completed',
          fee: 0.5,
          createdAt: Date.now() - 172800000,
        },
      ];
    }

    // In live mode, fetch order history from Transak.
    throw new Error('Transak off-ramp live mode not yet implemented.');
  }

  async estimateFee(params: { asset: string; network: string; amount: number }): Promise<{
    fee: number;
    estimatedGas?: number;
  }> {
    const { asset, network, amount } = params;

    if (this.mode === 'paper') {
      // Paper mode: approximate fees (Transak fee + network fee)
      // Transak off-ramp fees vary by country and payment method.
      // For ARS, assume 1.5% fee + network gas.
      const transakFeeRate = 0.015; // 1.5%
      const transakFee = amount * transakFeeRate;
      const networkFees: Record<string, number> = {
        ethereum: 5.0,
        polygon: 0.01,
        arbitrum: 0.5,
        optimism: 0.5,
        base: 0.01,
      };
      const networkFee = networkFees[network.toLowerCase()] ?? 1.0;
      return {
        fee: transakFee + networkFee,
        estimatedGas: network === 'ethereum' ? 21000 : undefined,
      };
    }

    // In live mode, we'd fetch a quote from Transak to get exact fee.
    // For now, return estimated fees.
    const transakFeeRate = 0.015;
    const transakFee = amount * transakFeeRate;
    const networkFees: Record<string, number> = {
      ethereum: 5.0,
      polygon: 0.05,
      arbitrum: 1.0,
      optimism: 1.0,
      base: 0.05,
    };
    return {
      fee: transakFee + (networkFees[network.toLowerCase()] ?? 2.0),
    };
  }

  // Helper method to generate payment instructions (CBU/alias) for manual bank transfer
  // This could be used when Transak cannot automatically process the bank transfer.
  getPaymentInstructions(transferId: string): string {
    return `=== TRANSFERENCIA BANCARIA PARA OFF-RAMP ===
ID de orden: ${transferId}
Banco: (será proporcionado por Transak)
CBU/CVU: (será proporcionado por Transak)
Alias: (será proporcionado por Transak)
Concepto: Transferencia de stablecoins a ARS
Estado: Pendiente de pago

Por favor, envíe sus stablecoins a la dirección de depósito proporcionada por Transak.
Una vez recibido, Transak procesará la conversión a ARS y transferirá a su cuenta bancaria.`;
  }
}

// Re-export types for convenience
import type { StablecoinAsset, StablecoinNetwork } from './types';
