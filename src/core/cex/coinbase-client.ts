import type { CexBalance, CexClient, CexOrder, CexOrderResult, CexPosition, CexTicker } from './types';

const COINBASE_BASE = 'https://api.coinbase.com/api/v3/brokerage';

export class CoinbaseClient implements CexClient {
  constructor(private _mode?: 'paper' | 'live') {
    // Mode parameter kept for compatibility but not used
    // Paper mode is handled by PaperCexClient in the factory
  }
  readonly exchange = 'coinbase' as const;

  private async getCredentials(): Promise<{ apiKey: string; apiSecret: string }> {
    const { getSecret } = await import('../providers/secret-adapter');
    const apiKey = (await getSecret('COINBASE_API_KEY')) ?? process.env.COINBASE_API_KEY;
    const apiSecret = (await getSecret('COINBASE_API_SECRET')) ?? process.env.COINBASE_API_SECRET;

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

  async placeOrder(order: CexOrder): Promise<CexOrderResult> {
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

  async cancelOrder(_symbol: string, orderId: string): Promise<void> {
    await this.request('POST', '/api/v3/brokerage/orders/batch_cancel', {
      order_ids: [orderId],
    });
  }

  async getTicker(symbol: string): Promise<CexTicker> {
    const data = await this.request<{ prices: Array<{ price: string }> }>(
      'GET',
      `/api/v3/brokerage/product_book?product_id=${symbol.toUpperCase()}`
    );
    const price = data.prices?.[0]?.price ?? '0';
    return { symbol: symbol.toUpperCase(), price };
  }

  async withdraw(asset: string, amount: number, address: string, network: string): Promise<string> {
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
