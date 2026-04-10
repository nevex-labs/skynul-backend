// Stub - trading disabled per user request
export type RiskCheckResult = { allowed: true } | { allowed: false; reason: string };
export type VenueId = 'polymarket' | 'chain' | 'binance' | 'coinbase';

export const checkTradeAllowed = (_venue: VenueId | string, _amount: number): Promise<RiskCheckResult> =>
  Promise.resolve({ allowed: true });
export const openRiskPosition = (
  _venue: VenueId | string,
  _symbol: string,
  _side: string,
  _size: number,
  _taskId?: string
): Promise<void> => Promise.resolve();
export const recordTradeVolume = (_venue: VenueId | string, _volume: number): Promise<void> => Promise.resolve();
export const loadRiskConfig = async () => ({
  global: { enabled: true, maxSingleTradeUsd: 500, maxDailyVolumeUsd: 5000, maxConcurrentPositions: 5 },
});
export const DEFAULT_RISK_LIMITS = {
  maxSingleTradeUsd: 500,
  maxDailyVolumeUsd: 5000,
  maxConcurrentPositions: 5,
  enabled: true,
};
