# Crypto Transfers API Documentation

## Overview

The crypto transfer system allows sending stablecoins (USDT, USDC, DAI) to wallet addresses or converting them to Argentine Pesos (ARS) via Ripio off-ramp.

## Providers

| Provider | Use Case | Requires |
|----------|----------|----------|
| `coinbase` | Send stablecoins to external wallet | Coinbase OAuth + API keys |
| `ripio` | Off-ramp stablecoins to ARS (Argentina) | Ripio credentials |
| `manual` | Manual transfer instructions | No credentials |

## Available Actions

### crypto_get_balance

Get stablecoin balances.

```json
{
  "type": "crypto_get_balance",
  "provider": "coinbase"
}
```

**Response:**
```
coinbase stablecoin balances:
  USDT (ethereum): 1000.00 available, 1000.00 total
  USDC (polygon): 500.00 available, 500.00 total
```

---

### crypto_get_addresses

List verified withdrawal addresses.

```json
{
  "type": "crypto_get_addresses",
  "provider": "coinbase"
}
```

---

### crypto_send_transfer

Send stablecoins or convert to ARS.

**For wallet transfer (Coinbase):**
```json
{
  "type": "crypto_send_transfer",
  "provider": "coinbase",
  "asset": "USDT",
  "network": "ethereum",
  "amount": 100,
  "destination": "0x742d35Cc6634C0532935334AdCb2f44d923604d5"
}
```

**For ARS transfer via Ripio:**
```json
{
  "type": "crypto_send_transfer",
  "provider": "ripio",
  "asset": "USDT",
  "network": "ethereum",
  "amount": 100,
  "destination": "1234567890123456789012"
}
```

**Parameters:**

| Parameter | Required | Description |
|-----------|----------|-------------|
| `provider` | Yes | `coinbase`, `ripio`, `manual` |
| `asset` | Yes | `USDT`, `USDC`, `DAI` |
| `network` | Yes | `ethereum`, `polygon`, `arbitrum`, `optimism`, `base` |
| `amount` | Yes | Amount to send |
| `destination` | Yes | Wallet address or CBU/alias (Argentina) |
| `memo` | No | Optional memo/tag |

**Destination formats for Ripio:**

| Format | Example | Type |
|--------|---------|------|
| CBU (22 digits) | `1234567890123456789012` | Bank Transfer |
| CVU (22 digits) | `0000000110000000012345` | Bank Transfer |
| Alias | `juan.perez` | Mercado Pago |

**Response:**
```
Stablecoin transfer initiated via ripio: id=ripio-xyz-123 status=pending | tx=0x1234...abcd | fee=1.50
```

---

### crypto_get_transfer_status

Check transfer status.

```json
{
  "type": "crypto_get_transfer_status",
  "provider": "ripio",
  "transferId": "ripio-xyz-123"
}
```

**Response statuses:**
- `pending` - Transfer initiated, processing
- `completed` - Transfer successful
- `failed` - Transfer failed

---

### crypto_get_transfer_history

Get transfer history.

```json
{
  "type": "crypto_get_transfer_history",
  "provider": "coinbase",
  "limit": 10
}
```

---

### crypto_estimate_fee

Estimate transfer fee.

```json
{
  "type": "crypto_estimate_fee",
  "provider": "coinbase",
  "asset": "USDT",
  "network": "ethereum",
  "amount": 100
}
```

**Response:**
```
Fee estimate for 100 USDT on ethereum: 5.50 USD (gas: 21000)
```

## Fee Structure

| Provider | Fee | Notes |
|----------|-----|-------|
| Coinbase | $0.50-5 | Network gas fee only |
| Ripio | ~1.5% + gas | 1.5% service fee + network fee |

## Supported Networks

| Network | Chain ID | Status |
|---------|----------|--------|
| Ethereum | 1 | ✅ Supported |
| Polygon | 137 | ✅ Supported |
| Arbitrum | 42161 | ✅ Supported |
| Optimism | 10 | ✅ Supported |
| Base | 8453 | ✅ Supported |

## Supported Assets

| Asset | Symbol | Decimals |
|-------|--------|----------|
| Tether | USDT | 6 |
| USD Coin | USDC | 6 |
| Dai | DAI | 18 |

## Capability Required

Enable `crypto.transfers` capability in task settings.

## Environment Variables

| Variable | Description | Required for |
|----------|-------------|--------------|
| `COINBASE_API_KEY` | Coinbase API key | Coinbase |
| `COINBASE_API_SECRET` | Coinbase API secret | Coinbase |
| `RIPIO_CLIENT_ID` | Ripio client ID | Ripio |
| `RIPIO_CLIENT_SECRET` | Ripio client secret | Ripio |

## Paper Mode

When `paperMode` is enabled, all operations use mock data:
- Mock balances (1000 USDT, 500 USDC, etc.)
- Mock transfers (instant completion)
- No real API calls

## Example User Flows

### Send USDT to wallet

```
User: "Send 100 USDT to 0x742d35Cc6634C0532935334AdCb2f44d923604d5"
Agent: crypto_send_transfer (provider: coinbase)
```

### Send ARS to Argentine bank

```
User: "Send 10000 ARS to my friend, CBU 1234567890123456789012"
Agent: crypto_send_transfer (provider: ripio, asset: USDT, destination: CBU)
```

### Send ARS to Mercado Pago

```
User: "Send 5000 ARS to juan.perez"
Agent: crypto_send_transfer (provider: ripio, asset: USDT, destination: juan.perez)
```
