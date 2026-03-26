import type { FiatAccount, FiatBalance, FiatTransferHistoryEntry, FiatTransferResult, FiatTransferStatus } from './types';
import type { FiatProvider } from './fiat-provider';

const PLAID_BASE_URL = 'https://production.plaid.com';
const DWOLLA_BASE_URL = 'https://api.dwolla.com';

export class PlaidClient implements FiatProvider {
  private readonly mode: 'paper' | 'live';

  constructor({ mode }: { mode: 'paper' | 'live' }) {
    this.mode = mode;
  }

  private async getCredentials(): Promise<{
    plaidClientId: string;
    plaidSecret: string;
    plaidAccessToken: string;
    dwollaKey: string;
    dwollaSecret: string;
  }> {
    const { getSecret } = await import('../stores/secret-store');
    const plaidClientId = (await getSecret('PLAID_CLIENT_ID')) ?? process.env.PLAID_CLIENT_ID ?? '';
    const plaidSecret = (await getSecret('PLAID_SECRET')) ?? process.env.PLAID_SECRET ?? '';
    const plaidAccessToken = (await getSecret('PLAID_ACCESS_TOKEN')) ?? process.env.PLAID_ACCESS_TOKEN ?? '';
    const dwollaKey = (await getSecret('DWOLLA_API_KEY')) ?? process.env.DWOLLA_API_KEY ?? '';
    const dwollaSecret = (await getSecret('DWOLLA_API_SECRET')) ?? process.env.DWOLLA_API_SECRET ?? '';
    if (!plaidClientId || !plaidSecret) throw new Error('PLAID_CLIENT_ID and PLAID_SECRET not configured');
    if (!plaidAccessToken)
      throw new Error('PLAID_ACCESS_TOKEN not configured — use POST /auth/plaid/exchange first');
    return { plaidClientId, plaidSecret, plaidAccessToken, dwollaKey, dwollaSecret };
  }

  async getBalance(): Promise<FiatBalance[]> {
    if (this.mode === 'paper') {
      return [
        { currency: 'USD', available: 2500.0, total: 2500.0 },
        { currency: 'USD', available: 500.0, total: 500.0 },
      ];
    }
    const creds = await this.getCredentials();
    const res = await fetch(`${PLAID_BASE_URL}/accounts/balance/get`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: creds.plaidClientId,
        secret: creds.plaidSecret,
        access_token: creds.plaidAccessToken,
      }),
    });
    if (!res.ok) throw new Error(`Plaid balance failed: ${res.status} ${await res.text()}`);
    const data = (await res.json()) as {
      accounts: Array<{ balances: { available: number; current: number; iso_currency_code: string } }>;
    };
    return (data.accounts ?? []).map((acc) => ({
      currency: acc.balances.iso_currency_code ?? 'USD',
      available: acc.balances.available ?? 0,
      total: acc.balances.current ?? 0,
    }));
  }

  async getAccounts(): Promise<FiatAccount[]> {
    if (this.mode === 'paper') {
      return [
        {
          id: 'chase-checking-001',
          label: 'Chase Checking ****1234',
          currency: 'USD',
          type: 'checking',
          institution: 'Chase',
        },
        {
          id: 'bofa-savings-001',
          label: 'BofA Savings ****5678',
          currency: 'USD',
          type: 'savings',
          institution: 'Bank of America',
        },
      ];
    }
    const creds = await this.getCredentials();
    const res = await fetch(`${PLAID_BASE_URL}/accounts/get`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: creds.plaidClientId,
        secret: creds.plaidSecret,
        access_token: creds.plaidAccessToken,
      }),
    });
    if (!res.ok) throw new Error(`Plaid accounts failed: ${res.status} ${await res.text()}`);
    const data = (await res.json()) as {
      accounts: Array<{
        account_id: string;
        name: string;
        subtype: string;
        balances: { iso_currency_code: string };
      }>;
      item: { institution_id: string };
    };
    return (data.accounts ?? []).map((acc) => ({
      id: acc.account_id,
      label: acc.name,
      currency: acc.balances.iso_currency_code ?? 'USD',
      type: acc.subtype ?? 'checking',
      institution: data.item?.institution_id ?? 'Unknown',
    }));
  }

  async sendTransfer(params: {
    amount: number;
    currency: string;
    destinationAccount: string;
    concept?: string;
  }): Promise<FiatTransferResult> {
    if (this.mode === 'paper') {
      const transferId = `paper-plaid-${Date.now()}`;
      return {
        transferId,
        status: 'completed',
        amount: params.amount,
        currency: params.currency,
        destination: params.destinationAccount,
        createdAt: Date.now(),
      };
    }
    const creds = await this.getCredentials();
    if (!creds.dwollaKey || !creds.dwollaSecret)
      throw new Error('DWOLLA_API_KEY and DWOLLA_API_SECRET not configured');
    // Get Dwolla token
    const tokenRes = await fetch(`${DWOLLA_BASE_URL}/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: creds.dwollaKey,
        client_secret: creds.dwollaSecret,
      }),
    });
    if (!tokenRes.ok) throw new Error(`Dwolla auth failed: ${tokenRes.status} ${await tokenRes.text()}`);
    const tokenData = (await tokenRes.json()) as { access_token: string };

    const transferRes = await fetch(`${DWOLLA_BASE_URL}/transfers`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/vnd.dwolla.v1.hal+json',
        Authorization: `Bearer ${tokenData.access_token}`,
      },
      body: JSON.stringify({
        _links: { destination: { href: params.destinationAccount } },
        amount: { value: params.amount.toFixed(2), currency: params.currency },
        metadata: { description: params.concept ?? 'Transfer' },
      }),
    });
    if (!transferRes.ok) throw new Error(`Dwolla transfer failed: ${transferRes.status} ${await transferRes.text()}`);
    const location = transferRes.headers.get('location') ?? '';
    const transferId = location.split('/').pop() ?? `dwolla-${Date.now()}`;
    return {
      transferId,
      status: 'pending',
      amount: params.amount,
      currency: params.currency,
      destination: params.destinationAccount,
      createdAt: Date.now(),
    };
  }

  async getTransferStatus(transferId: string): Promise<FiatTransferStatus> {
    if (this.mode === 'paper') {
      return { transferId, status: 'completed', updatedAt: Date.now() };
    }
    const creds = await this.getCredentials();
    const tokenRes = await fetch(`${DWOLLA_BASE_URL}/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: creds.dwollaKey,
        client_secret: creds.dwollaSecret,
      }),
    });
    if (!tokenRes.ok) throw new Error(`Dwolla auth failed: ${tokenRes.status}`);
    const { access_token } = (await tokenRes.json()) as { access_token: string };
    const res = await fetch(`${DWOLLA_BASE_URL}/transfers/${transferId}`, {
      headers: { Authorization: `Bearer ${access_token}` },
    });
    if (!res.ok) throw new Error(`Dwolla status failed: ${res.status} ${await res.text()}`);
    const data = (await res.json()) as { status: string };
    const s = data.status?.toLowerCase() ?? 'pending';
    return {
      transferId,
      status: s === 'processed' ? 'completed' : s === 'failed' || s === 'cancelled' ? 'failed' : 'pending',
      updatedAt: Date.now(),
    };
  }

  async getTransferHistory(limit = 10): Promise<FiatTransferHistoryEntry[]> {
    if (this.mode === 'paper') {
      return [
        {
          transferId: 'paper-plaid-history-1',
          amount: 100.0,
          currency: 'USD',
          destination: 'friend-account',
          status: 'completed',
          createdAt: Date.now() - 86400000,
        },
      ];
    }
    const creds = await this.getCredentials();
    const tokenRes = await fetch(`${DWOLLA_BASE_URL}/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: creds.dwollaKey,
        client_secret: creds.dwollaSecret,
      }),
    });
    if (!tokenRes.ok) throw new Error(`Dwolla auth failed`);
    const { access_token } = (await tokenRes.json()) as { access_token: string };
    const res = await fetch(`${DWOLLA_BASE_URL}/transfers?limit=${limit}`, {
      headers: { Authorization: `Bearer ${access_token}` },
    });
    if (!res.ok) throw new Error(`Dwolla history failed: ${res.status}`);
    const data = (await res.json()) as {
      _embedded?: {
        transfers: Array<{
          id: string;
          amount: { value: string; currency: string };
          status: string;
          created: string;
          _links: { destination?: { href: string } };
        }>;
      };
    };
    return ((data._embedded?.transfers ?? []).slice(0, limit)).map((t) => ({
      transferId: t.id,
      amount: parseFloat(t.amount.value),
      currency: t.amount.currency,
      destination: t._links?.destination?.href ?? '',
      status: t.status,
      createdAt: new Date(t.created).getTime(),
    }));
  }
}
