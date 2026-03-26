import type { FiatAccount, FiatBalance, FiatTransferHistoryEntry, FiatTransferResult, FiatTransferStatus } from './types';
import type { FiatProvider } from './fiat-provider';

const BASE_URL = 'https://banking.prometeoapi.net';

export class PrometeoClient implements FiatProvider {
  private readonly mode: 'paper' | 'live';

  constructor({ mode }: { mode: 'paper' | 'live' }) {
    this.mode = mode;
  }

  private async getCredentials(): Promise<{ apiKey: string; sessionKey: string }> {
    const { getSecret } = await import('../stores/secret-store');
    const apiKey = (await getSecret('PROMETEO_API_KEY')) ?? process.env.PROMETEO_API_KEY ?? '';
    const sessionKey = (await getSecret('PROMETEO_SESSION_KEY')) ?? process.env.PROMETEO_SESSION_KEY ?? '';
    if (!apiKey) throw new Error('PROMETEO_API_KEY not configured');
    if (!sessionKey)
      throw new Error('PROMETEO_SESSION_KEY not configured — use POST /auth/prometeo/login first');
    return { apiKey, sessionKey };
  }

  async getBalance(): Promise<FiatBalance[]> {
    if (this.mode === 'paper') {
      // Prometeo is live in Mexico, Brazil, Peru. Argentina is coming soon.
      return [
        { currency: 'BRL', available: 15000, total: 15000 },
        { currency: 'MXN', available: 5000, total: 5000 },
      ];
    }
    const { sessionKey } = await this.getCredentials();
    const res = await fetch(`${BASE_URL}/account/`, {
      headers: { 'X-Auth-Token': sessionKey },
    });
    if (!res.ok) throw new Error(`Prometeo /account/ failed: ${res.status} ${await res.text()}`);
    const data = (await res.json()) as { status: string; data: Array<{ currency: string; balance: number }> };
    return (data.data ?? []).map((acc) => ({
      currency: acc.currency,
      available: acc.balance,
      total: acc.balance,
    }));
  }

  async getAccounts(): Promise<FiatAccount[]> {
    if (this.mode === 'paper') {
      return [
        {
          id: '001-12345678-9',
          label: 'Conta Corrente Itaú',
          currency: 'BRL',
          type: 'checking',
          institution: 'Itaú',
        },
        {
          id: '002-87654321-0',
          label: 'Cuenta BBVA México',
          currency: 'MXN',
          type: 'checking',
          institution: 'BBVA México',
        },
      ];
    }
    const { sessionKey } = await this.getCredentials();
    const res = await fetch(`${BASE_URL}/account/`, {
      headers: { 'X-Auth-Token': sessionKey },
    });
    if (!res.ok) throw new Error(`Prometeo /account/ failed: ${res.status} ${await res.text()}`);
    const data = (await res.json()) as {
      data: Array<{ id: string; name: string; currency: string; type: string; bank: string; number: string }>;
    };
    return (data.data ?? []).map((acc) => ({
      id: acc.number ?? acc.id,
      label: acc.name,
      currency: acc.currency,
      type: acc.type ?? 'checking',
      institution: acc.bank ?? 'Unknown',
    }));
  }

  async sendTransfer(params: {
    amount: number;
    currency: string;
    destinationAccount: string;
    concept?: string;
  }): Promise<FiatTransferResult> {
    if (this.mode === 'paper') {
      const transferId = `paper-prometeo-${Date.now()}`;
      return {
        transferId,
        status: 'completed',
        amount: params.amount,
        currency: params.currency,
        destination: params.destinationAccount,
        createdAt: Date.now(),
      };
    }
    const { sessionKey } = await this.getCredentials();
    // Step 1: preprocess
    const preprocessRes = await fetch(`${BASE_URL}/transfer/preprocess`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Auth-Token': sessionKey },
      body: JSON.stringify({
        origin_account: 'default',
        destination_account: params.destinationAccount,
        currency: params.currency,
        amount: params.amount,
        concept: params.concept ?? 'Transfer',
      }),
    });
    if (!preprocessRes.ok)
      throw new Error(`Prometeo preprocess failed: ${preprocessRes.status} ${await preprocessRes.text()}`);
    const preprocessData = (await preprocessRes.json()) as {
      status: string;
      request_id: string;
      authorization_devices?: Array<{ type: string }>;
    };

    // If 2FA required, return requires_auth
    if (preprocessData.authorization_devices && preprocessData.authorization_devices.length > 0) {
      const authType = preprocessData.authorization_devices[0].type;
      return {
        transferId: preprocessData.request_id,
        status: 'requires_auth',
        amount: params.amount,
        currency: params.currency,
        destination: params.destinationAccount,
        createdAt: Date.now(),
        authorizationRequired: authType,
      };
    }

    // Step 2: confirm
    const confirmRes = await fetch(`${BASE_URL}/transfer/confirm`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Auth-Token': sessionKey },
      body: JSON.stringify({ request_id: preprocessData.request_id }),
    });
    if (!confirmRes.ok)
      throw new Error(`Prometeo confirm failed: ${confirmRes.status} ${await confirmRes.text()}`);
    const confirmData = (await confirmRes.json()) as { status: string; transfer_id?: string };
    return {
      transferId: confirmData.transfer_id ?? preprocessData.request_id,
      status: confirmData.status === 'SUCCESS' ? 'completed' : 'pending',
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
    const { sessionKey } = await this.getCredentials();
    const res = await fetch(`${BASE_URL}/transfer/${transferId}`, {
      headers: { 'X-Auth-Token': sessionKey },
    });
    if (!res.ok) throw new Error(`Prometeo transfer status failed: ${res.status} ${await res.text()}`);
    const data = (await res.json()) as { data: { status: string; updated_at?: string } };
    const s = data.data?.status?.toLowerCase() ?? 'pending';
    return {
      transferId,
      status: s === 'success' ? 'completed' : s === 'failed' ? 'failed' : 'pending',
      updatedAt: Date.now(),
    };
  }

  async getTransferHistory(limit = 10): Promise<FiatTransferHistoryEntry[]> {
    if (this.mode === 'paper') {
      return [
        {
          transferId: 'paper-prometeo-history-1',
          amount: 500,
          currency: 'BRL',
          destination: '001-99887766-5',
          status: 'completed',
          createdAt: Date.now() - 86400000,
        },
      ];
    }
    const { sessionKey } = await this.getCredentials();
    const res = await fetch(`${BASE_URL}/transfer/?limit=${limit}`, {
      headers: { 'X-Auth-Token': sessionKey },
    });
    if (!res.ok) throw new Error(`Prometeo transfer history failed: ${res.status} ${await res.text()}`);
    const data = (await res.json()) as {
      data: Array<{
        id: string;
        amount: number;
        currency: string;
        destination_account: string;
        status: string;
        created_at: string;
      }>;
    };
    return (data.data ?? []).slice(0, limit).map((t) => ({
      transferId: t.id,
      amount: t.amount,
      currency: t.currency,
      destination: t.destination_account,
      status: t.status,
      createdAt: new Date(t.created_at).getTime(),
    }));
  }
}
