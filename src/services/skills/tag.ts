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
  readonly list: () => Effect.Effect<Skill[], DatabaseError>;
  readonly create: (input: SkillInput) => Effect.Effect<Skill, DatabaseError>;
  readonly update: (id: number, input: SkillInput) => Effect.Effect<Skill, DatabaseError | SkillNotFoundError>;
  readonly delete: (id: number) => Effect.Effect<void, DatabaseError>;
  readonly toggle: (id: number) => Effect.Effect<Skill, DatabaseError | SkillNotFoundError>;
  readonly import: (input: SkillInput) => Effect.Effect<Skill[], DatabaseError>;
}

export class SkillService extends Context.Tag('SkillService')<SkillService, SkillServiceApi>() {}
