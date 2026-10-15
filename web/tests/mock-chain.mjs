// Test-only JSON-RPC fixture. It is never imported by the production app.
import { readFileSync } from "node:fs";
import {
  encodeFunctionResult,
  decodeFunctionData,
  encodeEventTopics,
  encodeAbiParameters,
  parseAbiParameters,
  encodeErrorResult,
  hashTypedData,
  keccak256,
  toHex,
  zeroAddress,
  recoverTypedDataAddress,
} from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { protocolAbi } from "../src/config.ts";
import {
  passphraseAccount,
  grabTypedData,
  randomSecret,
  sameAddress,
} from "../src/hongbao.ts";

const handoff = JSON.parse(
  readFileSync(new URL("../deployment-handoff.json", import.meta.url), "utf8"),
);
const { network } = JSON.parse(
  readFileSync(new URL("../network-handoff.json", import.meta.url), "utf8"),
);
const box = handoff.contracts.find((c) => c.name === "HongbaoBox").address;
const token = handoff.contracts.find((c) => c.name === "LaunchToken").address;
const boxAbi = JSON.parse(
  readFileSync(
    new URL("../../docs/abi/HongbaoBox.json", import.meta.url),
    "utf8",
  ),
);
export const UNIT = 10n ** 18n;
export const TEST_PHRASE = "恭喜发财TEST";
export function fixture() {
  const actor = privateKeyToAccount(generatePrivateKey()).address;
  const friend = privateKeyToAccount(generatePrivateKey()).address;
  const salt = randomSecret();
  const secret = randomSecret();
  const signer = passphraseAccount(handoff.chainId, box, salt, TEST_PHRASE);
  const now = BigInt(Math.floor(Date.now() / 1000));
  const state = {
    actor,
    friend,
    salt,
    secret,
    box,
    token,
    network,
    chainId: handoff.chainId,
    now,
    nextId: 6n,
    blockNumber: 2001n,
    writes: [],
    calls: [],
    simulationFailed: false,
    rejectNext: false,
    rpcFail: false,
    receiptDelay: 0,
    bigBalance: false,
    allowances: new Map(),
    permits: new Map(),
    credit: new Map([[actor.toLowerCase(), 5n * UNIT]]),
    receipts: new Map(),
    transactions: new Map(),
    packets: new Map(),
  };
  const createP = (id, fields = {}) => ({
    creator: actor,
    amount: (995n * UNIT) / 100n,
    slots: 3n,
    grabbed: 0n,
    lucky: true,
    expiry: now + 3600n,
    keyAddress: signer.address,
    salt,
    state: 0,
    recipients: [],
    shares: [],
    commitment: keccak256(secret),
    best: zeroAddress,
    settlement: now + 90000n,
    remaining: (995n * UNIT) / 100n,
    ...fields,
  });
  state.packets.set(1n, createP(1n));
  state.packets.set(
    2n,
    createP(2n, {
      lucky: false,
      expiry: now - 1n,
      grabbed: 1n,
      recipients: [friend],
      shares: [3n * UNIT],
    }),
  );
  state.packets.set(
    3n,
    createP(3n, {
      grabbed: 3n,
      recipients: [friend, actor, signer.address],
      shares: [0n, 0n, 0n],
      settlement: now - 1n,
    }),
  );
  state.packets.set(
    4n,
    createP(4n, {
      grabbed: 3n,
      recipients: [friend, actor, signer.address],
      shares: [0n, 0n, 0n],
      settlement: now + 86400n,
    }),
  );
  state.packets.set(5n, createP(5n, { lucky: false }));
  const allowanceKey = (address, owner, spender) =>
    `${address.toLowerCase()}:${owner.toLowerCase()}:${spender.toLowerCase()}`;
  function abiFor(to) {
    if (sameAddress(to, box)) return boxAbi;
    if (sameAddress(to, network.uniswapV4.permit2)) return protocolAbi.permit2;
    if (sameAddress(to, network.uniswapV4.quoter)) return protocolAbi.quoter;
    if (sameAddress(to, network.uniswapV4.stateView))
      return protocolAbi.stateView;
    if (sameAddress(to, network.uniswapV4.universalRouter))
      return protocolAbi.router;
    return protocolAbi.erc20;
  }
  const blockHash = toHex(2001n, { size: 32 });
  const block = () => ({
    number: "0x7d1",
    hash: blockHash,
    parentHash: blockHash,
    nonce: "0x0000000000000000",
    sha3Uncles: toHex(0n, { size: 32 }),
    logsBloom: `0x${"00".repeat(256)}`,
    transactionsRoot: blockHash,
    stateRoot: blockHash,
    receiptsRoot: blockHash,
    miner: actor,
    difficulty: "0x0",
    totalDifficulty: "0x0",
    extraData: "0x",
    size: "0x100",
    gasLimit: "0x1c9c380",
    gasUsed: "0x10000",
    timestamp: toHex(state.now),
    transactions: [],
    uncles: [],
    baseFeePerGas: "0x3b9aca00",
    mixHash: blockHash,
  });
  function revert(name) {
    const e = Error(name);
    e.data = encodeErrorResult({ abi: boxAbi, errorName: name });
    e.code = 3;
    throw e;
  }
  async function execute(call, mutate = false) {
    const to = call.to;
    const abi = abiFor(to);
    const { functionName: fn, args = [] } = decodeFunctionData({
      abi,
      data: call.data,
    });
    state.calls.push({ to, fn, args, mutate, value: call.value });
    const id = args[0];
    const p = state.packets.get(id);
    let result;
    let logs = [];
    if (sameAddress(to, box)) {
      switch (fn) {
        case "imd":
          result = network.pairToken.address;
          break;
        case "nextPacketId":
          result = state.nextId;
          break;
        case "totalEscrow":
          result = 50n * UNIT;
          break;
        case "claimable":
          result = state.credit.get(args[0].toLowerCase()) ?? 0n;
          break;
        case "packet":
          if (!p) revert("UnknownPacket");
          result = p;
          break;
        case "grabbers":
          if (!p) revert("UnknownPacket");
          result = [p.recipients, p.shares];
          break;
        case "bestLuck":
          result = p.best;
          break;
        case "remaining":
          result = p.remaining;
          break;
        case "settlementTime":
          result = p.settlement;
          break;
        case "revealCommitments":
          result = p.commitment;
          break;
        case "hasGrabbed":
          result = p.recipients.some((a) => sameAddress(a, args[1]));
          break;
        case "grabDigest":
          result = hashTypedData(
            grabTypedData(state.chainId, box, id, args[1]),
          );
          break;
        case "create": {
          if (state.simulationFailed) revert("InexactTransfer");
          result = state.nextId;
          if (mutate) {
            const [
              gross,
              slots,
              lucky,
              keyAddress,
              packetSalt,
              duration,
              commitment,
            ] = args;
            const packetId = state.nextId++;
            const burn = gross / 200n;
            state.packets.set(
              packetId,
              createP(packetId, {
                amount: gross - burn,
                remaining: gross - burn,
                slots,
                lucky,
                keyAddress,
                salt: packetSalt,
                expiry: state.now + duration,
                commitment,
              }),
            );
            logs = [
              {
                address: box,
                topics: encodeEventTopics({
                  abi: boxAbi,
                  eventName: "PacketCreated",
                  args: { id: packetId, creator: actor },
                }),
                data: encodeAbiParameters(
                  parseAbiParameters(
                    "uint256,uint256,uint256,uint256,bool,uint256,address,bytes32,bytes32",
                  ),
                  [
                    gross,
                    gross - burn,
                    burn,
                    slots,
                    lucky,
                    state.now + duration,
                    keyAddress,
                    packetSalt,
                    commitment,
                  ],
                ),
              },
            ];
          }
          break;
        }
        case "grab": {
          if (!p) revert("UnknownPacket");
          if (p.state !== 0) revert("PacketClosed");
          if (p.expiry <= state.now) revert("PacketExpired");
          if (p.grabbed >= p.slots) revert("PacketFull");
          if (p.recipients.some((a) => sameAddress(a, args[1])))
            revert("AlreadyGrabbed");
          if (
            !sameAddress(
              await recoverTypedDataAddress({
                ...grabTypedData(state.chainId, box, id, args[1]),
                signature: args[2],
              }),
              p.keyAddress,
            )
          )
            revert("InvalidSignature");
          if (mutate) {
            p.grabbed++;
            p.recipients.push(args[1]);
            p.shares.push(p.lucky ? 0n : p.amount / p.slots);
            if (!p.lucky && p.grabbed === p.slots) p.state = 1;
          }
          break;
        }
        case "reveal":
          if (keccak256(args[1]) !== p.commitment) revert("WrongSecret");
          if (mutate) {
            p.state = 2;
            p.shares = p.recipients.map((_, i) =>
              i === 0 ? p.amount - 2n * UNIT : UNIT,
            );
            p.best = p.recipients[0];
            p.remaining = 0n;
          }
          break;
        case "settle":
          if (state.now < p.settlement) revert("TooEarly");
          if (mutate) {
            p.state = 3;
            p.shares = p.recipients.map(() => p.amount / p.grabbed);
            p.remaining = 0n;
          }
          break;
        case "refund":
          if (state.now < p.expiry) revert("TooEarly");
          if (mutate) {
            p.state = 4;
            p.remaining = 0n;
          }
          break;
        case "claim":
          result = state.credit.get(args[0].toLowerCase()) ?? 0n;
          if (mutate) state.credit.set(args[0].toLowerCase(), 0n);
          break;
        case "recoverSurplus":
          result = 2n * UNIT;
          break;
        default:
          throw Error(`Unhandled box function ${fn}`);
      }
    } else if (sameAddress(to, network.uniswapV4.quoter)) {
      if (state.simulationFailed) revert("InexactTransfer");
      result = [args[0].exactAmount * 2n, 100000n];
    } else if (sameAddress(to, network.uniswapV4.stateView)) {
      result =
        fn === "getSlot0"
          ? [2n ** 96n, 0, 0, handoff.poolKey.fee]
          : state.zeroActiveLiquidity
            ? 0n
            : 1000000n * UNIT;
    } else if (sameAddress(to, network.uniswapV4.permit2)) {
      const key =
        fn === "allowance"
          ? allowanceKey(args[1], args[0], args[2])
          : allowanceKey(args[0], actor, args[1]);
      if (fn === "allowance") result = state.permits.get(key) ?? [0n, 0, 0];
      else if (mutate) state.permits.set(key, [args[2], args[3], 0]);
    } else if (sameAddress(to, network.uniswapV4.universalRouter)) {
      if (state.simulationFailed) revert("InexactTransfer");
    } else {
      switch (fn) {
        case "decimals":
          result = 18;
          break;
        case "symbol":
          result = sameAddress(to, token) ? "HONGBAO" : "IMD";
          break;
        case "name":
          result = sameAddress(to, token) ? "HONGBAO" : "Identity.md";
          break;
        case "balanceOf":
          result = sameAddress(args[0], box)
            ? 52n * UNIT
            : state.bigBalance
              ? 999999999999999999999999999n * UNIT
              : 1000n * UNIT;
          break;
        case "allowance":
          result =
            state.allowances.get(allowanceKey(to, args[0], args[1])) ?? 0n;
          break;
        case "approve":
          if (mutate)
            state.allowances.set(allowanceKey(to, actor, args[0]), args[1]);
          result = true;
          break;
        case "transfer":
          result = true;
          break;
        default:
          throw Error(`Unhandled ERC20 function ${fn}`);
      }
    }
    return {
      output: encodeFunctionResult({
        abi,
        functionName: fn,
        ...(result === undefined ? {} : { result }),
      }),
      logs,
      fn,
      args,
    };
  }
  state.rpc = async ({ method, params = [], id }) => {
    try {
      if (state.rpcFail) throw Error("Mock RPC unavailable");
      let result;
      switch (method) {
        case "eth_chainId":
          result = toHex(state.chainId);
          break;
        case "eth_accounts":
        case "eth_requestAccounts":
          result = [actor];
          break;
        case "eth_getCode":
          result = state.codeMissing ? "0x" : "0x60006000";
          break;
        case "eth_blockNumber":
          result = toHex(++state.blockNumber);
          break;
        case "eth_getBlockByNumber":
        case "eth_getBlockByHash":
          result = block();
          break;
        case "eth_getBalance":
          result = toHex(10n * UNIT);
          break;
        case "eth_getTransactionCount":
          result = "0x0";
          break;
        case "eth_gasPrice":
        case "eth_maxPriorityFeePerGas":
          result = "0x3b9aca00";
          break;
        case "eth_estimateGas":
          result = "0x493e0";
          break;
        case "eth_call":
          result = (await execute(params[0])).output;
          break;
        case "eth_sendTransaction": {
          if (state.rejectNext) {
            state.rejectNext = false;
            const e = Error("User rejected request");
            e.code = 4001;
            throw e;
          }
          const call = params[0];
          const executed = await execute(call, true);
          state.writes.push({ ...call, fn: executed.fn, args: executed.args });
          result = toHex(BigInt(state.writes.length), { size: 32 });
          const receipt = {
            transactionHash: result,
            blockHash,
            blockNumber: "0x7d1",
            transactionIndex: "0x0",
            from: actor,
            to: call.to,
            cumulativeGasUsed: "0x10000",
            gasUsed: "0x10000",
            contractAddress: null,
            logsBloom: `0x${"00".repeat(256)}`,
            status: "0x1",
            effectiveGasPrice: "0x3b9aca00",
            type: "0x2",
            logs: executed.logs.map((log, i) => ({
              ...log,
              transactionHash: result,
              blockHash,
              blockNumber: "0x7d1",
              transactionIndex: "0x0",
              logIndex: toHex(i),
              removed: false,
            })),
          };
          state.receipts.set(result, {
            receipt,
            readyAt: Date.now() + state.receiptDelay,
          });
          state.transactions.set(result, {
            hash: result,
            blockHash: null,
            blockNumber: null,
            transactionIndex: null,
            from: actor,
            to: call.to,
            nonce: toHex(state.writes.length - 1),
            input: call.data,
            value: call.value ?? "0x0",
            gas: "0x493e0",
            gasPrice: "0x3b9aca00",
            type: "0x2",
            chainId: toHex(state.chainId),
            maxFeePerGas: "0x77359400",
            maxPriorityFeePerGas: "0x3b9aca00",
            accessList: [],
            v: "0x0",
            r: toHex(1n, { size: 32 }),
            s: toHex(1n, { size: 32 }),
          });
          break;
        }
        case "eth_getTransactionReceipt": {
          const value = state.receipts.get(params[0]);
          result = value && Date.now() >= value.readyAt ? value.receipt : null;
          break;
        }
        case "eth_getTransactionByHash":
          result = state.transactions.get(params[0]) ?? null;
          break;
        case "wallet_getCapabilities":
          result = {};
          break;
        default:
          throw Error(`Unhandled RPC ${method}`);
      }
      return { jsonrpc: "2.0", id, result };
    } catch (e) {
      return {
        jsonrpc: "2.0",
        id,
        error: {
          code: e.code ?? -32000,
          message: e.message,
          ...(e.data ? { data: e.data } : {}),
        },
      };
    }
  };
  return state;
}

export async function installMock(
  page,
  state,
  {
    wrongChain = false,
    missingChain = false,
    injected = true,
    rejectConnect = false,
  } = {},
) {
  const allowed = network.rpcUrls.map((u) => new URL(u).hostname);
  await page.route("**/*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (allowed.includes(url.hostname) || url.pathname === "/__mock_rpc") {
      const data = request.postDataJSON();
      const result = Array.isArray(data)
        ? await Promise.all(data.map(state.rpc))
        : await state.rpc(data);
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(result),
      });
      return;
    }
    if (url.hostname === "127.0.0.1" || url.hostname === "localhost")
      return route.continue();
    await route.abort();
  });
  if (!injected) return;
  await page.addInitScript(
    ({ actor, chainId, wrongChain, missingChain, rejectConnect }) => {
      let currentChain = wrongChain ? "0x1" : `0x${chainId.toString(16)}`;
      let known = !missingChain;
      let reject = rejectConnect;
      let connected = sessionStorage.getItem("test-wallet-connected") === "yes";
      const events = new Map();
      window.__walletCalls = [];
      const provider = {
        on: (name, cb) => {
          events.set(name, [...(events.get(name) ?? []), cb]);
        },
        removeListener: (name, cb) =>
          events.set(
            name,
            (events.get(name) ?? []).filter((f) => f !== cb),
          ),
        request: async ({ method, params }) => {
          window.__walletCalls.push({ method, params });
          if (method === "eth_chainId") return currentChain;
          if (method === "eth_accounts") return connected ? [actor] : [];
          if (method === "eth_requestAccounts") {
            if (reject) {
              reject = false;
              throw Object.assign(Error("User rejected request"), {
                code: 4001,
              });
            }
            connected = true;
            sessionStorage.setItem("test-wallet-connected", "yes");
            return [actor];
          }
          if (method === "wallet_switchEthereumChain") {
            if (!known)
              throw Object.assign(Error("Unknown chain"), { code: 4902 });
            currentChain = params[0].chainId;
            for (const callback of events.get("chainChanged") ?? [])
              callback(currentChain);
            return null;
          }
          if (method === "wallet_addEthereumChain") {
            known = true;
            return null;
          }
          if (method === "wallet_requestPermissions")
            return [{ parentCapability: "eth_accounts" }];
          if (method === "wallet_revokePermissions") return null;
          const response = await fetch("/__mock_rpc", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
          });
          const json = await response.json();
          if (json.error)
            throw Object.assign(Error(json.error.message), json.error);
          return json.result;
        },
      };
      window.ethereum = provider;
      window.__changeChain = (hex) => {
        currentChain = hex;
        for (const cb of events.get("chainChanged") ?? []) cb(hex);
      };
      const announce = () =>
        dispatchEvent(
          new CustomEvent("eip6963:announceProvider", {
            detail: {
              info: {
                uuid: "Mock-6963-wallet",
                name: "Test wallet",
                icon: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"/>',
                rdns: "test.hongbao.wallet",
              },
              provider,
            },
          }),
        );
      addEventListener("eip6963:requestProvider", announce);
      announce();
    },
    {
      actor: state.actor,
      chainId: state.chainId,
      wrongChain,
      missingChain,
      rejectConnect,
    },
  );
}
