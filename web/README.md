# IMD Hongbao frontend

Chinese-first, bilingual IMD red packets on Robinhood Chain. This is a static Vite + React + TypeScript application: no backend, wallet relay, API key or WalletConnect project ID. The deployment is already live; this source does not deploy contracts or publish the website.

## Install, build and preview

Use Node 22.12+ (validated with Node 24) and npm. Run from the repository root:

```sh
npm ci --prefix web
npm run typecheck --prefix web
npm run build --prefix web
npm run preview --prefix web
```

For the same gateway-subpath preview used by the browser checks:

```sh
node web/scripts/preview.mjs
# Open http://localhost:4173/preview/
```

`npm run dev --prefix web` runs the source development server. It serves the deployment manifest and ABI files from the committed `dist/`; build first if those artifacts are absent. Vite's base is `./`, and navigation uses hashes. Upload **all of `dist/` together**; the publisher does not need to rebuild it. Do not open `index.html` with `file://`: HTTP(S) is needed for configuration fetches and wallet features.

## One runtime deployment configuration

The application fetches `dist/imd-deployment.json`, then loads and verifies the ABI JSON at each `abiPath`. It reads all deployment addresses, the chain, public RPC endpoints, pool key, protocol addresses and chain-add parameters from that manifest. `src/config.ts` centralizes configuration loading, wallet setup and generic ERC-20/Uniswap interface definitions. There is no independent application address map.

`deployment-handoff.json` and `network-handoff.json` are preserved **build inputs**, copied from the assignment. They are not imported into the application. `scripts/export.mjs`:

1. Uses `git show <sourceCommit>:docs/abi/<Contract>.json` to obtain the exact implementation-derived ABI at the deployed source commit.
2. Verifies Keccak-256 of canonical JSON (recursively sorted object keys; arrays preserve order) against the attested ABI hash.
3. Copies the complete contract set, identifiers, pool key, `network` and `walletAddChain` without changing their values.
4. Writes the final manifest after Vite, including lowercase SHA-256 for every exported file except the manifest itself.
5. Runs `scripts/verify.mjs` to check exact schema, bindings, file inventory, hashes and size limits. When the original assignment inputs are present, it also compares the preserved inputs with them.

Keep the pinned Git commit available when rebuilding. Never edit addresses in a component or invent a replacement RPC/router. A different deployment requires a new validated handoff. `dist/imd-deployment.json` must be regenerated after **any** change to export bytes, including images and metadata. Run `npm run verify --prefix web` to verify the existing export without rebuilding it.

Before transactions become available the runtime checks RPC chain ID, nonempty deployed application/IMD code, the box's immutable `imd()` address, and IMD decimals. The swap page additionally checks the configured Uniswap contracts and pool initialization. These checks bind the interface to the supplied handoff; they do not constitute a new contract audit or independently authenticate the handoff's attestation.

## Product flows

| Route | Controls and state |
| --- | --- |
| `#/` | Total IMD, 1–200 slots, lucky/equal mode, exact passphrase, expiry; gross/burn/net preview; exact-amount approval followed by creation; receipt-derived packet link and copy-ready message |
| `#/grab` | Open a packet by ID without a wallet |
| `#/p/<id>` | Live slots, expiry, state, recipients and shares; connected or pasted recipient; local EIP-712 signature and grab; creator reveal; permissionless equal fallback/refund; best-luck crown |
| `#/swap` | IMD ↔ HONGBAO quote, slippage, minimum output, explicit ERC-20 and Permit2 approvals, simulated router execution, pool/address details |
| `#/funds` | Deferred `claim`, authorized destination changes, `recoverSurplus`, escrow/balance reads, HONGBAO transfer |

Packets hold **IMD**, not the launch's HONGBAO token. Creation burns `floor(gross / 200)`; net must fund at least 0.01 IMD per slot. Equal packets pay immediately. Lucky grabs reserve slots without paying until reveal or equal fallback. The creator may choose between revealing and allowing equal settlement after 24 hours from filling or expiry. Robinhood Chain's sequencer orders transactions. This is a sender-controlled draw, not unbiased randomness or one-person-one-claim enforcement.

The contract is ownerless and needs no owner setup. Settlement/refund failures that defer a payout are exposed by the Funds page. Surplus recovery only transfers unassigned IMD above the contract's liabilities; the UI explains that any caller can recover it.

## Passphrases and reveal backups

`src/hongbao.ts` implements the exact packed derivation documented in `docs/INTEGRATION.md`: UTF-8 prefix, 32-byte chain ID, 20-byte box address, 32-byte random salt, and unmodified UTF-8 passphrase; then `(hash mod (N-1)) + 1`. The derived EOA signs `Grab(id, recipient)` locally. Its address and the typed-data digest are checked against on-chain views before sending. The wallet only submits the transaction and pays gas.

Passphrases and derived private keys stay in memory; neither is written to storage, telemetry, transaction calldata or share URLs. Share messages deliberately contain the passphrase separately from the `#/p/<id>` URL. The requested greeting-plus-four-random-character suggestion is a convenience, not a strong secret: public salts and key addresses permit offline guessing. The page warns about weak/common phrases, advises adding randomness and explains multiple-address participation.

Lucky reveal secrets use 32 cryptographically random bytes. The page displays the backup before creation, requires a saved-backup checkbox, and stores the code in local storage under a chain/contract/packet namespace. A pre-broadcast commitment-keyed backup supports receipt/reload recovery. If browser storage is denied, the manual backup is mandatory. A restore field accepts the original code and checks its commitment before reveal. The passphrase and reveal code are different; never share the reveal code. Browser data clearing removes local backups, and scripts on the same web origin can access local storage. A dedicated hosting origin and an independent private backup are preferable to sharing a gateway origin.

## Wallets, transactions and swaps

- EIP-6963 discovery names installed wallets; a generic browser-wallet fallback appears only when none is named.
- On mobile without an injected provider, the sheet offers MetaMask, Coinbase Wallet, Rabby and Phantom app-browser links. Coinbase Smart Wallet is also wired through the Coinbase SDK. No WalletConnect relay or project ID is used.
- Connect switches to the configured chain. An unknown-chain error triggers the **unchanged** `walletAddChain` parameters, followed by another switch. Wrong-chain actions remain unavailable.
- Public RPCs are tried in order, with a connected-wallet read fallback that verifies its chain. Wallet signing remains with the visitor.
- Each action has its own progress/error status. A shared lock prevents concurrent sends. Simulation precedes signing; balances and allowances refresh after confirmation. Pending transaction hashes are journaled in session storage, so a reload keeps the action locked while its receipt is recovered. Repriced/replaced/cancelled transactions are distinguished in the active session. A dropped transaction with no receipt remains pending; inspect it in the wallet/explorer rather than resubmitting blindly.
- Swaps use only the handoff's pool and `network.uniswapV4` addresses. Quotes are `eth_call` simulations of `quoteExactInputSingle`. Quotes expire after 30 seconds or an input/slippage/direction change. Slippage is 0.1–5%, with at most two decimal places. Minimum output is rounded down in token base units.
- ERC-20 input first approves the exact amount to Permit2, then authorizes Universal Router for that amount with a 30-minute expiration, only where allowance is short. The router uses command `0x10`, actions `0x060c0f`, and the configured **six-field** Robinhood tuple when `extendedSwapParams` is true. The additional `uint256` is zero. This IMD pair sends no native value. Router execution is simulated before a wallet prompt; its deadline is five minutes.
- Zero *active* liquidity is not a rejection condition: a v4 swap can cross into a funded tick range. The quoter determines whether the requested direction and amount are executable. Nested `NotEnoughLiquidity` and slippage/allowance errors are translated for the visitor.

The app shows token units, balances, exchange rates from quotes, complete copyable addresses and explorer links. No USD price is fabricated. Interactive state polls every five seconds; deployment health every minute and pool state every fifteen seconds, with background polling disabled.

## Validation

```sh
npm run typecheck --prefix web
npm run build --prefix web
npm run test --prefix web
npm run verify --prefix web
# Install browsers if needed; this browser cache is not a deliverable.
PLAYWRIGHT_BROWSERS_PATH=/tmp/imd-browsers web/node_modules/.bin/playwright install chromium webkit
PLAYWRIGHT_BROWSERS_PATH=/tmp/imd-browsers npm run test:browser --prefix web
# Both-language first screen and route-preserving keyboard skip, Chromium + WebKit.
PLAYWRIGHT_BROWSERS_PATH=/tmp/imd-browsers web/node_modules/.bin/tsx web/tests/layout-navigation.mjs
# Optional live reads and quotes only; this script never sends transactions.
PLAYWRIGHT_BROWSERS_PATH=/tmp/imd-browsers npm run check:live --prefix web
```

The browser suite serves the production export under `/preview/`, supplies a test-only EIP-6963 wallet and JSON-RPC fixture, blocks other network requests, checks interactions and produces evidence in `docs/validation/`. Mock contracts are never bundled into the app. Real mobile app handoff, Coinbase passkey creation, live funded transactions, a native screen reader and native browser zoom remain untested. The UI was measured at 320, 390, 768 and 1440 CSS pixels, with text enlargement separately tested at 200%.

The focused `layout-navigation.mjs` regression uses fresh storage with no injected wallet. It checks the Chinese and English Send action at 390×844, reflow at all four widths, and keyboard skip-link focus, scroll, route/history and form preservation on Send, Grab, packet, Swap and Funds. It writes `revision-ui.json` and English mobile screenshots. Both browser engines and their OS libraries are required; `--chromium-only` explicitly limits a local run and records that limitation in its engine list.

See [validation](../docs/FRONTEND-VALIDATION.md), [implemented design](../docs/DESIGN.md), and [attribution](../docs/ATTRIBUTION.md). The design document is in `docs/` because the assignment's explicit write budget forbids a root `DESIGN.md`.

## Packaging

The only ignore-file change is the explicitly allowed `web/.gitignore`. It excludes dependency and cache directories at every nesting level under `web/`, along with logs, reports and tarballs. No dependency registry, `node_modules`, browser binary or npm archive belongs in the submission. The source, npm lockfile, complete static export and evidence are the deliverables. `scripts/share-image.mjs` regenerates the small local PNG share image with Chromium; it has no external font/image dependency. Metadata remains relative until the publisher assigns a hosting URL.
