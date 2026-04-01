import { cors } from 'hono/cors';

const ALLOWED_ORIGINS = (process.env.SKYNUL_ALLOWED_ORIGINS ?? '')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

export const corsMiddleware = cors({
  origin: (origin) => {
    // No origin (CLI tools, curl, file:// protocol)
    if (!origin) return '*';
    // Localhost dev
    if (origin.startsWith('http://localhost') || origin.startsWith('http://127.0.0.1')) return origin;
    // Configured production origins
    if (ALLOWED_ORIGINS.includes(origin)) return origin;
    // Reject unknown origins — empty string means no CORS headers, browser blocks
    return '';
  },
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
});
