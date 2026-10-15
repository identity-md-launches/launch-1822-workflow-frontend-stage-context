import { chromium } from "playwright";
import { writeFile, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createPublicClient, custom } from "viem";
import { protocolAbi } from "../src/config.ts";
import { explainError } from "../src/errors.ts";
import { poolId } from "../src/swap.ts";
import { preview } from "./preview.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const manifest = JSON.parse(
  await readFile(`${root}dist/imd-deployment.json`, "utf8"),
);
const box = manifest.contracts.find((c) => c.name === "HongbaoBox");
const token = manifest.contracts.find((c) => c.name === "LaunchToken");
const abi = JSON.parse(await readFile(`${root}dist/${box.abiPath}`, "utf8"));
const browser = await chromium.launch({ headless: true });
const server = preview();
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const evidence = {
  checkedAt: new Date().toISOString(),
  method:
    "Read-only browser RPC. No wallet, private key, approval or transaction submission.",
  endpoints: [],
};
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.goto(`http://127.0.0.1:${server.address().port}/preview/`);
  await page.getByRole("heading", { name: "发一份好运" }).waitFor();
  for (const rpc of manifest.network.rpcUrls) {
    const client = createPublicClient({
      transport: custom(
        {
          request: async (request) => {
            const body = await page.evaluate(
              async ({ rpc, request }) => {
                const response = await fetch(rpc, {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ jsonrpc: "2.0", id: 1, ...request }),
                });
                return await response.json();
              },
              { rpc, request },
            );
            if (body.error)
              throw Object.assign(
                new Error(body.error.message || "RPC request reverted"),
                body.error,
              );
            return body.result;
          },
        },
        { retryCount: 0 },
      ),
    });
    const endpoint = { rpc };
    try {
      endpoint.chainId = await client.getChainId();
      const targets = [
        ...manifest.contracts.map(({ name, address }) => ({ name, address })),
        { name: "IMD", address: manifest.network.pairToken.address },
        ...Object.entries(manifest.network.uniswapV4)
          .filter(([, value]) => typeof value === "string")
          .map(([name, address]) => ({ name, address })),
        { name: "poolHook", address: manifest.poolKey.hooks },
      ];
      endpoint.code = await Promise.all(
        targets.map(async ({ name, address }) => ({
          name,
          address,
          bytes: ((await client.getCode({ address }))?.length - 2) / 2,
        })),
      );
      const read = (functionName) =>
        client.readContract({ address: box.address, abi, functionName });
      const [
        imd,
        nextId,
        totalEscrow,
        minShare,
        maxSlots,
        minDuration,
        maxDuration,
        revealGrace,
        block,
        symbol,
        decimals,
      ] = await Promise.all([
        read("imd"),
        read("nextPacketId"),
        read("totalEscrow"),
        read("MIN_SHARE"),
        read("MAX_SLOTS"),
        read("MIN_DURATION"),
        read("MAX_DURATION"),
        read("REVEAL_GRACE"),
        client.getBlock(),
        client.readContract({
          address: token.address,
          abi: protocolAbi.erc20,
          functionName: "symbol",
        }),
        client.readContract({
          address: token.address,
          abi: protocolAbi.erc20,
          functionName: "decimals",
        }),
      ]);
      endpoint.application = {
        imd,
        nextId,
        totalEscrow,
        minShare,
        maxSlots,
        minDuration,
        maxDuration,
        revealGrace,
        blockNumber: block.number,
        timestamp: block.timestamp,
        launchToken: { symbol, decimals },
      };
      const [slot0, liquidity] = await Promise.all([
        client.readContract({
          address: manifest.network.uniswapV4.stateView,
          abi: protocolAbi.stateView,
          functionName: "getSlot0",
          args: [poolId(manifest.poolKey)],
        }),
        client.readContract({
          address: manifest.network.uniswapV4.stateView,
          abi: protocolAbi.stateView,
          functionName: "getLiquidity",
          args: [poolId(manifest.poolKey)],
        }),
      ]);
      endpoint.pool = { slot0, liquidity };
      for (const zeroForOne of [true, false]) {
        try {
          const quote = await client.simulateContract({
            address: manifest.network.uniswapV4.quoter,
            abi: protocolAbi.quoter,
            functionName: "quoteExactInputSingle",
            args: [
              {
                poolKey: manifest.poolKey,
                zeroForOne,
                exactAmount: 10n ** 16n,
                hookData: "0x",
              },
            ],
          });
          (endpoint.quotes ??= []).push({
            zeroForOne,
            amountIn: 10n ** 16n,
            amountOut: quote.result[0],
            gasEstimate: quote.result[1],
            method: "eth_call",
          });
        } catch (e) {
          (endpoint.quotes ??= []).push({
            zeroForOne,
            amountIn: 10n ** 16n,
            method: "eth_call",
            error: explainError(e, "en"),
          });
        }
      }
    } catch (e) {
      endpoint.error = e.shortMessage ?? e.message;
    }
    evidence.endpoints.push(endpoint);
  }
  await page.screenshot({ path: `${root}docs/validation/live-mobile.png` });
} finally {
  await browser.close();
  await new Promise((r) => server.close(r));
  await writeFile(
    `${root}docs/validation/live-read.json`,
    JSON.stringify(
      evidence,
      (_, value) => (typeof value === "bigint" ? value.toString() : value),
      2,
    ) + "\n",
  );
  console.log(
    JSON.stringify(
      evidence,
      (_, value) => (typeof value === "bigint" ? value.toString() : value),
      2,
    ),
  );
}
