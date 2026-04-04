import { Context, Effect } from 'effect';
import type { TaskSchedule } from '../../infrastructure/db/schema';
import { DatabaseError } from '../../shared/errors';
import type { Schedule, ScheduleFrequency } from '../../types/schedule';

export interface ScheduleInput {
  prompt: string;
  capabilities: string[];
  mode: 'browser' | 'code';
  frequency: ScheduleFrequency;
  cronExpr: string;
  enabled?: boolean;
}

export interface SchedulesServiceApi {
  /**
   * Get all schedules for a user
   */
  readonly getSchedules: (userId: number) => Effect.Effect<Schedule[], DatabaseError>;

  /**
   * Get a single schedule by ID
   */
  readonly getSchedule: (userId: number, scheduleId: string) => Effect.Effect<Schedule | null, DatabaseError>;

  /**
   * Create a new schedule
   */
  readonly createSchedule: (
    userId: number,
    scheduleId: string,
    input: ScheduleInput
  ) => Effect.Effect<Schedule, DatabaseError>;

  /**
   * Update an existing schedule
   */
  readonly updateSchedule: (
    userId: number,
    scheduleId: string,
    input: Partial<ScheduleInput>
  ) => Effect.Effect<Schedule, DatabaseError>;

  /**
   * Delete a schedule
   */
  readonly deleteSchedule: (userId: number, scheduleId: string) => Effect.Effect<void, DatabaseError>;

  /**
   * Enable/disable a schedule
   */
  readonly toggleSchedule: (
    userId: number,
    scheduleId: string,
    enabled: boolean
  ) => Effect.Effect<Schedule, DatabaseError>;

  /**
   * Update last run timestamp
   */
  readonly updateLastRun: (userId: number, scheduleId: string, timestamp: number) => Effect.Effect<void, DatabaseError>;

  /**
   * Update next run timestamp
   */
  readonly updateNextRun: (userId: number, scheduleId: string, timestamp: number) => Effect.Effect<void, DatabaseError>;
}

export class SchedulesService extends Context.Tag('SchedulesService')<SchedulesService, SchedulesServiceApi>() {}
