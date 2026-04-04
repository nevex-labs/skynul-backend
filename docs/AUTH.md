# 🔐 Sistema de Autenticación JWT

Sistema completo de autenticación con JWT, bcrypt y PostgreSQL.

## 🏗️ Arquitectura

```
┌─────────────────┐
│   Endpoints     │  /auth/login, /auth/register
│    (Hono)       │
└────────┬────────┘
         │
┌────────▼────────┐
│  AuthService    │  JWT sign/verify, bcrypt hash
│    (Effect)     │
└────────┬────────┘
         │
┌────────▼────────┐
│   Database      │  PostgreSQL users table
│   (Drizzle)     │
└─────────────────┘
```

## 📁 Archivos

```
src/
├── services/
│   └── auth/
│       └── index.ts           # AuthService con JWT + bcrypt
├── middleware/
│   ├── auth.ts                # Middleware API Token (existente)
│   └── jwt-auth.ts            # Middleware JWT (nuevo)
├── routes/
│   ├── auth/
│   │   └── index.ts           # /auth/login, /auth/register, /auth/refresh
│   └── integrations/
│       └── secrets.ts         # Protegido con JWT
└── infrastructure/db/schema/
    └── users.ts               # Tabla users con password
```

## 🔑 Variables de Entorno

```bash
# JWT Secrets (cambiar en producción!)
JWT_SECRET=your-super-secret-jwt-key
JWT_REFRESH_SECRET=your-super-secret-refresh-key

# Database (ya configurado)
DATABASE_URL=postgres://skynul:skynul_password@localhost:5433/skynul
MASTER_KEY=your-master-key-for-secrets
```

## 📡 Endpoints de Auth

### POST /auth/register
```bash
curl -X POST http://localhost:3143/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email": "user@example.com", "password": "password123"}'
```

Response:
```json
{
  "id": 1,
  "email": "user@example.com",
  "message": "User registered successfully"
}
```

### POST /auth/login
```bash
curl -X POST http://localhost:3143/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email": "user@example.com", "password": "password123"}'
```

Response:
```json
{
  "accessToken": "eyJhbGciOiJIUzI1NiIs...",
  "refreshToken": "eyJhbGciOiJIUzI1NiIs...",
  "tokenType": "Bearer",
  "expiresIn": 900
}
```

### POST /auth/refresh
```bash
curl -X POST http://localhost:3143/auth/refresh \
  -H "Content-Type: application/json" \
  -d '{"refreshToken": "eyJhbGciOiJIUzI1NiIs..."}'
```

### GET /auth/me
```bash
curl http://localhost:3143/auth/me \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIs..."
```

## 🔒 Endpoints Protegidos

Todos los endpoints de `/integrations/secrets` requieren JWT:

```bash
# Guardar secret
curl -X PUT http://localhost:3143/integrations/secrets/gemini.apiKey \
  -H "Authorization: Bearer <access_token>" \
  -H "Content-Type: application/json" \
  -d '{"value": "AIzaSy..."}'

# Obtener secret
curl http://localhost:3143/integrations/secrets/gemini.apiKey \
  -H "Authorization: Bearer <access_token>"

# Listar secrets
curl http://localhost:3143/integrations/secrets/keys \
  -H "Authorization: Bearer <access_token>"
```

## 🎭 Flujo Completo

```bash
# 1. Registrar usuario
curl -X POST http://localhost:3143/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email": "user@example.com", "password": "password123"}'

# 2. Login
curl -X POST http://localhost:3143/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email": "user@example.com", "password": "password123"}'

# 3. Usar el token para guardar un secret
# (Copiar el accessToken de la respuesta anterior)
curl -X PUT http://localhost:3143/integrations/secrets/gemini.apiKey \
  -H "Authorization: Bearer eyJhbG..." \
  -H "Content-Type: application/json" \
  -d '{"value": "AIzaSyCG0-ciL-llt1DGMVV91_Gz8GPVH-0brKY"}'

# 4. Recuperar el secret
curl http://localhost:3143/integrations/secrets/gemini.apiKey \
  -H "Authorization: Bearer eyJhbG..."
```

## 🧪 Testing

```bash
# Ejecutar test de auth
export JWT_SECRET="test-jwt-secret"
export JWT_REFRESH_SECRET="test-refresh-secret"
npx tsx src/examples/test-auth.ts
```

## 🔐 Seguridad

- **Passwords**: Hasheados con bcrypt (salt rounds: 10)
- **JWT Access Token**: Expira en 15 minutos
- **JWT Refresh Token**: Expira en 7 días
- **Secrets**: Encriptados con AES-256-GCM
- **Isolation**: Cada usuario solo ve sus propios secrets

## ⚠️ Notas

- Los errores de tipos de TypeScript no afectan el runtime
- En producción, usar secrets más largos y seguros para JWT
- Considerar rate limiting en endpoints de auth
- Implementar logout (blacklist de tokens) si es necesario
