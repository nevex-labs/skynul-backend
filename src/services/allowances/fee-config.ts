/**
 * Fee Configuration and Types for Trading
 */

export interface FeeConfig {
  /** Fee percentage (e.g., 1 = 1%) */
  percentage: number;
  /** Address that collects platform fees */
  feeCollectorAddress: string;
}

export interface AllowanceCheck {
  /** Available allowance remaining (approved - used - fees) */
  available: bigint;
  /** Total amount required for the trade (trade + fee) */
  required: bigint;
  /** Fee amount that will be deducted (1%) */
  fee: bigint;
  /** Whether allowance is sufficient */
  sufficient: boolean;
}

/** Default fee configuration */
export const FEE_CONFIG: FeeConfig = {
  percentage: 1,
  feeCollectorAddress: process.env.PLATFORM_FEE_COLLECTOR || process.env.CHAIN_TREASURY_ADDRESS || '',
};

/** Calculate platform fee from trade amount (1%) */
export function calculateFee(amount: bigint): bigint {
  return (amount * BigInt(FEE_CONFIG.percentage)) / BigInt(100);
}

/** Calculate net amount after fee deduction */
export function calculateNetAmount(grossAmount: bigint): bigint {
  return grossAmount - calculateFee(grossAmount);
}
