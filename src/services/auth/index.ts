import bcrypt from 'bcryptjs';
import { eq } from 'drizzle-orm';
import { Context, Effect, Layer } from 'effect';
import jwt from 'jsonwebtoken';
import { users } from '../../infrastructure/db/schema';
import { DatabaseError } from '../../shared/errors';
import { DatabaseService } from '../database/tag';

export interface AuthUser {
  readonly id: number;
  readonly email: string | null;
}

export interface AuthTokens {
  readonly accessToken: string;
  readonly refreshToken: string;
}

export class UserAlreadyExistsError {
  readonly _tag = 'UserAlreadyExistsError' as const;
  constructor(public readonly email: string) {}
}

export class InvalidCredentialsError {
  readonly _tag = 'InvalidCredentialsError' as const;
}

export class InvalidTokenError {
  readonly _tag = 'InvalidTokenError' as const;
  constructor(public readonly reason: string) {}
}

export type AuthError = UserAlreadyExistsError | InvalidCredentialsError | InvalidTokenError | DatabaseError;

export interface AuthServiceApi {
  readonly register: (email: string, password: string) => Effect.Effect<AuthUser, AuthError, DatabaseService>;
  readonly login: (email: string, password: string) => Effect.Effect<AuthTokens, AuthError, DatabaseService>;
  readonly verifyToken: (token: string) => Effect.Effect<AuthUser, AuthError, never>;
  readonly refreshToken: (refreshToken: string) => Effect.Effect<AuthTokens, AuthError, DatabaseService>;
}

export class AuthService extends Context.Tag('AuthService')<AuthService, AuthServiceApi>() {}

// Config
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'your-refresh-secret-change-in-production';
const ACCESS_TOKEN_EXPIRY = '15m';
const REFRESH_TOKEN_EXPIRY = '7d';
const SALT_ROUNDS = 10;

export const AuthServiceLive = Layer.effect(
  AuthService,
  Effect.gen(function* () {
    const db = yield* DatabaseService;

    return AuthService.of({
      register: (email: string, password: string) =>
        Effect.gen(function* () {
          // Verificar si el usuario ya existe
          const existing = yield* Effect.tryPromise({
            try: async () => {
              const result = await db.select().from(users).where(eq(users.email, email)).limit(1);
              return result;
            },
            catch: (error) => new DatabaseError(error),
          });

          if (existing.length > 0) {
            return yield* Effect.fail(new UserAlreadyExistsError(email));
          }

          // Hashear password
          const hashedPassword = yield* Effect.tryPromise({
            try: () => bcrypt.hash(password, SALT_ROUNDS),
            catch: () => new InvalidCredentialsError(),
          });

          // Crear usuario
          const result = yield* Effect.tryPromise({
            try: async () => {
              const inserted = await db.insert(users).values({ email, password: hashedPassword }).returning();
              return inserted[0];
            },
            catch: (error) => new DatabaseError(error),
          });

          return { id: result.id, email: result.email };
        }),

      login: (email: string, password: string) =>
        Effect.gen(function* () {
          // Buscar usuario
          const result = yield* Effect.tryPromise({
            try: async () => {
              const rows = await db.select().from(users).where(eq(users.email, email)).limit(1);
              return rows[0];
            },
            catch: (error) => new DatabaseError(error),
          });

          if (!result || !result.password) {
            return yield* Effect.fail(new InvalidCredentialsError());
          }

          // Verificar password
          const valid = yield* Effect.tryPromise({
            try: () => bcrypt.compare(password, result.password!),
            catch: () => new InvalidCredentialsError(),
          });

          if (!valid) {
            return yield* Effect.fail(new InvalidCredentialsError());
          }

          // Generar tokens
          const accessToken = jwt.sign({ userId: result.id, email: result.email }, JWT_SECRET, {
            expiresIn: ACCESS_TOKEN_EXPIRY,
          });
          const refreshToken = jwt.sign({ userId: result.id }, JWT_REFRESH_SECRET, {
            expiresIn: REFRESH_TOKEN_EXPIRY,
          });

          return { accessToken, refreshToken };
        }),

      verifyToken: (token: string) =>
        Effect.tryPromise({
          try: async () => {
            const decoded = jwt.verify(token, JWT_SECRET) as { userId: number; email: string };
            return { id: decoded.userId, email: decoded.email };
          },
          catch: (error) => new InvalidTokenError(String(error)),
        }),

      refreshToken: (refreshToken: string) =>
        Effect.gen(function* () {
          const decoded = yield* Effect.tryPromise({
            try: async () => {
              const result = jwt.verify(refreshToken, JWT_REFRESH_SECRET) as { userId: number };
              return result;
            },
            catch: (error) => new InvalidTokenError(String(error)),
          });

          // Buscar usuario
          const result = yield* Effect.tryPromise({
            try: async () => {
              const rows = await db.select().from(users).where(eq(users.id, decoded.userId)).limit(1);
              return rows[0];
            },
            catch: (error) => new DatabaseError(error),
          });

          if (!result) {
            return yield* Effect.fail(new InvalidTokenError('User not found'));
          }

          // Generar nuevos tokens
          const accessToken = jwt.sign({ userId: result.id, email: result.email }, JWT_SECRET, {
            expiresIn: ACCESS_TOKEN_EXPIRY,
          });
          const newRefreshToken = jwt.sign({ userId: result.id }, JWT_REFRESH_SECRET, {
            expiresIn: REFRESH_TOKEN_EXPIRY,
          });

          return { accessToken, refreshToken: newRefreshToken };
        }),
    });
  })
);
