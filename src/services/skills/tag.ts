import { Context, Effect } from 'effect';
import type { Skill } from '../../infrastructure/db/schema';
import { DatabaseError, SkillNotFoundError } from '../../shared/errors';

export type SkillInput = {
  name: string;
  tag: string;
  description: string;
  prompt: string;
  enabled?: boolean;
};

export interface SkillServiceApi {
  readonly list: (userId: number) => Effect.Effect<Skill[], DatabaseError>;
  readonly create: (userId: number, input: SkillInput) => Effect.Effect<Skill, DatabaseError>;
  readonly update: (
    userId: number,
    id: number,
    input: SkillInput
  ) => Effect.Effect<Skill, DatabaseError | SkillNotFoundError>;
  readonly delete: (userId: number, id: number) => Effect.Effect<void, DatabaseError | SkillNotFoundError>;
  readonly toggle: (userId: number, id: number) => Effect.Effect<Skill, DatabaseError | SkillNotFoundError>;
  readonly import: (userId: number, input: SkillInput) => Effect.Effect<Skill[], DatabaseError>;
}

export class SkillService extends Context.Tag('SkillService')<SkillService, SkillServiceApi>() {}
