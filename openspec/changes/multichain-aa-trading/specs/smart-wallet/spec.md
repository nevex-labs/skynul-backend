# Smart Wallet Specification

## Purpose

Define the behavior of Smart Contract Wallet management via ERC-4337 (Account Abstraction). Users create and manage Smart Accounts that enable autonomous trading without exposing private keys.

## Requirements

### Requirement: Smart Account Creation

The system MUST allow users to create a Smart Account (ERC-4337 compatible) by signing a single transaction from their EOA (Externally Owned Account). The gas for creation MAY be paid in USDC via Paymaster.

#### Scenario: User creates Smart Account with USDC gas payment

- GIVEN user has connected their EOA (MetaMask) to the frontend
- AND user has sufficient USDC balance on the target chain
- WHEN user initiates Smart Account creation
- THEN the system generates a UserOperation for account deployment
- AND the Paymaster covers the ETH gas cost
- AND the user's USDC balance is debited for the equivalent gas cost
- AND the Smart Account address is returned and stored

#### Scenario: User creates Smart Account on a new chain

- GIVEN user already has a Smart Account on Base
- WHEN user requests Smart Account creation on Arbitrum
- THEN the system deploys a Smart Account on Arbitrum with the same owner
- AND the new account address is linked to the user's profile

#### Scenario: Smart Account creation fails due to insufficient USDC

- GIVEN user has less USDC than the minimum required for gas
- WHEN user initiates Smart Account creation
- THEN the system returns an error indicating insufficient USDC for gas
- AND no Smart Account is created

### Requirement: Session Key Management

The system MUST allow users to create, revoke, and manage Session Keys that grant limited permissions to the trading agent.

#### Scenario: User approves a Session Key for the trading agent

- GIVEN user has an active Smart Account
- WHEN user signs a Session Key approval with their EOA
- THEN the Session Key is recorded on-chain with the following constraints:
  - Maximum amount per trade
  - Maximum daily volume
  - Expiration timestamp
  - Allowed token pairs (whitelist)
- AND the agent can now execute trades within these limits

#### Scenario: Session Key expires automatically

- GIVEN a Session Key was created with a 30-day expiry
- WHEN 30 days have passed since creation
- THEN the Session Key is no longer valid
- AND any UserOperation signed by the expired key is rejected

#### Scenario: User revokes a Session Key

- GIVEN user has an active Session Key
- WHEN user signs a revocation transaction from their EOA
- THEN the Session Key is immediately invalidated on-chain
- AND the agent can no longer execute trades with that key

### Requirement: Smart Account Balance Query

The system MUST allow querying the balance of any ERC-20 token held in a Smart Account.

#### Scenario: Query USDC balance in Smart Account

- GIVEN user has a Smart Account with 500 USDC
- WHEN the system queries the USDC balance
- THEN the system returns 500 USDC (in smallest unit: 500000000)

#### Scenario: Query balance of token with zero holdings

- GIVEN user has a Smart Account with no WETH
- WHEN the system queries the WETH balance
- THEN the system returns 0

### Requirement: Smart Account Withdrawal

The system MUST allow users to withdraw any ERC-20 token from their Smart Account to any address they control. Withdrawals MUST be signed by the user's EOA and cannot be initiated by the trading agent.

#### Scenario: User withdraws all USDC from Smart Account

- GIVEN user has 500 USDC in their Smart Account
- WHEN user signs a withdrawal request to their EOA address
- THEN all 500 USDC is transferred to the user's EOA
- AND the Smart Account USDC balance becomes 0

#### Scenario: Agent attempts to withdraw funds (must fail)

- GIVEN user has 500 USDC in their Smart Account
- WHEN the trading agent attempts to initiate a withdrawal
- THEN the transaction is rejected
- AND the Smart Account balance remains unchanged
