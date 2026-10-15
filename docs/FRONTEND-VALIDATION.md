# Frontend validation

Validated on 15 October 2026 against the final production export. This is worker-generated evidence, not independent certification, a contract audit or publication verification. No live transaction, approval, deployment or publication was performed.

## Delivered scope

The Chinese-first, bilingual frontend implements Send, Grab/Result, Swap and Funds. Source, frontend configuration, npm manifest/lockfile and repeatable tests are under `web/`; the complete static site is under `dist/`; documentation and evidence are under `docs/`. Existing deployed source, root build files and implementation-derived ABI exports were preserved.

The assignment's explicit path budget takes precedence over its request for a root `DESIGN.md`. The implemented design is documented at [docs/DESIGN.md](DESIGN.md). `web/.gitignore` is the only ignore-file addition and was explicitly permitted. Dependencies, caches, browser binaries and dependency archives are excluded from submission; none are needed for static serving.

## Final checks

| Check | Result and evidence |
| --- | --- |
| Clean dependency installation | `npm ci --prefix web` succeeded using the committed lockfile. Node 24, npm 11; Vite 8.3.4, React 19.3.1, TypeScript 5.9.3, Viem 2.57.7 and Wagmi 3.7.7. |
| Typecheck and production build | `npm run build --prefix web` passed, including `tsc --noEmit`, Vite and manifest generation/verification. [Build log](validation/build.log). Vite reports a non-blocking 500 KB chunk warning: the main JavaScript is about 663 KB minified / 201 KB gzip; the entire export is 859,010 bytes. |
| Unit/encoding tests | **10/10 passed**, covering exact key derivation, signature binding/replay boundaries, amount precision and limits, random phrase format, eligibility boundaries, six-field swap encoding, slippage, chain addition and nested errors. [Log](validation/unit-tests.log); reproducible source in `web/tests/core.test.ts`. |
| Browser interactions | **20/20 passed** against the production files at a `/preview/` subpath. EIP-6963 wallet and JSON-RPC were mocked, and other external requests were blocked. [Scenario results](validation/interactions.json). |
| Accessibility automation | Axe: **0 violations**, 43 passing rules in the tested English initial view. [Result](validation/accessibility.json). This is not exhaustive accessibility coverage. |
| Pinned design probe | **16/16 passed**, rendering at 320, 390 and 1440 CSS pixels, with no script errors, missing local files, horizontal scroll, overlapping text or clipped critical text. [Full probe output](validation/taste.json). The final 390 screenshot was visually inspected: brand, wallet control, amount/slots, mode, passphrase, expiry, net/burn and primary action are visible in the first 844 CSS pixels. |
| Manifest integrity | Exact handoff identifiers, complete contract set, network/chain-add objects, pool key, two pinned canonical ABI hashes and all **13** asset hashes verified. Manifest excludes itself. All paths are relative; no symlinks or extra manifest keys. Run `npm run verify --prefix web`. |
| Live reads | Both configured public RPCs returned chain **4663**, nonempty code for both application contracts, IMD, all six configured Uniswap contracts and the pool hook. Immutable IMD, application limits, token decimals/symbol and pool state were read. [Timestamped results](validation/live-read.json). |
| Packaging | Source, lockfile, export and evidence fit the 8 MiB submission budget. A complete tree snapshot and an incremental Git bundle were each checked against a conservative 3 MiB bound; see [packaging evidence](validation/packaging.json). Temporary checkouts/bundles remain outside deliverables. No submodule or dependency/cache directory is included. |

The recorded final interaction run completed at `2026-10-15T08:40:48.842Z`; final live reads began at `2026-10-15T08:43:58.583Z`. No application source or export was changed after these checks. Documentation and packaging evidence were finalized afterward.

## Interaction coverage

The browser suite exercises the main flows through actual rendered controls, decodes submitted calldata, and checks wallet requests and state changes. It does not merely inspect source strings.

- Both languages and disconnected initial state; navigation, metadata, gateway-relative resources and reloads.
- Named EIP-6963 discovery, hidden generic fallback when a named wallet exists, Coinbase Smart Wallet entry, all four mobile wallet links preserving the gateway path and packet hash, keyboard loop/Escape/focus return, rejected connection and unknown-chain add/switch sequence.
- Connected balance reads; invalid amount, precision and slot count; weak passphrase warning; rejected approval recovery; separate exact IMD approval; waiting for its receipt before creation.
- Lucky backup acknowledgement; simulation failure preventing a wallet send; successful packet ID decoded from receipt logs; copy-ready share message; no stored passphrase or derived private key.
- Wrong passphrase rejection; recipient-bound EIP-712 signature checked by the fixture; pasted recipient; duplicate-grab prevention; restore/reveal with a wrong and correct backup; final shares and crown.
- Permissionless settlement at its contract time and equal-packet refund after expiry; deferred claim redirection authorization; surplus recovery and launch-token transfer.
- Quote via `eth_call`, zero active liquidity with a successful quote, slippage/minimum output, both distinct approval layers, simulation failure, six-field Robinhood router calldata and both swap directions using only configured addresses.
- Wallet chain changes disable transactions; switching restores them. Missing deployed code fails closed with a retry. A tampered ABI fails before connection or signing.
- Broadcast/pending states prevent duplicate sends; session-storage journal restores the pending lock on reload and recovers receipt confirmation.
- No application console errors or local resource failures. Oversized balances, full addresses and expanded deployment information reflow at 320/390/1440; 200% text enlargement also reflows.

Screenshots: [390 px initial view](validation/mobile-390.png), [1440 px initial view](validation/desktop-1440.png), [visible keyboard focus](validation/keyboard-focus.png), [packet result and controls](validation/packet-results.png), [200% text](validation/text-enlargement.png), [mobile wallet sheet](validation/mobile-wallets.png), and [live-read initial view](validation/live-mobile.png). All except the last use mocked RPC/wallet state. They contain no real participant's wallet or funds.

## Better Interface review

The pinned contents/workflow, core principles of all six domains and relevant supporting sections were read before implementation. Source review and rendered checks were both performed; code review is not presented as proof of browser behavior.

| Domain | Applied and reviewed | Evidence and limits |
| --- | --- | --- |
| Accessibility | Semantic landmarks/headings; persistent input labels; invalid fields and associated errors; native radios/details/dialog; explicit focus loop and focus return; visible outlines; text status alongside color; reduced motion and forced-colors support. | `web/src/components/Wallet.tsx:147`, `web/src/pages/Send.tsx:318`, `web/src/styles.css:177`; keyboard interaction scenario, axe and screenshots. No native screen-reader or physical assistive-device session. |
| Layout | Form before explanation, one-column mobile layout, flexible header/tabs, min-width-safe fields, wrapping full values, no fixed overlay obscuring the action. | `web/src/styles.css:305`, `web/src/styles.css:1015`; probe at 320/390/1440 and interactions at 768 plus oversized data/text. First-screen action visually confirmed at 390. |
| Writing | Chinese first and complete English toggle; action-specific button labels; nearby costs, burn/net, beneficiaries, timing and approval steps; precise errors; explicit sender-choice/sequencer/weak-secret explanation. No fabricated USD price or activity. | `web/src/pages/Send.tsx:405`, `web/src/pages/Packet.tsx:415`, `web/src/errors.ts:130`; both-language tests and source review. Native-speaker copy review was not commissioned. |
| Typography | Six-size source scale, three weights, strongest main heading, natural spacing, comfortable body line height, tabular numbers, system fonts, long-value wrapping. | `web/src/styles.css:44`, `web/src/styles.css:102`; probe reports three weights, no tracked capitals, four/five rendered sizes at mobile/desktop. System-font availability differs by device. |
| Colors | Central semantic palette, crimson/gold on warm neutral surfaces; text and icon labels accompany status; distinct focus color. | Tokens in `web/src/styles.css:44`; all text measured by the probe meets 4.5:1 or 3:1 for large text. This does not claim every dynamic state or illustration was contrast-tested. |
| UI | Shared buttons/forms/panels, clear disabled prerequisites, independent action status, wallet rejection recovery, loading/empty states, separate approvals, confirmation tracking and reload recovery. Flat borders, restrained motion, no card nesting. | `web/src/components/UI.tsx`, `web/src/context.tsx:314`, `web/src/pages/Swap.tsx:139`; production browser interaction scenarios and design probe. Actual wallet extension and passkey prompts are outside the fixture. |

### Findings repaired before final build

| Severity/domain | Location in final source | Finding and repair |
| --- | --- | --- |
| High / transaction UI | `web/src/context.tsx:79` | Persisted Wagmi connector metadata can briefly lack `getProvider()` during hydration. Added connection/method guards; the pending-transaction reload scenario now passes without crashing or duplicating sends. |
| High / swap availability | `web/src/pages/Swap.tsx:139` | Treating zero active liquidity as an unusable pool incorrectly blocked a real successful quote. Removed that gate, retained verified code/initialization prerequisites, and made the quoter authoritative. Added an empty-active-range browser fixture. |
| High / transaction continuity | `web/src/context.tsx:41` and `web/src/context.tsx:102` | A page reload could lose pending-action context. Added a namespaced session journal, shared lock, receipt recovery and packet-event recovery; delayed-receipt and reload tests pass. |
| Medium / keyboard | `web/src/components/Wallet.tsx:155` | The wallet sheet needed deterministic focus containment and return. Added explicit Tab wrapping and dismissal handling, validated with keyboard interaction and focus screenshot. |
| Medium / layout | `web/src/styles.css:317` and `web/src/styles.css:1089` | Enlarged text and long values could make navigation/header content too wide. Allowed wrapping and flexible minimum widths; 200% text and long-balance/address checks now pass. |
| Medium / hierarchy | `web/src/styles.css:339` | Initial navigation pill treatment triggered the probe's eyebrow/kicker heuristic. Changed active navigation to an underline; no kicker-label findings remain. |
| Low / writing | `web/src/pages/Send.tsx` | An unavailable-balance dash failed the pinned glyph check and provided little guidance. Replaced it with localized “Connect to view” and a distinct loading state. |
| Medium / errors | `web/src/errors.ts:130` | The deployed quoter wraps `NotEnoughLiquidity` in `UnexpectedRevertBytes`. Added nested error decoding, including router execution wrappers, so the user sees an actionable liquidity explanation. Unit tests and live read-only quotes confirm translation. |

No failed first-screen or repeated design-probe check remains. The probe notes four targets smaller than its comfortable 44 px target, while all 17 tested controls satisfy its 24 px/spacing threshold. Radio options have large clickable labels; small auxiliary controls have spacing. Full device accessibility testing remains a limitation.

## Live-chain observations and boundaries

At blocks **89,090,794** and **89,090,797**, both public endpoints reported `nextId = 1`, `totalEscrow = 0`, IMD decimals 18, minimum share 0.01 IMD, maximum 200 slots, duration 600–604800 seconds and reveal grace 86400 seconds. The pool was initialized at tick 128998 with fee 12500 and active liquidity zero.

A read-only quote for **0.01 IMD → HONGBAO** returned **3926.885560341990674840 HONGBAO** with gas estimate 87612 on both endpoints. The reverse **0.01 HONGBAO → IMD** quote reverted with insufficient liquidity. These are timestamped quotes, not promised prices. A v4 swap can cross an empty active range, so zero active liquidity alone does not disable quoting. The UI shows the live quote or translated revert for the selected direction and amount.

Public RPC browser access was confirmed. An initial command-line HTTP probe returned 403; browser-origin RPC requests subsequently succeeded on both configured endpoints. No custom/private RPC credential was introduced.

Unperformed checks and operational limits:

- No funded mainnet create, grab, reveal, settle, refund, claim, approval, transfer or swap. Browser tests model those effects and verify requests; they cannot establish live execution, token economics or end-to-end contract behavior. No claim is made that the earlier contract test suite was rerun.
- No real Coinbase passkey creation, wallet-extension signing, native wallet app handoff or physical mobile device test. EIP-6963 and chain switch/add behavior were checked with a test provider; SDK integration was bundled and the picker exercised.
- No native screen reader, native browser zoom, forced-colors device or full cross-browser matrix. The actual checks use Chromium and 200% CSS text enlargement.
- Lucky backup codes live in the creator's browser and require the explicit private backup. Clearing storage or losing that backup can prevent reveal; permissionless equal settlement remains available at the contract's time. Same-origin scripts can access local storage.
- A dropped transaction without a receipt remains locked in the open session; inspect wallet/explorer state before retrying. Pending recovery is best effort when browser storage is denied.
- No on-chain USD source was provided, so the interface uses actual token units and quoted token exchange rates. Public RPC availability, quotes and balances can change.
- Open Graph image paths are relative because a final hosting domain was not supplied. Final absolute sharing URLs, IPFS pinning, named-site checks and control-plane publication verification belong to the publisher and were not performed here.
- The supplied Git object database is missing some historical objects, preventing an all-ancestry bundle. The current tree and pinned ABI commit are readable. Size checks instead cover a complete independent snapshot of the current tree plus deliverables, and an incremental bundle against the available base. Original Git metadata is read-only, so the prepared files require the publisher's commit; only temporary validation checkouts were committed here.

## Reproduction

Install, build and test commands are in [web/README.md](../web/README.md). Browser and live-read scripts install no runtime server into the export and never require a real private key. The pinned design probe was run from the repository root:

```sh
PLAYWRIGHT_BROWSERS_PATH=/tmp/imd-browsers \
IMD_PLAYWRIGHT="$PWD/web/node_modules/playwright/index.mjs" \
node .imd/reads/skills/design-critic/scripts/taste.mjs --out test/scratch/taste-final
```

The assignment removes `.imd/reads/` and `test/scratch/` before delivery. Its probe therefore requires the same pinned input to be supplied again; the final report is preserved here. The frontend's own tests, manifest verifier and live-read checker remain reproducible from the delivered source and lockfile without those temporary paths.
