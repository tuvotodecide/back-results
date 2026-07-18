# TVD module

This module owns TVD accounting and the isolated blockchain integration.

## Accounting

- `TvdExchangeRate` stores versioned BOB/TVD rates.
- Payment QR creation freezes a `tvdQuote` snapshot with the exact rate and
  token amount used at quote time.
- `TokenAccreditation` stores an internal accreditation request and idempotency
  by `sourceType + sourceId`.
- Monetary and token amounts are stored as strings. Conversion avoids floating
  point arithmetic and rounds down to avoid over-accrediting TVD.

Historical quotes are not recalculated when the exchange rate or token decimals
configuration changes. If a provisional decimals value is later found to be
wrong, affected pending accreditations should be moved to `NEEDS_REVIEW` before
any on-chain assignment. That transition belongs to the later integration flow.

## ABI and Contracts

ABI files live in:

- `src/modules/tvd/contracts/abis/tvd-token.abi.json`
- `src/modules/tvd/contracts/abis/tvd-assignment.abi.json`

These files must contain only ABI JSON. Contract addresses are not stored in ABI
files and must come from environment variables.

## Environment

The isolated blockchain service is considered configured only when all of these
values are present and valid:

- `TVD_RPC_URL`
- `TVD_CHAIN_ID`
- `TVD_TOKEN_CONTRACT_ADDRESS`
- `TVD_ASSIGNMENT_CONTRACT_ADDRESS`
- `TVD_OPERATOR_PRIVATE_KEY`
- `TVD_CONFIRMATIONS_REQUIRED`
- `TVD_DECIMALS`

`TVD_OPERATOR_PRIVATE_KEY` must come from secrets, must not be persisted, and
must not be logged or returned in responses. `TVD_DECIMALS` is provisional until
validated against `token.decimals()` on-chain.

## Blockchain Service

`TvdBlockchainService` is internal and isolated. It can validate configuration,
read token and assignment contract state, query balances, execute `assign()`,
and validate the receipt plus `TokensAssigned` event. It does not create
payment accreditations, does not process Red Enlace webhooks, and does not
expose public endpoints.

`assign()` is an operator action signed by the configured backend operator.
`release()` remains out of backend scope here: it must be signed by the
institutional wallet when the release flow is explicitly implemented later.

## Manual institutional assignments

A global `ADMIN` can create a manual TVD accreditation for an active, verified
institutional assignment. The backend resolves the wallet from
`TenantAdminAssignment.accountAddress` and never trusts an arbitrary wallet from
the request.

Manual assignments use `TokenAccreditation` with `sourceType = MANUAL_GRANT`
and are idempotent by `sourceType + sourceId`, where `sourceId` is the
`Idempotency-Key`. The application service orchestrates tenant validation,
wallet resolution, amount conversion, state transitions and audit events while
`TvdBlockchainService` remains isolated from HTTP, MongoDB, payments and
authorization.

## QR payment accreditations

When a Red Enlace QR payment is confirmed, the backend creates one idempotent
`TokenAccreditation` with `sourceType = QR_PAYMENT` using the institutional
wallet and TVD quote frozen when the QR was created.

The webhook does not execute blockchain operations or wait for a receipt.
Pending QR accreditations will be processed by the later worker and
reconciliation flow.
Accreditations in `NEEDS_REVIEW` are never submitted automatically.

## Accreditation processing

Pending QR and manual accreditations are processed through a common on-chain
processor. Accreditations are claimed atomically, while operator transactions
are serialized by chain and operator address to prevent nonce collisions.

The transaction hash and nonce are persisted before broadcast. Submitted
transactions are reconciled using the original signed transaction and are never
recreated as a new `assign()` operation after an ambiguous RPC result.

Accreditations in `NEEDS_REVIEW` are never processed automatically.
