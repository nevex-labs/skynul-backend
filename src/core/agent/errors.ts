import type { TaskStep } from '../../types/task';

export type ErrorCode =
  | 'RATE_LIMIT'
  | 'AUTH_FAILURE'
  | 'NETWORK_ERROR'
  | 'TOOL_EXECUTION_FAILED'
  | 'MODEL_ERROR'
  | 'TIMEOUT'
  | 'BROWSER_LAUNCH_FAILED'
  | 'VALIDATION_ERROR'
  | 'UNKNOWN';

export interface FormattedError {
  code: ErrorCode;
  message: string;
  userMessage: string;
  isRetryable: boolean;
  details?: string;
}

const ERROR_MESSAGES: Record<ErrorCode, { userMessage: string; retryable: boolean }> = {
  RATE_LIMIT: {
    userMessage:
      'Has alcanzado el límite de uso de tu plan. Intenta de nuevo más tarde o considera actualizar tu plan.',
    retryable: true,
  },
  AUTH_FAILURE: {
    userMessage: 'Error de autenticación. Verificá tu API key o tokens de acceso.',
    retryable: false,
  },
  NETWORK_ERROR: {
    userMessage: 'Error de conexión. Verificá tu conexión a internet e intentá de nuevo.',
    retryable: true,
  },
  TOOL_EXECUTION_FAILED: {
    userMessage: 'La herramienta no pudo ejecutarse. El comando puede haber fallado o estar bloqueado.',
    retryable: true,
  },
  MODEL_ERROR: {
    userMessage: 'El modelo de IA tuvo un problema. Intentá de nuevo en unos segundos.',
    retryable: true,
  },
  TIMEOUT: {
    userMessage: 'La operación tardó demasiado. Intentá de nuevo.',
    retryable: true,
  },
  BROWSER_LAUNCH_FAILED: {
    userMessage: 'No se pudo iniciar el navegador. Cerrá otras instancias de Chrome que estén usando el mismo perfil.',
    retryable: true,
  },
  VALIDATION_ERROR: {
    userMessage: 'Los datos enviados no son válidos. Revisá la entrada e intentá de nuevo.',
    retryable: false,
  },
  UNKNOWN: {
    userMessage: 'Ocurrió un error inesperado. Intentá de nuevo.',
    retryable: true,
  },
};

type ErrorPattern = { patterns: string[]; and?: string[]; code: ErrorCode };

const ERROR_PATTERNS: ErrorPattern[] = [
  { patterns: ['429', 'rate limit', 'usage_limit', 'resets_at'], code: 'RATE_LIMIT' },
  { patterns: ['401', '403', 'unauthorized', 'invalid api key', 'api key is not set'], code: 'AUTH_FAILURE' },
  { patterns: ['etimedout', 'econnrefused', 'network', 'fetch failed'], code: 'NETWORK_ERROR' },
  { patterns: ['timeout', 'timed out'], code: 'TIMEOUT' },
  { patterns: ['chrome'], and: ['launch', 'cdp', 'executable'], code: 'BROWSER_LAUNCH_FAILED' },
  { patterns: ['model call error', 'api error', 'completion'], code: 'MODEL_ERROR' },
  { patterns: ['validation', 'invalid', 'zod'], code: 'VALIDATION_ERROR' },
  { patterns: ['require is not defined', 'cannot find module'], code: 'TOOL_EXECUTION_FAILED' },
];

function matchesPattern(lower: string, p: ErrorPattern): boolean {
  const base = p.patterns.some((t) => lower.includes(t));
  if (!base) return false;
  if (p.and) return p.and.some((t) => lower.includes(t));
  return true;
}

function classifyError(error: string | Error): { code: ErrorCode; details?: string } {
  const msg = error instanceof Error ? error.message : error;
  const lower = msg.toLowerCase();
  const match = ERROR_PATTERNS.find((p) => matchesPattern(lower, p));
  return { code: match?.code ?? 'UNKNOWN', details: msg };
}

export function formatError(error: string | Error): FormattedError {
  const { code, details } = classifyError(error);
  const config = ERROR_MESSAGES[code];

  return {
    code,
    message: details ?? (error instanceof Error ? error.message : error),
    userMessage: config.userMessage,
    isRetryable: config.retryable,
    details,
  };
}

export function formatStepError(error: string | undefined): Pick<TaskStep, 'error'> {
  if (!error) return { error: undefined };

  const formatted = formatError(error);
  return {
    error: `[${formatted.code}] ${formatted.userMessage}${formatted.details ? ` (${formatted.details.slice(0, 100)})` : ''}`,
  };
}

export function formatTaskError(
  taskError: string | undefined
): { error: string; formatted: FormattedError } | undefined {
  if (!taskError) return undefined;

  const formatted = formatError(taskError);
  return {
    error: formatted.userMessage,
    formatted,
  };
}
