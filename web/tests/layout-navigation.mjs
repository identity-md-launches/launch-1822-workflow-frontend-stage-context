import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { chromium, webkit } from "playwright";
import { preview } from "../scripts/preview.mjs";
import { fixture, installMock } from "./mock-chain.mjs";

const output = fileURLToPath(new URL("../../docs/validation/", import.meta.url));
await mkdir(output, { recursive: true });
const results = [];
const runtimeErrors = [];
const completedHeaderProbes = [];
const server = preview();
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const url = `http://127.0.0.1:${server.address().port}/preview/`;
const engines = process.argv.includes("--chromium-only")
  ? { chromium }
  : { chromium, webkit };

async function check(engine, name, fn) {
  try {
    const measurements = await fn();
    results.push({ engine, name, passed: true, measurements });
    console.log(`PASS ${engine}: ${name}`);
  } catch (error) {
    results.push({ engine, name, passed: false, error: error.stack });
    console.error(`FAIL ${engine}: ${name}: ${error.message}`);
    process.exitCode = 1;
  }
}

async function measure(page) {
  return page.evaluate(() => {
    const box = (selector) => {
      const rect = document.querySelector(selector).getBoundingClientRect();
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    };
    return {
      viewport: { width: innerWidth, height: innerHeight },
      scrollY,
      documentWidth: document.documentElement.scrollWidth,
      header: box(".site-header"),
      brand: box(".brand"),
      language: box(".language-button"),
      wallet: box(".wallet-button"),
      heading: box(".send-panel h1"),
      primary: box(".send-panel .primary"),
    };
  });
}

try {
  for (const [engine, browserType] of Object.entries(engines)) {
    let browser;
    try {
      browser = await browserType.launch({ headless: true });
      const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
      const page = await context.newPage();
      const statuses = new Map();
      page.on("pageerror", (error) => runtimeErrors.push({ engine, error: error.message }));
      page.on("console", (message) => {
        if (message.type() === "error") runtimeErrors.push({ engine, error: message.text() });
      });
      page.on("response", (response) => {
        statuses.set(response.request(), response.status());
        if (response.url().startsWith(url) && response.status() >= 400)
          runtimeErrors.push({ engine, error: `${response.status()} ${response.url()}` });
      });
      page.on("requestfailed", (request) => {
        if (!request.url().startsWith(url)) return;
        // Coinbase's COOP check reads HEAD response headers successfully; Chromium
        // can report the absent response body as aborted after the HTTP 200.
        if (request.method() === "HEAD" && statuses.get(request) === 200 &&
          request.failure()?.errorText === "net::ERR_ABORTED") {
          completedHeaderProbes.push({ engine, path: new URL(request.url()).pathname, method: "HEAD", status: 200 });
          return;
        }
        runtimeErrors.push({ engine, error: `${request.url()}: ${request.failure()?.errorText}` });
      });
      await installMock(page, fixture(), { injected: false });
      await page.goto(url);
      await page.getByRole("heading", { name: "发一份好运" }).waitFor();
      await page.waitForFunction(() => document.querySelector(".connection-state")?.textContent.includes("已验证"));
      await page.evaluate(() => document.fonts.ready);

      for (const language of ["zh", "en"]) {
        if (language === "en") {
          await page.getByRole("button", { name: "Switch to English" }).click();
          await page.getByRole("heading", { name: "Send a little luck" }).waitFor();
        }
        await check(engine, `${language}: first screen and reflow at 320/390/768/1440`, async () => {
          const measurements = [];
          for (const width of [320, 390, 768, 1440]) {
            await page.setViewportSize({ width, height: 844 });
            await page.evaluate(() => window.scrollTo(0, 0));
            const measured = await measure(page);
            measurements.push(measured);
            assert.equal(measured.scrollY, 0);
            assert(measured.documentWidth <= width, `horizontal overflow at ${width}`);
            if (width === 390) {
              if (language === "en")
                await page.screenshot({ path: `${output}revision-${engine}-en-390.png` });
              const { primary, brand, language: toggle, wallet } = measured;
              assert.equal(primary.height, 48, "primary action keeps its 48px height");
              assert(primary.y >= 0 && primary.y + primary.height <= 844,
                `primary action ends at ${primary.y + primary.height}px`);
              for (const control of [brand, toggle, wallet]) {
                assert(control.x >= 0 && control.x + control.width <= width,
                  "header control must be horizontally visible");
                assert(control.y >= 0 && control.y + control.height <= 844,
                  "header control must be vertically visible");
              }
              assert(brand.x + brand.width <= toggle.x, "brand overlaps language control");
              assert(toggle.x + toggle.width <= wallet.x, "language overlaps wallet control");
              assert(Math.abs(brand.y + brand.height / 2 - wallet.y - wallet.height / 2) <= 1,
                "brand and wallet remain on one header row");
            }
          }
          return measurements;
        });
      }

      await page.setViewportSize({ width: 390, height: 844 });
      const routes = [
        { hash: "#/", field: "#amount", value: "12.3" },
        { hash: "#/grab", field: "#packet-id", value: "123" },
        { hash: "#/p/1", field: "#grab-phrase", value: "keep this passphrase" },
        { hash: "#/swap", field: "#swap-amount", value: "12.3" },
        { hash: "#/funds", field: "#token-amount", value: "12.3", expand: true },
      ];
      for (const route of routes) {
        await check(engine, `keyboard skip preserves ${route.hash} and input`, async () => {
          await page.evaluate((hash) => { location.hash = hash; }, route.hash);
          if (route.expand)
            await page.getByText("Transfer HONGBAO tokens", { exact: true }).click();
          await page.locator(route.field).fill(route.value);
          const before = await page.evaluate(() => ({ hash: location.hash, historyLength: history.length }));
          await page.locator(".brand").focus();
          await page.keyboard.press("Shift+Tab");
          assert(await page.locator(".skip-link").evaluate((element) => element === document.activeElement),
            "keyboard must reach skip link before brand");
          await page.keyboard.press("Enter");
          await page.waitForFunction(() => document.activeElement?.id === "main");
          const after = await page.evaluate(() => ({
            hash: location.hash,
            historyLength: history.length,
            focus: document.activeElement?.id,
            mainTop: document.querySelector("#main").getBoundingClientRect().top,
            scrollY,
          }));
          assert.equal(after.hash, before.hash, "skip must preserve current route");
          assert.equal(after.historyLength, before.historyLength, "skip must not add browser history");
          assert.equal(after.focus, "main", "skip must focus main");
          assert(Math.abs(after.mainTop) <= 1, "skip must scroll main to viewport start");
          assert.equal(await page.locator(route.field).inputValue(), route.value,
            "skip must preserve current form values");
          return { before, after, field: route.field, inputPreserved: true };
        });
      }
      await context.close();
    } catch (error) {
      results.push({ engine, name: "browser setup", passed: false, error: error.stack });
      console.error(error.stack);
      process.exitCode = 1;
    } finally {
      await browser?.close();
    }
  }
  await check("all", "no runtime or local resource errors", async () => assert.deepEqual(runtimeErrors, []));
} finally {
  await writeFile(`${output}revision-ui.json`, JSON.stringify({
    testedAt: new Date().toISOString(),
    boundary: "Production export under /preview/; fresh browser storage, no injected wallet, fixture JSON-RPC. No live transactions.",
    engines: Object.keys(engines),
    results,
    runtimeErrors,
    completedHeaderProbes,
  }, null, 2) + "\n");
  await new Promise((resolve) => server.close(resolve));
}
