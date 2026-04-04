import { Context, Effect } from 'effect';
import type { Session } from '../../infrastructure/db/schema';
import { DatabaseError, SessionNotFoundError } from '../../shared/errors';

export interface SessionInput {
  sessionId: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  oauthSubject: string;
  appUserId?: number | null;
  displayName?: string;
  avatarUrl?: string;
}

export interface SessionServiceApi {
  readonly create: (input: SessionInput) => Effect.Effect<Session, DatabaseError>;
  readonly getById: (sessionId: string) => Effect.Effect<Session, DatabaseError | SessionNotFoundError>;
  readonly delete: (sessionId: string) => Effect.Effect<void, DatabaseError>;
  readonly update: (
    sessionId: string,
    patch: Partial<SessionInput>
  ) => Effect.Effect<Session, DatabaseError | SessionNotFoundError>;
  readonly cleanupExpired: () => Effect.Effect<number, DatabaseError>;
}

export class SessionService extends Context.Tag('SessionService')<SessionService, SessionServiceApi>() {}
