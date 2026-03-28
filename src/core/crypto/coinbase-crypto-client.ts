import type { CryptoProvider } from './crypto-provider';
import type {
  CryptoAddress,
  CryptoBalance,
  CryptoTransferHistoryEntry,
  CryptoTransferResult,
  CryptoTransferStatus,
} from './types';
import { isNetworkSupported, isStablecoinAsset } from './types';

const COINBASE_BASE = 'https://api.coinbase.com/api/v3/brokerage';

type CryptoMode = 'paper' | 'live';

// Network name mappings for Coinbase API
const NETWORK_TO_COINBASE: Record<string, string> = {
  ethereum: 'ethereum',
  polygon: 'polygon',
  arbitrum: 'arbitrum',
  optimism: 'optimism',
  base: 'base',
};

// Asset precision mapping
const ASSET_DECIMALS: Record<string, number> = {
  USDT: 6,
  USDC: 6,
  DAI: 18,
};

export class CoinbaseCryptoClient implements CryptoProvider {
  private readonly mode: CryptoMode;

  constructor(opts?: { mode?: CryptoMode }) {
    this.mode = opts?.mode ?? 'paper';
  }

  private async getCredentials(): Promise<{ apiKey: string; apiSecret: string }> {
    const { getSecret } = await import('../stores/secret-store');
    const apiKey = (await getSecret('COINBASE_API_KEY')) ?? process.env.COINBASE_API_KEY;
    const apiSecret = (await getSecret('COINBASE_API_SECRET')) ?? process.env.COINBASE_API_SECRET;

    if (!apiKey || !apiSecret) {
      throw new Error('COINBASE_API_KEY and COINBASE_API_SECRET are not set. Configure them in Settings → Trading.');
    }
    return { apiKey, apiSecret };
  }

  /**
   * Build a JWT for Coinbase Advanced Trade API.
   */
  private async buildJwt(method: string, path: string): Promise<string> {
    const { apiKey, apiSecret } = await this.getCredentials();

    const { createSign } = await import('crypto');
    const header = Buffer.from(JSON.stringify({ alg: 'ES256', kid: apiKey })).toString('base64url');
    const now = Math.floor(Date.now() / 1000);
    const payload = Buffer.from(
      JSON.stringify({
        sub: apiKey,
        iss: 'coinbase-cloud',
        nbf: now,
        exp: now + 120,
        uri: `${method} api.coinbase.com${path}`,
      })
    ).toString('base64url');

    const signingInput = `${header}.${payload}`;
    const sign = createSign('SHA256');
    sign.update(signingInput);
    const sigDer = sign.sign(apiSecret, 'base64url');

    return `${signingInput}.${sigDer}`;
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const jwt = await this.buildJwt(method, path);
    const url = `https://api.coinbase.com${path}`;

    const res = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${jwt}`,
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Coinbase API error ${res.status}: ${err}`);
    }
    return res.json() as Promise<T>;
  }

  async getBalance(): Promise<CryptoBalance[]> {
    if (this.mode === 'paper') {
      return [
        { asset: 'USDC', network: 'ethereum', available: 1000, total: 1000 },
        { asset: 'USDT', network: 'ethereum', available: 500, total: 500 },
        { asset: 'USDC', network: 'polygon', available: 250, total: 250 },
        { asset: 'DAI', network: 'ethereum', available: 100, total: 100 },
      ];
    }

    const data = await this.request<{
      accounts: Array<{
        currency: string;
        available_balance: { value: string };
        hold: { value: string };
        destination_network?: string;
      }>;
    }>('GET', '/api/v3/brokerage/accounts');

    const balances: CryptoBalance[] = [];
    for (const account of data.accounts ?? []) {
      const asset = account.currency;
      if (!isStablecoinAsset(asset)) continue;

      const network = this.mapNetwork(account.destination_network ?? 'ethereum');
      if (!network) continue;

      balances.push({
        asset,
        network,
        available: Number.parseFloat(account.available_balance.value),
        total: Number.parseFloat(account.available_balance.value) + Number.parseFloat(account.hold.value),
      });
    }

    return balances;
  }

  async getAddresses(): Promise<CryptoAddress[]> {
    if (this.mode === 'paper') {
      return [
        {
          address: '0x742d35Cc6634C0532935334AdCb2f44d923604d5',
          network: 'ethereum',
          label: 'Primary Wallet',
          verified: true,
        },
        {
          address: '0x742d35Cc6634C0532935334AdCb2f44d923604d5',
          network: 'polygon',
          label: 'Primary Wallet (Polygon)',
          verified: true,
        },
      ];
    }

    // Coinbase doesn't have a dedicated "get addresses" endpoint in Advanced Trade API
    // For now, return empty array - addresses are validated on withdraw
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

    const coinbaseNetwork = NETWORK_TO_COINBASE[network];
    if (!coinbaseNetwork) {
      throw new Error(`Unsupported network: ${network}`);
    }

    if (this.mode === 'paper') {
      const transferId = `paper-crypto-${Date.now()}`;
      return {
        transferId,
        status: 'completed',
        amount,
        asset,
        network: network as CryptoBalance['network'],
        destination,
        txHash: `0x${Math.random().toString(16).slice(2, 10)}${Date.now().toString(16)}`,
        createdAt: Date.now(),
      };
    }

    const body: Record<string, unknown> = {
      type: 'SEND',
      to: destination,
      amount: amount.toFixed(ASSET_DECIMALS[asset] ?? 6),
      currency: asset,
      network: coinbaseNetwork,
    };

    if (memo) {
      body.metadata = { memo };
    }

    const data = await this.request<{ id: string }>('POST', '/api/v3/brokerage/transfers', body);

    return {
      transferId: data.id,
      status: 'pending',
      amount,
      asset,
      network: network as CryptoBalance['network'],
      destination,
      createdAt: Date.now(),
    };
  }

  async getTransferStatus(transferId: string): Promise<CryptoTransferStatus> {
    if (this.mode === 'paper') {
      return {
        transferId,
        status: 'completed',
        txHash: `0x${Math.random().toString(16).slice(2, 10)}${Date.now().toString(16)}`,
        updatedAt: Date.now(),
      };
    }

    const data = await this.request<{
      transfers: Array<{
        id: string;
        status: string;
        network?: { status?: string; hash?: string };
      }>;
    }>('GET', `/api/v3/brokerage/transfers?transfer_ids=${transferId}`);

    const transfer = data.transfers?.[0];
    if (!transfer) {
      throw new Error(`Transfer ${transferId} not found`);
    }

    const status = this.mapTransferStatus(transfer.status);

    return {
      transferId: transfer.id,
      status,
      txHash: transfer.network?.hash,
      updatedAt: Date.now(),
    };
  }

  async getTransferHistory(limit = 10): Promise<CryptoTransferHistoryEntry[]> {
    if (this.mode === 'paper') {
      return [
        {
          transferId: 'paper-crypto-history-1',
          amount: 100,
          asset: 'USDC',
          network: 'ethereum',
          destination: '0x742d35Cc6634C0532935334AdCb2f44d923604d5',
          status: 'completed',
          txHash: '0xabc123def456...',
          fee: 2.5,
          createdAt: Date.now() - 86400000,
        },
        {
          transferId: 'paper-crypto-history-2',
          amount: 50,
          asset: 'USDT',
          network: 'polygon',
          destination: '0x742d35Cc6634C0532935334AdCb2f44d923604d5',
          status: 'completed',
          txHash: '0xdef789abc123...',
          fee: 0.01,
          createdAt: Date.now() - 172800000,
        },
      ];
    }

    const data = await this.request<{
      transfers: Array<{
        id: string;
        amount: { value: string; currency: string };
        status: string;
        created_at: string;
        to: string;
        network?: { name?: string; status?: string; hash?: string };
        fee?: { amount: string };
      }>;
    }>('GET', `/api/v3/brokerage/transfers?limit=${limit}&type=SEND`);

    return (data.transfers ?? []).slice(0, limit).map((t) => ({
      transferId: t.id,
      amount: Number.parseFloat(t.amount.value),
      asset: t.amount.currency as CryptoBalance['asset'],
      network: this.mapNetwork(t.network?.name ?? 'ethereum') ?? 'ethereum',
      destination: t.to,
      status: t.status,
      txHash: t.network?.hash,
      fee: t.fee ? Number.parseFloat(t.fee.amount) : undefined,
      createdAt: new Date(t.created_at).getTime(),
    }));
  }

  async estimateFee(params: { asset: string; network: string; amount: number }): Promise<{
    fee: number;
    estimatedGas?: number;
  }> {
    const { asset, network } = params;

    if (this.mode === 'paper') {
      // Paper mode: return estimated fees
      const fees: Record<string, Record<string, number>> = {
        ethereum: { USDC: 3.0, USDT: 3.5, DAI: 4.0 },
        polygon: { USDC: 0.01, USDT: 0.01, DAI: 0.01 },
        arbitrum: { USDC: 0.5, USDT: 0.5, DAI: 0.5 },
        optimism: { USDC: 0.5, USDT: 0.5, DAI: 0.5 },
        base: { USDC: 0.01, USDT: 0.01, DAI: 0.01 },
      };

      const assetUpper = asset.toUpperCase();
      const networkLower = network.toLowerCase();

      return {
        fee: fees[networkLower]?.[assetUpper] ?? 2.0,
        estimatedGas: 21000,
      };
    }

    // For live mode, we'd query the network gas prices
    // Coinbase doesn't expose a direct fee estimate endpoint for withdrawals
    // Return estimated fees based on typical network conditions
    const estimatedFees: Record<string, number> = {
      ethereum: 5.0,
      polygon: 0.05,
      arbitrum: 1.0,
      optimism: 1.0,
      base: 0.05,
    };

    return {
      fee: estimatedFees[network.toLowerCase()] ?? 2.0,
    };
  }

  private mapNetwork(coinbaseNetwork: string): CryptoBalance['network'] | null {
    const normalized = coinbaseNetwork.toLowerCase();
    const mapping: Record<string, CryptoBalance['network']> = {
      ethereum: 'ethereum',
      eth: 'ethereum',
      polygon: 'polygon',
      matic: 'polygon',
      arbitrum: 'arbitrum',
      arb: 'arbitrum',
      optimism: 'optimism',
      op: 'optimism',
      base: 'base',
    };
    return mapping[normalized] ?? null;
  }

  private mapTransferStatus(coinbaseStatus: string): CryptoTransferStatus['status'] {
    const normalized = coinbaseStatus.toLowerCase();
    const mapping: Record<string, CryptoTransferStatus['status']> = {
      completed: 'completed',
      success: 'completed',
      pending: 'pending',
      processing: 'pending',
      failed: 'failed',
      cancelled: 'failed',
      canceled: 'failed',
    };
    return mapping[normalized] ?? 'pending';
  }
}

// Re-export types for convenience
import type { StablecoinAsset, StablecoinNetwork } from './types';
import { STABLECOIN_NETWORK_SUPPORT } from './types';
