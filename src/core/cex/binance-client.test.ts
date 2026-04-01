import { createHmac } from 'crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BinanceClient } from './binance-client';

vi.mock('../stores/secret-store', () => ({
  getSecret: vi.fn(),
}));

const TEST_API_KEY = 'test-api-key';
const TEST_API_SECRET = 'test-api-secret';
const FIXED_TIMESTAMP = 1700000000000;

function computeExpectedSignature(params: Record<string, string | number>): string {
  const allParams = { ...params, timestamp: FIXED_TIMESTAMP };
  const queryString = new URLSearchParams(Object.entries(allParams).map(([k, v]) => [k, String(v)])).toString();
  return createHmac('sha256', TEST_API_SECRET).update(queryString).digest('hex');
}

describe('BinanceClient', () => {
  let client: BinanceClient;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.spyOn(Date, 'now').mockReturnValue(FIXED_TIMESTAMP);

    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const { getSecret } = await import('../stores/secret-store');
    vi.mocked(getSecret).mockImplementation(async (key: string) => {
      if (key === 'BINANCE_API_KEY') return TEST_API_KEY;
      if (key === 'BINANCE_API_SECRET') return TEST_API_SECRET;
      return null;
    });
  });

  describe('paper mode (default)', () => {
    beforeEach(() => {
      client = new BinanceClient();
    });

    it('getBalances() returns paper balances without calling fetch', async () => {
      const balances = await client.getBalances();
      expect(fetchMock).not.toHaveBeenCalled();
      expect(balances).toEqual([
        { asset: 'USDT', free: 1000, locked: 0 },
        { asset: 'BTC', free: 0.01, locked: 0 },
      ]);
    });

    it('getPositions() returns empty array without calling fetch', async () => {
      const positions = await client.getPositions();
      expect(fetchMock).not.toHaveBeenCalled();
      expect(positions).toEqual([]);
    });

    it('placeOrder() returns paper order without calling fetch', async () => {
      const result = await client.placeOrder({ symbol: 'BTCUSDT', side: 'buy', orderType: 'market', amount: 0.01 });
      expect(fetchMock).not.toHaveBeenCalled();
      expect(result.status).toBe('FILLED');
      expect(result.orderId).toMatch(/^paper-/);
    });

    it('cancelOrder() resolves without calling fetch', async () => {
      await expect(client.cancelOrder('BTCUSDT', '12345')).resolves.toBeUndefined();
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('withdraw() returns paper withdrawal id without calling fetch', async () => {
      const id = await client.withdraw('USDT', 100, '0xabc', 'ETH');
      expect(fetchMock).not.toHaveBeenCalled();
      expect(id).toMatch(/^paper-withdraw-/);
    });
  });

  describe('live mode', () => {
    beforeEach(() => {
      client = new BinanceClient({ mode: 'live' });
    });

    describe('getBalances()', () => {
      it('parses balances and filters out zero balances', async () => {
        fetchMock.mockResolvedValue({
          ok: true,
          json: async () => ({
            balances: [
              { asset: 'USDT', free: '500.5', locked: '10.0' },
              { asset: 'BTC', free: '0.05', locked: '0.0' },
              { asset: 'ETH', free: '0.0', locked: '0.0' },
            ],
          }),
        });

        const balances = await client.getBalances();

        expect(balances).toHaveLength(2);
        expect(balances[0]).toEqual({ asset: 'USDT', free: 500.5, locked: 10 });
        expect(balances[1]).toEqual({ asset: 'BTC', free: 0.05, locked: 0 });
      });

      it('sends signed GET /account with correct API key header', async () => {
        fetchMock.mockResolvedValue({ ok: true, json: async () => ({ balances: [] }) });

        await client.getBalances();

        const [url, opts] = fetchMock.mock.calls[0];
        expect(url).toContain('/account?');
        expect(url).toContain(`timestamp=${FIXED_TIMESTAMP}`);
        expect(url).toContain('signature=');
        expect(opts.method).toBe('GET');
        expect(opts.headers['X-MBX-APIKEY']).toBe(TEST_API_KEY);
      });

      it('includes correct HMAC signature', async () => {
        fetchMock.mockResolvedValue({ ok: true, json: async () => ({ balances: [] }) });

        await client.getBalances();

        const [url] = fetchMock.mock.calls[0];
        const expectedSig = computeExpectedSignature({});
        expect(url).toContain(`signature=${expectedSig}`);
      });

      it('returns empty array when all balances are zero', async () => {
        fetchMock.mockResolvedValue({
          ok: true,
          json: async () => ({
            balances: [{ asset: 'ETH', free: '0.0', locked: '0.0' }],
          }),
        });

        const balances = await client.getBalances();
        expect(balances).toHaveLength(0);
      });
    });

    describe('getPositions()', () => {
      it('maps open orders to positions', async () => {
        fetchMock.mockResolvedValue({
          ok: true,
          json: async () => [
            { symbol: 'BTCUSDT', side: 'BUY', origQty: '0.1', price: '30000' },
            { symbol: 'ETHUSDT', side: 'SELL', origQty: '2.0', price: '2000' },
          ],
        });

        const positions = await client.getPositions();

        expect(positions).toHaveLength(2);
        expect(positions[0]).toEqual({
          symbol: 'BTCUSDT',
          side: 'long',
          size: 0.1,
          entryPrice: 30000,
          markPrice: 30000,
          unrealizedPnl: 0,
        });
        expect(positions[1].side).toBe('short');
      });

      it('returns empty array for empty order list', async () => {
        fetchMock.mockResolvedValue({ ok: true, json: async () => [] });
        const positions = await client.getPositions();
        expect(positions).toEqual([]);
      });
    });

    describe('placeOrder()', () => {
      it('places a market order with correct params', async () => {
        fetchMock.mockResolvedValue({
          ok: true,
          json: async () => ({ orderId: 9876, status: 'FILLED' }),
        });

        const result = await client.placeOrder({
          symbol: 'btcusdt',
          side: 'buy',
          orderType: 'market',
          amount: 0.01,
        });

        expect(result).toEqual({ orderId: '9876', status: 'FILLED' });

        const [url, opts] = fetchMock.mock.calls[0];
        expect(url).toContain('/order');
        expect(opts.method).toBe('POST');
        expect(opts.body).toContain('symbol=BTCUSDT');
        expect(opts.body).toContain('side=BUY');
        expect(opts.body).toContain('type=MARKET');
        expect(opts.body).not.toContain('price=');
        expect(opts.body).not.toContain('timeInForce=');
      });

      it('places a limit order with price and GTC', async () => {
        fetchMock.mockResolvedValue({
          ok: true,
          json: async () => ({ orderId: 5555, status: 'NEW' }),
        });

        await client.placeOrder({
          symbol: 'ETHUSDT',
          side: 'sell',
          orderType: 'limit',
          amount: 1,
          price: 2500,
        });

        const [, opts] = fetchMock.mock.calls[0];
        expect(opts.body).toContain('price=2500');
        expect(opts.body).toContain('timeInForce=GTC');
      });
    });

    describe('cancelOrder()', () => {
      it('sends DELETE /order with symbol and orderId', async () => {
        fetchMock.mockResolvedValue({ ok: true, json: async () => ({}) });

        await client.cancelOrder('btcusdt', '12345');

        const [url, opts] = fetchMock.mock.calls[0];
        expect(opts.method).toBe('DELETE');
        expect(url).toContain('/order?');
        expect(url).toContain('symbol=BTCUSDT');
        expect(url).toContain('orderId=12345');
      });
    });

    describe('withdraw()', () => {
      it('sends signed POST to capital/withdraw/apply and returns id', async () => {
        fetchMock.mockResolvedValue({
          ok: true,
          json: async () => ({ id: 'withdraw-abc-123' }),
        });

        const id = await client.withdraw('USDT', 100, '0xdeadbeef', 'ETH');

        expect(id).toBe('withdraw-abc-123');
        const [url, opts] = fetchMock.mock.calls[0];
        expect(url).toContain('capital/withdraw/apply');
        expect(opts.method).toBe('POST');
        expect(opts.body).toContain('coin=USDT');
        expect(opts.body).toContain('amount=100');
        expect(opts.body).toContain('address=0xdeadbeef');
        expect(opts.body).toContain('network=ETH');
        expect(opts.body).toContain('signature=');
      });
    });

    describe('error handling', () => {
      it('throws on 401 Unauthorized', async () => {
        fetchMock.mockResolvedValue({ ok: false, status: 401, text: async () => 'Unauthorized' });
        await expect(client.getBalances()).rejects.toThrow('Binance API error 401');
      });

      it('throws on 429 Rate limit', async () => {
        fetchMock.mockResolvedValue({ ok: false, status: 429, text: async () => 'Too Many Requests' });
        await expect(client.getBalances()).rejects.toThrow('Binance API error 429');
      });

      it('throws on 500 Server error', async () => {
        fetchMock.mockResolvedValue({ ok: false, status: 500, text: async () => 'Internal Server Error' });
        await expect(client.placeOrder({ symbol: 'BTC', side: 'buy', orderType: 'market', amount: 1 })).rejects.toThrow(
          'Binance API error 500'
        );
      });

      it('throws when credentials are missing', async () => {
        const { getSecret } = await import('../stores/secret-store');
        vi.mocked(getSecret).mockResolvedValue(null);
        const prevKey = process.env.BINANCE_API_KEY;
        const prevSecret = process.env.BINANCE_API_SECRET;
        process.env.BINANCE_API_KEY = '';
        process.env.BINANCE_API_SECRET = '';

        await expect(client.getBalances()).rejects.toThrow('BINANCE_API_KEY and BINANCE_API_SECRET are not set');

        process.env.BINANCE_API_KEY = prevKey;
        process.env.BINANCE_API_SECRET = prevSecret;
      });
    });
  });
});
