import { Effect } from 'effect';
import type { Context, Next } from 'hono';
import { AuthService, InvalidTokenError } from '../services/auth';

export interface AuthenticatedContext extends Context {
  Variables: {
    user: {
      id: number;
      email: string | null;
    };
  };
}

/**
 * Middleware de autenticación JWT
 * Extrae el token del header Authorization: Bearer <token>
 * y lo verifica usando AuthService
 *
 * NOTA: Este middleware debe usarse DENTRO de un handler de Effect
 * para tener acceso al AuthService del contexto
 *
 * Ejemplo:
 * handler((c) =>
 *   Effect.gen(function* () {
 *     const authService = yield* AuthService;
 *     const user = yield* verifyAuthToken(c, authService);
 *     // ...continuar con el handler
 *   })
 * )
 */
export async function verifyAuthToken(
  c: Context,
  authService: AuthServiceApi
): Promise<{ id: number; email: string | null }> {
  const authHeader = c.req.header('Authorization');

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    throw new Error('Missing or invalid authorization header');
  }

  const token = authHeader.substring(7);

  const user = await Effect.runPromise(authService.verifyToken(token));
  return user;
}

// Tipo para la API del servicio de auth
import type { AuthServiceApi } from '../services/auth';

/**
 * Helper para obtener el usuario autenticado del contexto
 */
export function getAuthUser(c: AuthenticatedContext): { id: number; email: string | null } {
  return c.get('user');
}
