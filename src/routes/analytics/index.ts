import { Effect } from 'effect';
import { Hono } from 'hono';
import { AppLayer } from '../../config/layers';
import { TaskManager } from '../../core/agent/task-manager';
import { Http, createEffectRoute } from '../../lib/hono-effect';
import type { HttpResponse } from '../../lib/hono-effect';
import { PaperPortfolioService } from '../../services/paper-portfolio/tag';
import { SchedulesService } from '../../services/schedules';

const handler = createEffectRoute(AppLayer as any);

const handleError = (error: any): HttpResponse => {
  console.error('Analytics error:', error);
  return Http.internalError();
};

// Singleton TaskManager instance (same as routes/tasks/routes.ts)
const tm = new TaskManager();

const analytics = new Hono().get(
  '/overview',
  handler((c) =>
    Effect.gen(function* () {
      const mode = (c.req.query('mode') || 'paper') as 'paper' | 'real';
      const userId = (c.get('jwtPayload') as any)?.userId as number | undefined;

      // ── Task metrics (from in-memory TaskManager) ──────────────────
      const allTasks = tm.list();
      const activeAgents = allTasks.filter(
        (t) => t.status === 'running' || t.status === 'approved' || t.status === 'pending_approval'
      ).length;

      const completed = allTasks.filter((t) => t.status === 'completed').length;
      const failed = allTasks.filter((t) => t.status === 'failed').length;
      const resolved = completed + failed;
      const winRate = resolved > 0 ? Math.round((completed / resolved) * 100) : null;

      const lastRunAt = allTasks.length > 0 ? Math.max(...allTasks.map((t) => t.updatedAt)) : null;

      // ── Schedule metrics (from DB via Effect) ──────────────────────
      const scheduleService = yield* SchedulesService;
      const schedules = userId
        ? yield* scheduleService.getSchedules(userId).pipe(Effect.catchAll(() => Effect.succeed([])))
        : [];

      const enabledSchedules = schedules.filter((s) => s.enabled);
      const scheduledAgents = enabledSchedules.length;

      const nextRunAt =
        enabledSchedules.length > 0
          ? Math.min(...enabledSchedules.map((s) => s.nextRunAt ?? Number.POSITIVE_INFINITY))
          : null;

      // ── Paper portfolio (from DB via Effect) ───────────────────────
      let paperPortfolioData = {
        usdcBalance: 0,
        totalUsd: 0,
        nonUsdcPositions: [] as { asset: string; amount: string }[],
        pnlTotal: null as number | null,
        todayPnl: 0,
        tradesToday: 0,
      };

      if (userId) {
        const paperService = yield* PaperPortfolioService;
        const balances = yield* paperService.getBalances(userId).pipe(Effect.catchAll(() => Effect.succeed([])));
        const trades = yield* paperService.getTrades(userId).pipe(Effect.catchAll(() => Effect.succeed([])));

        const usdcBalance = balances.find((b) => b.asset === 'USDC')?.amount ?? 0;
        const nonUsdcPositions = balances
          .filter((b) => b.asset !== 'USDC' && b.asset !== 'USDT' && b.asset !== 'DAI')
          .map((b) => ({ asset: b.asset, amount: String(b.amount) }));

        const totalUsd = balances.reduce((sum, b) => {
          if (b.asset === 'USDC' || b.asset === 'USDT' || b.asset === 'DAI') return sum + b.amount;
          return sum;
        }, 0);

        // Today's trades
        const startOfDay = new Date();
        startOfDay.setHours(0, 0, 0, 0);
        const startOfDayMs = startOfDay.getTime();

        const todayTrades = trades.filter((t) => t.createdAt >= startOfDayMs);

        // PnL today: approximate from today's trade volume
        const todayPnl = todayTrades.reduce((sum, t) => {
          if (t.side === 'sell' && t.price && t.size) return sum + t.price * t.size;
          if (t.side === 'buy' && t.price && t.size) return sum - t.price * t.size;
          return sum;
        }, 0);

        const startingBalance = 10000; // Default starting balance

        paperPortfolioData = {
          usdcBalance,
          totalUsd,
          nonUsdcPositions,
          pnlTotal: mode === 'paper' ? totalUsd - startingBalance : null,
          todayPnl,
          tradesToday: todayTrades.length,
        };
      }

      const exposureUsd = paperPortfolioData.totalUsd - paperPortfolioData.usdcBalance;

      return Http.ok({
        activeAgents,
        scheduledAgents,
        nextRunAt: nextRunAt === Number.POSITIVE_INFINITY ? null : nextRunAt,
        lastRunAt,
        winRate,
        balance: {
          usdc: String(paperPortfolioData.usdcBalance),
          totalUsd: String(paperPortfolioData.totalUsd),
          exposureUsd: String(exposureUsd),
          nonUsdcPositions: paperPortfolioData.nonUsdcPositions,
        },
        pnl: {
          total: paperPortfolioData.pnlTotal,
          today: mode === 'paper' ? paperPortfolioData.todayPnl : null,
          tradesToday: mode === 'paper' ? paperPortfolioData.tradesToday : 0,
        },
      });
    }).pipe(Effect.catchAll((error) => Effect.succeed(handleError(error))))
  )
);

export { analytics };
export type AnalyticsRoute = typeof analytics;
