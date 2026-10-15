import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import AxeBuilder from "@axe-core/playwright";
import { preview } from "../scripts/preview.mjs";
import { fixture, installMock, TEST_PHRASE, UNIT } from "./mock-chain.mjs";
import { decodeAbiParameters, parseAbiParameters, keccak256 } from "viem";

const output = fileURLToPath(
  new URL("../../docs/validation/", import.meta.url),
);
await mkdir(output, { recursive: true });
const results = [];
const errors = [];
const server = preview();
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const url = `http://127.0.0.1:${server.address().port}/preview/`;
const browser = await chromium.launch({ headless: true });
const wait = async (fn, message = "condition", timeout = 12000) => {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (await fn()) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw Error(`Timeout: ${message}`);
};
async function check(name, fn) {
  const start = Date.now();
  try {
    await fn();
    results.push({ name, passed: true, durationMs: Date.now() - start });
    console.log(`PASS ${name}`);
  } catch (e) {
    results.push({
      name,
      passed: false,
      error: e.stack,
      durationMs: Date.now() - start,
    });
    console.error(`FAIL ${name}: ${e.message}`);
    throw e;
  }
}
async function newPage(options = {}, mockOptions = {}) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    ...options,
  });
  const page = await context.newPage();
  const state = fixture();
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("response", (res) => {
    if (res.url().startsWith(url) && res.status() >= 400)
      errors.push(`${res.status()} ${new URL(res.url()).pathname}`);
  });
  await installMock(page, state, mockOptions);
  await page.goto(url);
  await page.getByRole("heading", { name: "发一份好运" }).waitFor();
  await wait(
    async () =>
      (await page.locator(".connection-state").textContent()).includes(
        "已验证",
      ),
    "deployment verification",
  );
  return { context, page, state };
}
async function english(page) {
  await page.getByRole("button", { name: "Switch to English" }).click();
}
async function connect(page) {
  await page
    .getByRole("button", { name: "Connect wallet", exact: true })
    .click();
  await page.getByRole("button", { name: "Test wallet", exact: true }).click();
  await wait(
    async () => !(await page.locator("dialog").isVisible()),
    "wallet connected",
  );
  await wait(
    async () =>
      (await page.locator("#amount-help").textContent()).includes("1000"),
    "live balance after connect",
  );
}
async function noOverflow(page) {
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    true,
    "horizontal overflow",
  );
}
async function confirmed(page, fn, state) {
  await wait(() => state.writes.some((w) => w.fn === fn), `${fn} broadcast`);
  await wait(
    async () =>
      !(await page
        .getByText("A transaction is in progress.", { exact: false })
        .count()),
    `${fn} receipt`,
  );
}

try {
  const { page, context, state } = await newPage();
  await check(
    "Chinese first screen, relative subpath, metadata and reflow at 320/390/768/1440",
    async () => {
      for (const width of [320, 390, 768, 1440]) {
        await page.setViewportSize({ width, height: width < 600 ? 844 : 1000 });
        await noOverflow(page);
        if (width === 390) {
          const button = await page
            .getByRole("button", { name: "连接钱包，开始使用", exact: true })
            .boundingBox();
          assert(
            button.y + button.height < 844,
            "main action below first screen",
          );
          await page.screenshot({ path: `${output}mobile-390.png` });
        }
        if (width === 1440)
          await page.screenshot({ path: `${output}desktop-1440.png` });
      }
      assert.match(await page.title(), /IMD/);
      for (const selector of [
        'meta[name="description"]',
        'meta[property="og:title"]',
        'meta[property="og:image"]',
        'link[rel="icon"]',
      ])
        assert.equal(await page.locator(selector).count(), 1);
      assert.equal((await page.request.get(`${url}share.png`)).status(), 200);
    },
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await check(
    "English toggle, semantic labels, no serious/critical accessibility findings",
    async () => {
      await english(page);
      await page.getByRole("heading", { name: "Send a little luck" }).waitFor();
      await noOverflow(page);
      const button = await page
        .getByRole("button", { name: "Connect wallet to continue" })
        .boundingBox();
      assert(
        button.y + button.height < 844,
        "English main action below first screen",
      );
      const scan = await new AxeBuilder({ page }).analyze();
      const violations = scan.violations.map(({ id, impact, nodes }) => ({
        id,
        impact,
        count: nodes.length,
      }));
      await writeFile(
        `${output}accessibility.json`,
        JSON.stringify({ violations, passes: scan.passes.length }, null, 2),
      );
      assert.equal(
        violations.filter((v) => ["serious", "critical"].includes(v.impact))
          .length,
        0,
        JSON.stringify(violations),
      );
    },
  );
  await check(
    "EIP-6963 named wallet picker, keyboard focus trap and Escape focus return",
    async () => {
      await page
        .getByRole("button", { name: "Connect wallet", exact: true })
        .focus();
      await page.keyboard.press("Enter");
      assert(
        await page.getByRole("button", { name: "Test wallet" }).isVisible(),
      );
      assert.equal(
        await page
          .getByRole("button", { name: "Browser wallet", exact: true })
          .count(),
        0,
      );
      assert(
        await page
          .getByRole("button", { name: "Coinbase Wallet", exact: true })
          .isVisible(),
      );
      for (let i = 0; i < 7; i++) {
        await page.keyboard.press("Tab");
        assert(
          await page.evaluate(() => !!document.activeElement.closest("dialog")),
        );
      }
      await page.keyboard.press("Escape");
      assert(
        await page
          .getByRole("button", { name: "Connect wallet", exact: true })
          .evaluate((el) => el === document.activeElement),
      );
      const outline = await page
        .getByRole("button", { name: "Connect wallet", exact: true })
        .evaluate((el) => getComputedStyle(el).outlineWidth);
      assert.equal(outline, "3px");
      await page.screenshot({ path: `${output}keyboard-focus.png` });
    },
  );
  await connect(page);
  await check(
    "Live balances after connect, invalid amount/slots/precision and weak-passphrase warning",
    async () => {
      assert.match(await page.locator("#amount-help").innerText(), /1000 IMD/);
      await page.locator("#amount").fill("0.01");
      await page.getByRole("button", { name: "Approve IMD · step 1" }).click();
      await page
        .getByText("After the 0.5% burn, each slot needs at least 0.01 IMD.")
        .waitFor();
      assert.equal(state.writes.length, 0);
      await page.locator("#amount").fill("10");
      await page.locator("#slots").fill("201");
      await page.getByRole("button", { name: "Approve IMD · step 1" }).click();
      await page.getByText("Choose between 1 and 200 packets.").waitFor();
      await page.locator("#slots").fill("5");
      await page.locator("#passphrase").fill("123456");
      await page.getByText("Weak passphrase.", { exact: false }).waitFor();
      await page.locator("#passphrase").fill(TEST_PHRASE);
    },
  );
  await check(
    "Rejected approval recovers, exact IMD approval is separate and waits for confirmation",
    async () => {
      state.rejectNext = true;
      await page.getByRole("button", { name: "Approve IMD · step 1" }).click();
      await page
        .getByText("Wallet request cancelled. You can try again.")
        .waitFor();
      assert.equal(state.writes.length, 0);
      await page.getByRole("button", { name: "Approve IMD · step 1" }).click();
      await page
        .getByRole("button", { name: "Prepare packet · step 2" })
        .waitFor();
      assert.equal(state.writes.length, 1);
      assert.equal(state.writes[0].fn, "approve");
      assert.equal(state.writes[0].args[0].toLowerCase(), state.box);
      assert.equal(state.writes[0].args[1], 10n * UNIT);
    },
  );
  await check(
    "Lucky create requires private backup, simulates first, shows receipt-derived share link",
    async () => {
      await page
        .getByRole("button", { name: "Prepare packet · step 2" })
        .click();
      await page
        .getByRole("heading", { name: "Save your reveal backup" })
        .waitFor();
      assert(
        await page
          .getByRole("button", { name: "Confirm and send packet" })
          .isDisabled(),
      );
      const secret = await page.locator(".backup-code").textContent();
      assert.match(secret, /^0x[0-9a-f]{64}$/);
      await page.getByLabel("I saved my backup code").check();
      state.simulationFailed = true;
      await page
        .getByRole("button", { name: "Confirm and send packet" })
        .click();
      await page
        .getByText(
          "IMD transferred an unexpected amount. The transaction was reverted.",
        )
        .waitFor();
      assert.equal(state.writes.filter((w) => w.fn === "create").length, 0);
      state.simulationFailed = false;
      await page
        .getByRole("button", { name: "Confirm and send packet" })
        .click();
      await page
        .getByRole("heading", { name: "Your packet is ready" })
        .waitFor();
      const message = await page.locator("#share-message").inputValue();
      assert.match(message, /#\/p\/6/);
      assert(message.includes(TEST_PHRASE));
      assert(!message.includes(secret));
      const tx = state.writes.find((w) => w.fn === "create");
      assert.equal(tx.args[6], keccak256(secret));
      const storage = await page.evaluate(() =>
        Object.fromEntries(
          Object.entries(localStorage).filter(([k]) =>
            k.startsWith("imd-hongbao:reveal:"),
          ),
        ),
      );
      assert(
        Object.entries(storage).some(
          ([k, v]) => k.endsWith(":6") && v === secret,
        ),
      );
      assert(!JSON.stringify(storage).includes(TEST_PHRASE));
    },
  );
  await check(
    "Recipient-bound grab rejects wrong phrase; pasted recipient receives the signed slot; duplicate disabled",
    async () => {
      await page.goto(`${url}#/p/1`);
      await page
        .getByRole("heading", { name: "A little good fortune" })
        .waitFor();
      await page.locator("#grab-phrase").fill("wrong");
      await page
        .getByRole("button", { name: "Grab red packet", exact: true })
        .click();
      await page
        .getByText("Passphrase does not match.", { exact: false })
        .waitFor();
      assert.equal(state.writes.filter((w) => w.fn === "grab").length, 0);
      await page.getByText("Grab for another address", { exact: true }).click();
      await page.locator("#recipient").fill(state.friend);
      await page.locator("#grab-phrase").fill(TEST_PHRASE);
      await page
        .getByRole("button", { name: "Grab red packet", exact: true })
        .click();
      await page
        .getByRole("button", { name: "Already grabbed by this recipient" })
        .waitFor();
      assert(
        await page
          .getByRole("button", { name: "Already grabbed by this recipient" })
          .isDisabled(),
      );
      assert.equal(
        state.writes.find((w) => w.fn === "grab").args[1].toLowerCase(),
        state.friend.toLowerCase(),
      );
      await page.screenshot({
        path: `${output}packet-results.png`,
        fullPage: true,
      });
    },
  );
  await check(
    "Creator reveal restores backup, rejects wrong code and renders best-luck crown",
    async () => {
      await page.goto(`${url}#/p/4`);
      await page
        .getByRole("button", { name: "Reveal lucky packet", exact: true })
        .waitFor();
      await page.locator("#reveal-secret").fill("wrong");
      await page
        .getByRole("button", { name: "Reveal lucky packet", exact: true })
        .click();
      await page
        .getByText("The backup code does not match.", { exact: false })
        .waitFor();
      await page.locator("#reveal-secret").fill(state.secret);
      await page
        .getByRole("button", { name: "Reveal lucky packet", exact: true })
        .click();
      await page.getByText("Best luck", { exact: true }).waitFor();
      assert.equal(state.packets.get(4n).state, 2);
    },
  );
  await check(
    "Permissionless equal settlement and refund use contract timing and reach terminal states",
    async () => {
      await page.goto(`${url}#/p/1`);
      await page
        .getByRole("button", { name: "Settle equally", exact: true })
        .waitFor();
      assert(
        await page
          .getByRole("button", { name: "Settle equally", exact: true })
          .isDisabled(),
      );
      await page.goto(`${url}#/p/3`);
      await page
        .getByRole("button", { name: "Settle equally", exact: true })
        .click();
      await page.getByText("Settled equally", { exact: true }).waitFor();
      await page.goto(`${url}#/p/2`);
      await page
        .getByRole("button", { name: "Refund remaining IMD", exact: true })
        .click();
      await page.getByText("Refunded", { exact: true }).waitFor();
      assert.equal(state.packets.get(3n).state, 3);
      assert.equal(state.packets.get(2n).state, 4);
    },
  );
  await check(
    "Deferred payout and surplus controls, destination protection and token transfer",
    async () => {
      await page.goto(`${url}#/funds`);
      await page
        .getByRole("button", { name: "Claim deferred IMD", exact: true })
        .waitFor();
      await wait(
        async () =>
          await page
            .getByRole("button", { name: "Claim deferred IMD", exact: true })
            .isEnabled(),
      );
      await page
        .getByRole("button", { name: "Claim deferred IMD", exact: true })
        .click();
      await confirmed(page, "claim", state);
      assert.equal(state.credit.get(state.actor.toLowerCase()), 0n);
      await page
        .getByRole("button", { name: "Recover surplus to this wallet" })
        .click();
      await confirmed(page, "recoverSurplus", state);
      await page.getByText("Transfer HONGBAO tokens", { exact: true }).click();
      await page.locator("#token-to").fill(state.friend);
      await page.locator("#token-amount").fill("1");
      await page
        .getByRole("button", { name: "Confirm HONGBAO transfer" })
        .click();
      await confirmed(page, "transfer", state);
    },
  );
  await check(
    "Swap quote is eth_call; both approval layers precede six-field router execute; reverse trade works",
    async () => {
      state.zeroActiveLiquidity = true;
      await page.goto(`${url}#/swap`);
      await page
        .getByRole("button", { name: "Get quote", exact: true })
        .waitFor();
      await wait(
        async () =>
          await page
            .getByRole("button", { name: "Get quote", exact: true })
            .isEnabled(),
      );
      await page
        .getByRole("button", { name: "Get quote", exact: true })
        .click();
      await page
        .getByRole("button", { name: "Approve IMD to Permit2 · 1/3" })
        .click();
      await page
        .getByRole("button", { name: "Approve router spending · 2/3" })
        .click();
      await page.getByRole("button", { name: "Confirm swap · 3/3" }).waitFor();
      state.simulationFailed = true;
      await page.getByRole("button", { name: "Confirm swap · 3/3" }).click();
      await page
        .getByText("Simulation or transaction failed", { exact: false })
        .waitFor();
      assert.equal(state.writes.filter((w) => w.fn === "execute").length, 0);
      state.simulationFailed = false;
      await page.getByRole("button", { name: "Confirm swap · 3/3" }).click();
      await confirmed(page, "execute", state);
      const tx = state.writes.find((w) => w.fn === "execute");
      assert.equal(
        tx.to.toLowerCase(),
        state.network.uniswapV4.universalRouter,
      );
      assert.equal(BigInt(tx.value ?? "0x0"), 0n);
      assert.equal(tx.args[0], "0x10");
      const [actions, params] = decodeAbiParameters(
        parseAbiParameters("bytes,bytes[]"),
        tx.args[1][0],
      );
      assert.equal(actions, "0x060c0f");
      const [swapArgs] = decodeAbiParameters(
        parseAbiParameters(
          "((address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks),bool,uint128,uint128,uint256,bytes)",
        ),
        params[0],
      );
      assert.equal(swapArgs[4], 0n);
      assert.equal(swapArgs[3], (199n * UNIT) / 100n);
      assert.equal(
        state.writes.filter((w) => w.fn === "quoteExactInputSingle").length,
        0,
      );
      await page
        .getByRole("button", { name: "Reverse swap direction" })
        .click();
      await page
        .getByRole("button", { name: "Get quote", exact: true })
        .click();
      await page
        .getByRole("button", { name: "Approve HONGBAO to Permit2 · 1/3" })
        .click();
      await page
        .getByRole("button", { name: "Approve router spending · 2/3" })
        .click();
      await page.getByRole("button", { name: "Confirm swap · 3/3" }).click();
      await wait(
        () => state.writes.filter((w) => w.fn === "execute").length === 2,
        "reverse swap",
      );
    },
  );
  await check(
    "Wallet chain changes disable transactions and a single switch restores the network",
    async () => {
      await page.evaluate(() => window.__changeChain("0x1"));
      await page
        .getByRole("button", { name: "Switch to Robinhood Chain", exact: true })
        .waitFor();
      assert.equal(
        await page.getByRole("button", { name: "Confirm swap · 3/3" }).count(),
        0,
      );
      await page
        .getByRole("button", { name: "Switch to Robinhood Chain", exact: true })
        .click();
      await page
        .getByRole("button", { name: "Get quote", exact: true })
        .waitFor();
    },
  );
  await check(
    "Long balances, full addresses, expanded details and text enlargement reflow",
    async () => {
      state.bigBalance = true;
      await page.goto(`${url}#/funds`);
      await page.getByRole("heading", { name: "Recover your IMD" }).waitFor();
      await page.getByText("Transfer HONGBAO tokens", { exact: true }).click();
      await page.getByText("Contracts and deployment", { exact: true }).click();
      for (const width of [320, 390, 1440]) {
        await page.setViewportSize({ width, height: 844 });
        await noOverflow(page);
      }
      await page.setViewportSize({ width: 390, height: 844 });
      await page.addStyleTag({ content: "html{font-size:200%}" });
      await noOverflow(page);
      await page.screenshot({
        path: `${output}text-enlargement.png`,
        fullPage: true,
      });
    },
  );
  await context.close();
  await check(
    "Approval stays disabled after broadcast until its receipt confirms",
    async () => {
      const { page, context, state } = await newPage();
      await english(page);
      await connect(page);
      state.receiptDelay = 1800;
      await page.getByRole("button", { name: "Approve IMD · step 1" }).click();
      await wait(() => state.writes.length === 1, "approval hash returned");
      assert(
        await page
          .getByRole("button", { name: "Approving…", exact: true })
          .isDisabled(),
      );
      assert.equal(
        await page
          .getByRole("button", { name: "Prepare packet · step 2" })
          .count(),
        0,
      );
      await page
        .getByText("Submitted. Waiting for confirmation…", { exact: true })
        .waitFor();
      await page
        .getByRole("button", { name: "Prepare packet · step 2" })
        .waitFor({ timeout: 15000 });
      assert.equal(state.writes.length, 1);
      await context.close();
    },
  );
  await check(
    "Missing contract code fails closed; visible retry recovers public RPC reads",
    async () => {
      const context = await browser.newContext({
        viewport: { width: 390, height: 844 },
      });
      const page = await context.newPage();
      const state = fixture();
      state.codeMissing = true;
      await installMock(page, state);
      await page.goto(url);
      await page.getByRole("heading", { name: "发一份好运" }).waitFor();
      await english(page);
      await page
        .getByRole("button", { name: "Connect wallet", exact: true })
        .click();
      await page.getByRole("button", { name: "Test wallet" }).click();
      await page
        .getByRole("button", { name: "Retry connection", exact: true })
        .waitFor();
      assert.equal(
        await page
          .getByRole("button", { name: "Approve IMD · step 1" })
          .count(),
        0,
      );
      assert.equal(state.writes.length, 0);
      state.codeMissing = false;
      await page
        .getByRole("button", { name: "Retry connection", exact: true })
        .click();
      await page
        .getByRole("button", { name: "Approve IMD · step 1" })
        .waitFor();
      assert.equal(state.writes.length, 0);
      await context.close();
    },
  );
  await check(
    "Reload preserves the pending-transaction lock and recovers confirmation without duplicate sends",
    async () => {
      const { page, context, state } = await newPage();
      await english(page);
      await connect(page);
      state.receiptDelay = 2500;
      await page.getByRole("button", { name: "Approve IMD · step 1" }).click();
      await page
        .getByRole("link", { name: "View pending transaction" })
        .waitFor();
      await page.reload();
      await page
        .getByRole("link", { name: "View pending transaction" })
        .waitFor();
      assert.equal(state.writes.length, 1);
      await page
        .getByText("The previously submitted transaction confirmed.", {
          exact: false,
        })
        .waitFor({ timeout: 15000 });
      assert.equal(state.writes.length, 1);
      await context.close();
    },
  );
  await check(
    "Unknown-chain add flow and wallet rejection recovery",
    async () => {
      const { page, context } = await newPage(
        {},
        { wrongChain: true, missingChain: true, rejectConnect: true },
      );
      await english(page);
      await page
        .getByRole("button", { name: "Connect wallet", exact: true })
        .click();
      await page.getByRole("button", { name: "Test wallet" }).click();
      await page
        .getByText("Wallet request cancelled. You can try again.")
        .waitFor();
      await page.getByRole("button", { name: "Test wallet" }).click();
      await wait(async () => !(await page.locator("dialog").isVisible()));
      const methods = await page.evaluate(() =>
        window.__walletCalls.map((c) => c.method),
      );
      const start = methods.indexOf("wallet_switchEthereumChain");
      assert.deepEqual(methods.slice(start, start + 3), [
        "wallet_switchEthereumChain",
        "wallet_addEthereumChain",
        "wallet_switchEthereumChain",
      ]);
      await context.close();
    },
  );
  await check(
    "Mobile wallet links preserve gateway subpath and hash, all four marks and Coinbase Smart Wallet",
    async () => {
      const { page, context } = await newPage(
        {
          userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)",
          isMobile: true,
          hasTouch: true,
        },
        { injected: false },
      );
      await english(page);
      await page.goto(`${url}#/grab`);
      await page
        .getByRole("button", { name: "Connect wallet", exact: true })
        .click();
      for (const name of ["MetaMask", "Coinbase Wallet", "Rabby", "Phantom"]) {
        const link = page.getByRole("link", {
          name: `Open in ${name}`,
          exact: true,
        });
        assert(await link.isVisible());
        assert(
          decodeURIComponent(await link.getAttribute("href")).includes(
            "/preview/#/grab",
          ),
        );
        assert.equal(
          await link
            .locator("img")
            .evaluate((el) => el.complete && el.naturalWidth > 0),
          true,
        );
      }
      assert(
        await page
          .getByRole("button", { name: "Coinbase Smart Wallet" })
          .isVisible(),
      );
      await noOverflow(page);
      await page.screenshot({ path: `${output}mobile-wallets.png` });
      await context.close();
    },
  );
  await check(
    "Tampered ABI fails closed before connecting or sending",
    async () => {
      const context = await browser.newContext();
      const page = await context.newPage();
      await page.route("**/abi/HongbaoBox.json", (route) =>
        route.fulfill({ contentType: "application/json", body: "[]" }),
      );
      await page.goto(url);
      await page.getByText("ABI verification failed: HongbaoBox").waitFor();
      assert.equal(
        await page
          .getByRole("button", { name: "Connect wallet", exact: true })
          .count(),
        0,
      );
      await context.close();
    },
  );
  await check(
    "Production script and local resources have no runtime failures",
    async () => assert.deepEqual(errors, []),
  );
} catch (e) {
  console.error(e.stack);
  for (const context of browser.contexts())
    for (const page of context.pages()) {
      await page
        .screenshot({ path: `${output}failure.png`, fullPage: true })
        .catch(() => {});
      console.error(
        (
          await page
            .locator("body")
            .innerText()
            .catch(() => "")
        ).slice(0, 5000),
      );
    }
  process.exitCode = 1;
} finally {
  await writeFile(
    `${output}interactions.json`,
    JSON.stringify(
      {
        testedAt: new Date().toISOString(),
        boundary:
          "Production export; mocked EIP-1193 wallet and JSON-RPC. No live transactions.",
        results,
        runtimeErrors: errors,
      },
      null,
      2,
    ) + "\n",
  );
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
