import type { TxReceipt } from './types';

/**
 * Fee service — currently disabled (no platform fee).
 * All functions are no-ops that allow operations to proceed without fees.
 */

async function canCollectFee(_chainId: number, _additionalAmount?: string): Promise<boolean> {
  return true;
}

async function collectFee(_chainId: number): Promise<TxReceipt> {
  return { hash: '', status: 'skipped' } as unknown as TxReceipt;
}

function deductFeeFromAmount(grossAmount: number): number {
  return grossAmount;
}

export const FeeService = {
  canCollectFee,
  collectFee,
  deductFeeFromAmount,
} as const;
