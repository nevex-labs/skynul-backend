import { Effect } from 'effect';
import type { AppSetting, TradingSetting } from '../../infrastructure/db/schema';
import { DatabaseLive } from '../../services/database';
import { SettingsService, SettingsServiceLive } from '../../services/settings';
import type { LanguageCode, PolicyState, ProviderId, ThemeMode } from '../../shared/types';

export async function loadPolicy(userId: number): Promise<PolicyState | null> {
  try {
    const program = Effect.gen(function* () {
      const svc = yield* SettingsService;
      const settings = yield* svc.getSettings(userId);
      const trading = yield* svc.getTradingSettings(userId);
      return { settings, trading };
    }).pipe(Effect.provide(SettingsServiceLive), Effect.provide(DatabaseLive));

    const { settings, trading } = await Effect.runPromise(
      program as Effect.Effect<{ settings: AppSetting; trading: TradingSetting }, never, never>
    );

    return {
      capabilities: {
        'fs.read': true,
        'fs.write': true,
        'cmd.run': true,
        'net.http': true,
      },
      themeMode: settings.themeMode as ThemeMode,
      language: settings.language as LanguageCode,
      provider: {
        active: settings.activeProvider as ProviderId,
        openaiModel: settings.openaiModel,
      },
      taskMemoryEnabled: settings.taskMemoryEnabled,
      taskAutoApprove: settings.taskAutoApprove,
      paperTradingEnabled: trading.paperTrading,
    };
  } catch {
    return null;
  }
}
