# Proposal: Multichain Account Abstraction Trading Layer

## Intent

Permitir que el agente de Skynul ejecute trades on-chain de forma autónoma **sin que el usuario provea su private key** y **sin que Skynul pague gas**. El usuario conecta su wallet (MetaMask/browser extension), autoriza permisos limitados, y el agente opera dentro de esos límites. El gas se paga en USDC (vía Paymaster ERC-4337), no en ETH.

Esto elimina la fricción de:
- Dar PKs al sistema
- Tener ETH para gas
- Firmar cada transacción individualmente
- Estar atado a una sola red

## Scope

### In Scope
- **Domain Layer**: Interfaces `ChainProvider`, `SmartWallet`, `Paymaster`, `SwapRouter` que abstraen la infraestructura on-chain
- **ERC-4337 Integration**: Smart Account creation, Session Keys, UserOperations
- **Paymaster Integration**: Gas payment en USDC (Pimlico/Alchemy free tier)
- **Multichain Support**: Base, Arbitrum, Polygon, Ethereum (configurable)
- **Allowance System**: Tracking de permisos por usuario/token/chain con límites
- **Fee Collection**: 1% del trade deducido automáticamente en la misma tx
- **Service Layer**: `AllowanceService`, `SwapService`, `WalletService` con Effect.js
- **Action Executors**: Integración en `action-executors.ts` para `chain_swap`
- **Tests**: Tests unitarios de cada servicio + integration tests

### Out of Scope
- Deploy del contrato Smart Account (usamos estándar ERC-4337)
- Frontend UI (solo backend services)
- CEX trading (Binance/Coinbase ya implementados)
- Polymarket integration
- Evaluación post-trade / P&L tracking

## Approach

### Clean Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│                        Presentation Layer                        │
│  Action Executors (chain_swap, chain_get_balance, etc.)          │
├──────────────────────────────────────────────────────────────────┤
│                     Application Layer (Services)                 │
│  SwapService, AllowanceService, SmartWalletService              │
│  (Effect.js: Tag + Layer pattern)                               │
├──────────────────────────────────────────────────────────────────┤
│                        Domain Layer                              │
│  Interfaces: ChainProvider, SmartWallet, Paymaster, SwapRouter   │
│  Types: SwapIntent, Allowance, SessionKey, UserOperation         │
├──────────────────────────────────────────────────────────────────┤
│                    Infrastructure Layer                          │
│  Adapters: PimlicoProvider, AlchemyProvider, UniswapRouter       │
│  Ethers/Viem implementations                                    │
└──────────────────────────────────────────────────────────────────┘
```

### Flujo de Trading

```
1. Usuario conecta wallet (frontend)
2. Usuario firma "Permit" off-chain (autoriza USDC)
3. Usuario crea Smart Account (1 tx, gas pagado en USDC)
4. Usuario establece Session Key (permisos: max/trade, max/día, expiry)
5. Agente detecta oportunidad → crea SwapIntent
6. SwapService verifica Allowance → genera UserOp
7. Bundler ejecuta (Pimlico/Alchemy free tier)
8. Paymaster cobra gas en USDC del usuario
9. Router ejecuta swap + cobra 1% fee a Skynul
10. Resultado registrado en DB
```

### Multichain Strategy

- **Abstracción**: `ChainProvider` interface que cada red implementa
- **Config**: `chain-config.ts` con RPCs, contratos, bundlers por red
- **Provider Agnostic**: Pimlico, Alchemy, o self-hosted bundler
- **Router Agnostic**: Uniswap, SushiSwap, 1inch según la red

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `src/core/chain/types.ts` | Modified | Nuevos tipos: SwapIntent, SessionKey, UserOp |
| `src/core/chain/config.ts` | Modified | Multichain config (RPCs, bundlers, routers) |
| `src/services/allowances/` | Modified | AllowanceService con Effect.js |
| `src/services/smart-wallet/` | New | SmartWalletService (Tag + Layer) |
| `src/services/swap/` | New | SwapService (Tag + Layer) |
| `src/core/chain/domain/` | New | Interfaces: ChainProvider, Paymaster, SwapRouter |
| `src/core/chain/infrastructure/` | New | Adapters: PimlicoProvider, UniswapRouter |
| `src/core/agent/action-executors.ts` | Modified | chain_swap usa nuevos servicios |
| `src/infrastructure/db/schema/allowances.ts` | Modified | Schema actualizado |

## Risks

| Risk | Likelihood | Mitigation |
|------|-----------|------------|
| Bundler free tier se agota | Medium | Fallback a otro bundler (Pimlico → Alchemy) |
| Paymaster no soporta USDC en alguna red | Medium | Verificar soporte antes de agregar red |
| Session Key comprometida | Low | Límites estrictos (max/trade, max/día, expiry corto) |
| Smart contract vulnerability | Low | Usar contratos auditados (Safe, ERC-4337 reference) |
| Gas en USDC > gas en ETH | Low | Diferencia mínima en L2s (Base, Arbitrum) |

## Rollback Plan

1. Si el bundler falla, fallback a modo "intención manual" (usuario firma cada tx)
2. Si el paymaster falla, el usuario puede pagar gas en ETH directamente
3. Si el swap falla, la UserOp revierte (no se cobra fee)
4. Revocar Session Key desde el frontend en cualquier momento
5. Deploy de contratos es reversible (usuario puede retirar fondos)

## Dependencies

- **ERC-4337**: Bundler público (Pimlico free tier: 100k UserOps/mes)
- **Paymaster**: Soporte USDC en la red objetivo
- **Viem/Ethers**: Librería de interacción con Ethereum
- **OpenZeppelin**: Contratos estándar (IERC20, etc.)
- **Effect.js**: Ya integrado en el proyecto

## Success Criteria

- [ ] Usuario puede crear Smart Account sin tener ETH (paga gas en USDC)
- [ ] Agente puede ejecutar trades sin intervención del usuario
- [ ] Fee del 1% se cobra automáticamente en cada trade
- [ ] Soporte para al menos 2 redes (Base + Arbitrum)
- [ ] Tests unitarios > 90% coverage en servicios nuevos
- [ ] Typecheck y lint sin errores
- [ ] Documentación de arquitectura actualizada
