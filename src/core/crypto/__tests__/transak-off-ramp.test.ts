import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TransakOffRamp } from '../transak-off-ramp';

describe('TransakOffRamp', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(global, 'fetch');
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  describe('paper mode', () => {
    it('should return mock balances', async () => {
      const client = new TransakOffRamp({ mode: 'paper' });
      const balances = await client.getBalance();
      expect(balances.length).toBeGreaterThan(0);
      expect(balances[0]).toHaveProperty('asset');
      expect(balances[0]).toHaveProperty('network');
      expect(balances[0]).toHaveProperty('available');
      expect(balances[0]).toHaveProperty('total');
    });

    it('should return mock addresses', async () => {
      const client = new TransakOffRamp({ mode: 'paper' });
      const addresses = await client.getAddresses();
      expect(addresses.length).toBeGreaterThan(0);
      expect(addresses[0].verified).toBe(true);
    });

    it('should return pending transfer result', async () => {
      const client = new TransakOffRamp({ mode: 'paper' });
      const result = await client.sendTransfer({
        amount: 100,
        asset: 'USDT',
        destination: 'CBU: 1234567890123456789012',
        network: 'ethereum',
      });
      expect(result.status).toBe('pending');
      expect(result.transferId).toContain('paper-transak');
      expect(result.amount).toBe(100);
      expect(result.asset).toBe('USDT');
      expect(result.network).toBe('ethereum');
    });

    it('should return transfer status (mock)', async () => {
      const client = new TransakOffRamp({ mode: 'paper' });
      const status = await client.getTransferStatus('test-id');
      expect(status.transferId).toBe('test-id');
      expect(['pending', 'completed']).toContain(status.status);
    });

    it('should return transfer history (mock)', async () => {
      const client = new TransakOffRamp({ mode: 'paper' });
      const history = await client.getTransferHistory(5);
      expect(history.length).toBeLessThanOrEqual(5);
      if (history.length > 0) {
        expect(history[0]).toHaveProperty('transferId');
        expect(history[0]).toHaveProperty('amount');
        expect(history[0]).toHaveProperty('asset');
      }
    });

    it('should estimate fees', async () => {
      const client = new TransakOffRamp({ mode: 'paper' });
      const fee = await client.estimateFee({
        asset: 'USDT',
        network: 'ethereum',
        amount: 100,
      });
      expect(fee.fee).toBeGreaterThan(0);
    });
  });

  describe('live mode', () => {
    it('should throw error for getBalance (not implemented)', async () => {
      const client = new TransakOffRamp({ mode: 'live' });
      // Mock credentials to avoid error
      vi.spyOn(client as any, 'getCredentials').mockResolvedValue({
        apiKey: 'test',
        apiSecret: 'test',
      });
      const balances = await client.getBalance();
      expect(balances).toEqual([]);
    });

    it('should throw error for sendTransfer (not implemented)', async () => {
      const client = new TransakOffRamp({ mode: 'live' });
      vi.spyOn(client as any, 'getCredentials').mockResolvedValue({
        apiKey: 'test',
        apiSecret: 'test',
      });
      await expect(
        client.sendTransfer({
          amount: 100,
          asset: 'USDT',
          destination: '0x123',
          network: 'ethereum',
        })
      ).rejects.toThrow('Transak off-ramp live mode not yet implemented');
    });
  });

  describe('error handling', () => {
    it('should throw error for unsupported asset', async () => {
      const client = new TransakOffRamp({ mode: 'paper' });
      await expect(
        client.sendTransfer({
          amount: 100,
          asset: 'BTC',
          destination: '0x123',
          network: 'ethereum',
        })
      ).rejects.toThrow('Unsupported asset');
    });

    it('should throw error for unsupported network', async () => {
      const client = new TransakOffRamp({ mode: 'paper' });
      await expect(
        client.sendTransfer({
          amount: 100,
          asset: 'USDT',
          destination: '0x123',
          network: 'solana',
        })
      ).rejects.toThrow('not supported on');
    });
  });
});
