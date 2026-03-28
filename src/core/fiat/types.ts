export type FiatProviderId = 'prometeo' | 'plaid' | 'manual';

export type FiatBalance = {
  currency: string;
  available: number;
  total: number;
};

export type FiatAccount = {
  id: string;
  label: string;
  currency: string;
  type: string;
  institution: string;
};

export type FiatTransferResult = {
  transferId: string;
  status: 'pending' | 'completed' | 'failed' | 'requires_auth';
  amount: number;
  currency: string;
  destination: string;
  createdAt: number;
  authorizationRequired?: string;
};

export type FiatTransferStatus = {
  transferId: string;
  status: 'pending' | 'completed' | 'failed';
  updatedAt: number;
};

export type FiatTransferHistoryEntry = {
  transferId: string;
  amount: number;
  currency: string;
  destination: string;
  status: string;
  createdAt: number;
};
