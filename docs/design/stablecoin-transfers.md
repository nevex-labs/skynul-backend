# Design Document: Stablecoin Transfer Support

## 1. Overview

Add clean, validated support for sending stablecoins (USDT/USDC) from Coinbase/Binance to external Ethereum wallet addresses.

## 2. Current State Analysis

### 2.1 Existing Infrastructure (Reusable)

| Component | Location | Status |
|-----------|----------|--------|
| `cex_withdraw` action type | `src/types/task.ts:196-202` | ✅ Exists |
| `executeCexAction` handler | `src/core/agent/action-executors.ts:787-795` | ✅ Exists |
| `CoinbaseClient.withdraw()` | `src/core/cex/coinbase-client.ts:164-175` | ✅ Exists |
| `BinanceClient.withdraw()` | `src/core/cex/binance-client.ts:147-173` | ✅ Exists |

### 2.2 Missing Pieces

1. **No validation** for stablecoin assets (USDT/USDC format)
2. **No validation** for Ethereum wallet addresses
3. **No network validation** for stablecoin-specific networks
4. **No dedicated stablecoin abstraction** (clean interface)
5. **No tests** for stablecoin transfer functionality

## 3. Design Decision

**Decision: Enhance existing system with validation layer (NOT new action type)**

### Rationale
- `cex_withdraw` already exists and handles withdrawals generically
- Creating `cex_send_stablecoin` would duplicate 90% of the logic
- Clean architecture principle: add validation at the boundary, don't duplicate execution
- Follows "desacoplado" requirement: validation is decoupled from execution

### What We'll Build

```
┌─────────────────────────────────────────────────────────────┐
│                    Stablecoin Transfer Flow                  │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  Agent Action                                                │
│  ┌─────────────────────────────────────┐                    │
│  │  {                                   │                    │
│  │    type: 'cex_withdraw',             │                    │
│  │    exchange: 'coinbase',             │                    │
│  │    asset: 'USDC',                    │                    │
│  │    amount: 100,                      │                    │
│  │    address: '0x742d35Cc6634C0532...', │                    │
│  │    network: 'ethereum'               │                    │
│  │  }                                   │                    │
│  └─────────────────────────────────────┘                    │
│                    │                                         │
│                    ▼                                         │
│  ┌─────────────────────────────────────┐                    │
│  │  StablecoinValidator.validate()      │  NEW              │
│  │  - Asset: USDT/USDC check           │                    │
│  │  - Address: Ethereum format         │                    │
│  │  - Network: Supported networks      │                    │
│  └─────────────────────────────────────┘                    │
│                    │                                         │
│                    ▼                                         │
│  ┌─────────────────────────────────────┐                    │
│  │  executeCexAction()                 │  EXISTING          │
│  │  → CoinbaseClient.withdraw()        │                    │
│  └─────────────────────────────────────┘                    │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

## 4. File Structure

### 4.1 New Files

```
src/
├── core/
│   └── cex/
│       ├── stablecoin-validator.ts          # Validation logic
│       └── __tests__/
│           └── stablecoin-validator.test.ts # Unit tests
└── types/
    └── task.ts                              # Updated (if needed)
```

### 4.2 Modified Files

- `src/core/agent/action-executors.ts` (add validation call)
- `src/core/cex/types.ts` (new types for validation)

## 5. Type Definitions

### 5.1 New Types (`src/core/cex/types.ts`)

```typescript
// Supported stablecoins for validation
export const SUPPORTED_STABLECOINS = ['USDT', 'USDC', 'DAI'] as const;
export type StablecoinAsset = (typeof SUPPORTED_STABLECOINS)[number];

// Networks that support stablecoin transfers
export const STABLECOIN_NETWORKS = ['ethereum', 'polygon', 'arbitrum', 'optimism', 'base'] as const;
export type StablecoinNetwork = (typeof STABLECOIN_NETWORKS)[number];

// Validation result type
export type ValidationResult = 
  | { valid: true }
  | { valid: false; error: string; code: ValidationErrorCode };

// Validation error codes for programmatic handling
export type ValidationErrorCode =
  | 'INVALID_ASSET'
  | 'UNSUPPORTED_ASSET'
  | 'INVALID_ADDRESS'
  | 'INVALID_NETWORK'
  | 'UNSUPPORTED_NETWORK'
  | 'INVALID_AMOUNT'
  | 'AMOUNT_TOO_LOW'
  | 'AMOUNT_TOO_HIGH';
```

### 5.2 Type Guards

```typescript
export function isStablecoinAsset(asset: string): asset is StablecoinAsset {
  return SUPPORTED_STABLECOINS.includes(asset.toUpperCase() as StablecoinAsset);
}

export function isStablecoinNetwork(network: string): network is StablecoinNetwork {
  return STABLECOIN_NETWORKS.includes(network.toLowerCase() as StablecoinNetwork);
}
```

## 6. Interface Design

### 6.1 Zod Schemas (Following Existing Patterns)

**File**: `src/core/cex/stablecoin-validator.ts`

```typescript
import { z } from 'zod';

// ── Constants ──────────────────────────────────────────────────────────────────

export const SUPPORTED_STABLECOINS = ['USDT', 'USDC', 'DAI'] as const;
export const STABLECOIN_NETWORKS = ['ethereum', 'polygon', 'arbitrum', 'optimism', 'base'] as const;

// Network support matrix (which stablecoin works on which network)
const STABLECOIN_NETWORK_SUPPORT: Record<StablecoinAsset, StablecoinNetwork[]> = {
  USDC: ['ethereum', 'polygon', 'arbitrum', 'optimism', 'base'],
  USDT: ['ethereum', 'polygon', 'arbitrum', 'optimism'],
  DAI: ['ethereum', 'polygon', 'arbitrum', 'optimism'],
};

// ── Zod Schemas ────────────────────────────────────────────────────────────────

// Ethereum address regex (0x + 40 hex chars)
const ETH_ADDRESS_REGEX = /^0x[a-fA-F0-9]{40}$/;

export const EthereumAddressSchema = z
  .string()
  .regex(ETH_ADDRESS_REGEX, 'Invalid Ethereum address format. Must be 0x followed by 40 hex characters');

export const StablecoinAssetSchema = z.enum(SUPPORTED_STABLECOINS, {
  errorMap: () => ({ message: `Asset must be one of: ${SUPPORTED_STABLECOINS.join(', ')}` }),
});

export const StablecoinNetworkSchema = z.enum(STABLECOIN_NETWORKS, {
  errorMap: () => ({ message: `Network must be one of: ${STABLECOIN_NETWORKS.join(', ')}` }),
});

export const StablecoinWithdrawSchema = z.object({
  asset: z.string().transform((val) => val.toUpperCase()),
  amount: z.number().positive('Amount must be positive').min(1, 'Minimum amount is 1').max(100_000, 'Maximum amount is 100,000'),
  address: EthereumAddressSchema,
  network: z.string().transform((val) => val.toLowerCase()),
  exchange: z.enum(['binance', 'coinbase']),
});

// ── Validated Output Type ──────────────────────────────────────────────────────

export type StablecoinAsset = (typeof SUPPORTED_STABLECOINS)[number];
export type StablecoinNetwork = (typeof STABLECOIN_NETWORKS)[number];

export type ValidatedStablecoinWithdraw = {
  asset: StablecoinAsset;
  amount: number;
  address: string;
  network: StablecoinNetwork;
  exchange: 'binance' | 'coinbase';
};

// ── Validation Functions ───────────────────────────────────────────────────────

/**
 * Validate and normalize a stablecoin withdrawal request.
 * Returns parsed data or throws ZodError with detailed issues.
 */
export function validateStablecoinWithdraw(params: unknown): ValidatedStablecoinWithdraw {
  const parsed = StablecoinWithdrawSchema.parse(params);
  
  // Additional validation: check network supports this asset
  const supportedNetworks = STABLECOIN_NETWORK_SUPPORT[parsed.asset as StablecoinAsset];
  if (!supportedNetworks.includes(parsed.network as StablecoinNetwork)) {
    throw new z.ZodError([
      {
        code: z.ZodIssueCode.custom,
        message: `${parsed.asset} is not supported on ${parsed.network}. Supported: ${supportedNetworks.join(', ')}`,
        path: ['network'],
      },
    ]);
  }
  
  return parsed as ValidatedStablecoinWithdraw;
}

/**
 * Validate just an Ethereum address.
 * Returns true if valid, false otherwise.
 */
export function isValidEthereumAddress(address: string): boolean {
  return ETH_ADDRESS_REGEX.test(address);
}

/**
 * Check if asset is a supported stablecoin.
 */
export function isStablecoin(asset: string): asset is StablecoinAsset {
  return SUPPORTED_STABLECOINS.includes(asset.toUpperCase() as StablecoinAsset);
}

/**
 * Get supported networks for a given stablecoin.
 */
export function getSupportedNetworks(asset: StablecoinAsset): StablecoinNetwork[] {
  return [...STABLECOIN_NETWORK_SUPPORT[asset]];
}
```

### 6.2 Usage Pattern (Consistent with Existing Code)

```typescript
import { z } from 'zod';
import { validateStablecoinWithdraw } from '../cex/stablecoin-validator';

// In executeCexAction:
try {
  const validated = validateStablecoinWithdraw({
    asset: a.asset,
    amount: a.amount,
    address: a.address,
    network: a.network,
    exchange,
  });
  
  // Proceed with validated.stablecoin, validated.amount, etc.
} catch (error) {
  if (error instanceof z.ZodError) {
    const message = error.errors.map((e) => e.message).join('; ');
    return errResult(`[VALIDATION] ${message}`);
  }
  throw error;
}
```

## 7. Integration Points

### 7.1 Action Executor Integration

**File**: `src/core/agent/action-executors.ts`

**Change**: Add Zod validation before CEX withdrawal execution

```typescript
// In executeCexAction(), update the cex_withdraw case:

case 'cex_withdraw': {
  try {
    const a = action as Extract<TaskAction, { type: 'cex_withdraw' }>;
    
    // NEW: Validate stablecoin transfer parameters with Zod
    const { validateStablecoinWithdraw } = await import('../cex/stablecoin-validator');
    const { z } = await import('zod');
    
    let validated;
    try {
      validated = validateStablecoinWithdraw({
        asset: a.asset,
        amount: a.amount,
        address: a.address,
        network: a.network,
        exchange,
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        const message = error.errors.map((e) => e.message).join('; ');
        return errResult(`[VALIDATION] ${message}`);
      }
      throw error;
    }
    
    // Use validated params (asset/network normalized)
    const withdrawId = await client.withdraw(validated.asset, validated.amount, validated.address, validated.network);
    return result(`Withdrawal initiated on ${exchange}: ${withdrawId}`);
  } catch (e) {
    return errResult(String(e instanceof Error ? e.message : e));
  }
}
```

### 7.2 Capability Check Enhancement

The existing `cex.trading` capability already covers this use case. No new capability needed.

## 8. Test Strategy

### 8.1 Unit Tests (`src/core/cex/__tests__/stablecoin-validator.test.ts`)

```typescript
import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import {
  validateStablecoinWithdraw,
  isValidEthereumAddress,
  isStablecoin,
  getSupportedNetworks,
} from '../stablecoin-validator';

describe('StablecoinValidator', () => {
  describe('validateStablecoinWithdraw', () => {
    // Happy path tests
    it('accepts valid USDC transfer to Ethereum address', () => {
      const result = validateStablecoinWithdraw({
        asset: 'usdc',  // lowercase, should be normalized
        amount: 100,
        address: '0x742d35Cc6634C0532935334AdCb2f44d923604d5',
        network: 'ethereum',
        exchange: 'coinbase',
      });
      expect(result.asset).toBe('USDC');
      expect(result.network).toBe('ethereum');
    });

    it('accepts valid USDT transfer to Polygon address', () => {
      const result = validateStablecoinWithdraw({
        asset: 'USDT',
        amount: 50,
        address: '0x742d35Cc6634C0532935334AdCb2f44d923604d5',
        network: 'polygon',
        exchange: 'binance',
      });
      expect(result.asset).toBe('USDT');
    });

    // Asset validation
    it('rejects non-stablecoin assets (BTC, ETH)', () => {
      expect(() =>
        validateStablecoinWithdraw({
          asset: 'BTC',
          amount: 100,
          address: '0x742d35Cc6634C0532935334AdCb2f44d923604d5',
          network: 'ethereum',
          exchange: 'coinbase',
        })
      ).toThrow(z.ZodError);
    });

    // Address validation
    it('rejects invalid Ethereum addresses', () => {
      expect(() =>
        validateStablecoinWithdraw({
          asset: 'USDC',
          amount: 100,
          address: '0x123',  // too short
          network: 'ethereum',
          exchange: 'coinbase',
        })
      ).toThrow(z.ZodError);
    });

    // Amount validation
    it('rejects amount below minimum', () => {
      expect(() =>
        validateStablecoinWithdraw({
          asset: 'USDC',
          amount: 0.5,
          address: '0x742d35Cc6634C0532935334AdCb2f44d923604d5',
          network: 'ethereum',
          exchange: 'coinbase',
        })
      ).toThrow(z.ZodError);
    });

    // Asset-network compatibility
    it('rejects USDT on Base network (not supported)', () => {
      expect(() =>
        validateStablecoinWithdraw({
          asset: 'USDT',
          amount: 100,
          address: '0x742d35Cc6634C0532935334AdCb2f44d923604d5',
          network: 'base',
          exchange: 'coinbase',
        })
      ).toThrow(/not supported on base/i);
    });
  });

  describe('isValidEthereumAddress', () => {
    it('returns true for valid addresses', () => {
      expect(isValidEthereumAddress('0x742d35Cc6634C0532935334AdCb2f44d923604d5')).toBe(true);
    });

    it('returns false for invalid addresses', () => {
      expect(isValidEthereumAddress('0x123')).toBe(false);
      expect(isValidEthereumAddress('0xGGG')).toBe(false);
      expect(isValidEthereumAddress('')).toBe(false);
    });
  });

  describe('isStablecoin', () => {
    it('returns true for USDT, USDC, DAI (case-insensitive)', () => {
      expect(isStablecoin('USDT')).toBe(true);
      expect(isStablecoin('usdc')).toBe(true);
      expect(isStablecoin('DAI')).toBe(true);
    });

    it('returns false for other assets', () => {
      expect(isStablecoin('BTC')).toBe(false);
      expect(isStablecoin('ETH')).toBe(false);
    });
  });

  describe('getSupportedNetworks', () => {
    it('returns correct networks for USDC (includes Base)', () => {
      const networks = getSupportedNetworks('USDC');
      expect(networks).toContain('base');
      expect(networks).toContain('ethereum');
    });

    it('returns correct networks for USDT (excludes Base)', () => {
      const networks = getSupportedNetworks('USDT');
      expect(networks).not.toContain('base');
      expect(networks).toContain('ethereum');
    });
  });
});
```

### 8.2 Integration Tests

```typescript
describe('executeCexAction with stablecoin validation', () => {
  // Mock CoinbaseClient
  // Test that validation is called before withdraw
  // Test error messages propagate correctly
});
```

## 9. Implementation Tasks

### Phase 1: Foundation (Day 1)
- [ ] Create `src/core/cex/types.ts` with validation types
- [ ] Create `src/core/cex/stablecoin-validator.ts` with validator class
- [ ] Write unit tests for validator
- [ ] Ensure all tests pass

### Phase 2: Integration (Day 1)
- [ ] Update `executeCexAction` in action-executors.ts
- [ ] Add integration tests
- [ ] Run full test suite

### Phase 3: Documentation (Day 2)
- [ ] Update README with stablecoin transfer examples
- [ ] Add JSDoc comments to new code
- [ ] Create usage examples

## 10. Error Messages

Error messages come from Zod schemas and custom validation:

```typescript
// Zod schema errors (auto-generated):
// "Asset must be one of: USDT, USDC, DAI"
// "Invalid Ethereum address format. Must be 0x followed by 40 hex characters"
// "Amount must be positive"
// "Minimum amount is 1"
// "Maximum amount is 100,000"

// Custom validation errors:
// "USDT is not supported on base. Supported: ethereum, polygon, arbitrum, optimism"
```

User-facing errors are clear and actionable, generated by Zod's built-in error messages plus custom network compatibility checks.

## 11. Security Considerations

1. **No API keys in logs**: Validator doesn't log sensitive data
2. **Address validation**: Strict regex prevents typos
3. **Amount limits**: Configurable limits prevent accidental large transfers
4. **Network validation**: Prevents sending to wrong chain

## 12. Future Enhancements

1. **Multi-chain address validation**: Support non-EVM addresses for other chains
2. **Fee estimation**: Show estimated network fees before withdrawal
3. **Batch transfers**: Send to multiple addresses in one action
4. **Whitelist addresses**: Pre-approved addresses for security

## 13. Rollout Plan

1. **Development**: Implement in feature branch
2. **Testing**: Unit + integration + manual testing
3. **Staging**: Deploy to staging environment
4. **Production**: Deploy with feature flag (optional)
5. **Monitoring**: Track validation failures for improvement

## 14. Dependencies

- No new npm packages required
- Uses existing `crypto` module for address validation
- Integrates with existing `CoinbaseClient` and `BinanceClient`

## 15. Migration

No migration needed. This is an additive change that doesn't modify existing behavior.

Existing `cex_withdraw` calls that don't involve stablecoins will continue to work (validation only triggers for stablecoin assets).

---

**Author**: Skynul Backend Team  
**Status**: Design Complete  
**Next Steps**: Implementation after review