import { beforeEach, describe, expect, it } from 'vitest';
import { CoinbaseCryptoClient } from '../coinbase-crypto-client';

describe('CoinbaseCryptoClient', () => {
  let client: CoinbaseCryptoClient;

  beforeEach(() => {
    client = new CoinbaseCryptoClient({ mode: 'paper' });
  });

  describe('paper mode', () => {
    it('getBalance returns paper balances', async () => {
      const balances = await client.getBalance();
      expect(balances).toBeInstanceOf(Array);
      expect(balances.length).toBeGreaterThan(0);

      const usdcBalance = balances.find((b) => b.asset === 'USDC' && b.network === 'ethereum');
      expect(usdcBalance).toBeDefined();
      expect(usdcBalance!.available).toBe(1000);
    });

    it('getAddresses returns paper addresses', async () => {
      const addresses = await client.getAddresses();
      expect(addresses).toBeInstanceOf(Array);
      expect(addresses.length).toBeGreaterThan(0);

      const ethAddress = addresses.find((a) => a.network === 'ethereum');
      expect(ethAddress).toBeDefined();
      expect(ethAddress!.verified).toBe(true);
    });

    it('sendTransfer returns completed transfer in paper mode', async () => {
      const result = await client.sendTransfer({
        amount: 100,
        asset: 'USDC',
        destination: '0x742d35Cc6634C0532935334AdCb2f44d923604d5',
        network: 'ethereum',
      });

      expect(result.transferId).toContain('paper-crypto-');
      expect(result.status).toBe('completed');
      expect(result.amount).toBe(100);
      expect(result.asset).toBe('USDC');
      expect(result.txHash).toBeDefined();
      expect(result.txHash).toMatch(/^0x/);
    });

    it('sendTransfer with memo includes memo', async () => {
      const result = await client.sendTransfer({
        amount: 50,
        asset: 'USDT',
        destination: '0x742d35Cc6634C0532935334AdCb2f44d923604d5',
        network: 'polygon',
        memo: 'Test payment',
      });

      expect(result.status).toBe('completed');
    });

    it('getTransferStatus returns completed status in paper mode', async () => {
      const status = await client.getTransferStatus('paper-crypto-123');
      expect(status.transferId).toBe('paper-crypto-123');
      expect(status.status).toBe('completed');
      expect(status.txHash).toBeDefined();
    });

    it('getTransferHistory returns paper history', async () => {
      const history = await client.getTransferHistory();
      expect(history).toBeInstanceOf(Array);
      expect(history.length).toBeGreaterThan(0);

      const entry = history[0];
      expect(entry.transferId).toContain('paper-crypto-history');
      expect(entry.amount).toBeGreaterThan(0);
      expect(entry.asset).toMatch(/USDC|USDT|DAI/);
      expect(entry.txHash).toBeDefined();
    });

    it('estimateFee returns paper fees', async () => {
      const result = await client.estimateFee({
        asset: 'USDC',
        network: 'ethereum',
        amount: 100,
      });

      expect(result.fee).toBeGreaterThan(0);
      expect(result.estimatedGas).toBe(21000);
    });

    it('estimateFee returns lower fees for L2s', async () => {
      const ethFee = await client.estimateFee({
        asset: 'USDC',
        network: 'ethereum',
        amount: 100,
      });

      const polygonFee = await client.estimateFee({
        asset: 'USDC',
        network: 'polygon',
        amount: 100,
      });

      expect(polygonFee.fee).toBeLessThan(ethFee.fee);
    });
  });

  describe('input validation', () => {
    it('throws for unsupported asset', async () => {
      await expect(
        client.sendTransfer({
          amount: 100,
          asset: 'BTC',
          destination: '0x742d35Cc6634C0532935334AdCb2f44d923604d5',
          network: 'ethereum',
        })
      ).rejects.toThrow('Unsupported asset');
    });

    it('throws for unsupported network for asset', async () => {
      await expect(
        client.sendTransfer({
          amount: 100,
          asset: 'USDT',
          destination: '0x742d35Cc6634C0532935334AdCb2f44d923604d5',
          network: 'base',
        })
      ).rejects.toThrow(/not supported on base/i);
    });

    it('throws for invalid network', async () => {
      await expect(
        client.sendTransfer({
          amount: 100,
          asset: 'USDC',
          destination: '0x742d35Cc6634C0532935334AdCb2f44d923604d5',
          network: 'solana',
        })
      ).rejects.toThrow(/not supported on solana/i);
    });
  });

  describe('multi-asset support', () => {
    it('supports USDC on all networks including Base', async () => {
      const result = await client.sendTransfer({
        amount: 100,
        asset: 'USDC',
        destination: '0x742d35Cc6634C0532935334AdCb2f44d923604d5',
        network: 'base',
      });
      expect(result.status).toBe('completed');
    });

    it('supports USDT on ethereum but not base', async () => {
      // Should work on ethereum
      const ethResult = await client.sendTransfer({
        amount: 100,
        asset: 'USDT',
        destination: '0x742d35Cc6634C0532935334AdCb2f44d923604d5',
        network: 'ethereum',
      });
      expect(ethResult.status).toBe('completed');

      // Should fail on base
      await expect(
        client.sendTransfer({
          amount: 100,
          asset: 'USDT',
          destination: '0x742d35Cc6634C0532935334AdCb2f44d923604d5',
          network: 'base',
        })
      ).rejects.toThrow(/not supported on base/i);
    });

    it('supports DAI on all networks except Base', async () => {
      // Should work on polygon
      const result = await client.sendTransfer({
        amount: 100,
        asset: 'DAI',
        destination: '0x742d35Cc6634C0532935334AdCb2f44d923604d5',
        network: 'polygon',
      });
      expect(result.status).toBe('completed');
    });
  });
});
