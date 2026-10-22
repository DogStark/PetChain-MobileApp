# Stellar payments: network, review, idempotency and recovery

Contributor documentation for the payment path, covering issues #943, #945,
#946 and #947.

## 1. Network configuration is one unit (#943)

**Never read a network, Horizon URL or passphrase individually.** Call
`getStellarNetworkProfile()` from `src/config/stellarNetwork.ts`.

```ts
import { getStellarNetworkProfile } from '../config/stellarNetwork';

const { network, horizonUrl, networkPassphrase, friendbotUrl } = getStellarNetworkProfile();
```

### Why

These three values were previously chosen independently in two places:

| Module | How it chose |
| --- | --- |
| `services/blockchainService.ts` | `const STELLAR_NETWORK = 'TESTNET'` — a hard-coded literal |
| `services/stellarPathPaymentService.ts` | `config.env === 'production' ? PUBLIC : TESTNET` |

With `APP_ENV=production` those disagree: a transaction was **signed with the
public network passphrase** and **submitted to testnet Horizon**. A passphrase is
part of what a Stellar signature commits to, so the pairing must be resolved
together or not at all.

### Configuration

| Env var | Default | Notes |
| --- | --- | --- |
| `STELLAR_NETWORK` | `PUBLIC` in production, `TESTNET` otherwise | `PUBLIC`/`MAINNET`/`TESTNET` |
| `STELLAR_HORIZON_URL` | Canonical host for the network | Must be https and match the network |
| `STELLAR_ALLOW_PUBLIC_OUTSIDE_PRODUCTION` | `false` | Deliberate opt-in for staging against mainnet |

Resolution **throws** rather than falling back to a default, because a
wrong-network default is exactly the irreversible mistake being prevented.
Rejected combinations include: public network outside production, testnet in
production, a Horizon host belonging to the other network, non-https Horizon, and
a passphrase that does not match the network. All problems are reported at once.

## 2. Review before signing (#945)

Signing is irreversible, so the confirm screen describes **the bytes being
signed**, not the server-supplied quote.

- `simulateTransactionXdr(xdr, passphrase)` decodes the envelope: source, fee,
  memo, sequence, network, and every operation's destination, asset and amount.
- `compareQuoteToSimulation(quote, simulation, expectedNetwork)` flags any field
  where the displayed quote and the actual envelope disagree. A `blocking`
  discrepancy prevents signing — that is the defence against a wrong or tampered
  `transactionXdr` being approved against a reassuring summary.
- `evaluateQuoteFreshness(quote, now)` implements stale-quote expiry using
  `PathPaymentQuote.expiresAt`, which previously existed but was never read. An
  absent or unparseable expiry is treated as **expired**; refusing to sign is the
  safe direction.
- `canSignQuote(freshness, discrepancies)` is the single gate the UI consults.

`PaymentScreen` re-evaluates the gate **at the moment of signing**, not just on
render, because the countdown may not have ticked since the quote lapsed.

## 3. Submit at most once (#946)

Use `submitStellarTransactionOnce(transaction, operationKey)` rather than the raw
`submitStellarTransaction`. `sendPayment` and `storeDataOnStellar` already do.

Two distinct hazards, handled differently:

1. **Rapid taps.** Concurrent calls share a single in-flight promise keyed by the
   envelope hash. Registration happens *before the first `await`* — an earlier
   version read storage first, which let every tap in the same tick past the
   guard.
2. **Ambiguous timeouts.** A signed envelope has a deterministic hash, so the
   registry asks Horizon whether that hash already landed instead of rebuilding
   with a fresh sequence number. Rebuilding is what pays twice.

An unreachable Horizon leaves the record `pending`, never `failed` — an outage
is not evidence that a payment failed.

`PaymentScreen` additionally holds a synchronous `useRef` lock, because
`submitting` is React state and a second tap in the same frame can beat the
re-render.

### API change

`sendPayment` and `storeDataOnStellar` now resolve to `SubmitResult`
(`{ hash, status, deduplicated, ledger?, resultCode? }`) rather than a raw
Horizon `SubmitTransactionResponse`. Neither had callers outside
`blockchainService.ts`.

## 4. Surviving termination (#947)

The record is persisted **before** the network call, so an app killed mid-flight
leaves a durable trace. `App.tsx` calls
`reconcilePendingStellarTransactions()` on launch, which resolves anything left
`submitting`/`pending` against Horizon.

**Only non-secret data is stored.** A signed envelope contains the source public
key and a signature — the same bytes the network sees. Secret keys stay in secure
storage and never reach the registry, the pending store, or any log. Storage is
capped at 50 records, unresolved ones first, so trimming cannot discard live work.

## Testing

```bash
npx jest src/config/__tests__/stellarNetwork.test.ts
npx jest src/services/__tests__/transactionSimulation.test.ts
npx jest src/services/__tests__/stellarTransactionRegistry.test.ts
npx jest src/services/__tests__/stellarStartup.test.ts
```

`transactionSimulation.test.ts` calls `jest.unmock('@stellar/stellar-sdk')` and
builds real XDR envelopes: a mocked decoder would prove nothing about the review
path.
