import { Context, Effect } from 'effect';
import type {
  ObservationDto,
  SaveObservationInput,
  SearchObservationsOpts,
  TaskMemoryDto,
  UserFactDto,
} from '../../infrastructure/db/schema/task-memory';
import { DatabaseError } from '../../shared/errors';

export interface TaskMemoryServiceApi {
  /**
   * Save a task memory entry.
   */
  readonly saveMemory: (
    userId: number,
    entry: {
      taskId: string;
      prompt: string;
      outcome: 'completed' | 'failed';
      learnings: string;
      provider?: string;
      durationMs?: number;
    }
  ) => Effect.Effect<void, DatabaseError>;

  /**
   * Search task memories using full-text search.
   * Returns memories ranked by relevance and recency.
   */
  readonly searchMemories: (
    userId: number,
    query: string,
    limit?: number
  ) => Effect.Effect<TaskMemoryDto[], DatabaseError>;

  /**
   * Format memories for prompt injection.
   */
  readonly formatMemoriesForPrompt: (memories: TaskMemoryDto[]) => string;

  /**
   * Save a user fact.
   */
  readonly saveFact: (userId: number, fact: string) => Effect.Effect<void, DatabaseError>;

  /**
   * Delete a user fact by id.
   */
  readonly deleteFact: (userId: number, id: number) => Effect.Effect<void, DatabaseError>;

  /**
   * List all user facts for a user.
   */
  readonly listFacts: (userId: number) => Effect.Effect<UserFactDto[], DatabaseError>;

  /**
   * Search user facts using full-text search.
   * If the user has few facts (< 20), returns all facts.
   */
  readonly searchFacts: (userId: number, query: string, limit?: number) => Effect.Effect<string[], DatabaseError>;

  /**
   * Format facts for prompt injection.
   */
  readonly formatFactsForPrompt: (facts: string[]) => string;

  /**
   * Save a structured observation.
   * Uses topic_key upsert or hash deduplication logic.
   * Returns the id of the affected row.
   */
  readonly saveObservation: (userId: number, input: SaveObservationInput) => Effect.Effect<number, DatabaseError>;

  /**
   * Search observations using full-text search.
   * Excludes soft-deleted observations.
   */
  readonly searchObservations: (
    userId: number,
    query: string,
    opts?: SearchObservationsOpts
  ) => Effect.Effect<ObservationDto[], DatabaseError>;

  /**
   * Get recent observations ordered by updated_at.
   * Excludes soft-deleted observations.
   */
  readonly getRecentObservations: (
    userId: number,
    opts?: SearchObservationsOpts
  ) => Effect.Effect<ObservationDto[], DatabaseError>;

  /**
   * Soft-delete an observation by id.
   */
  readonly deleteObservation: (userId: number, id: number) => Effect.Effect<void, DatabaseError>;

  /**
   * Format observations for prompt injection.
   */
  readonly formatObservationsForPrompt: (observations: ObservationDto[]) => string;
}

export class TaskMemoryService extends Context.Tag('TaskMemoryService')<TaskMemoryService, TaskMemoryServiceApi>() {}
