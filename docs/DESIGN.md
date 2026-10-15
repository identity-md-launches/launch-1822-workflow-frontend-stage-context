# IMD Hongbao: implemented design

This document intentionally lives in `docs/`. The assignment requests a root `DESIGN.md`, but its overriding write budget permits only `web/**`, `dist/**`, `docs/**` and the explicitly named `web/.gitignore`.

## Overview

The product is a Chinese-first red-packet utility for people sending IMD to friends. English is a complete alternate interface. The visual idea is a traditional red envelope on warm paper: crimson actions, gold envelope details, quiet cream surfaces, and a visible form before explanatory content. The design follows the requested red-and-gold direction; ordinary spacing and typography choices were implementation decisions.

The application form is the leading column. A locally drawn envelope illustration, short explanation and three steps occupy the secondary desktop column. At narrow widths, the illustration disappears and explanatory content follows the complete form. There is no introductory hero before the primary action.

## Colors

All UI colors are defined in `web/src/styles.css`, in the `tokens` layer. Components consume semantic aliases; the original illustration and third-party wallet marks have their own explicit artwork colors.

| Token | Actual value | Role |
| --- | --- | --- |
| `--page` → `--cream-100` | `#f8f3e9` | Warm page background |
| `--surface` → `--cream-50` | `#fffcf7` | Panels, inputs and dialog |
| `--surface-subtle` → `--cream-200` | `#efe6d7` | Gentle hover backgrounds, secondary separators |
| `--border` → `--cream-300` | `#d9cdbb` | Structural borders and dividers |
| `--text` → `--ink-900` | `#342d28` | Primary text |
| `--muted` → `--ink-600` | `#73685c` | Secondary text and supporting copy |
| `--accent` → `--red-700` | `#a92429` | Primary action, selected navigation, links |
| `--accent-hover` → `--red-800` | `#8e1d23` | Hovered primary action and error text |
| `--accent-soft` → `--red-50` | `#fbebe7` | Selected packet mode and success symbol background |
| `--accent-text` | `#fffcf7` | Primary-action text |
| `--ornament` → `--gold-200` | `#edcc86` | Envelope seal and brand mark |
| `--warning` → `--gold-800` | `#815a24` | Warnings and best-luck label |
| `--success` → `--green-700` | `#33614b` | Confirmed status text and connection dot |
| `--focus` | `#275c96` | Three-pixel visible keyboard outline |

The page is deliberately light only; there is no theme control. Status is always accompanied by text, so red/gold/green are not the only signal. The final taste probe measures rendered text contrast; the evidence reports all measured text meeting 4.5:1, or 3:1 for large text. No unmeasured artwork contrast is claimed.

## Typography

`--font-body` is `PingFang SC`, `Microsoft YaHei`, `Noto Sans CJK SC`, `system-ui`, `sans-serif`. `--font-display` is `Noto Serif CJK SC`, `Songti SC`, `STSong`, `Georgia`, `serif`. Backup codes use `ui-monospace, monospace`. No remote font requests or font files are required. These are system-font preferences: a computed family list does not prove which specific CJK face is installed on every platform.

The six-size scale is 14, 16, 18, 24, 32 and 40 px at a 16 px root (`--text-small`, `--text-body`, `--text-heading`, `--text-title`, `--text-display`, `--text-art`). Body weight is 400, labels/emphasis 600, and the main headline 700. The main heading is 40 px on wide desktops, 32 px on ordinary mobile widths and 24 px below 350 px. The secondary story heading never outweighs it. Body line height is 1.6, main headings 1.25, subordinate headings 1.4. Natural letter spacing is retained.

Headings balance their lines; supporting paragraphs use pretty wrapping. Amounts and changing numbers use tabular numerals. Complete addresses, large balances, hashes and backup codes wrap rather than being clipped. Inputs remain at least 16 px at normal text size, avoiding the small-input zoom trigger on iOS.

## Layout

The header is capped at 1200 px. The main grid and footer are capped at 1120 px, with 40 px horizontal padding on wide screens. The content grid uses `minmax(0, 560px)` for the form and a flexible secondary column, separated by 64 px. Panels use 32 px padding; common intra-group gaps are 6–12 px and inter-group gaps 16–28 px.

At 920 px, horizontal padding and panel padding reduce to 24 px and the column gap to 32 px. At 760 px, the layout becomes one column with 16 px outer margins and 22 px panel padding; the decorative illustration disappears, the brand subtitle is hidden, and the header may wrap. At 350 px, margins become 12 px and panel padding 18 px. Navigation wraps when enlarged text cannot fit four items. The two amount/slot fields retain a `minmax(0, …)` grid.

Observed widths: 320, 390, 768 and 1440 px. Both language variants show the product, main form and action inside the 390×844 first screen. Expanded contract details and oversized balances were checked at 320/390/1440. The 200% text-size test passes without sideways scrolling; this is not a native browser-zoom claim.

## Elevation & depth

The system is flat. Panels use a one-pixel structural border, without a shadow. Inputs and selected modes use borders; selected navigation uses a red underline. There are no gradient headings, stacked cards or perpetual animations. The native wallet dialog uses the browser top layer and a `rgb(52 45 40 / .45)` backdrop; it is the only overlay.

## Shapes

`--radius-control` is 10 px and `--radius-panel` is 20 px. The modal shares the 20 px radius and becomes a bottom sheet with rounded top corners on mobile. The brand is a small rounded red envelope; the outlined envelope and circular gold seal carry through the local SVG illustration and PNG share card. No critical text is hidden with clipping or ellipsis. The abbreviated header wallet address opens a dialog with its complete, copyable value.

## Components

| Source/pattern | Intended use and behavior |
| --- | --- |
| `components/UI.tsx`: `Icon` | One 1.6 px outline SVG set using `currentColor`; decorative to accessibility APIs. Crown indicates best luck. Wallet-vendor marks remain separate, with their official colors. |
| `Wallet.tsx`: `Wallet` | One wallet sheet reached from header or action gate. Named EIP-6963 rows, mobile deep links and Coinbase. Native dialog, explicit Tab loop, Escape/backdrop/close dismissal, focus return, per-row pending state and inline errors. |
| `.tabs` | Real hash-navigation links; active state uses `aria-current="page"` and a red underline. |
| `.panel`, `.panel-heading` | Primary task surface and title; use for new task views rather than introducing another card system. |
| `.field`, `.form-pair`, `.unit-input` | Persistent labels, appropriate input modes, 46 px minimum controls; units remain visible beside numeric entry. Creation errors reference the form error and mark the relevant field invalid. |
| `.primary`, `.secondary`, `.text-button` | Filled transaction/continuation action, bordered secondary action, underlined auxiliary action. Primary buttons are at least 48 px high. Disabled state is native and visibly dimmed. |
| `ActionGate` | Connection and chain/verification prerequisites. It never enables transaction controls when those checks fail. |
| `TxStatus` and `useTransaction` | Preparing, simulation, wallet confirmation, pending receipt, success and persistent error states. Pending/recovery status and transaction links survive route changes; a session journal protects reloads. |
| `AddressView`, `CopyButton` | Full checksummed address with explorer link and clipboard action. Clipboard failure gives a manual-copy instruction. |
| `.amount-summary`, `.stats-list` | Gross/net/burn and other structured amounts; values wrap and use stable numeric widths. |
| `.backup-panel` | Lucky-packet secret, private-backup warning and explicit saved-backup checkbox before signing. |
| `.grabbers`, `.best-luck` | Ordered on-chain recipients, final shares or pending labels, with a crown for the recorded winner. Empty state explains how to share a packet. |
| Native `<details>` | Rules, recipient override, deployment information, approvals and advanced transfer. Disclosure remains visible and keyboard accessible. |

Focus uses a three-pixel outline with a three-pixel offset, preserving system colors in forced-colors mode. Hover is gated by pointer capability. The only motion is a 120 ms transition of background/color/transform and a 0.96 press scale, enabled only when reduced motion is not requested. There is no `transition: all` or autoplay.

## Do's and don'ts

- Start a task page with the existing panel, heading, fields and action patterns. Keep the actionable state above explanation.
- Use the existing semantic colors, type scale and 400/600/700 weights. Keep the main heading strongest.
- Give every input a label; use native buttons, links, radios and disclosure controls. Keep full critical values reachable.
- Use `ActionGate`, `useTransaction` and centralized configuration for contract actions. Design changes must preserve chain and eligibility checks.
- Put incidental explanation in details, while keeping costs, beneficiaries, approvals and irreversible consequences next to the action.
- Do not add a pre-form marketing hero, fabricated chain statistics, a new font download, a second address map or an alternate wallet connection system.

Design guidance attribution and licenses are recorded in `docs/ATTRIBUTION.md` and `docs/licenses/`. Review evidence and limitations are in `docs/FRONTEND-VALIDATION.md`.
