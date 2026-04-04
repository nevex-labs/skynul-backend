# Design: Multichain Account Abstraction Trading Layer

## Technical Approach

Implement a Clean Architecture layering system where:
1. **Domain** defines chain-agnostic interfaces (`ChainProvider`, `Paymaster`, `SwapRouter`)
2. **Infrastructure** provides concrete implementations (Pimlico, Uniswap, etc.)
3. **Services** (Effect.js) orchestrate business logic using domain interfaces
4. **Action Executors** consume services to execute trades

The existing `ChainClient` (which uses PK-based EvmWallet) is **replaced** for AA trading by a new `SwapService` that uses ERC-4337 UserOperations. The old `ChainClient` remains for non-AA operations (balance queries, tx status).

## Architecture Decisions

### Decision: Use Viem over Ethers.js for AA

**Choice**: Viem + permissionless.js for Account Abstraction
**Alternatives considered**: Ethers.js (already in project), etherspot
**Rationale**: Viem is the standard for ERC-4337. Permissionless.js is built on Viem and provides the cleanest AA API. Ethers.js AA support is limited. We keep Ethers for legacy `ChainClient` but use Viem for all new AA code.

### Decision: Effect.js Service Pattern

**Choice**: Tag + Layer pattern (consistent with existing services)
**Alternatives considered**: Direct function exports, class-based services
**Rationale**: The project already uses Effect.js with Tag/Layer for WalletService, SecretService, etc. Following the same pattern ensures consistency and testability.

### Decision: Multichain via ChainConfig Extension

**Choice**: Extend existing `chain-config.ts` with bundler/paymaster/router fields
**Alternatives considered**: Separate config file, runtime config from DB
**Rationale**: The existing config already supports multiple chains. We extend the `ChainConfig` type rather than creating a parallel system. Runtime config from DB can be added later for dynamic chain management.

### Decision: Pimlico as Default Bundler

**Choice**: Pimlico (free tier: 100k UserOps/month)
**Alternatives considered**: Alchemy Account Kit, self-hosted Skandha
**Rationale**: Pimlico has the best free tier and most mature paymaster support. Alchemy is the fallback. Self-hosted is deferred until we have volume.

### Decision: Fee Deducted from Trade Amount

**Choice**: 1% deducted from input amount (not added on top)
**Alternatives considered**: Fee added on top, separate fee tx
**Rationale**: Deducting from input is simpler for the user — they see "swap 100 USDC" and get the output minus fee. A separate fee tx would require two UserOps. Adding on top would confuse users about how much they're spending.

## Data Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                        Action Executor                          │
│  executeChainAction(ctx, { type: 'chain_swap', ... })           │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                      SwapService (Effect)                        │
│  1. checkAllowance(userId, tokenIn, amount)                     │
│  2. getPriceQuote(tokenIn, tokenOut, amount)                    │
│  3. executeSwap(userAddress, intent)                            │
└──┬──────────────┬──────────────┬────────────────────────────────┘
   │              │              │
   ▼              ▼              ▼
┌──────────┐ ┌───────────┐ ┌──────────────────┐
│Allowance │ │ChainProvider│ │  SmartWallet     │
│Service   │ │(multichain) │ │  (ERC-4337)      │
└──────────┘ └──────┬──────┘ └────────┬─────────┘
                    │                 │
                    ▼                 ▼
              ┌───────────┐    ┌──────────────┐
              │Pimlico    │    │Paymaster     │
              │Bundler    │    │(USDC gas)    │
              └───────────┘    └──────────────┘
                    │                 │
                    └────────┬────────┘
                             ▼
                       ┌───────────┐
                       │DEX Router │
                       │(Uniswap)  │
                       └───────────┘
```

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `src/core/chain/types.ts` | Modify | Add `SwapIntent`, `SessionKey`, `UserOpResult`, `ChainProvider` interface |
| `src/core/chain/config.ts` | Modify | Add `bundlerUrl`, `paymasterUrl`, `skynulRouterAddress` to `ChainConfig` |
| `src/core/chain/domain/types.ts` | Create | Domain types: `SwapIntent`, `AllowanceCheck`, `TradeResult` |
| `src/core/chain/domain/interfaces.ts` | Create | Domain interfaces: `ChainProvider`, `Paymaster`, `SwapRouter`, `Bundler` |
| `src/core/chain/infrastructure/pimlico-provider.ts` | Create | Pimlico bundler + paymaster adapter |
| `src/core/chain/infrastructure/uniswap-router.ts` | Create | Uniswap v3 swap execution |
| `src/core/chain/infrastructure/skynul-router.ts` | Create | SkynulRouter contract interaction (fee collection) |
| `src/services/smart-wallet/tag.ts` | Create | SmartWalletService Effect Tag |
| `src/services/smart-wallet/layer.ts` | Create | SmartWalletService implementation |
| `src/services/swap/tag.ts` | Create | SwapService Effect Tag |
| `src/services/swap/layer.ts` | Create | SwapService implementation |
| `src/services/allowances/tag.ts` | Modify | Update to use domain types |
| `src/services/allowances/layer.ts` | Modify | Update to use domain types |
| `src/core/agent/action-executors.ts` | Modify | `chain_swap` uses SwapService instead of ChainClient |
| `src/core/agent/trading-executors.test.ts` | Modify | Update mocks for new services |
| `src/services/swap/swap.test.ts` | Create | Unit tests for SwapService |
| `src/services/smart-wallet/smart-wallet.test.ts` | Create | Unit tests for SmartWalletService |

## Interfaces / Contracts

### Domain Interfaces

```typescript
// src/core/chain/domain/interfaces.ts

/** Abstract chain provider — each chain implements this */
export interface ChainProvider {
  readonly chainId: number;
  getBalance(address: string, tokenAddress?: string): Promise<string>;
  getNonce(address: string): Promise<number>;
  estimateGas(call: EvmCall): Promise<bigint>;
  sendUserOperation(op: UserOperation): Promise<UserOpResult>;
  getUserOperationReceipt(opHash: string): Promise<UserOpResult>;
}

/** Abstract paymaster — pays gas in USDC */
export interface Paymaster {
  readonly chainId: number;
  getPaymasterData(userOp: UserOperation): Promise<PaymasterData>;
  isSupported(tokenAddress: string): Promise<boolean>;
}

/** Abstract DEX router — executes swaps */
export interface SwapRouter {
  readonly chainId: number;
  getQuote(params: QuoteParams): Promise<Quote>;
  encodeSwap(params: SwapParams): Promise<EncodedCall>;
}

/** Abstract bundler — submits UserOps to the network */
export interface Bundler {
  readonly chainId: number;
  sendUserOperation(op: UserOperation): Promise<string>;
  getUserOperationReceipt(hash: string): Promise<UserOpResult>;
  estimateUserOperationGas(op: UserOperation): Promise<GasEstimate>;
}

/** Smart wallet — ERC-4337 account */
export interface SmartWallet {
  readonly address: string;
  readonly owner: string;
  readonly chainId: number;
  create(): Promise<string>;
  execute(calls: EvmCall[]): Promise<UserOpResult>;
  getSessionKey(): Promise<SessionKey | null>;
  revokeSessionKey(): Promise<void>;
}
```

### Domain Types

```typescript
// src/core/chain/domain/types.ts

export interface SwapIntent {
  userId: number;
  chainId: number;
  tokenIn: string;
  tokenOut: string;
  amountIn: bigint;
  minAmountOut: bigint;
  slippageBps: number;
}

export interface TradeResult {
  txHash: string;
  userOpHash: string;
  amountIn: bigint;
  amountOut: bigint;
  feeAmount: bigint;
  gasCostUsd: bigint;
  status: 'success' | 'failed';
  timestamp: number;
}

export interface SessionKey {
  address: string;
  maxPerTrade: bigint;
  dailyLimit: bigint;
  expiresAt: number;
  allowedTokens: string[];
}

export interface UserOperation {
  sender: string;
  nonce: bigint;
  initCode: string;
  callData: string;
  callGasLimit: bigint;
  verificationGasLimit: bigint;
  preVerificationGas: bigint;
  maxFeePerGas: bigint;
  maxPriorityFeePerGas: bigint;
  paymasterAndData: string;
  signature: string;
}

export interface UserOpResult {
  userOpHash: string;
  txHash: string;
  status: 'success' | 'failed';
  gasUsed: bigint;
  gasPrice: bigint;
  logs: Log[];
}
```

### Extended ChainConfig

```typescript
// src/core/chain/config.ts (modified)

export type ChainConfig = {
  chainId: number;
  name: string;
  rpcUrl: string;
  explorerUrl: string;
  nativeCurrency: { name: string; symbol: string; decimals: 18 };
  usdcAddress: string;
  usdcDecimals: number;
  dexRouterAddress?: string;
  testnet: boolean;
  // NEW: AA fields
  bundlerUrl?: string;           // Pimlico/Alchemy bundler endpoint
  paymasterUrl?: string;         // Paymaster endpoint
  skynulRouterAddress?: string;  // Our fee-collecting router
  entryPointAddress?: string;    // ERC-4337 EntryPoint (0.7.0)
};
```

### SwapService (Effect)

```typescript
// src/services/swap/tag.ts

export interface SwapServiceApi {
  readonly executeSwap: (
    intent: SwapIntent
  ) => Effect.Effect<TradeResult, SwapError | AllowanceError | DatabaseError, never>;

  readonly getPriceQuote: (
    chainId: number,
    tokenIn: string,
    tokenOut: string,
    amountIn: bigint
  ) => Effect.Effect<Quote, QuoteError, never>;

  readonly getTradeHistory: (
    userId: number,
    chainId?: number
  ) => Effect.Effect<TradeResult[], DatabaseError, never>;
}

export class SwapService extends Context.Tag('SwapService')<SwapService, SwapServiceApi>() {}
```

## Testing Strategy

| Layer | What to Test | Approach |
|-------|-------------|----------|
| Unit | SwapService logic (allowance check, fee calc, quote) | Mock ChainProvider, mock Paymaster, mock Bundler |
| Unit | AllowanceService (check, record, revoke) | Effect Test layer with in-memory DB |
| Unit | ChainConfig (multichain lookups) | Pure function tests |
| Integration | PimlicoProvider (real bundler calls) | Testnet (Base Sepolia) with real UserOps |
| Integration | UniswapRouter (real DEX quotes) | Fork testnet with Viem |
| E2E | Full swap flow (create wallet → approve → swap) | Testnet end-to-end with real contracts |

## Migration / Rollout

**No migration required.** This is a new feature that coexists with the existing `ChainClient`. The rollout is:

1. **Phase 1**: Deploy SkynulRouter contract to testnet (Base Sepolia)
2. **Phase 2**: Implement services + tests
3. **Phase 3**: Deploy to mainnet (Base)
4. **Phase 4**: Add Arbitrum support
5. **Phase 5**: Frontend integration (separate change)

The existing `ChainClient` (PK-based) remains functional for users who prefer that approach. The new AA path is opt-in.

## Open Questions

- [ ] **EntryPoint version**: ERC-4337 0.6.0 vs 0.7.0? (Recommendation: 0.7.0 — latest, better tooling)
- [ ] **Smart Account implementation**: SimpleAccount (Infinitism) vs Safe? (Recommendation: SimpleAccount for MVP, Safe for production)
- [ ] **Paymaster USDC support**: Does Pimlico's paymaster support USDC on all target chains? Need to verify per-chain.
- [ ] **Session Key storage**: On-chain (in Smart Account) vs off-chain (in our DB)? (Recommendation: On-chain for security, off-chain cache for speed)
