import type { FiatProvider } from './fiat-provider';
import type {
  FiatAccount,
  FiatBalance,
  FiatTransferHistoryEntry,
  FiatTransferResult,
  FiatTransferStatus,
} from './types';

export class ManualClient implements FiatProvider {
  private readonly mode: 'paper' | 'live';
  private static transfers: FiatTransferResult[] = [];

  constructor({ mode }: { mode: 'paper' | 'live' }) {
    this.mode = mode;
  }

  async getBalance(): Promise<FiatBalance[]> {
    // Return mock balances - manual mode doesn't connect to real banks
    return [
      { currency: 'USD', available: 1000.0, total: 1000.0 },
      { currency: 'EUR', available: 800.0, total: 800.0 },
    ];
  }

  async getAccounts(): Promise<FiatAccount[]> {
    // Return mock accounts - manual mode doesn't connect to real banks
    return [
      {
        id: 'manual-checking-001',
        label: 'Manual Checking Account',
        currency: 'USD',
        type: 'checking',
        institution: 'Manual Entry',
      },
      {
        id: 'manual-savings-001',
        label: 'Manual Savings Account',
        currency: 'EUR',
        type: 'savings',
        institution: 'Manual Entry',
      },
    ];
  }

  async sendTransfer(params: {
    amount: number;
    currency: string;
    destinationAccount: string;
    concept?: string;
  }): Promise<FiatTransferResult> {
    const transferId = `manual-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
    const result: FiatTransferResult = {
      transferId,
      status: 'pending',
      amount: params.amount,
      currency: params.currency,
      destination: params.destinationAccount,
      createdAt: Date.now(),
    };
    ManualClient.transfers.push(result);

    // In a real scenario, we'd format instructions for the user
    // For now, just return the transfer result
    return result;
  }

  async getTransferStatus(transferId: string): Promise<FiatTransferStatus> {
    const transfer = ManualClient.transfers.find((t) => t.transferId === transferId);
    if (!transfer) {
      throw new Error(`Transfer ${transferId} not found`);
    }
    // For manual transfers, we can't track real status, just return what we have
    // Map status to FiatTransferStatus allowed values
    const statusMap: Record<string, 'pending' | 'completed' | 'failed'> = {
      pending: 'pending',
      completed: 'completed',
      failed: 'failed',
      requires_auth: 'pending', // treat as pending for manual
    };
    const mappedStatus = statusMap[transfer.status] ?? 'pending';
    return {
      transferId: transfer.transferId,
      status: mappedStatus,
      updatedAt: Date.now(),
    };
  }

  async getTransferHistory(limit = 10): Promise<FiatTransferHistoryEntry[]> {
    return ManualClient.transfers
      .slice(-limit)
      .reverse()
      .map((t) => ({
        transferId: t.transferId,
        amount: t.amount,
        currency: t.currency,
        destination: t.destination,
        status: t.status,
        createdAt: t.createdAt,
      }));
  }

  /**
   * Generate manual transfer instructions for the user.
   * This is a helper method not part of the FiatProvider interface.
   */
  getTransferInstructions(transferId: string): string {
    const transfer = ManualClient.transfers.find((t) => t.transferId === transferId);
    if (!transfer) {
      return `Transfer ${transferId} not found`;
    }

    const lines = [
      `=== MANUAL TRANSFER INSTRUCTIONS ===`,
      `Transfer ID: ${transfer.transferId}`,
      `Amount: ${transfer.amount} ${transfer.currency}`,
      `Destination: ${transfer.destination}`,
      `Concept: (add your own concept)`,
      `Status: ${transfer.status}`,
      ``,
      `Please log into your bank and manually transfer the above amount to the destination account.`,
      `After completing the transfer, you can check the status using the transfer ID.`,
    ];

    return lines.join('\n');
  }
}
