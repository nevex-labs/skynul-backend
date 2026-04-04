import { Context, Effect } from 'effect';
import type {
  ExitTrigger,
  RiskCheckResult,
  RiskConfig,
  RiskLimits,
  RiskPositionDto,
  TradingMode,
  VenueId,
  YoloCheckResult,
} from '../../infrastructure/db/schema/risk-guard';
import { DatabaseError } from '../../shared/errors';

export interface RiskGuardServiceApi {
  /**
   * Check whether a trade is allowed given current risk limits.
   * Call BEFORE executing any live trade action.
   */
  readonly checkTradeAllowed: (
    userId: number,
    venue: VenueId,
    amountUsd: number
  ) => Effect.Effect<RiskCheckResult, DatabaseError>;

  /**
   * Get effective limits for a venue (global + venue override).
   */
  readonly getEffectiveLimits: (userId: number, venue: VenueId) => Effect.Effect<RiskLimits, DatabaseError>;

  /**
   * Get daily volume traded for a venue (or all venues if venue not specified).
   */
  readonly getDailyVolume: (userId: number, venue?: VenueId) => Effect.Effect<number, DatabaseError>;

  /**
   * Record trade volume for daily tracking.
   */
  readonly recordTradeVolume: (userId: number, venue: VenueId, amountUsd: number) => Effect.Effect<void, DatabaseError>;

  /**
   * Get count of open positions (or for a specific venue).
   */
  readonly getOpenPositionCount: (userId: number, venue?: VenueId) => Effect.Effect<number, DatabaseError>;

  /**
   * Get all open positions (or for a specific venue).
   */
  readonly getOpenPositions: (userId: number, venue?: VenueId) => Effect.Effect<RiskPositionDto[], DatabaseError>;

  /**
   * Open a new risk position.
   * Returns the position ID.
   */
  readonly openRiskPosition: (
    userId: number,
    venue: VenueId,
    symbol: string,
    side: string,
    sizeUsd: number,
    taskId?: string,
    mode?: TradingMode,
    entryPrice?: number
  ) => Effect.Effect<number, DatabaseError>;

  /**
   * Close a risk position by ID.
   */
  readonly closeRiskPosition: (
    userId: number,
    positionId: number,
    exitPrice?: number,
    exitReason?: string
  ) => Effect.Effect<void, DatabaseError>;

  /**
   * Close all positions for a task.
   */
  readonly closeAllPositionsForTask: (userId: number, taskId: string) => Effect.Effect<void, DatabaseError>;

  /**
   * Check YOLO mode entry criteria for a token.
   */
  readonly checkYoloEntryCriteria: (
    userId: number,
    tokenInfo: {
      liquidityUsd: number;
      uniqueHolders: number;
      topHolderPercent: number;
      devHoldingPercent: number;
      mintAuthority?: boolean;
      freezeAuthority?: boolean;
      ageMinutes: number;
    },
    mode?: TradingMode
  ) => Effect.Effect<YoloCheckResult, DatabaseError>;

  /**
   * Check daily loss limit for YOLO mode.
   */
  readonly checkDailyLossLimit: (userId: number, mode?: TradingMode) => Effect.Effect<YoloCheckResult, DatabaseError>;

  /**
   * Check if enough time has passed since last trade (cooldown).
   */
  readonly checkTradeCooldown: (userId: number, mode?: TradingMode) => Effect.Effect<YoloCheckResult, DatabaseError>;

  /**
   * Check if position should be auto-closed based on exit criteria.
   */
  readonly checkExitTriggers: (
    userId: number,
    position: {
      entryPrice: number;
      currentPrice: number;
      sizeUsd: number;
      openedAt: number;
    },
    mode?: TradingMode
  ) => Effect.Effect<ExitTrigger | null, DatabaseError>;

  /**
   * Load risk configuration from file.
   */
  readonly loadRiskConfig: (userId: number) => Effect.Effect<RiskConfig, DatabaseError>;

  /**
   * Save risk configuration to file.
   */
  readonly saveRiskConfig: (userId: number, config: RiskConfig) => Effect.Effect<void, DatabaseError>;
}

export class RiskGuardService extends Context.Tag('RiskGuardService')<RiskGuardService, RiskGuardServiceApi>() {}
