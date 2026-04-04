import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Context, Effect } from 'effect';
import type * as schema from '../../infrastructure/db/schema';

export type Database = NodePgDatabase<typeof schema>;

export class DatabaseService extends Context.Tag('DatabaseService')<DatabaseService, Database>() {}
