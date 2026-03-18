import { cors } from 'hono/cors'

export const corsMiddleware = cors({
  origin: (origin) => {
    // Allow Electron (file:// has no origin) and localhost dev
    if (!origin) return '*'
    if (origin.startsWith('http://localhost')) return origin
    if (origin.startsWith('http://127.0.0.1')) return origin
    // TODO: Add production web domain here
    return origin
  },
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization'],
  credentials: true
})
