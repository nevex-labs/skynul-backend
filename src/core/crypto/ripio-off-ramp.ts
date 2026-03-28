import type { CryptoProvider } from './crypto-provider';
import type {
  CryptoAddress,
  CryptoBalance,
  CryptoTransferHistoryEntry,
  CryptoTransferResult,
  CryptoTransferStatus,
} from './types';
import { STABLECOIN_NETWORK_SUPPORT, isNetworkSupported, isStablecoinAsset } from './types';

const RIPIO_BASE_SANDBOX = 'https://skala-sandbox.ripio.com';
const RIPIO_BASE_PRODUCTION = 'https://skala.ripio.com';

type CryptoMode = 'paper' | 'live';

// Network name mappings for Ripio API (uppercase)
const NETWORK_TO_RIPIO: Record<string, string> = {
  ethereum: 'ETHEREUM',
  polygon: 'POLYGON',
  arbitrum: 'ARBITRUM',
  optimism: 'OPTIMISM',
  base: 'BASE',
};

// Asset mapping (Ripio uses uppercase)
const ASSET_TO_RIPIO: Record<string, string> = {
  USDT: 'USDT',
  USDC: 'USDC',
  DAI: 'DAI',
};

// Payment method types for Argentina
const PAYMENT_METHODS = {
  BANK_TRANSFER: 'bank_transfer',
  MERCADO_PAGO: 'mercado_pago',
} as const;

type PaymentMethodType = (typeof PAYMENT_METHODS)[keyof typeof PAYMENT_METHODS];

interface RipioCredentials {
  clientId: string;
  clientSecret: string;
}

interface RipioAccessToken {
  accessToken: string;
  expiresIn: number;
  tokenType: string;
}

interface RipioCustomer {
  customerId: string;
  email: string;
  createdAt: string;
}

interface RipioFiatAccount {
  fiatAccountId: string;
  fiatAccountFields: Record<string, string>;
  createdAt: string;
  status: 'UNCONFIRMED' | 'PROCESSING' | 'ENABLED' | 'DISABLED';
  paymentMethodType: string;
  customerId: string;
}

interface RipioOffRampSession {
  sessionId: string;
  customerId: string;
  createdAt: string;
  toCurrency: string;
  paymentMethodType: string;
  fiatAccountId: string;
  depositAddresses: Array<{
    chain: string;
    address: string;
  }>;
  transactions: unknown[];
}

interface RipioOffRampOrder {
  transactionId: string;
  createdAt: string;
  customerId: string;
  quoteId: string;
  fromCurrency: string;
  toCurrency: string;
  amount: string;
  chain: string;
  status: string;
  txnHash?: string;
}

export class RipioOffRamp implements CryptoProvider {
  private readonly mode: CryptoMode;
  private accessToken: string | null = null;
  private tokenExpiry = 0;

  // In-memory cache for customers and fiat accounts (for paper mode)
  private static paperCustomers: Map<string, RipioCustomer> = new Map();
  private static paperFiatAccounts: Map<string, RipioFiatAccount> = new Map();
  private static paperSessions: Map<string, RipioOffRampSession> = new Map();
  private static paperTransfers: CryptoTransferResult[] = [];

  constructor(opts?: { mode?: CryptoMode }) {
    this.mode = opts?.mode ?? 'paper';
  }

  private async getCredentials(): Promise<RipioCredentials> {
    const { getSecret } = await import('../stores/secret-store');
    const clientId = (await getSecret('RIPIO_CLIENT_ID')) ?? process.env.RIPIO_CLIENT_ID;
    const clientSecret = (await getSecret('RIPIO_CLIENT_SECRET')) ?? process.env.RIPIO_CLIENT_SECRET;

    if (!clientId || !clientSecret) {
      throw new Error('RIPIO_CLIENT_ID and RIPIO_CLIENT_SECRET are not set. Configure them in Settings → Trading.');
    }
    return { clientId, clientSecret };
  }

  private getBaseUrl(): string {
    return process.env.RIPIO_ENV === 'production' ? RIPIO_BASE_PRODUCTION : RIPIO_BASE_SANDBOX;
  }

  private async getAccessToken(): Promise<string> {
    // Check if token is still valid (with 60s buffer)
    if (this.accessToken && Date.now() < this.tokenExpiry - 60000) {
      return this.accessToken;
    }

    const credentials = await this.getCredentials();
    const baseUrl = this.getBaseUrl();

    // Encode credentials as Basic Auth
    const basicAuth = Buffer.from(`${credentials.clientId}:${credentials.clientSecret}`).toString('base64');

    const response = await fetch(`${baseUrl}/oauth2/token/`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${basicAuth}`,
      },
      body: new URLSearchParams({ grant_type: 'client_credentials' }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Ripio OAuth2 error ${response.status}: ${errorText}`);
    }

    const data: RipioAccessToken = await response.json();
    this.accessToken = data.accessToken;
    this.tokenExpiry = Date.now() + data.expiresIn * 1000;
    return this.accessToken;
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    if (this.mode === 'paper') {
      return this.handlePaperRequest<T>(method, path, body);
    }

    const token = await this.getAccessToken();
    const baseUrl = this.getBaseUrl();
    const url = `${baseUrl}${path}`;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    };

    const response = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Ripio API error ${response.status}: ${errorText}`);
    }

    // Handle 204 No Content
    if (response.status === 204) {
      return {} as T;
    }

    return response.json() as Promise<T>;
  }

  private handlePaperRequest<T>(method: string, path: string, body?: unknown): T {
    // Mock responses for paper mode
    if (path.includes('/oauth2/token/')) {
      return {
        accessToken: 'paper-mock-access-token',
        expiresIn: 36000,
        tokenType: 'Bearer',
      } as T;
    }

    if (path.includes('/customers/')) {
      if (method === 'POST' && path.endsWith('/customers/')) {
        const customerId = `paper-customer-${Date.now()}`;
        const customer: RipioCustomer = {
          customerId,
          email: (body as any)?.email ?? 'paper@example.com',
          createdAt: new Date().toISOString(),
        };
        RipioOffRamp.paperCustomers.set(customerId, customer);
        return customer as T;
      }
      if (method === 'GET' && !path.includes('/fiatAccounts/')) {
        const customerId = path.split('/').pop();
        const customer = RipioOffRamp.paperCustomers.get(customerId ?? '');
        if (!customer) {
          throw new Error(`Customer ${customerId} not found`);
        }
        return customer as T;
      }
    }

    if (path.includes('/fiatAccounts/')) {
      if (method === 'POST') {
        const req = body as any;
        const fiatAccountId = `paper-fiat-${Date.now()}`;
        const fiatAccount: RipioFiatAccount = {
          fiatAccountId,
          fiatAccountFields: req.accountFields,
          createdAt: new Date().toISOString(),
          status: 'ENABLED',
          paymentMethodType: req.paymentMethodType,
          customerId: req.customerId,
        };
        RipioOffRamp.paperFiatAccounts.set(fiatAccountId, fiatAccount);
        return fiatAccount as T;
      }
      if (method === 'GET' && path.endsWith('/fiatAccounts/')) {
        const customerId = path.split('/')[3]; // /api/v1/customers/{customerId}/fiatAccounts/
        const accounts = Array.from(RipioOffRamp.paperFiatAccounts.values()).filter(
          (acc) => acc.customerId === customerId
        );
        return { results: accounts } as T;
      }
    }

    if (path.includes('/offrampSession/')) {
      if (method === 'POST') {
        const req = body as any;
        const sessionId = `paper-session-${Date.now()}`;
        const session: RipioOffRampSession = {
          sessionId,
          customerId: req.customerId ?? 'paper-customer',
          createdAt: new Date().toISOString(),
          toCurrency: 'ARS',
          paymentMethodType: 'bank_transfer',
          fiatAccountId: req.fiatAccountId,
          depositAddresses: [
            {
              chain: 'ETHEREUM',
              address: '0x742d35Cc6634C0532935334AdCb2f44d923604d5',
            },
            {
              chain: 'POLYGON',
              address: '0x742d35Cc6634C0532935334AdCb2f44d923604d5',
            },
          ],
          transactions: [],
        };
        RipioOffRamp.paperSessions.set(sessionId, session);
        return session as T;
      }
      if (method === 'GET' && !path.includes('/orders/')) {
        const sessionId = path.split('/').pop();
        const session = RipioOffRamp.paperSessions.get(sessionId ?? '');
        if (!session) {
          throw new Error(`Session ${sessionId} not found`);
        }
        return session as T;
      }
    }

    if (path.includes('/offrampOrders/')) {
      if (method === 'GET') {
        return { transactions: [], count: 0, next: null, previous: null } as T;
      }
    }

    if (path.includes('/quotes/')) {
      if (method === 'POST') {
        const req = body as any;
        return {
          quoteId: `paper-quote-${Date.now()}`,
          fromCurrency: req.fromCurrency,
          toCurrency: req.toCurrency,
          fromAmount: req.fromAmount,
          finalFromAmount: req.fromAmount,
          toAmount: (Number.parseFloat(req.fromAmount) / 1000).toFixed(8),
          finalToAmount: (Number.parseFloat(req.fromAmount) / 1000).toFixed(8),
          rate: '1000.00000000',
          expiration: new Date(Date.now() + 30000).toISOString(),
          fees: [
            {
              amount: '1.50',
              type: 'Ripio Fee',
              currency: 'ARS',
              appliesOnFromAmount: true,
              appliesOnToAmount: false,
            },
          ],
        } as T;
      }
    }

    // Default empty response
    return {} as T;
  }

  async getBalance(): Promise<CryptoBalance[]> {
    if (this.mode === 'paper') {
      // Paper mode returns mock balances for ARS off-ramp testing
      return [
        { asset: 'USDT', network: 'ethereum', available: 1000, total: 1000 },
        { asset: 'USDC', network: 'ethereum', available: 500, total: 500 },
        { asset: 'USDT', network: 'polygon', available: 250, total: 250 },
        { asset: 'DAI', network: 'ethereum', available: 100, total: 100 },
      ];
    }

    // In live mode, Ripio doesn't have a direct balance endpoint for off-ramp.
    // Balances are tracked per customer via the Crypto as a Service API.
    // For now, return empty array (or integrate with a wallet client).
    return [];
  }

  async getAddresses(): Promise<CryptoAddress[]> {
    if (this.mode === 'paper') {
      // These are the deposit addresses where users send crypto for off-ramp.
      // In a real implementation, these would be provided by Ripio per session.
      return [
        {
          address: '0x742d35Cc6634C0532935334AdCb2f44d923604d5',
          network: 'ethereum',
          label: 'Ripio Off-Ramp Deposit (ETH)',
          verified: true,
        },
        {
          address: '0x742d35Cc6634C0532935334AdCb2f44d923604d5',
          network: 'polygon',
          label: 'Ripio Off-Ramp Deposit (Polygon)',
          verified: true,
        },
      ];
    }

    // In production, Ripio provides deposit addresses per off-ramp session.
    // We can't fetch a static list. Return empty array.
    return [];
  }

  async sendTransfer(params: {
    amount: number;
    asset: string;
    destination: string;
    network: string;
    memo?: string;
  }): Promise<CryptoTransferResult> {
    const { amount, asset, destination, network, memo } = params;

    // Validate inputs
    if (!isStablecoinAsset(asset)) {
      throw new Error(`Unsupported asset: ${asset}. Supported: USDT, USDC, DAI`);
    }

    if (!isNetworkSupported(asset, network)) {
      const supported = STABLECOIN_NETWORK_SUPPORT[asset];
      throw new Error(`${asset} is not supported on ${network}. Supported: ${supported.join(', ')}`);
    }

    const ripioNetwork = NETWORK_TO_RIPIO[network];
    if (!ripioNetwork) {
      throw new Error(`Unsupported network: ${network}`);
    }

    const ripioAsset = ASSET_TO_RIPIO[asset];
    if (!ripioAsset) {
      throw new Error(`Unsupported asset mapping for ${asset}`);
    }

    // Validate destination format (CBU/CVU/alias for Argentina)
    // CBU: 22 digits, CVU: 22 digits, alias: alphanumeric with dots
    const isCBU = /^\d{22}$/.test(destination);
    const isCVU = /^\d{22}$/.test(destination);
    const isAlias = /^[a-zA-Z0-9.]{6,20}$/.test(destination);
    if (!isCBU && !isCVU && !isAlias) {
      throw new Error(
        'Invalid destination. Must be a valid CBU (22 digits), CVU (22 digits), or alias (6-20 alphanumeric chars).'
      );
    }

    // Determine payment method based on destination
    // For Argentina, both bank_transfer and mercado_pago are supported
    // We'll default to bank_transfer unless the destination looks like a Mercado Pago alias
    const paymentMethod: PaymentMethodType = this.isMercadoPagoAlias(destination)
      ? PAYMENT_METHODS.MERCADO_PAGO
      : PAYMENT_METHODS.BANK_TRANSFER;

    if (this.mode === 'paper') {
      // In paper mode, simulate the off-ramp flow:
      // 1. Create or get customer
      // 2. Create fiat account
      // 3. Create off-ramp session
      // 4. Return deposit address

      const customerId = `paper-customer-${Date.now()}`;
      const customer: RipioCustomer = {
        customerId,
        email: `user-${Date.now()}@example.com`,
        createdAt: new Date().toISOString(),
      };
      RipioOffRamp.paperCustomers.set(customerId, customer);

      // Create fiat account
      const fiatAccountId = `paper-fiat-${Date.now()}`;
      const fiatAccount: RipioFiatAccount = {
        fiatAccountId,
        fiatAccountFields: { alias_or_cvu_destination: destination },
        createdAt: new Date().toISOString(),
        status: 'ENABLED',
        paymentMethodType: paymentMethod,
        customerId,
      };
      RipioOffRamp.paperFiatAccounts.set(fiatAccountId, fiatAccount);

      // Create off-ramp session
      const sessionId = `paper-session-${Date.now()}`;
      const session: RipioOffRampSession = {
        sessionId,
        customerId,
        createdAt: new Date().toISOString(),
        toCurrency: 'ARS',
        paymentMethodType: paymentMethod,
        fiatAccountId,
        depositAddresses: [
          {
            chain: ripioNetwork,
            address: '0x742d35Cc6634C0532935334AdCb2f44d923604d5',
          },
        ],
        transactions: [],
      };
      RipioOffRamp.paperSessions.set(sessionId, session);

      const transferId = `paper-ripio-${Date.now()}`;
      const result: CryptoTransferResult = {
        transferId,
        status: 'pending',
        amount,
        asset: asset as CryptoBalance['asset'],
        network: network as CryptoBalance['network'],
        destination, // This is the user's bank account CBU/alias in ARS
        createdAt: Date.now(),
      };
      RipioOffRamp.paperTransfers.push(result);
      return result;
    }

    // In live mode, we need to:
    // 1. Create or get customer (using external_ref as customer ID)
    // 2. Create fiat account for the destination
    // 3. Create off-ramp session
    // 4. Return the deposit address for the user to send crypto

    try {
      // Step 1: Create customer (or get existing)
      const customerId = await this.getOrCreateCustomer(destination);

      // Step 2: Create fiat account
      const fiatAccountId = await this.createFiatAccount(customerId, paymentMethod, destination);

      // Step 3: Create off-ramp session
      const session = await this.createOffRampSession(fiatAccountId, customerId);

      // Find the deposit address for the requested network
      const depositAddress = session.depositAddresses.find((addr) => addr.chain === ripioNetwork);

      if (!depositAddress) {
        throw new Error(`No deposit address available for network ${network}`);
      }

      const transferId = `ripio-session-${session.sessionId}`;
      const result: CryptoTransferResult = {
        transferId,
        status: 'pending',
        amount,
        asset: asset as CryptoBalance['asset'],
        network: network as CryptoBalance['network'],
        destination: depositAddress.address, // Return the crypto deposit address
        createdAt: Date.now(),
      };

      return result;
    } catch (error) {
      throw new Error(`Ripio off-ramp failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private isMercadoPagoAlias(destination: string): boolean {
    // Mercado Pago aliases often contain specific patterns
    // This is a heuristic - in practice, you'd need to validate with Ripio
    const mpPatterns = ['mp', 'mercadopago', 'mercado.pago'];
    const lowerDest = destination.toLowerCase();
    return mpPatterns.some((pattern) => lowerDest.includes(pattern));
  }

  private async getOrCreateCustomer(destination: string): Promise<string> {
    // In a real implementation, you'd map destination to a customer ID
    // For simplicity, we'll create a new customer each time
    // In production, you'd want to cache customer IDs per user

    const externalRef = `user-${Date.now()}`; // In real app, use actual user ID

    try {
      // Try to create customer
      const customer = await this.request<RipioCustomer>('POST', '/api/v1/customers/', {
        customerId: externalRef,
        email: `user-${externalRef}@example.com`,
        type: 'INDIVIDUAL',
      });
      return customer.customerId;
    } catch (error) {
      // If customer already exists, we might get an error
      // In production, you'd handle this properly
      return externalRef;
    }
  }

  private async createFiatAccount(
    customerId: string,
    paymentMethod: PaymentMethodType,
    destination: string
  ): Promise<string> {
    const accountFields: Record<string, string> = {};

    if (paymentMethod === PAYMENT_METHODS.BANK_TRANSFER || paymentMethod === PAYMENT_METHODS.MERCADO_PAGO) {
      accountFields.alias_or_cvu_destination = destination;
    }

    const fiatAccount = await this.request<RipioFiatAccount>('POST', '/api/v1/fiatAccounts/', {
      customerId,
      paymentMethodType: paymentMethod,
      accountFields,
    });

    return fiatAccount.fiatAccountId;
  }

  private async createOffRampSession(fiatAccountId: string, customerId: string): Promise<RipioOffRampSession> {
    const session = await this.request<RipioOffRampSession>('POST', '/api/v1/offrampSession/', {
      fiatAccountId,
      customerId, // Ripio might need this in the request
    });

    return session;
  }

  async getTransferStatus(transferId: string): Promise<CryptoTransferStatus> {
    if (this.mode === 'paper') {
      // Find the transfer in our paper storage
      const transfer = RipioOffRamp.paperTransfers.find((t) => t.transferId === transferId);

      // Simulate order completion after some time
      const isCompleted = transferId.includes('completed') || (transfer && Date.now() - transfer.createdAt > 300000); // 5 minutes

      return {
        transferId,
        status: isCompleted ? 'completed' : 'pending',
        updatedAt: Date.now(),
      };
    }

    // In live mode, we'd query Ripio's off-ramp order status endpoint
    // For now, throw not implemented.
    throw new Error('Ripio off-ramp live mode status check not yet implemented.');
  }

  async getTransferHistory(limit = 10): Promise<CryptoTransferHistoryEntry[]> {
    if (this.mode === 'paper') {
      return [
        {
          transferId: 'paper-ripio-history-1',
          amount: 100,
          asset: 'USDT',
          network: 'ethereum',
          destination: 'CBU: 1234567890123456789012',
          status: 'completed',
          fee: 1.5,
          createdAt: Date.now() - 86400000,
        },
        {
          transferId: 'paper-ripio-history-2',
          amount: 50,
          asset: 'USDC',
          network: 'polygon',
          destination: 'ALIAS: juan.perez',
          status: 'completed',
          fee: 0.5,
          createdAt: Date.now() - 172800000,
        },
      ];
    }

    // In live mode, fetch order history from Ripio
    throw new Error('Ripio off-ramp live mode history not yet implemented.');
  }

  async estimateFee(params: { asset: string; network: string; amount: number }): Promise<{
    fee: number;
    estimatedGas?: number;
  }> {
    const { asset, network, amount } = params;

    if (this.mode === 'paper') {
      // Paper mode: approximate fees (Ripio fee + network fee)
      // Ripio off-ramp fees vary by country and payment method.
      // For ARS, assume 1.5% fee + network gas.
      const ripioFeeRate = 0.015; // 1.5%
      const ripioFee = amount * ripioFeeRate;
      const networkFees: Record<string, number> = {
        ethereum: 5.0,
        polygon: 0.01,
        arbitrum: 0.5,
        optimism: 0.5,
        base: 0.01,
      };
      const networkFee = networkFees[network.toLowerCase()] ?? 1.0;
      return {
        fee: ripioFee + networkFee,
        estimatedGas: network === 'ethereum' ? 21000 : undefined,
      };
    }

    // In live mode, we'd fetch a quote from Ripio to get exact fee
    // For now, return estimated fees
    const ripioFeeRate = 0.015;
    const ripioFee = amount * ripioFeeRate;
    const networkFees: Record<string, number> = {
      ethereum: 5.0,
      polygon: 0.05,
      arbitrum: 1.0,
      optimism: 1.0,
      base: 0.05,
    };
    return {
      fee: ripioFee + (networkFees[network.toLowerCase()] ?? 2.0),
    };
  }

  // Helper method to generate payment instructions for the user
  getPaymentInstructions(transferId: string): string {
    const transfer = RipioOffRamp.paperTransfers.find((t) => t.transferId === transferId);
    if (!transfer) {
      return `Transfer ${transferId} not found`;
    }

    const lines = [
      `=== INSTRUCCIONES OFF-RAMP RIPIO ===`,
      `ID de sesión: ${transferId}`,
      `Monto: ${transfer.amount} ${transfer.asset} (${transfer.network})`,
      `Cuenta destino: ${transfer.destination}`,
      `Estado: ${transfer.status}`,
      ``,
      `Por favor, envíe sus stablecoins a la dirección de depósito proporcionada por Ripio.`,
      `Una vez recibido, Ripio procesará la conversión a ARS y transferirá a su cuenta bancaria.`,
      ``,
      `Métodos de pago soportados en Argentina:`,
      `- Transferencia bancaria (CBU/CVU)`,
      `- Mercado Pago (alias)`,
    ];

    return lines.join('\n');
  }
}

// Re-export types for convenience
import type { StablecoinAsset, StablecoinNetwork } from './types';
