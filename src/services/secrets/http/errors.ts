import { Effect } from 'effect';
import { Http } from '../../../lib/hono-effect';
import type { HttpResponse } from '../../../lib/hono-effect';
import { CryptoError, DatabaseError, SecretNotFoundError } from '../../../shared/errors';

/**
 * Mapea errores de dominio de secrets a respuestas HTTP
 *
 * Uso:
 *   yield* secrets.get(userId, keyName).pipe(
 *     Effect.map(value => Http.ok({ value })),
 *     Effect.catchTags(secretErrorMap)
 *   );
 */
export const secretErrorMap = {
  SecretNotFoundError: (error: SecretNotFoundError): Effect.Effect<HttpResponse, never, never> =>
    Effect.succeed(Http.notFound(`Secret "${error.keyName}"`)),

  DatabaseError: (error: DatabaseError): Effect.Effect<HttpResponse, never, never> => {
    console.error('Database error:', error.cause);
    return Effect.succeed(Http.internalError('Database error'));
  },

  CryptoError: (error: CryptoError): Effect.Effect<HttpResponse, never, never> => {
    console.error('Crypto error:', error.cause);
    return Effect.succeed(Http.internalError('Encryption error'));
  },
};

/**
 * Helper para wrappear cualquier operación de secrets con manejo de errores
 */
export function withSecretHandling<A>(
  operation: Effect.Effect<A, SecretNotFoundError | DatabaseError | CryptoError, any>,
  onSuccess: (value: A) => HttpResponse
): Effect.Effect<HttpResponse, never, any> {
  return operation.pipe(Effect.map(onSuccess), Effect.catchTags(secretErrorMap));
}
