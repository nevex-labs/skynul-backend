# Multichain Specification

## Purpose

Define the behavior of the multichain abstraction layer. The system MUST support multiple EVM-compatible chains with a unified interface, allowing the trading agent to operate across networks without chain-specific code.

## Requirements

### Requirement: Chain Configuration

The system MUST maintain a configuration for each supported chain including RPC endpoints, bundler URLs, DEX router addresses, and native token details.

#### Scenario: Query chain configuration

- GIVEN the system is initialized
- WHEN a component requests configuration for chain ID 8453 (Base)
- THEN the system returns:
  - Chain name: "Base"
  - Native token: ETH
  - RPC URL
  - Bundler URL (Pimlico/Alchemy)
  - USDC address
  - DEX router address
  - Paymaster address
  - SkynulRouter address

#### Scenario: Request configuration for unsupported chain

- GIVEN a component requests configuration for chain ID 99999
- WHEN the chain is not in the configuration
- THEN the system returns null
- AND logs a warning

### Requirement: Chain Detection

The system MUST detect the user's current chain from their connected wallet and validate it against supported chains.

#### Scenario: User connects on supported chain

- GIVEN user connects their wallet on Base (chain ID 8453)
- WHEN the system detects the chain
- THEN the system confirms the chain is supported
- AND loads the chain configuration

#### Scenario: User connects on unsupported chain

- GIVEN user connects their wallet on an unsupported chain
- WHEN the system detects the chain
- THEN the system returns an unsupported chain error
- AND prompts the user to switch to a supported chain

### Requirement: Cross-Chain Bridge Detection

The system SHOULD detect when a user's funds are on a different chain than the target trading chain and suggest bridging.

#### Scenario: User has funds on different chain

- GIVEN user wants to trade on Base
- AND user's USDC balance is on Arbitrum
- WHEN the system checks fund availability
- THEN the system detects the fund location
- AND suggests bridging from Arbitrum to Base
- AND provides estimated bridge time and cost

### Requirement: Chain-Specific Fee Estimation

The system MUST estimate gas fees in USDC for each supported chain, accounting for different gas prices and token decimals.

#### Scenario: Estimate gas fee on Base

- GIVEN user wants to execute a swap on Base
- WHEN the system estimates the gas cost
- THEN the system queries current gas prices on Base
- AND converts the estimated ETH gas cost to USDC
- AND returns the total cost in USDC

#### Scenario: Estimate gas fee on Arbitrum

- GIVEN user wants to execute a swap on Arbitrum
- WHEN the system estimates the gas cost
- THEN the system queries current gas prices on Arbitrum
- AND converts the estimated ETH gas cost to USDC
- AND returns the total cost in USDC

### Requirement: Provider Abstraction

The system MUST abstract the bundler and paymaster providers so that switching between Pimlico, Alchemy, or self-hosted bundlers requires only configuration changes.

#### Scenario: Switch bundler provider

- GIVEN the system is configured with Pimlico as the bundler
- WHEN the configuration is changed to Alchemy
- THEN the system uses Alchemy's bundler endpoint
- AND all existing functionality continues to work
- AND no code changes are required

#### Scenario: Fallback to secondary bundler

- GIVEN the primary bundler (Pimlico) is unavailable
- WHEN the system attempts to send a UserOperation
- THEN the system retries with the secondary bundler (Alchemy)
- AND if both fail, returns an error

### Requirement: Supported Chains Registry

The system MUST maintain a registry of supported chains with metadata including name, icon, explorer URL, and native currency symbol.

#### Scenario: List supported chains

- GIVEN the system is queried for supported chains
- WHEN the list is requested
- THEN the system returns:
  - Base (8453): ETH, USDC, WETH
  - Arbitrum (42161): ETH, USDC, WETH
  - Polygon (137): MATIC, USDC, WETH
  - Ethereum (1): ETH, USDC, WETH

#### Scenario: Add new chain to registry

- GIVEN a new chain configuration is added
- WHEN the system is restarted
- THEN the new chain appears in the supported chains list
- AND all services can operate on the new chain
