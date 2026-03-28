import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RipioOffRamp } from '../ripio-off-ramp';

describe('RipioOffRamp', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(global, 'fetch');
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  describe('paper mode', () => {
    it('should return mock balances', async () => {
      const client = new RipioOffRamp({ mode: 'paper' });
      const balances = await client.getBalance();
      expect(balances.length).toBeGreaterThan(0);
      expect(balances[0]).toHaveProperty('asset');
      expect(balances[0]).toHaveProperty('network');
      expect(balances[0]).toHaveProperty('available');
      expect(balances[0]).toHaveProperty('total');
    });

    it('should return mock addresses', async () => {
      const client = new RipioOffRamp({ mode: 'paper' });
      const addresses = await client.getAddresses();
      expect(addresses.length).toBeGreaterThan(0);
      expect(addresses[0].verified).toBe(true);
    });

    it('should return pending transfer result for bank transfer', async () => {
      const client = new RipioOffRamp({ mode: 'paper' });
      const result = await client.sendTransfer({
        amount: 100,
        asset: 'USDT',
        destination: '1234567890123456789012', // CBU
        network: 'ethereum',
      });
      expect(result.status).toBe('pending');
      expect(result.transferId).toContain('paper-ripio');
      expect(result.amount).toBe(100);
      expect(result.asset).toBe('USDT');
      expect(result.network).toBe('ethereum');
    });

    it('should return pending transfer result for Mercado Pago alias', async () => {
      const client = new RipioOffRamp({ mode: 'paper' });
      const result = await client.sendTransfer({
        amount: 50,
        asset: 'USDC',
        destination: 'juan.mercadopago', // Alias containing "mercadopago"
        network: 'polygon',
      });
      expect(result.status).toBe('pending');
      expect(result.transferId).toContain('paper-ripio');
      expect(result.amount).toBe(50);
      expect(result.asset).toBe('USDC');
      expect(result.network).toBe('polygon');
    });

    it('should return transfer status (mock)', async () => {
      const client = new RipioOffRamp({ mode: 'paper' });
      const status = await client.getTransferStatus('test-id');
      expect(status.transferId).toBe('test-id');
      expect(['pending', 'completed']).toContain(status.status);
    });

    it('should return transfer history (mock)', async () => {
      const client = new RipioOffRamp({ mode: 'paper' });
      const history = await client.getTransferHistory(5);
      expect(history.length).toBeLessThanOrEqual(5);
      if (history.length > 0) {
        expect(history[0]).toHaveProperty('transferId');
        expect(history[0]).toHaveProperty('amount');
        expect(history[0]).toHaveProperty('asset');
      }
    });

    it('should estimate fees', async () => {
      const client = new RipioOffRamp({ mode: 'paper' });
      const fee = await client.estimateFee({
        asset: 'USDT',
        network: 'ethereum',
        amount: 100,
      });
      expect(fee.fee).toBeGreaterThan(0);
    });

    it('should generate payment instructions', async () => {
      const client = new RipioOffRamp({ mode: 'paper' });
      const result = await client.sendTransfer({
        amount: 100,
        asset: 'USDT',
        destination: '1234567890123456789012',
        network: 'ethereum',
      });
      const instructions = client.getPaymentInstructions(result.transferId);
      expect(instructions).toContain('RIPIO');
      expect(instructions).toContain(result.transferId);
    });
  });

  describe('live mode', () => {
    it('should return empty balances (not implemented)', async () => {
      const client = new RipioOffRamp({ mode: 'live' });
      // Mock credentials to avoid error
      vi.spyOn(client as any, 'getCredentials').mockResolvedValue({
        clientId: 'test',
        clientSecret: 'test',
      });
      const balances = await client.getBalance();
      expect(balances).toEqual([]);
    });

    it('should create off-ramp session for bank transfer', async () => {
      const client = new RipioOffRamp({ mode: 'live' });
      vi.spyOn(client as any, 'getCredentials').mockResolvedValue({
        clientId: 'test',
        clientSecret: 'test',
      });

      // Mock OAuth2 token response
      fetchSpy.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          accessToken: 'mock-token',
          expiresIn: 36000,
          tokenType: 'Bearer',
        }),
      } as Response);

      // Mock customer creation
      fetchSpy.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          customerId: 'test-customer-id',
          email: 'test@example.com',
          createdAt: new Date().toISOString(),
        }),
      } as Response);

      // Mock fiat account creation
      fetchSpy.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          fiatAccountId: 'test-fiat-account-id',
          fiatAccountFields: { alias_or_cvu_destination: '1234567890123456789012' },
          createdAt: new Date().toISOString(),
          status: 'ENABLED',
          paymentMethodType: 'bank_transfer',
          customerId: 'test-customer-id',
        }),
      } as Response);

      // Mock off-ramp session creation
      fetchSpy.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          sessionId: 'test-session-id',
          customerId: 'test-customer-id',
          createdAt: new Date().toISOString(),
          toCurrency: 'ARS',
          paymentMethodType: 'bank_transfer',
          fiatAccountId: 'test-fiat-account-id',
          depositAddresses: [
            { chain: 'ETHEREUM', address: '0x742d35Cc6634C0532935334AdCb2f44d923604d5' },
            { chain: 'POLYGON', address: '0x742d35Cc6634C0532935334AdCb2f44d923604d5' },
          ],
          transactions: [],
        }),
      } as Response);

      const result = await client.sendTransfer({
        amount: 100,
        asset: 'USDT',
        destination: '1234567890123456789012', // CBU
        network: 'ethereum',
      });

      expect(result.status).toBe('pending');
      expect(result.transferId).toContain('ripio-session');
      expect(result.destination).toBe('0x742d35Cc6634C0532935334AdCb2f44d923604d5');
    });

    it('should throw error for sendTransfer with invalid destination', async () => {
      const client = new RipioOffRamp({ mode: 'live' });
      // Mock getCredentials to avoid env var dependency
      vi.spyOn(client as any, 'getCredentials').mockResolvedValue({
        clientId: 'test',
        clientSecret: 'test',
      });
      // Mock OAuth2 token response
      fetchSpy.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          accessToken: 'mock-token',
          expiresIn: 36000,
          tokenType: 'Bearer',
        }),
      } as Response);
      await expect(
        client.sendTransfer({
          amount: 100,
          asset: 'USDT',
          destination: 'ab', // Too short for alias, not numeric
          network: 'ethereum',
        })
      ).rejects.toThrow('Invalid destination');
    });
  });

  describe('error handling', () => {
    it('should throw error for unsupported asset', async () => {
      const client = new RipioOffRamp({ mode: 'paper' });
      await expect(
        client.sendTransfer({
          amount: 100,
          asset: 'BTC',
          destination: '1234567890123456789012',
          network: 'ethereum',
        })
      ).rejects.toThrow('Unsupported asset');
    });

    it('should throw error for unsupported network', async () => {
      const client = new RipioOffRamp({ mode: 'paper' });
      await expect(
        client.sendTransfer({
          amount: 100,
          asset: 'USDT',
          destination: '1234567890123456789012',
          network: 'solana',
        })
      ).rejects.toThrow('not supported on');
    });

    it('should throw error for missing credentials in live mode', async () => {
      const client = new RipioOffRamp({ mode: 'live' });
      // Clear env vars
      const originalId = process.env.RIPIO_CLIENT_ID;
      const originalSecret = process.env.RIPIO_CLIENT_SECRET;
      process.env.RIPIO_CLIENT_ID = undefined;
      process.env.RIPIO_CLIENT_SECRET = undefined;

      // Mock getCredentials to throw error
      vi.spyOn(client as any, 'getCredentials').mockRejectedValue(
        new Error('RIPIO_CLIENT_ID and RIPIO_CLIENT_SECRET are not set. Configure them in Settings → Trading.')
      );

      await expect(
        client.sendTransfer({
          amount: 100,
          asset: 'USDT',
          destination: '1234567890123456789012',
          network: 'ethereum',
        })
      ).rejects.toThrow('RIPIO_CLIENT_ID and RIPIO_CLIENT_SECRET are not set');

      // Restore env vars
      if (originalId) process.env.RIPIO_CLIENT_ID = originalId;
      if (originalSecret) process.env.RIPIO_CLIENT_SECRET = originalSecret;
    });
  });
});
