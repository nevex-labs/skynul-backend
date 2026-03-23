import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../stores/secret-store', () => ({
  getSecret: vi.fn(),
  setSecret: vi.fn(),
}));

vi.mock('ethers', () => {
  const MOCK_ADDRESS = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';
  const MOCK_PK = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';

  class MockProvider {
    getBalance = vi.fn().mockResolvedValue(BigInt('1000000000000000000'));
    getTransactionReceipt = vi.fn().mockResolvedValue({ status: 1, blockNumber: 42 });
  }

  class MockWallet {
    address = MOCK_ADDRESS;
    privateKey: string;
    constructor(pk: string, _provider?: unknown) {
      this.privateKey = pk;
    }
    static createRandom() {
      return new MockWallet(MOCK_PK);
    }
    sendTransaction = vi.fn().mockResolvedValue({
      hash: '0xabc123',
      wait: vi.fn().mockResolvedValue({ status: 1, blockNumber: 100 }),
    });
  }

  class MockContract {
    balanceOf = vi.fn().mockResolvedValue(BigInt('5000000'));
    decimals = vi.fn().mockResolvedValue(6);
    symbol = vi.fn().mockResolvedValue('USDC');
    transfer = vi.fn().mockResolvedValue({
      hash: '0xtransfer123',
      wait: vi.fn().mockResolvedValue({ status: 1, blockNumber: 55 }),
    });
    approve = vi.fn().mockResolvedValue({ wait: vi.fn().mockResolvedValue(undefined) });
  }

  return {
    Wallet: MockWallet,
    JsonRpcProvider: MockProvider,
    Contract: MockContract,
    formatUnits: vi.fn().mockImplementation((val: bigint, dec: number) => (Number(val) / 10 ** dec).toFixed(dec)),
    parseEther: vi.fn().mockReturnValue(BigInt('1000000000000000000')),
    parseUnits: vi.fn().mockReturnValue(BigInt('1000000')),
    MaxUint256: BigInt('0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff'),
  };
});

import * as secretStore from '../stores/secret-store';
import { EvmWallet } from './evm-wallet';

const TEST_PK = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
const TEST_ADDRESS = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';

describe('EvmWallet', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('create()', () => {
    it('generates a new wallet and stores the private key', async () => {
      vi.mocked(secretStore.setSecret).mockResolvedValue(undefined);

      const result = await EvmWallet.create();

      expect(result.address).toBe(TEST_ADDRESS);
      expect(secretStore.setSecret).toHaveBeenCalledWith('CHAIN_WALLET_PRIVATE_KEY', expect.stringMatching(/^0x/));
    });
  });

  describe('exists()', () => {
    it('returns true when private key is stored', async () => {
      vi.mocked(secretStore.getSecret).mockResolvedValue(TEST_PK);
      expect(await EvmWallet.exists()).toBe(true);
    });

    it('returns false when no private key stored', async () => {
      vi.mocked(secretStore.getSecret).mockResolvedValue(null);
      expect(await EvmWallet.exists()).toBe(false);
    });
  });

  describe('load()', () => {
    it('returns EvmWallet instance when key exists', async () => {
      vi.mocked(secretStore.getSecret).mockResolvedValue(TEST_PK);
      const wallet = await EvmWallet.load();
      expect(wallet).not.toBeNull();
    });

    it('returns null when no key stored', async () => {
      vi.mocked(secretStore.getSecret).mockResolvedValue(null);
      const wallet = await EvmWallet.load();
      expect(wallet).toBeNull();
    });
  });

  describe('getAddress()', () => {
    it('derives address from private key', async () => {
      vi.mocked(secretStore.getSecret).mockResolvedValue(TEST_PK);
      const wallet = await EvmWallet.load();
      expect(wallet!.getAddress()).toBe(TEST_ADDRESS);
    });
  });

  describe('getUsdcBalance()', () => {
    it('returns USDC balance for Base Sepolia', async () => {
      vi.mocked(secretStore.getSecret).mockResolvedValue(TEST_PK);
      const wallet = await EvmWallet.load();
      const balance = await wallet!.getUsdcBalance(84532);

      expect(balance.symbol).toBe('USDC');
      expect(balance.decimals).toBe(6);
      expect(balance.address).toMatch(/^0x/);
      expect(typeof balance.balance).toBe('string');
    });
  });

  describe('getNativeBalance()', () => {
    it('returns ETH balance', async () => {
      vi.mocked(secretStore.getSecret).mockResolvedValue(TEST_PK);
      const wallet = await EvmWallet.load();
      const balance = await wallet!.getNativeBalance(84532);

      expect(balance.symbol).toBe('ETH');
      expect(balance.decimals).toBe(18);
      expect(typeof balance.balance).toBe('string');
    });
  });

  describe('getTxStatus()', () => {
    it('returns success for confirmed tx', async () => {
      vi.mocked(secretStore.getSecret).mockResolvedValue(TEST_PK);
      const wallet = await EvmWallet.load();
      const receipt = await wallet!.getTxStatus(84532, '0xabc123');

      expect(receipt.hash).toBe('0xabc123');
      expect(receipt.status).toBe('success');
      expect(receipt.blockNumber).toBe(42);
    });
  });

  describe('throws on unknown chainId', () => {
    it('getNativeBalance throws for unknown chain', async () => {
      vi.mocked(secretStore.getSecret).mockResolvedValue(TEST_PK);
      const wallet = await EvmWallet.load();
      await expect(wallet!.getNativeBalance(99999)).rejects.toThrow('Unknown chainId');
    });

    it('getUsdcBalance throws for unknown chain', async () => {
      vi.mocked(secretStore.getSecret).mockResolvedValue(TEST_PK);
      const wallet = await EvmWallet.load();
      await expect(wallet!.getUsdcBalance(99999)).rejects.toThrow('Unknown chainId');
    });
  });
});
