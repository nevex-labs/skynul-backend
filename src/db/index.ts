import 'dotenv/config';
import { drizzle } from 'drizzle-orm/node-postgres';
import { config } from '../core/config';

export const db = drizzle(config.databaseUrl);

export * from './queries';
export * from './schema';
