import type { CryptoProvider } from './crypto-provider';
import type {
  CryptoAddress,
  CryptoBalance,
  CryptoTransferHistoryEntry,
  CryptoTransferResult,
  CryptoTransferStatus,
} from './types';

type CryptoMode = 'paper' | 'live';

/**
 * Manual crypto client for testing and manual transfers.
 * Does not connect to any real API; returns mock data.
 */
export class ManualCryptoClient implements CryptoProvider {
  private readonly mode: CryptoMode;
  private static transfers: CryptoTransferResult[] = [];

  constructor(opts?: { mode?: CryptoMode }) {
    this.mode = opts?.mode ?? 'paper';
  }

  async getBalance(): Promise<CryptoBalance[]> {
    // Return mock balances
    return [
      { asset: 'USDT', network: 'ethereum', available: 1000, total: 1000 },
      { asset: 'USDC', network: 'ethereum', available: 500, total: 500 },
      { asset: 'USDT', network: 'polygon', available: 250, total: 250 },
      { asset: 'DAI', network: 'ethereum', available: 100, total: 100 },
    ];
  }

  async getAddresses(): Promise<CryptoAddress[]> {
    // Return mock addresses
    return [
      {
        address: '0x742d35Cc6634C0532935334AdCb2f44d923604d5',
        network: 'ethereum',
        label: 'Manual Wallet',
        verified: true,
      },
      {
        address: '0x742d35Cc6634C0532935334AdCb2f44d923604d5',
        network: 'polygon',
        label: 'Manual Wallet (Polygon)',
        verified: true,
      },
    ];
  }

  async sendTransfer(params: {
    amount: number;
    asset: string;
    destination: string;
    network: string;
    memo?: string;
  }): Promise<CryptoTransferResult> {
    const { amount, asset, destination, network, memo } = params;
    const transferId = `manual-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
    const result: CryptoTransferResult = {
      transferId,
      status: 'pending',
      amount,
      asset: asset as CryptoBalance['asset'],
      network: network as CryptoBalance['network'],
      destination,
      createdAt: Date.now(),
    };
    ManualCryptoClient.transfers.push(result);
    return result;
  }

  async getTransferStatus(transferId: string): Promise<CryptoTransferStatus> {
    const transfer = ManualCryptoClient.transfers.find((t) => t.transferId === transferId);
    if (!transfer) {
      throw new Error(`Transfer ${transferId} not found`);
    }
    // For manual transfers, we can't track real status, just return what we have
    const statusMap: Record<string, 'pending' | 'completed' | 'failed'> = {
      pending: 'pending',
      completed: 'completed',
      failed: 'failed',
      requires_confirmation: 'pending',
    };
    const mappedStatus = statusMap[transfer.status] ?? 'pending';
    return {
      transferId: transfer.transferId,
      status: mappedStatus,
      updatedAt: Date.now(),
    };
  }

  async getTransferHistory(limit = 10): Promise<CryptoTransferHistoryEntry[]> {
    return ManualCryptoClient.transfers
      .slice(-limit)
      .reverse()
      .map((t) => ({
        transferId: t.transferId,
        amount: t.amount,
        asset: t.asset,
        network: t.network,
        destination: t.destination,
        status: t.status,
        fee: t.fee,
        createdAt: t.createdAt,
      }));
  }

  async estimateFee(params: { asset: string; network: string; amount: number }): Promise<{
    fee: number;
    estimatedGas?: number;
  }> {
    // Return estimated fees
    const fees: Record<string, Record<string, number>> = {
      ethereum: { USDC: 3.0, USDT: 3.5, DAI: 4.0 },
      polygon: { USDC: 0.01, USDT: 0.01, DAI: 0.01 },
      arbitrum: { USDC: 0.5, USDT: 0.5, DAI: 0.5 },
      optimism: { USDC: 0.5, USDT: 0.5, DAI: 0.5 },
      base: { USDC: 0.01, USDT: 0.01, DAI: 0.01 },
    };
    const assetUpper = params.asset.toUpperCase();
    const networkLower = params.network.toLowerCase();
    return {
      fee: fees[networkLower]?.[assetUpper] ?? 2.0,
      estimatedGas: params.network === 'ethereum' ? 21000 : undefined,
    };
  }

  /**
   * Generate manual transfer instructions for the user.
   * This is a helper method not part of the CryptoProvider interface.
   */
  getTransferInstructions(transferId: string): string {
    const transfer = ManualCryptoClient.transfers.find((t) => t.transferId === transferId);
    if (!transfer) {
      return `Transfer ${transferId} not found`;
    }

    const lines = [
      `=== MANUAL CRYPTO TRANSFER INSTRUCTIONS ===`,
      `Transfer ID: ${transfer.transferId}`,
      `Amount: ${transfer.amount} ${transfer.asset} (${transfer.network})`,
      `Destination: ${transfer.destination}`,
      `Status: ${transfer.status}`,
      ``,
      `Please send the above amount to the destination address using your wallet.`,
      `After completing the transfer, you can check the status using the transfer ID.`,
    ];

    return lines.join('\n');
  }
}
