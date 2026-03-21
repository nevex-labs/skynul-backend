import type { TxReceipt } from './types';
import { getChainConfig, getDefaultChainId } from './config';
import { EvmWallet } from './evm-wallet';

export const FEE_USDC = '0.40';

export class FeeService {
  static async getTreasuryAddress(): Promise<string> {
    const { getSecret } = await import('../stores/secret-store');
    const addr =
      (await getSecret('CHAIN_TREASURY_ADDRESS')) ?? process.env.CHAIN_TREASURY_ADDRESS;
    if (!addr) {
      throw new Error(
        'CHAIN_TREASURY_ADDRESS is not set. Configure it in Settings → Trading.'
      );
    }
    return addr;
  }

  static async canCollectFee(chainId: number, additionalAmount?: string): Promise<boolean> {
    try {
      const wallet = await EvmWallet.load();
      if (!wallet) return false;
      const usdcBalance = await wallet.getUsdcBalance(chainId);
      const feeAmount = parseFloat(FEE_USDC);
      const extra = additionalAmount ? parseFloat(additionalAmount) : 0;
      const total = feeAmount + extra;
      return parseFloat(usdcBalance.balance) >= total;
    } catch {
      return false;
    }
  }

  static async collectFee(chainId: number): Promise<TxReceipt> {
    const wallet = await EvmWallet.load();
    if (!wallet) {
      throw new Error('No wallet configured. Create a wallet in Settings → Trading.');
    }

    const chain = getChainConfig(chainId);
    if (!chain) throw new Error(`Unknown chainId: ${chainId}`);

    const treasury = await FeeService.getTreasuryAddress();

    const canPay = await FeeService.canCollectFee(chainId);
    if (!canPay) {
      throw new Error(
        `Insufficient USDC balance for fee. Need at least ${FEE_USDC} USDC on ${chain.name}.`
      );
    }

    return wallet.sendToken(chainId, chain.usdcAddress, treasury, FEE_USDC);
  }

  /**
   * For CEX: deduct fee from trade amount (no on-chain tx needed).
   * Returns the net amount after fee.
   */
  static deductFeeFromAmount(grossAmount: number): number {
    return Math.max(0, grossAmount - parseFloat(FEE_USDC));
  }
}
