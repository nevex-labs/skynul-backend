import { describe, it, expect } from 'vitest';
import { getAllChains, getChainConfig, getDefaultChainId } from './config';

describe('chain config', () => {
  it('getDefaultChainId returns Base Sepolia', () => {
    expect(getDefaultChainId()).toBe(84532);
  });

  it('getChainConfig(84532) returns Base Sepolia config', () => {
    const chain = getChainConfig(84532);
    expect(chain).toBeDefined();
    expect(chain!.name).toBe('Base Sepolia');
    expect(chain!.testnet).toBe(true);
    expect(chain!.nativeCurrency.symbol).toBe('ETH');
    expect(chain!.usdcDecimals).toBe(6);
    expect(chain!.usdcAddress).toMatch(/^0x/);
  });

  it('getChainConfig(8453) returns Base Mainnet config', () => {
    const chain = getChainConfig(8453);
    expect(chain).toBeDefined();
    expect(chain!.name).toBe('Base');
    expect(chain!.testnet).toBe(false);
    expect(chain!.dexRouterAddress).toMatch(/^0x/);
  });

  it('getChainConfig(42161) returns Arbitrum One config', () => {
    const chain = getChainConfig(42161);
    expect(chain).toBeDefined();
    expect(chain!.name).toBe('Arbitrum One');
    expect(chain!.testnet).toBe(false);
  });

  it('getChainConfig with unknown chainId returns undefined', () => {
    expect(getChainConfig(99999)).toBeUndefined();
  });

  it('getAllChains returns all registered chains', () => {
    const chains = getAllChains();
    expect(chains.length).toBeGreaterThanOrEqual(3);
    const ids = chains.map((c) => c.chainId);
    expect(ids).toContain(84532);
    expect(ids).toContain(8453);
    expect(ids).toContain(42161);
  });

  it('every chain config has required fields', () => {
    for (const chain of getAllChains()) {
      expect(chain.chainId).toBeTypeOf('number');
      expect(chain.name).toBeTypeOf('string');
      expect(chain.rpcUrl).toMatch(/^https?:\/\//);
      expect(chain.explorerUrl).toMatch(/^https?:\/\//);
      expect(chain.usdcAddress).toMatch(/^0x[0-9a-fA-F]{40}$/);
      expect(chain.usdcDecimals).toBe(6);
      expect(chain.nativeCurrency.decimals).toBe(18);
    }
  });
});
