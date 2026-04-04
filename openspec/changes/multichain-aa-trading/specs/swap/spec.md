# Swap Specification

## Purpose

Define the behavior of token swaps via DEX routers using ERC-4337 UserOperations. The system enables autonomous trading with automatic fee collection and gas payment in USDC.

## Requirements

### Requirement: Swap Execution

The system MUST execute token swaps through a DEX router using a UserOperation signed by the trading agent's Session Key. The swap MUST deduct the 1% platform fee before execution.

#### Scenario: Successful market swap

- GIVEN user has sufficient allowance for 100 USDC
- AND user has approved the SkynulRouter contract
- WHEN the agent initiates a swap of 100 USDC → WETH
- THEN the system:
  - Deducts 1 USDC fee (1%)
  - Swaps 99 USDC for WETH via DEX
  - Sends WETH to the user's Smart Account
  - Sends 1 USDC fee to the treasury address
- AND the system returns the transaction hash and amounts

#### Scenario: Swap fails due to slippage

- GIVEN agent initiates a swap with 50 bps slippage tolerance
- WHEN the DEX price moves beyond the slippage tolerance
- THEN the UserOperation reverts
- AND no fee is charged
- AND the system returns an error with the slippage details

#### Scenario: Swap fails due to insufficient liquidity

- GIVEN agent initiates a swap for a low-liquidity token
- WHEN the DEX cannot fulfill the order
- THEN the UserOperation reverts
- AND no fee is charged
- AND the system returns an insufficient liquidity error

### Requirement: Swap Intent Creation

The system MUST create SwapIntents that describe the desired trade before execution. The LLM agent generates the intent, and the SwapService validates and executes it.

#### Scenario: Agent creates valid swap intent

- GIVEN LLM agent decides to buy WETH with 50 USDC
- WHEN the agent generates a SwapIntent
- THEN the intent contains:
  - User ID
  - Token in: USDC address
  - Token out: WETH address
  - Amount in: 50 USDC
  - Minimum amount out: calculated with slippage
  - Chain ID
- AND the SwapService validates the intent against allowance

#### Scenario: SwapIntent rejected due to invalid token

- GIVEN LLM agent generates a SwapIntent for an unsupported token
- WHEN the SwapService validates the intent
- THEN the intent is rejected
- AND the system returns an unsupported token error

### Requirement: Price Estimation

The system MUST estimate the output amount for a given input before executing a swap, using on-chain price oracles or DEX quotes.

#### Scenario: Get price quote for USDC → WETH

- GIVEN user wants to swap 100 USDC for WETH
- WHEN the system requests a price quote
- THEN the system queries the DEX router for the current rate
- AND returns the estimated WETH output
- AND includes the price impact percentage

#### Scenario: Price quote expires

- GIVEN a price quote was retrieved 30 seconds ago
- WHEN the system attempts to use the quote for execution
- THEN the quote is considered stale
- AND a fresh quote must be fetched

### Requirement: Multi-Hop Swap Support

The system MUST support multi-hop swaps when a direct path is not available or has better rates.

#### Scenario: Multi-hop swap: USDC → WETH → TOKEN

- GIVEN user wants to swap USDC for a token not directly paired with USDC
- WHEN the system finds a multi-hop route
- THEN the swap executes through the intermediate token
- AND the fee is still 1% of the input amount
- AND the final token is sent to the user's Smart Account

#### Scenario: Multi-hop vs direct path comparison

- GIVEN both direct and multi-hop paths exist
- WHEN the system evaluates routes
- THEN the system selects the path with the best output
- AND logs both routes for audit

### Requirement: Swap History Tracking

The system MUST record every swap attempt (successful or failed) for audit and performance tracking.

#### Scenario: Record successful swap

- GIVEN a swap of 100 USDC → 0.05 WETH completes
- WHEN the system records the trade
- THEN the record includes:
  - User ID
  - Token in, token out
  - Amount in, amount out
  - Fee charged
  - Transaction hash
  - Timestamp
  - Chain ID
  - Status: success

#### Scenario: Record failed swap

- GIVEN a swap fails due to slippage
- WHEN the system records the attempt
- THEN the record includes:
  - User ID
  - Token in, token out
  - Amount in
  - Error reason
  - Timestamp
  - Chain ID
  - Status: failed
