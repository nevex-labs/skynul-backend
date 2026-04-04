import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock environment
const TEST_API_KEY = 'test-pimlico-key';

vi.mock('../config', () => ({
  getChainConfig: (chainId: number) => {
    if (chainId === 8453) {
      return {
        chainId: 8453,
        name: 'Base',
        rpcUrl: 'https://mainnet.base.org',
        bundlerUrl: 'https://api.pimlico.io/v2/8453/rpc?apikey=',
        paymasterUrl: 'https://api.pimlico.io/v2/8453/rpc?apikey=',
        entryPointAddress: '0x0000000071727De22E5E9d8BAf0edAc6f37da032',
        usdcAddress: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
        dexRouterAddress: '0x2626664c2603336E57B271c5C0b26F421741e481',
      };
    }
    return undefined;
  },
}));

describe('PimlicoBundler', () => {
  beforeEach(() => {
    process.env.PIMLICO_API_KEY = TEST_API_KEY;
    vi.resetModules();
  });

  describe('constructor', () => {
    it('throws if no bundler URL configured', async () => {
      const { PimlicoBundler } = await import('./pimlico-provider');
      expect(() => new PimlicoBundler(99999)).toThrow('No bundler URL configured for chain 99999');
    });

    it('throws if PIMLICO_API_KEY not set', async () => {
      const prevKey = process.env.PIMLICO_API_KEY;
      process.env.PIMLICO_API_KEY = '';
      vi.resetModules();
      const { PimlicoBundler } = await import('./pimlico-provider');
      expect(() => new PimlicoBundler(8453)).toThrow('PIMLICO_API_KEY environment variable is required');
      process.env.PIMLICO_API_KEY = prevKey;
    });

    it('creates bundler with valid config', async () => {
      const { PimlicoBundler } = await import('./pimlico-provider');
      const bundler = new PimlicoBundler(8453);
      expect(bundler.chainId).toBe(8453);
    });
  });

  describe('toPimlicoUserOp', () => {
    it('converts bigint fields to hex strings', async () => {
      const { PimlicoBundler } = await import('./pimlico-provider');
      const bundler = new PimlicoBundler(8453);

      // Access private method via any cast for testing
      const userOp = (bundler as any).toPimlicoUserOp({
        sender: '0xSender',
        nonce: BigInt(1),
        initCode: '0x',
        callData: '0x1234',
        callGasLimit: BigInt(100000),
        verificationGasLimit: BigInt(50000),
        preVerificationGas: BigInt(10000),
        maxFeePerGas: BigInt(1000000000),
        maxPriorityFeePerGas: BigInt(1000000000),
        paymasterAndData: '0x',
        signature: '0x',
      });

      expect(userOp.nonce).toBe('0x1');
      expect(userOp.callGasLimit).toBe('0x186a0');
      expect(userOp.sender).toBe('0xSender');
    });
  });
});

describe('PimlicoPaymaster', () => {
  beforeEach(() => {
    process.env.PIMLICO_API_KEY = TEST_API_KEY;
    vi.resetModules();
  });

  describe('isSupported', () => {
    it('returns true for USDC on Base', async () => {
      const { PimlicoPaymaster } = await import('./paymaster');
      const paymaster = new PimlicoPaymaster(8453);
      const result = await paymaster.isSupported('0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913');
      expect(result).toBe(true);
    });

    it('returns false for non-USDC token', async () => {
      const { PimlicoPaymaster } = await import('./paymaster');
      const paymaster = new PimlicoPaymaster(8453);
      const result = await paymaster.isSupported('0xOtherToken');
      expect(result).toBe(false);
    });
  });
});
