import { dirname, join } from 'path';
import { mkdir, readFile, writeFile } from 'fs/promises';
import { DEFAULT_TRADING_SETTINGS, type TradingSettings } from '../../types/trading';
import { getDataDir } from '../config';
import { TradingSettingsSchema } from './schemas';

function tradingPath(): string {
  return join(getDataDir(), 'trading.json');
}

function normalizeTrading(parsed: Record<string, unknown>): TradingSettings {
  // Merge defaults shallowly to keep backward compatibility when schema evolves.
  // version is pinned to 1 for now.
  const p = parsed as Partial<TradingSettings>;
  return {
    ...DEFAULT_TRADING_SETTINGS,
    ...(p ?? {}),
    cex: {
      ...DEFAULT_TRADING_SETTINGS.cex,
      ...(p.cex ?? {}),
      exchanges: {
        ...DEFAULT_TRADING_SETTINGS.cex.exchanges,
        ...((p.cex as any)?.exchanges ?? {}),
      },
    },
    dex: {
      ...DEFAULT_TRADING_SETTINGS.dex,
      ...(p.dex ?? {}),
      evm: {
        ...DEFAULT_TRADING_SETTINGS.dex.evm,
        ...((p.dex as any)?.evm ?? {}),
      },
      solana: {
        ...DEFAULT_TRADING_SETTINGS.dex.solana,
        ...((p.dex as any)?.solana ?? {}),
      },
      bitcoin: {
        ...DEFAULT_TRADING_SETTINGS.dex.bitcoin,
        ...((p.dex as any)?.bitcoin ?? {}),
      },
    },
  };
}

export async function loadTradingSettings(): Promise<TradingSettings> {
  try {
    const raw = await readFile(tradingPath(), 'utf8');
    const parsed = JSON.parse(raw);
    const result = TradingSettingsSchema.safeParse(parsed);
    if (result.success) return normalizeTrading(result.data as unknown as Record<string, unknown>);
    console.warn('[trading-store] Invalid data:', result.error.issues);
    if (parsed && typeof parsed === 'object') return normalizeTrading(parsed as Record<string, unknown>);
  } catch {
    // fall through to default
  }
  return DEFAULT_TRADING_SETTINGS;
}

export async function saveTradingSettings(next: TradingSettings): Promise<void> {
  const file = tradingPath();
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(next, null, 2) + '\n', 'utf8');
}
