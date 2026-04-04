import { Context, Effect } from 'effect';
import type { AppSetting, TradingSetting } from '../../infrastructure/db/schema';
import { DatabaseError } from '../../shared/errors';

export interface SettingsInput {
  workspaceRoot?: string | null;
  capabilities?: {
    'fs.read'?: boolean;
    'fs.write'?: boolean;
    'cmd.run'?: boolean;
    'net.http'?: boolean;
  };
  themeMode?: 'system' | 'light' | 'dark';
  language?: 'en' | 'es';
  provider?: {
    active?: string;
    openaiModel?: string;
  };
  taskMemoryEnabled?: boolean;
  taskAutoApprove?: boolean;
  paperTradingEnabled?: boolean;
}

export interface TradingSettingsInput {
  paperTrading?: boolean;
  autoApprove?: boolean;
  cexProviders?: string[];
  dexProviders?: string[];
  chainConfigs?: Record<string, unknown>;
}

export interface SettingsServiceApi {
  // App settings
  readonly getSettings: (userId: number) => Effect.Effect<AppSetting, DatabaseError>;
  readonly updateSettings: (userId: number, settings: SettingsInput) => Effect.Effect<AppSetting, DatabaseError>;
  readonly updateCapability: (
    userId: number,
    capability: string,
    enabled: boolean
  ) => Effect.Effect<AppSetting, DatabaseError>;
  readonly updateTheme: (userId: number, themeMode: string) => Effect.Effect<AppSetting, DatabaseError>;
  readonly updateLanguage: (userId: number, language: string) => Effect.Effect<AppSetting, DatabaseError>;
  readonly updateProvider: (userId: number, active: string) => Effect.Effect<AppSetting, DatabaseError>;
  readonly updateProviderModel: (userId: number, model: string) => Effect.Effect<AppSetting, DatabaseError>;
  readonly updateTaskMemory: (userId: number, enabled: boolean) => Effect.Effect<AppSetting, DatabaseError>;
  readonly updateTaskAutoApprove: (userId: number, enabled: boolean) => Effect.Effect<AppSetting, DatabaseError>;
  readonly updatePaperTrading: (userId: number, enabled: boolean) => Effect.Effect<AppSetting, DatabaseError>;
  readonly updateWorkspace: (userId: number, path: string | null) => Effect.Effect<AppSetting, DatabaseError>;

  // Trading settings
  readonly getTradingSettings: (userId: number) => Effect.Effect<TradingSetting, DatabaseError>;
  readonly updateTradingSettings: (
    userId: number,
    settings: TradingSettingsInput
  ) => Effect.Effect<TradingSetting, DatabaseError>;
}

export class SettingsService extends Context.Tag('SettingsService')<SettingsService, SettingsServiceApi>() {}
