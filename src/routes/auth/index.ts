import { zValidator } from '@hono/zod-validator';
import { Effect } from 'effect';
import { Hono } from 'hono';
import { z } from 'zod';
import { AppLayer } from '../../config/layers';
import { Http, createEffectRoute } from '../../lib/hono-effect';
import { AuthService, InvalidCredentialsError, InvalidTokenError, UserAlreadyExistsError } from '../../services/auth';

const handler = createEffectRoute(AppLayer as any);

// Schema de validación
const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string(),
});

const refreshSchema = z.object({
  refreshToken: z.string(),
});

const auth = new Hono()
  // POST /auth/register
  .post(
    '/register',
    handler((c) =>
      Effect.gen(function* () {
        const body = yield* Effect.tryPromise({
          try: () => c.req.json(),
          catch: () => null,
        });

        const parsed = registerSchema.safeParse(body);
        if (!parsed.success) {
          return Http.badRequest('Invalid input: ' + parsed.error.message);
        }

        const { email, password } = parsed.data;
        const authService = yield* AuthService;

        const user = yield* authService.register(email, password);

        return Http.created({
          id: user.id,
          email: user.email,
          message: 'User registered successfully',
        });
      }).pipe(
        Effect.catchAll((error: any) => {
          if (error._tag === 'UserAlreadyExistsError') {
            return Effect.succeed(Http.conflict(`User with email ${error.email} already exists`));
          }
          console.error('Register error:', error);
          return Effect.succeed(Http.internalError());
        })
      )
    )
  )

  // POST /auth/login
  .post(
    '/login',
    handler((c) =>
      Effect.gen(function* () {
        const body = yield* Effect.tryPromise({
          try: () => c.req.json(),
          catch: () => null,
        });

        const parsed = loginSchema.safeParse(body);
        if (!parsed.success) {
          return Http.badRequest('Invalid input: ' + parsed.error.message);
        }

        const { email, password } = parsed.data;
        const authService = yield* AuthService;

        const tokens = yield* authService.login(email, password);

        return Http.ok({
          accessToken: tokens.accessToken,
          refreshToken: tokens.refreshToken,
          tokenType: 'Bearer',
          expiresIn: 900, // 15 minutos
        });
      }).pipe(
        Effect.catchAll((error: any) => {
          if (error._tag === 'InvalidCredentialsError') {
            return Effect.succeed(Http.unauthorized());
          }
          console.error('Login error:', error);
          return Effect.succeed(Http.internalError());
        })
      )
    )
  )

  // POST /auth/refresh
  .post(
    '/refresh',
    handler((c) =>
      Effect.gen(function* () {
        const body = yield* Effect.tryPromise({
          try: () => c.req.json(),
          catch: () => null,
        });

        const parsed = refreshSchema.safeParse(body);
        if (!parsed.success) {
          return Http.badRequest('Invalid input');
        }

        const { refreshToken } = parsed.data;
        const authService = yield* AuthService;

        const tokens = yield* authService.refreshToken(refreshToken);

        return Http.ok({
          accessToken: tokens.accessToken,
          refreshToken: tokens.refreshToken,
          tokenType: 'Bearer',
          expiresIn: 900,
        });
      }).pipe(
        Effect.catchAll((error: any) => {
          if (error._tag === 'InvalidTokenError') {
            return Effect.succeed(Http.unauthorized());
          }
          console.error('Refresh error:', error);
          return Effect.succeed(Http.internalError());
        })
      )
    )
  )

  // GET /auth/me (para verificar token)
  .get(
    '/me',
    handler((c) =>
      Effect.gen(function* () {
        const authHeader = c.req.header('Authorization');

        if (!authHeader || !authHeader.startsWith('Bearer ')) {
          return Http.unauthorized();
        }

        const token = authHeader.substring(7);
        const authService = yield* AuthService;

        const user = yield* authService.verifyToken(token);

        return Http.ok({ id: user.id, email: user.email });
      }).pipe(
        Effect.catchAll((error: any) => {
          if (error._tag === 'InvalidTokenError') {
            return Effect.succeed(Http.unauthorized());
          }
          return Effect.succeed(Http.internalError());
        })
      )
    )
  );

export { auth };
export type AuthRoute = typeof auth;
