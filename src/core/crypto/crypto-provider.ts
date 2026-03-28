import type {
  CryptoAddress,
  CryptoBalance,
  CryptoTransferHistoryEntry,
  CryptoTransferResult,
  CryptoTransferStatus,
} from './types';

/**
 * CryptoProvider interface for stablecoin transfers.
 * Follows the FiatProvider pattern for consistency.
 */
export interface CryptoProvider {
  /**
   * Get available stablecoin balances across supported networks.
   */
  getBalance(): Promise<CryptoBalance[]>;

  /**
   * Get verified withdrawal addresses.
   */
  getAddresses(): Promise<CryptoAddress[]>;

  /**
   * Send a stablecoin transfer to an external address.
   */
  sendTransfer(params: {
    amount: number;
    asset: string;
    destination: string;
    network: string;
    memo?: string;
  }): Promise<CryptoTransferResult>;

  /**
   * Get the current status of a transfer.
   */
  getTransferStatus(transferId: string): Promise<CryptoTransferStatus>;

  /**
   * Get transfer history.
   */
  getTransferHistory(limit?: number): Promise<CryptoTransferHistoryEntry[]>;

  /**
   * Estimate the network fee for a transfer.
   */
  estimateFee(params: {
    asset: string;
    network: string;
    amount: number;
  }): Promise<{ fee: number; estimatedGas?: number }>;
}
