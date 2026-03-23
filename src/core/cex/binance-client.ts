import type { CexBalance, CexOrder, CexPosition } from '../chain/types';

const BINANCE_BASE = 'https://api.binance.com/api/v3';
const BINANCE_WITHDRAW_BASE = 'https://api.binance.com/sapi/v1';

type BinanceMode = 'paper' | 'live';

export class BinanceClient {
  private readonly mode: BinanceMode;

  constructor(opts?: { mode?: BinanceMode }) {
    this.mode = opts?.mode ?? 'paper';
  }

  private async getCredentials(): Promise<{ apiKey: string; apiSecret: string }> {
    const { getSecret } = await import('../stores/secret-store');
    const apiKey = (await getSecret('BINANCE_API_KEY')) ?? process.env.BINANCE_API_KEY;
    const apiSecret = (await getSecret('BINANCE_API_SECRET')) ?? process.env.BINANCE_API_SECRET;

    if (!apiKey || !apiSecret) {
      throw new Error('BINANCE_API_KEY and BINANCE_API_SECRET are not set. Configure them in Settings → Trading.');
    }
    return { apiKey, apiSecret };
  }

  private async sign(queryString: string, secret: string): Promise<string> {
    const { createHmac } = await import('crypto');
    return createHmac('sha256', secret).update(queryString).digest('hex');
  }

  private async signedRequest<T>(
    method: 'GET' | 'POST' | 'DELETE',
    path: string,
    params: Record<string, string | number> = {}
  ): Promise<T> {
    const { apiKey, apiSecret } = await this.getCredentials();
    const timestamp = Date.now();
    const allParams = { ...params, timestamp };
    const queryString = new URLSearchParams(Object.entries(allParams).map(([k, v]) => [k, String(v)])).toString();
    const signature = await this.sign(queryString, apiSecret);
    const fullQuery = `${queryString}&signature=${signature}`;

    let url: string;
    let body: string | undefined;

    if (method === 'GET' || method === 'DELETE') {
      url = `${BINANCE_BASE}${path}?${fullQuery}`;
      body = undefined;
    } else {
      url = `${BINANCE_BASE}${path}`;
      body = fullQuery;
    }

    const res = await fetch(url, {
      method,
      headers: {
        'X-MBX-APIKEY': apiKey,
        ...(body ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
      },
      body,
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Binance API error ${res.status}: ${err}`);
    }
    return res.json() as Promise<T>;
  }

  async getBalances(): Promise<CexBalance[]> {
    if (this.mode === 'paper') {
      return [
        { asset: 'USDT', free: 1000, locked: 0 },
        { asset: 'BTC', free: 0.01, locked: 0 },
      ];
    }

    const data = await this.signedRequest<{ balances: Array<{ asset: string; free: string; locked: string }> }>(
      'GET',
      '/account',
      {}
    );

    return data.balances
      .filter((b) => Number.parseFloat(b.free) > 0 || Number.parseFloat(b.locked) > 0)
      .map((b) => ({
        asset: b.asset,
        free: Number.parseFloat(b.free),
        locked: Number.parseFloat(b.locked),
      }));
  }

  async getPositions(): Promise<CexPosition[]> {
    // Binance spot doesn't have positions in the futures sense.
    // Return open orders as proxy for positions.
    if (this.mode === 'paper') return [];

    const orders = await this.signedRequest<
      Array<{
        symbol: string;
        side: string;
        origQty: string;
        price: string;
      }>
    >('GET', '/openOrders', {});

    return orders.map((o) => ({
      symbol: o.symbol,
      side: o.side === 'BUY' ? 'long' : 'short',
      size: Number.parseFloat(o.origQty),
      entryPrice: Number.parseFloat(o.price),
      markPrice: Number.parseFloat(o.price),
      unrealizedPnl: 0,
    }));
  }

  async placeOrder(order: CexOrder): Promise<{ orderId: string; status: string }> {
    if (this.mode === 'paper') {
      return { orderId: `paper-${Date.now()}`, status: 'FILLED' };
    }

    const params: Record<string, string | number> = {
      symbol: order.symbol.toUpperCase(),
      side: order.side.toUpperCase(),
      type: order.orderType.toUpperCase(),
      quantity: order.amount,
    };

    if (order.orderType === 'limit' && order.price) {
      params.price = order.price;
      params.timeInForce = 'GTC';
    }

    const data = await this.signedRequest<{ orderId: number; status: string }>('POST', '/order', params);

    return { orderId: String(data.orderId), status: data.status };
  }

  async cancelOrder(symbol: string, orderId: string): Promise<void> {
    if (this.mode === 'paper') return;
    await this.signedRequest('DELETE', '/order', {
      symbol: symbol.toUpperCase(),
      orderId,
    });
  }

  async withdraw(asset: string, amount: number, address: string, network: string): Promise<string> {
    if (this.mode === 'paper') return `paper-withdraw-${Date.now()}`;

    const { apiKey, apiSecret } = await this.getCredentials();
    const timestamp = Date.now();
    const params = { coin: asset, address, amount, network, timestamp };
    const queryString = new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)])).toString();
    const { createHmac } = await import('crypto');
    const signature = createHmac('sha256', apiSecret).update(queryString).digest('hex');

    const res = await fetch(`${BINANCE_WITHDRAW_BASE}/capital/withdraw/apply`, {
      method: 'POST',
      headers: {
        'X-MBX-APIKEY': apiKey,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: `${queryString}&signature=${signature}`,
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Binance withdraw error ${res.status}: ${err}`);
    }

    const data = (await res.json()) as { id: string };
    return data.id;
  }
}
