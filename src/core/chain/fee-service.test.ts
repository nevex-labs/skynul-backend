import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../stores/secret-store', () => ({
  getSecret: vi.fn(),
  setSecret: vi.fn(),
}));

vi.mock('./evm-wallet', () => ({
  EvmWallet: {
    load: vi.fn(),
  },
}));

import { FeeService, FEE_USDC } from './fee-service';
import * as secretStore from '../stores/secret-store';
import { EvmWallet } from './evm-wallet';

const TREASURY = '0xTreasury0000000000000000000000000000000';

function mockWallet(usdcBalance: string, sendTokenResult = { hash: '0xfee123', status: 'success' as const, blockNumber: 10 }) {
  return {
    getUsdcBalance: vi.fn().mockResolvedValue({
      symbol: 'USDC',
      address: '0xusdc',
      balance: usdcBalance,
      balanceRaw: '0',
      decimals: 6,
    }),
    sendToken: vi.fn().mockResolvedValue(sendTokenResult),
  };
}

describe('FeeService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('FEE_USDC constant', () => {
    it('is 0.40', () => {
      expect(FEE_USDC).toBe('0.40');
    });
  });

  describe('deductFeeFromAmount()', () => {
    it('deducts 0.40 from gross amount', () => {
      expect(FeeService.deductFeeFromAmount(10)).toBeCloseTo(9.6);
    });

    it('returns 0 when amount equals fee', () => {
      expect(FeeService.deductFeeFromAmount(0.40)).toBeCloseTo(0);
    });

    it('returns 0 when amount is less than fee', () => {
      expect(FeeService.deductFeeFromAmount(0.1)).toBe(0);
    });

    it('handles large amounts correctly', () => {
      expect(FeeService.deductFeeFromAmount(1000)).toBeCloseTo(999.6);
    });
  });

  describe('getTreasuryAddress()', () => {
    it('returns address from secret store', async () => {
      vi.mocked(secretStore.getSecret).mockResolvedValue(TREASURY);
      const addr = await FeeService.getTreasuryAddress();
      expect(addr).toBe(TREASURY);
    });

    it('falls back to env variable', async () => {
      vi.mocked(secretStore.getSecret).mockResolvedValue(null);
      process.env.CHAIN_TREASURY_ADDRESS = TREASURY;
      const addr = await FeeService.getTreasuryAddress();
      expect(addr).toBe(TREASURY);
      delete process.env.CHAIN_TREASURY_ADDRESS;
    });

    it('throws when not configured', async () => {
      vi.mocked(secretStore.getSecret).mockResolvedValue(null);
      delete process.env.CHAIN_TREASURY_ADDRESS;
      await expect(FeeService.getTreasuryAddress()).rejects.toThrow('CHAIN_TREASURY_ADDRESS');
    });
  });

  describe('canCollectFee()', () => {
    it('returns true when balance >= 0.40', async () => {
      vi.mocked(EvmWallet.load).mockResolvedValue(mockWallet('1.00') as any);
      const can = await FeeService.canCollectFee(84532);
      expect(can).toBe(true);
    });

    it('returns true when balance exactly 0.40', async () => {
      vi.mocked(EvmWallet.load).mockResolvedValue(mockWallet('0.40') as any);
      const can = await FeeService.canCollectFee(84532);
      expect(can).toBe(true);
    });

    it('returns false when balance < 0.40', async () => {
      vi.mocked(EvmWallet.load).mockResolvedValue(mockWallet('0.10') as any);
      const can = await FeeService.canCollectFee(84532);
      expect(can).toBe(false);
    });

    it('returns false when no wallet configured', async () => {
      vi.mocked(EvmWallet.load).mockResolvedValue(null);
      const can = await FeeService.canCollectFee(84532);
      expect(can).toBe(false);
    });

    it('accounts for additionalAmount when checking', async () => {
      vi.mocked(EvmWallet.load).mockResolvedValue(mockWallet('10.00') as any);
      // fee (0.40) + additional (9.70) = 10.10 > 10.00
      const can = await FeeService.canCollectFee(84532, '9.70');
      expect(can).toBe(false);
    });
  });

  describe('collectFee()', () => {
    it('sends 0.40 USDC to treasury', async () => {
      vi.mocked(secretStore.getSecret).mockResolvedValue(TREASURY);
      const wallet = mockWallet('5.00');
      vi.mocked(EvmWallet.load).mockResolvedValue(wallet as any);

      const receipt = await FeeService.collectFee(84532);

      expect(receipt.hash).toBe('0xfee123');
      expect(receipt.status).toBe('success');
      expect(wallet.sendToken).toHaveBeenCalledWith(
        84532,                         // chainId (number)
        expect.stringMatching(/^0x/), // usdcAddress from chain config
        TREASURY,
        FEE_USDC
      );
    });

    it('throws when no wallet configured', async () => {
      vi.mocked(EvmWallet.load).mockResolvedValue(null);
      await expect(FeeService.collectFee(84532)).rejects.toThrow('No wallet configured');
    });

    it('throws when insufficient balance', async () => {
      vi.mocked(secretStore.getSecret).mockResolvedValue(TREASURY);
      vi.mocked(EvmWallet.load).mockResolvedValue(mockWallet('0.10') as any);
      await expect(FeeService.collectFee(84532)).rejects.toThrow('Insufficient USDC');
    });

    it('throws for unknown chainId', async () => {
      vi.mocked(EvmWallet.load).mockResolvedValue(mockWallet('5.00') as any);
      await expect(FeeService.collectFee(99999)).rejects.toThrow('Unknown chainId');
    });
  });
});
