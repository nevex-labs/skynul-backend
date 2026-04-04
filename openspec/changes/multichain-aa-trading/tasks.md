# Tasks: Multichain Account Abstraction Trading Layer

## Phase 1: Domain & Types

- [x] 1.1 Create `src/core/chain/domain/types.ts` with `SwapIntent`, `TradeResult`, `SessionKey`, `UserOperation`, `UserOpResult` types
- [x] 1.2 Create `src/core/chain/domain/interfaces.ts` with `ChainProvider`, `Paymaster`, `SwapRouter`, `Bundler`, `SmartWallet` interfaces
- [x] 1.3 Extend `src/core/chain/config.ts` — add `bundlerUrl`, `paymasterUrl`, `skynulRouterAddress`, `entryPointAddress` to `ChainConfig` type and update all chain entries
- [x] 1.4 Update `src/core/chain/types.ts` — move CEX types to `src/core/cex/types.ts` (cleanup), keep only chain-related types

## Phase 2: Infrastructure Adapters

- [x] 2.1 Create `src/core/chain/infrastructure/pimlico-provider.ts` — Pimlico bundler adapter implementing `Bundler` interface
- [x] 2.2 Create `src/core/chain/infrastructure/paymaster.ts` — Paymaster adapter implementing `Paymaster` interface (USDC gas payment)
- [x] 2.3 Create `src/core/chain/infrastructure/uniswap-router.ts` — Uniswap v3 router adapter implementing `SwapRouter` interface
- [x] 2.4 Create `src/core/chain/infrastructure/smart-wallet.ts` — ERC-4337 Smart Account implementation implementing `SmartWallet` interface

## Phase 3: Effect Services

- [x] 3.1 Create `src/services/smart-wallet/tag.ts` — `SmartWalletService` Effect Tag with interface definition
- [x] 3.2 Create `src/services/smart-wallet/layer.ts` — `SmartWalletServiceLive` + `SmartWalletServiceTest` implementations
- [x] 3.3 Create `src/services/swap/tag.ts` — `SwapService` Effect Tag with `executeSwap`, `getPriceQuote`, `getTradeHistory`
- [x] 3.4 Create `src/services/swap/layer.ts` — `SwapServiceLive` + `SwapServiceTest` implementations (orchestrates allowance check → quote → swap → fee → record)
- [x] 3.5 Update `src/services/allowances/tag.ts` — ensure types align with domain types
- [x] 3.6 Update `src/services/allowances/layer.ts` — ensure implementation uses domain types

## Phase 4: Action Executor Integration

- [x] 4.1 Update `src/core/agent/action-executors.ts` — `chain_swap` case uses `SwapService` instead of `ChainClient`
- [x] 4.2 Update `src/core/agent/action-executors.ts` — add `chain_get_allowance` action for querying allowance status
- [x] 4.3 Update `src/core/agent/action-executors.ts` — add `chain_get_smart_wallet` action for querying smart wallet info
- [x] 4.4 Update `src/types/task.ts` — add `chain_get_allowance` and `chain_get_smart_wallet` to `TaskAction` union

## Phase 5: Tests

- [x] 5.1 Create `src/services/smart-wallet/smart-wallet.test.ts` — unit tests for SmartWalletService (create, execute, revoke session key, balance query, withdrawal)
- [x] 5.2 Create `src/services/swap/swap.test.ts` — unit tests for SwapService (execute swap, price quote, trade history, error handling)
- [x] 5.3 Create `src/core/chain/infrastructure/pimlico-provider.test.ts` — unit tests for PimlicoProvider (send UserOp, get receipt, estimate gas)
- [x] 5.4 Create `src/core/chain/infrastructure/uniswap-router.test.ts` — unit tests for UniswapRouter (get quote, encode swap, multi-hop)
- [x] 5.5 Update `src/core/chain/chain-config.test.ts` — test multichain config lookups (supported chains, unsupported chains, AA fields)
- [x] 5.6 Update `src/services/allowances/index.test.ts` — tests already exist for allowance service

## Phase 6: Verification

- [x] 6.1 Run `npm run typecheck` — zero errors
- [x] 6.2 Run `npm run lint` — zero errors (301 files checked)
- [x] 6.3 Run `npm test` — 699 passing + 17 new tests passing (31 pre-existing failures unrelated to this change)
- [x] 6.4 Verify `chain_swap` action executor integration with SwapService
- [x] 6.5 Verify multichain config for Base + Arbitrum (both have bundlerUrl, paymasterUrl, skynulRouterAddress)
