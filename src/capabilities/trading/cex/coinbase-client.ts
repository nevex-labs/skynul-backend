import type { CexBalance, CexOrder, CexPosition } from '../chain/types';

const _COINBASE_BASE = 'https://api.coinbase.com/api/v3/brokerage';

type CoinbaseMode = 'paper' | 'live';

export class CoinbaseClient {
  private readonly mode: CoinbaseMode;

  constructor(opts?: { mode?: CoinbaseMode }) {
    this.mode = opts?.mode ?? 'paper';
  }

  private async getCredentials(): Promise<{ apiKey: string; apiSecret: string }> {
    const { getSecret } = await import('../../../services/secrets');
    const apiKey = await getSecret('COINBASE_API_KEY');
    const apiSecret = await getSecret('COINBASE_API_SECRET');

    if (!apiKey || !apiSecret) {
      throw new Error('COINBASE_API_KEY and COINBASE_API_SECRET are not set. Configure them in Settings → Trading.');
    }
    return { apiKey, apiSecret };
  }

  /**
   * Build a JWT for Coinbase Advanced Trade API.
   * Coinbase uses ES256 JWTs (ECDSA P-256).
   */
  private async buildJwt(method: string, path: string): Promise<string> {
    const { apiKey, apiSecret } = await this.getCredentials();

    const { createSign } = await import('crypto');
    const header = Buffer.from(JSON.stringify({ alg: 'ES256', kid: apiKey })).toString('base64url');
    const now = Math.floor(Date.now() / 1000);
    const payload = Buffer.from(
      JSON.stringify({
        sub: apiKey,
        iss: 'coinbase-cloud',
        nbf: now,
        exp: now + 120,
        uri: `${method} api.coinbase.com${path}`,
      })
    ).toString('base64url');

    const signingInput = `${header}.${payload}`;
    // apiSecret is the PEM-encoded EC private key from Coinbase
    const sign = createSign('SHA256');
    sign.update(signingInput);
    const sigDer = sign.sign(apiSecret, 'base64url');

    return `${signingInput}.${sigDer}`;
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const jwt = await this.buildJwt(method, path);
    const url = `https://api.coinbase.com${path}`;

    const res = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${jwt}`,
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Coinbase API error ${res.status}: ${err}`);
    }
    return res.json() as Promise<T>;
  }

  async getBalances(): Promise<CexBalance[]> {
    if (this.mode === 'paper') {
      return [
        { asset: 'USD', free: 1000, locked: 0 },
        { asset: 'BTC', free: 0.01, locked: 0 },
      ];
    }

    const data = await this.request<{
      accounts: Array<{ currency: string; available_balance: { value: string }; hold: { value: string } }>;
    }>('GET', '/api/v3/brokerage/accounts');

    return (data.accounts ?? [])
      .filter((a) => Number.parseFloat(a.available_balance.value) > 0 || Number.parseFloat(a.hold.value) > 0)
      .map((a) => ({
        asset: a.currency,
        free: Number.parseFloat(a.available_balance.value),
        locked: Number.parseFloat(a.hold.value),
      }));
  }

  async getPositions(): Promise<CexPosition[]> {
    if (this.mode === 'paper') return [];

    const data = await this.request<{
      orders: Array<{
        product_id: string;
        side: string;
        base_size: string;
        limit_price?: string;
        average_filled_price?: string;
      }>;
    }>('GET', '/api/v3/brokerage/orders/historical/batch?order_status=OPEN');

    return (data.orders ?? []).map((o) => ({
      symbol: o.product_id,
      side: o.side === 'BUY' ? 'long' : 'short',
      size: Number.parseFloat(o.base_size),
      entryPrice: Number.parseFloat(o.average_filled_price ?? o.limit_price ?? '0'),
      markPrice: Number.parseFloat(o.average_filled_price ?? o.limit_price ?? '0'),
      unrealizedPnl: 0,
    }));
  }

  async placeOrder(order: CexOrder): Promise<{ orderId: string; status: string }> {
    if (this.mode === 'paper') {
      return { orderId: `paper-${Date.now()}`, status: 'FILLED' };
    }

    const clientOrderId = `skynul-${Date.now()}`;
    const body: Record<string, unknown> = {
      client_order_id: clientOrderId,
      product_id: order.symbol.toUpperCase(),
      side: order.side.toUpperCase(),
    };

    if (order.orderType === 'market') {
      body.order_configuration = {
        market_market_ioc: {
          [order.side === 'buy' ? 'quote_size' : 'base_size']: String(order.amount),
        },
      };
    } else {
      if (!order.price) throw new Error('Price required for limit orders');
      body.order_configuration = {
        limit_limit_gtc: {
          base_size: String(order.amount),
          limit_price: String(order.price),
          post_only: false,
        },
      };
    }

    const data = await this.request<{
      success: boolean;
      order_id: string;
      success_response?: { order_id: string; status: string };
    }>('POST', '/api/v3/brokerage/orders', body);

    const orderId = data.success_response?.order_id ?? data.order_id ?? clientOrderId;
    return { orderId, status: data.success ? 'OPEN' : 'FAILED' };
  }

  async cancelOrder(orderId: string): Promise<void> {
    if (this.mode === 'paper') return;
    await this.request('POST', '/api/v3/brokerage/orders/batch_cancel', {
      order_ids: [orderId],
    });
  }

  async withdraw(asset: string, amount: number, address: string, network: string): Promise<string> {
    if (this.mode === 'paper') return `paper-withdraw-${Date.now()}`;

    const data = await this.request<{ id: string }>('POST', '/api/v3/brokerage/transfers', {
      type: 'SEND',
      to: address,
      amount: String(amount),
      currency: asset,
      network,
    });
    return data.id;
  }
}
