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

function classifyError(error: string | Error): { code: ErrorCode; details?: string } {
  const msg = error instanceof Error ? error.message : error;
  const lower = msg.toLowerCase();

  if (
    lower.includes('429') ||
    lower.includes('rate limit') ||
    lower.includes('usage_limit') ||
    lower.includes('resets_at')
  ) {
    return { code: 'RATE_LIMIT', details: msg };
  }
  if (
    lower.includes('401') ||
    lower.includes('403') ||
    lower.includes('unauthorized') ||
    lower.includes('invalid api key') ||
    lower.includes('api key is not set')
  ) {
    return { code: 'AUTH_FAILURE', details: msg };
  }
  if (
    lower.includes('etimedout') ||
    lower.includes('econnrefused') ||
    lower.includes('network') ||
    lower.includes('fetch failed')
  ) {
    return { code: 'NETWORK_ERROR', details: msg };
  }
  if (lower.includes('timeout') || lower.includes('timed out')) {
    return { code: 'TIMEOUT', details: msg };
  }
  if (lower.includes('chrome') && (lower.includes('launch') || lower.includes('cdp') || lower.includes('executable'))) {
    return { code: 'BROWSER_LAUNCH_FAILED', details: msg };
  }
  if (lower.includes('model call error') || lower.includes('api error') || lower.includes('completion')) {
    return { code: 'MODEL_ERROR', details: msg };
  }
  if (lower.includes('validation') || lower.includes('invalid') || lower.includes('zod')) {
    return { code: 'VALIDATION_ERROR', details: msg };
  }
  if (lower.includes('require is not defined') || lower.includes('cannot find module')) {
    return { code: 'TOOL_EXECUTION_FAILED', details: msg };
  }

  return { code: 'UNKNOWN', details: msg };
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
