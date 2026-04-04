# Allowance Specification

## Purpose

Define the behavior of allowance tracking for user-approved trading limits. The system tracks how much USDC a user has approved, how much has been used, and fees collected.

## Requirements

### Requirement: Allowance Check

The system MUST verify that a user has sufficient allowance before executing any trade. The check MUST include both the trade amount and the 1% platform fee.

#### Scenario: Sufficient allowance for trade

- GIVEN user has approved 1000 USDC
- AND user has used 200 USDC in previous trades
- AND user has accumulated 2 USDC in fees
- WHEN user requests a trade of 500 USDC
- THEN the system calculates:
  - Available: 1000 - 200 - 2 = 798 USDC
  - Required: 500 + 5 (1% fee) = 505 USDC
- AND the trade is allowed (798 >= 505)

#### Scenario: Insufficient allowance for trade

- GIVEN user has approved 100 USDC
- AND user has used 90 USDC in previous trades
- AND user has accumulated 0.9 USDC in fees
- WHEN user requests a trade of 10 USDC
- THEN the system calculates:
  - Available: 100 - 90 - 0.9 = 9.1 USDC
  - Required: 10 + 0.1 (1% fee) = 10.1 USDC
- AND the trade is rejected (9.1 < 10.1)
- AND the system returns an error indicating the shortfall

#### Scenario: No allowance exists for user

- GIVEN user has never approved any allowance
- WHEN user requests a trade of any amount
- THEN the system returns insufficient allowance
- AND the error message includes instructions on how to approve

### Requirement: Allowance Recording

The system MUST record allowance usage after each successful trade, updating both the used amount and fee collected.

#### Scenario: Record trade usage

- GIVEN user has approved 1000 USDC
- AND current used amount is 0
- AND current fees collected is 0
- WHEN a trade of 100 USDC completes successfully
- THEN the system updates:
  - Used amount: 0 + 100 = 100 USDC
  - Fees collected: 0 + 1 = 1 USDC (1%)
- AND the remaining available allowance becomes 899 USDC

#### Scenario: Record usage fails silently if DB error

- GIVEN a trade completes successfully on-chain
- WHEN the system attempts to record usage
- AND the database is unavailable
- THEN the system logs the error
- AND the trade result is still returned to the user
- AND the system retries recording on next opportunity

### Requirement: Allowance Revocation Detection

The system MUST detect when a user revokes or reduces their on-chain allowance and update the internal tracking accordingly.

#### Scenario: User reduces on-chain allowance

- GIVEN user had approved 1000 USDC
- AND user has used 200 USDC
- WHEN user reduces their on-chain approval to 500 USDC
- THEN the system detects the change on next sync
- AND resets the used amount to 0
- AND updates the approved amount to 500 USDC

#### Scenario: User revokes on-chain allowance completely

- GIVEN user had approved 1000 USDC
- WHEN user sets on-chain approval to 0
- THEN the system detects the revocation
- AND marks the allowance as inactive
- AND no further trades can be executed until re-approval

### Requirement: Fee Calculation

The system MUST calculate a 1% platform fee on every trade. The fee is deducted from the trade amount, not added on top.

#### Scenario: Calculate fee for standard trade

- GIVEN trade amount is 100 USDC
- WHEN the system calculates the fee
- THEN the fee is 1 USDC (1%)
- AND the net trade amount is 99 USDC

#### Scenario: Calculate fee for small trade

- GIVEN trade amount is 0.50 USDC
- WHEN the system calculates the fee
- THEN the fee is 0.005 USDC
- AND the net trade amount is 0.495 USDC

#### Scenario: Calculate fee for zero amount

- GIVEN trade amount is 0 USDC
- WHEN the system calculates the fee
- THEN the fee is 0 USDC

### Requirement: Fee Collection

The system MUST collect the platform fee by transferring it to the Skynul treasury address during the trade execution.

#### Scenario: Fee transferred to treasury

- GIVEN a trade of 100 USDC is executed
- AND the fee is 1 USDC
- WHEN the trade completes
- THEN 1 USDC is transferred to the treasury address
- AND the remaining 99 USDC is used for the swap
