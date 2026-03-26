import type {
  FiatAccount,
  FiatBalance,
  FiatTransferHistoryEntry,
  FiatTransferResult,
  FiatTransferStatus,
} from './types';

export interface FiatProvider {
  getBalance(): Promise<FiatBalance[]>;
  getAccounts(): Promise<FiatAccount[]>;
  sendTransfer(params: {
    amount: number;
    currency: string;
    destinationAccount: string;
    concept?: string;
  }): Promise<FiatTransferResult>;
  getTransferStatus(transferId: string): Promise<FiatTransferStatus>;
  getTransferHistory(limit?: number): Promise<FiatTransferHistoryEntry[]>;
}
