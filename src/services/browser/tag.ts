import { Context, Effect } from 'effect';
import type { BrowserSnapshot } from '../../infrastructure/db/schema';
import { BrowserSnapshotNotFoundError, DatabaseError } from '../../shared/errors';

export interface BrowserSnapshotServiceApi {
  readonly list: () => Effect.Effect<BrowserSnapshot[], DatabaseError>;
  readonly create: (name: string, url: string, title: string) => Effect.Effect<BrowserSnapshot, DatabaseError>;
  readonly getById: (
    snapshotId: string
  ) => Effect.Effect<BrowserSnapshot, DatabaseError | BrowserSnapshotNotFoundError>;
  readonly delete: (snapshotId: string) => Effect.Effect<void, DatabaseError>;
}

export class BrowserSnapshotService extends Context.Tag('BrowserSnapshotService')<
  BrowserSnapshotService,
  BrowserSnapshotServiceApi
>() {}
