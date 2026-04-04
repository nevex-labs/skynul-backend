# Wallet Authentication API

## Overview

Skynul uses **SIWE (Sign-In With Ethereum)** style authentication. Users connect their crypto wallet, sign a message, and receive a JWT token. No passwords, no private keys stored on the server.

**Key principles:**
- Users can connect **multiple wallets** (MetaMask, Coinbase Wallet, Phantom, etc.) to the same account
- Each wallet is identified by `address + chain`
- All data (tasks, secrets, settings) is isolated by `userId`, not by wallet
- JWT tokens are issued after successful signature verification

---

## Endpoints

### 1. Get Nonce

**`GET /auth/wallet/nonce`**

Generates a random nonce for the user to sign. The nonce expires after 5 minutes.

**Query Parameters:**
| Parameter | Type   | Required | Description                    |
|-----------|--------|----------|--------------------------------|
| `address` | string | Yes      | Wallet address (checksum or lowercase) |
| `chain`   | string | No       | Chain type: `evm` (default), `solana`, `bitcoin` |

**Response:**
```json
{
  "nonce": "3267eae888d3701ee022376fed298aeb",
  "message": "Sign in to Skynul\n\nNonce: 3267eae888d3701ee022376fed298aeb\n\nThis request will not trigger a blockchain transaction or cost any gas fees.",
  "chain": "evm"
}
```

**Example:**
```bash
curl "http://localhost:3142/auth/wallet/nonce?address=0x1234...abcd&chain=evm"
```

---

### 2. Verify Signature

**`POST /auth/wallet/verify`**

Verifies the signed message and returns a JWT token. If the wallet doesn't exist, a new user is created automatically.

**Request Body:**
```json
{
  "address": "0x1234...abcd",
  "signature": "0x...",
  "chain": "evm"
}
```

| Field       | Type   | Required | Description                                    |
|-------------|--------|----------|------------------------------------------------|
| `address`   | string | Yes      | Wallet address that signed the message         |
| `signature` | string | Yes      | Signature of the nonce message                 |
| `chain`     | string | No       | Chain type: `evm` (default), `solana`, `bitcoin` |

**Success Response (200):**
```json
{
  "token": "eyJhbGciOiJIUzI1NiIs...",
  "user": {
    "id": 2,
    "walletAddress": "0x1234...abcd",
    "chain": "evm",
    "isPrimary": true
  }
}
```

**Error Responses:**

| Status | Body                                      | Cause                                    |
|--------|-------------------------------------------|------------------------------------------|
| 400    | `{"error": "Missing address or signature"}` | Missing required fields                  |
| 400    | `{"error": "Nonce expired or not found"}`   | Nonce expired (>5min) or never requested |
| 401    | `{"error": "Unauthorized"}`                 | Invalid signature                        |
| 500    | `{"error": "Internal server error"}`        | Server error                             |

**Example:**
```bash
curl -X POST http://localhost:3142/auth/wallet/verify \
  -H "Content-Type: application/json" \
  -d '{"address":"0x1234...abcd","signature":"0x...","chain":"evm"}'
```

---

### 3. Get Current User

**`GET /auth/wallet/me`**

Returns the authenticated user's info and all connected wallets.

**Headers:**
```
Authorization: Bearer <jwt_token>
```

**Success Response (200):**
```json
{
  "userId": 2,
  "wallets": [
    {
      "address": "0x1234...abcd",
      "chain": "evm",
      "isPrimary": true,
      "lastSignedAt": "2026-04-03T16:03:37.020Z"
    },
    {
      "address": "0x5678...efgh",
      "chain": "evm",
      "isPrimary": false,
      "lastSignedAt": "2026-04-03T16:10:00.000Z"
    }
  ]
}
```

**Error Responses:**

| Status | Body                          | Cause                    |
|--------|-------------------------------|--------------------------|
| 401    | `{"error": "Unauthorized"}`   | Missing or invalid token |

---

### 4. Disconnect Wallet

**`POST /auth/wallet/disconnect`**

Removes a wallet from the user's account. Cannot disconnect the only remaining wallet.

**Headers:**
```
Authorization: Bearer <jwt_token>
```

**Request Body:**
```json
{
  "chain": "evm"
}
```

**Success Response (200):**
```json
{
  "ok": true
}
```

**Error Responses:**

| Status | Body                                              | Cause                              |
|--------|---------------------------------------------------|------------------------------------|
| 400    | `{"error": "Cannot disconnect your only wallet"}` | User has only one wallet connected |
| 401    | `{"error": "Unauthorized"}`                       | Missing or invalid token           |

---

## JWT Token Structure

The JWT payload contains:

```json
{
  "userId": 2,
  "walletAddress": "0x1234...abcd",
  "chain": "evm",
  "iat": 1775232217,
  "exp": 1775837017
}
```

| Claim           | Type   | Description                                  |
|-----------------|--------|----------------------------------------------|
| `userId`        | number | Internal user ID (used for data isolation)   |
| `walletAddress` | string | The wallet address that authenticated        |
| `chain`         | string | Chain type (`evm`, `solana`, `bitcoin`)      |
| `iat`           | number | Issued at (Unix timestamp)                   |
| `exp`           | number | Expires at (Unix timestamp, 7 days from issue) |

---

## Supported Chains

| Chain     | Value      | Wallets                                    |
|-----------|------------|--------------------------------------------|
| EVM       | `evm`      | MetaMask, Coinbase Wallet, Rainbow, etc.   |
| Solana    | `solana`   | Phantom, Backpack, Solflare                |
| Bitcoin   | `bitcoin`  | Unisat, Xverse, Leather                    |

---

## Frontend Integration Example

### Using wagmi + viem (React)

```tsx
import { useAccount, useSignMessage } from 'wagmi';
import { useState } from 'react';

const API_BASE = 'http://localhost:3142';

function WalletLogin() {
  const { address, isConnected } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const [token, setToken] = useState<string | null>(null);

  const handleLogin = async () => {
    if (!address) return;

    // 1. Get nonce
    const nonceRes = await fetch(`${API_BASE}/auth/wallet/nonce?address=${address}&chain=evm`);
    const { nonce, message } = await nonceRes.json();

    // 2. Sign message with wallet
    const signature = await signMessageAsync({ message });

    // 3. Verify signature and get JWT
    const verifyRes = await fetch(`${API_BASE}/auth/wallet/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ address, signature, chain: 'evm' }),
    });

    const data = await verifyRes.json();
    if (data.token) {
      setToken(data.token);
      localStorage.setItem('skynul_token', data.token);
    }
  };

  if (!isConnected) return <ConnectWalletButton />;

  return <button onClick={handleLogin}>Sign in with Wallet</button>;
}
```

### Using the JWT for API calls

```tsx
async function createTask(prompt: string) {
  const token = localStorage.getItem('skynul_token');
  
  const res = await fetch(`${API_BASE}/api/tasks`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify({
      prompt,
      capabilities: ['browser.cdp'],
      mode: 'browser',
    }),
  });

  return res.json();
}
```

### Multi-wallet flow

```tsx
// Connect a second wallet to the same account
async function connectSecondWallet() {
  // User already has token from first wallet login
  const token = localStorage.getItem('skynul_token');
  
  // Connect new wallet (e.g., via WalletConnect)
  const { address } = await connectWallet();
  
  // Get nonce and sign
  const nonceRes = await fetch(`${API_BASE}/auth/wallet/nonce?address=${address}&chain=evm`);
  const { message } = await nonceRes.json();
  const signature = await signMessageAsync({ message });
  
  // Verify - this will link the new wallet to the existing user
  const verifyRes = await fetch(`${API_BASE}/auth/wallet/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ address, signature, chain: 'evm' }),
  });
  
  // Same userId, new wallet added
  const data = await verifyRes.json();
  console.log(`Wallet linked to user ${data.user.id}`);
}
```

---

## Multi-User Data Isolation

All data is isolated by `userId`:

| Resource     | Isolation        | Example                              |
|--------------|------------------|--------------------------------------|
| Tasks        | `user_id` FK     | User 1 cannot see User 2's tasks     |
| Secrets      | `user_id` FK     | API keys are per-user                |
| Settings     | `user_id` FK     | Theme, language, provider per-user   |
| Projects     | `user_id` FK     | Projects are private                 |
| Schedules    | `user_id` FK     | Scheduled tasks are per-user         |

If a user tries to access another user's resource, they get a `404 Not Found`.

---

## Health & Status Endpoints

| Endpoint     | Method | Auth Required | Description                    |
|--------------|--------|---------------|--------------------------------|
| `/health`    | GET    | No            | Health check (verifies DB)     |
| `/ping`      | GET    | No            | Simple ping                    |
| `/metrics`   | GET    | No            | Prometheus-format metrics      |

**Health Response:**
```json
{ "status": "ok", "timestamp": 1775229088040 }
```

**Degraded Response (DB down):**
```json
{ "status": "degraded", "database": "unreachable" }
```
Status: `503 Service Unavailable`
