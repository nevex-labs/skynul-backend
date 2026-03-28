import { describe, expect, it } from 'vitest';
import {
  STABLECOIN_NETWORK_SUPPORT,
  getSupportedNetworks,
  isNetworkSupported,
  isStablecoinAsset,
  isValidEthereumAddress,
  validateCryptoTransfer,
} from '../types';

describe('CryptoProvider Types', () => {
  describe('isValidEthereumAddress', () => {
    it('returns true for valid addresses', () => {
      expect(isValidEthereumAddress('0x742d35Cc6634C0532935334AdCb2f44d923604d5')).toBe(true);
      expect(isValidEthereumAddress('0x0000000000000000000000000000000000000000')).toBe(true);
      expect(isValidEthereumAddress('0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF')).toBe(true);
    });

    it('returns false for invalid addresses', () => {
      expect(isValidEthereumAddress('0x123')).toBe(false);
      expect(isValidEthereumAddress('0xGGG')).toBe(false);
      expect(isValidEthereumAddress('')).toBe(false);
      expect(isValidEthereumAddress('0x742d35Cc6634C0532935334AdCb2f44d923604d5X')).toBe(false); // 41 chars
      expect(isValidEthereumAddress('742d35Cc6634C0532935334AdCb2f44d923604d5')).toBe(false); // no 0x prefix
    });
  });

  describe('isStablecoinAsset', () => {
    it('returns true for supported stablecoins (case-insensitive)', () => {
      expect(isStablecoinAsset('USDT')).toBe(true);
      expect(isStablecoinAsset('usdt')).toBe(true);
      expect(isStablecoinAsset('USDC')).toBe(true);
      expect(isStablecoinAsset('usdc')).toBe(true);
      expect(isStablecoinAsset('DAI')).toBe(true);
      expect(isStablecoinAsset('dai')).toBe(true);
    });

    it('returns false for other assets', () => {
      expect(isStablecoinAsset('BTC')).toBe(false);
      expect(isStablecoinAsset('ETH')).toBe(false);
      expect(isStablecoinAsset('SOL')).toBe(false);
      expect(isStablecoinAsset('')).toBe(false);
    });
  });

  describe('getSupportedNetworks', () => {
    it('returns correct networks for USDC (includes Base)', () => {
      const networks = getSupportedNetworks('USDC');
      expect(networks).toContain('base');
      expect(networks).toContain('ethereum');
      expect(networks).toContain('polygon');
      expect(networks).toContain('arbitrum');
      expect(networks).toContain('optimism');
    });

    it('returns correct networks for USDT (excludes Base)', () => {
      const networks = getSupportedNetworks('USDT');
      expect(networks).not.toContain('base');
      expect(networks).toContain('ethereum');
      expect(networks).toContain('polygon');
      expect(networks).toContain('arbitrum');
      expect(networks).toContain('optimism');
    });

    it('returns correct networks for DAI (excludes Base)', () => {
      const networks = getSupportedNetworks('DAI');
      expect(networks).not.toContain('base');
      expect(networks).toContain('ethereum');
      expect(networks).toContain('polygon');
      expect(networks).toContain('arbitrum');
      expect(networks).toContain('optimism');
    });
  });

  describe('isNetworkSupported', () => {
    it('returns true when network supports the asset', () => {
      expect(isNetworkSupported('USDC', 'ethereum')).toBe(true);
      expect(isNetworkSupported('USDC', 'base')).toBe(true);
      expect(isNetworkSupported('USDT', 'polygon')).toBe(true);
    });

    it('returns false when network does not support the asset', () => {
      expect(isNetworkSupported('USDT', 'base')).toBe(false);
      expect(isNetworkSupported('DAI', 'base')).toBe(false);
    });

    it('is case-insensitive', () => {
      expect(isNetworkSupported('USDC', 'ethereum')).toBe(true);
      expect(isNetworkSupported('USDC', 'base')).toBe(true);
    });
  });

  describe('validateCryptoTransfer', () => {
    const validParams = {
      asset: 'USDC',
      amount: 100,
      destination: '0x742d35Cc6634C0532935334AdCb2f44d923604d5',
      network: 'ethereum',
      provider: 'coinbase' as const,
    };

    it('validates and normalizes a valid request', () => {
      const result = validateCryptoTransfer(validParams);
      expect(result.asset).toBe('USDC');
      expect(result.network).toBe('ethereum');
      expect(result.amount).toBe(100);
      expect(result.provider).toBe('coinbase');
    });

    it('normalizes asset to uppercase', () => {
      const result = validateCryptoTransfer({
        ...validParams,
        asset: 'usdc',
      });
      expect(result.asset).toBe('USDC');
    });

    it('normalizes network to lowercase', () => {
      const result = validateCryptoTransfer({
        ...validParams,
        network: 'ETHEREUM',
      });
      expect(result.network).toBe('ethereum');
    });

    it('accepts optional memo', () => {
      const result = validateCryptoTransfer({
        ...validParams,
        memo: 'Payment for services',
      });
      expect(result.memo).toBe('Payment for services');
    });

    it('throws for unsupported asset', () => {
      expect(() =>
        validateCryptoTransfer({
          ...validParams,
          asset: 'BTC',
        })
      ).toThrow();
    });

    it('throws for invalid amount', () => {
      expect(() =>
        validateCryptoTransfer({
          ...validParams,
          amount: -10,
        })
      ).toThrow('Amount must be positive');

      expect(() =>
        validateCryptoTransfer({
          ...validParams,
          amount: 0.5,
        })
      ).toThrow('Minimum amount is 1');

      expect(() =>
        validateCryptoTransfer({
          ...validParams,
          amount: 150000,
        })
      ).toThrow('Maximum amount is 100,000');
    });

    it('throws for invalid Ethereum address', () => {
      expect(() =>
        validateCryptoTransfer({
          ...validParams,
          destination: '0x123',
        })
      ).toThrow('Invalid Ethereum address');
    });

    it('throws for unsupported network for the asset', () => {
      expect(() =>
        validateCryptoTransfer({
          ...validParams,
          asset: 'USDT',
          network: 'base',
        })
      ).toThrow(/not supported on base/i);
    });

    it('accepts arbitrary destination for transak provider', () => {
      const result = validateCryptoTransfer({
        asset: 'USDT',
        amount: 100,
        destination: 'CBU: 1234567890123456789012',
        network: 'ethereum',
        provider: 'transak',
      });
      expect(result.destination).toBe('CBU: 1234567890123456789012');
      expect(result.provider).toBe('transak');
    });

    it('still validates Ethereum address for coinbase provider', () => {
      expect(() =>
        validateCryptoTransfer({
          asset: 'USDT',
          amount: 100,
          destination: 'invalid',
          network: 'ethereum',
          provider: 'coinbase',
        })
      ).toThrow('Invalid Ethereum address');
    });
  });

  describe('STABLECOIN_NETWORK_SUPPORT', () => {
    it('defines correct network support matrix', () => {
      expect(STABLECOIN_NETWORK_SUPPORT.USDC).toContain('base');
      expect(STABLECOIN_NETWORK_SUPPORT.USDT).not.toContain('base');
      expect(STABLECOIN_NETWORK_SUPPORT.DAI).not.toContain('base');
    });
  });
});
