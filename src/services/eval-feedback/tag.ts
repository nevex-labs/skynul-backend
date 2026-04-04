import { Context, Effect } from 'effect';
import type {
  ExtractedTradeDto,
  GetPerformanceSummaryOpts,
  PerformanceSummaryDto,
  ScoreInputDto,
  TradeScoreDto,
  TradeVenue,
} from '../../infrastructure/db/schema/eval-feedback';
import { DatabaseError } from '../../shared/errors';
import type { Task } from '../../shared/types';

export interface EvalFeedbackServiceApi {
  /**
   * Score a task's trading outcome and persist to trade_scores table.
   * Returns the inserted row id.
   */
  readonly saveTradeScore: (input: ScoreInputDto) => Effect.Effect<number, DatabaseError>;

  /**
   * Get a trade score by task ID.
   */
  readonly getTaskScore: (userId: number, taskId: string) => Effect.Effect<TradeScoreDto | null, DatabaseError>;

  /**
   * Get performance summary with optional filtering.
   */
  readonly getPerformanceSummary: (
    opts: GetPerformanceSummaryOpts
  ) => Effect.Effect<PerformanceSummaryDto, DatabaseError>;

  /**
   * Format performance summary for prompt injection.
   */
  readonly formatPerformanceForPrompt: (summary: PerformanceSummaryDto) => string;

  /**
   * Build feedback context for trading capabilities.
   * Returns formatted performance context if trading caps are present.
   */
  readonly buildFeedbackContext: (
    userId: number,
    capabilities: string[]
  ) => Effect.Effect<string, DatabaseError, EvalFeedbackService>;

  /**
   * Extract trades from task steps.
   * Returns null if no trades found.
   */
  readonly extractTradesFromTask: (task: Task) => Effect.Effect<
    {
      venue: TradeVenue;
      capability: string;
      trades: ExtractedTradeDto[];
      hadOpenPositionsAtDone: boolean;
    } | null,
    never
  >;

  /**
   * Compute trade scores from input.
   * Pure calculation, no side effects.
   */
  readonly computeScore: (input: ScoreInputDto) => Effect.Effect<
    {
      scorePnl: number;
      scoreDiscipline: number;
      scoreEfficiency: number;
      scoreTotal: number;
      totalPnlUsd: number;
      pnlPct: number;
    },
    never
  >;
}

export class EvalFeedbackService extends Context.Tag('EvalFeedbackService')<
  EvalFeedbackService,
  EvalFeedbackServiceApi
>() {}
