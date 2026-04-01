import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CoinbaseClient } from './coinbase-client';

vi.mock('../stores/secret-store', () => ({
  getSecret: vi.fn(),
}));

// Mock crypto to avoid needing a real EC private key in tests
vi.mock('crypto', async (importOriginal) => {
  const actual = await importOriginal<typeof import('crypto')>();
  return {
    ...actual,
    createSign: () => ({
      update: vi.fn(),
      sign: vi.fn().mockReturnValue('mock-ecdsa-sig'),
    }),
  };
});

const TEST_API_KEY = 'coinbase-test-key';
const TEST_API_SECRET = '-----BEGIN EC PRIVATE KEY-----\ntest\n-----END EC PRIVATE KEY-----';
const FIXED_NOW_SEC = 1700000000;

describe('CoinbaseClient', () => {
  let client: CoinbaseClient;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.spyOn(Date, 'now').mockReturnValue(FIXED_NOW_SEC * 1000);

    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const { getSecret } = await import('../stores/secret-store');
    vi.mocked(getSecret).mockImplementation(async (key: string) => {
      if (key === 'COINBASE_API_KEY') return TEST_API_KEY;
      if (key === 'COINBASE_API_SECRET') return TEST_API_SECRET;
      return null;
    });
  });

  describe('paper mode (default)', () => {
    beforeEach(() => {
      client = new CoinbaseClient();
    });

    it('getBalances() returns paper balances without calling fetch', async () => {
      const balances = await client.getBalances();
      expect(fetchMock).not.toHaveBeenCalled();
      expect(balances).toEqual([
        { asset: 'USD', free: 1000, locked: 0 },
        { asset: 'BTC', free: 0.01, locked: 0 },
      ]);
    });

    it('getPositions() returns empty array without calling fetch', async () => {
      const positions = await client.getPositions();
      expect(fetchMock).not.toHaveBeenCalled();
      expect(positions).toEqual([]);
    });

    it('placeOrder() returns paper order without calling fetch', async () => {
      const result = await client.placeOrder({ symbol: 'BTC-USD', side: 'buy', orderType: 'market', amount: 0.01 });
      expect(fetchMock).not.toHaveBeenCalled();
      expect(result.status).toBe('FILLED');
      expect(result.orderId).toMatch(/^paper-/);
    });

    it('cancelOrder() resolves without calling fetch', async () => {
      await expect(client.cancelOrder('order-123')).resolves.toBeUndefined();
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('withdraw() returns paper withdrawal id without calling fetch', async () => {
      const id = await client.withdraw('USD', 100, '0xabc', 'ethereum');
      expect(fetchMock).not.toHaveBeenCalled();
      expect(id).toMatch(/^paper-withdraw-/);
    });
  });

  describe('live mode', () => {
    beforeEach(() => {
      client = new CoinbaseClient({ mode: 'live' });
    });

    describe('JWT auth', () => {
      it('sends Bearer JWT in Authorization header', async () => {
        fetchMock.mockResolvedValue({
          ok: true,
          json: async () => ({ accounts: [] }),
        });

        await client.getBalances();

        const [, opts] = fetchMock.mock.calls[0];
        expect(opts.headers.Authorization).toMatch(/^Bearer /);
      });

      it('JWT header contains apiKey as kid', async () => {
        fetchMock.mockResolvedValue({ ok: true, json: async () => ({ accounts: [] }) });

        await client.getBalances();

        const [, opts] = fetchMock.mock.calls[0];
        const token = opts.headers.Authorization.replace('Bearer ', '');
        const [headerB64] = token.split('.');
        const header = JSON.parse(Buffer.from(headerB64, 'base64url').toString());
        expect(header.kid).toBe(TEST_API_KEY);
        expect(header.alg).toBe('ES256');
      });

      it('JWT payload contains correct issuer and expiry window', async () => {
        fetchMock.mockResolvedValue({ ok: true, json: async () => ({ accounts: [] }) });

        await client.getBalances();

        const [, opts] = fetchMock.mock.calls[0];
        const token = opts.headers.Authorization.replace('Bearer ', '');
        const [, payloadB64] = token.split('.');
        const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString());
        expect(payload.iss).toBe('coinbase-cloud');
        expect(payload.nbf).toBe(FIXED_NOW_SEC);
        expect(payload.exp).toBe(FIXED_NOW_SEC + 120);
        expect(payload.sub).toBe(TEST_API_KEY);
      });
    });

    describe('getBalances()', () => {
      it('parses accounts and filters zero balances', async () => {
        fetchMock.mockResolvedValue({
          ok: true,
          json: async () => ({
            accounts: [
              { currency: 'USD', available_balance: { value: '1500.0' }, hold: { value: '50.0' } },
              { currency: 'BTC', available_balance: { value: '0.5' }, hold: { value: '0.0' } },
              { currency: 'ETH', available_balance: { value: '0.0' }, hold: { value: '0.0' } },
            ],
          }),
        });

        const balances = await client.getBalances();

        expect(balances).toHaveLength(2);
        expect(balances[0]).toEqual({ asset: 'USD', free: 1500, locked: 50 });
        expect(balances[1]).toEqual({ asset: 'BTC', free: 0.5, locked: 0 });
      });

      it('returns empty array when accounts is empty', async () => {
        fetchMock.mockResolvedValue({ ok: true, json: async () => ({ accounts: [] }) });
        expect(await client.getBalances()).toEqual([]);
      });

      it('handles missing accounts key gracefully', async () => {
        fetchMock.mockResolvedValue({ ok: true, json: async () => ({}) });
        expect(await client.getBalances()).toEqual([]);
      });
    });

    describe('getPositions()', () => {
      it('maps open orders to positions', async () => {
        fetchMock.mockResolvedValue({
          ok: true,
          json: async () => ({
            orders: [
              {
                product_id: 'BTC-USD',
                side: 'BUY',
                base_size: '0.1',
                average_filled_price: '30000',
                limit_price: '29000',
              },
              {
                product_id: 'ETH-USD',
                side: 'SELL',
                base_size: '2.0',
                limit_price: '2000',
              },
            ],
          }),
        });

        const positions = await client.getPositions();

        expect(positions).toHaveLength(2);
        expect(positions[0]).toEqual({
          symbol: 'BTC-USD',
          side: 'long',
          size: 0.1,
          entryPrice: 30000,
          markPrice: 30000,
          unrealizedPnl: 0,
        });
        expect(positions[1]).toEqual({
          symbol: 'ETH-USD',
          side: 'short',
          size: 2.0,
          entryPrice: 2000,
          markPrice: 2000,
          unrealizedPnl: 0,
        });
      });

      it('falls back to limit_price when average_filled_price is missing', async () => {
        fetchMock.mockResolvedValue({
          ok: true,
          json: async () => ({
            orders: [{ product_id: 'SOL-USD', side: 'BUY', base_size: '5', limit_price: '100' }],
          }),
        });

        const positions = await client.getPositions();
        expect(positions[0].entryPrice).toBe(100);
      });

      it('falls back to 0 when both prices are missing', async () => {
        fetchMock.mockResolvedValue({
          ok: true,
          json: async () => ({
            orders: [{ product_id: 'SOL-USD', side: 'BUY', base_size: '5' }],
          }),
        });

        const positions = await client.getPositions();
        expect(positions[0].entryPrice).toBe(0);
      });

      it('returns empty array when orders is missing', async () => {
        fetchMock.mockResolvedValue({ ok: true, json: async () => ({}) });
        expect(await client.getPositions()).toEqual([]);
      });
    });

    describe('placeOrder()', () => {
      it('places a market buy order with quote_size', async () => {
        fetchMock.mockResolvedValue({
          ok: true,
          json: async () => ({
            success: true,
            order_id: 'order-abc',
            success_response: { order_id: 'order-abc', status: 'OPEN' },
          }),
        });

        const result = await client.placeOrder({
          symbol: 'btc-usd',
          side: 'buy',
          orderType: 'market',
          amount: 100,
        });

        expect(result).toEqual({ orderId: 'order-abc', status: 'OPEN' });

        const [, opts] = fetchMock.mock.calls[0];
        const body = JSON.parse(opts.body);
        expect(body.product_id).toBe('BTC-USD');
        expect(body.side).toBe('BUY');
        expect(body.order_configuration.market_market_ioc.quote_size).toBe('100');
      });

      it('places a market sell order with base_size', async () => {
        fetchMock.mockResolvedValue({
          ok: true,
          json: async () => ({
            success: true,
            order_id: 'sell-order',
            success_response: { order_id: 'sell-order', status: 'OPEN' },
          }),
        });

        await client.placeOrder({ symbol: 'BTC-USD', side: 'sell', orderType: 'market', amount: 0.05 });

        const [, opts] = fetchMock.mock.calls[0];
        const body = JSON.parse(opts.body);
        expect(body.order_configuration.market_market_ioc.base_size).toBe('0.05');
      });

      it('places a limit order with limit_limit_gtc', async () => {
        fetchMock.mockResolvedValue({
          ok: true,
          json: async () => ({
            success: true,
            order_id: 'limit-order',
            success_response: { order_id: 'limit-order', status: 'OPEN' },
          }),
        });

        await client.placeOrder({
          symbol: 'ETH-USD',
          side: 'buy',
          orderType: 'limit',
          amount: 1,
          price: 2500,
        });

        const [, opts] = fetchMock.mock.calls[0];
        const body = JSON.parse(opts.body);
        expect(body.order_configuration.limit_limit_gtc).toMatchObject({
          base_size: '1',
          limit_price: '2500',
          post_only: false,
        });
      });

      it('throws when limit order has no price', async () => {
        await expect(
          client.placeOrder({ symbol: 'ETH-USD', side: 'buy', orderType: 'limit', amount: 1 })
        ).rejects.toThrow('Price required for limit orders');
        expect(fetchMock).not.toHaveBeenCalled();
      });

      it('falls back to order_id when success_response is missing', async () => {
        fetchMock.mockResolvedValue({
          ok: true,
          json: async () => ({ success: false, order_id: 'fallback-id' }),
        });

        const result = await client.placeOrder({ symbol: 'BTC-USD', side: 'buy', orderType: 'market', amount: 1 });
        expect(result.orderId).toBe('fallback-id');
        expect(result.status).toBe('FAILED');
      });
    });

    describe('cancelOrder()', () => {
      it('sends POST to batch_cancel with order id array', async () => {
        fetchMock.mockResolvedValue({ ok: true, json: async () => ({}) });

        await client.cancelOrder('order-xyz');

        const [url, opts] = fetchMock.mock.calls[0];
        expect(url).toContain('orders/batch_cancel');
        expect(opts.method).toBe('POST');
        expect(JSON.parse(opts.body)).toEqual({ order_ids: ['order-xyz'] });
      });
    });

    describe('withdraw()', () => {
      it('sends transfer request and returns id', async () => {
        fetchMock.mockResolvedValue({
          ok: true,
          json: async () => ({ id: 'transfer-123' }),
        });

        const id = await client.withdraw('USD', 500, '0xdeadbeef', 'ethereum');

        expect(id).toBe('transfer-123');
        const [, opts] = fetchMock.mock.calls[0];
        const body = JSON.parse(opts.body);
        expect(body).toMatchObject({
          type: 'SEND',
          to: '0xdeadbeef',
          amount: '500',
          currency: 'USD',
          network: 'ethereum',
        });
      });
    });

    describe('error handling', () => {
      it('throws on 401 Unauthorized', async () => {
        fetchMock.mockResolvedValue({ ok: false, status: 401, text: async () => 'Unauthorized' });
        await expect(client.getBalances()).rejects.toThrow('Coinbase API error 401');
      });

      it('throws on 429 Rate limit', async () => {
        fetchMock.mockResolvedValue({ ok: false, status: 429, text: async () => 'Too Many Requests' });
        await expect(client.getBalances()).rejects.toThrow('Coinbase API error 429');
      });

      it('throws on 500 Server error', async () => {
        fetchMock.mockResolvedValue({ ok: false, status: 500, text: async () => 'Internal Server Error' });
        await expect(client.getPositions()).rejects.toThrow('Coinbase API error 500');
      });

      it('throws when credentials are missing', async () => {
        const { getSecret } = await import('../stores/secret-store');
        vi.mocked(getSecret).mockResolvedValue(null);
        const prevKey = process.env.COINBASE_API_KEY;
        const prevSecret = process.env.COINBASE_API_SECRET;
        process.env.COINBASE_API_KEY = '';
        process.env.COINBASE_API_SECRET = '';

        await expect(client.getBalances()).rejects.toThrow('COINBASE_API_KEY and COINBASE_API_SECRET are not set');

        process.env.COINBASE_API_KEY = prevKey;
        process.env.COINBASE_API_SECRET = prevSecret;
      });
    });
  });
});
