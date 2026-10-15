import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  decodeAbiParameters,
  encodeErrorResult,
  encodePacked,
  hashTypedData,
  keccak256,
  parseAbiParameters,
  recoverTypedDataAddress,
  toHex,
  type Address,
  type Hex,
} from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import {
  amountUnits,
  grabTypedData,
  packetEligibility,
  passphraseAccount,
  suggestPassphrase,
  validRecipient,
  type Packet,
} from "../src/hongbao";
import { minimumOutput, poolKeyTuple, swapPayload } from "../src/swap";
import {
  protocolAbi,
  switchNetwork,
  type Deployment,
  type PoolKey,
} from "../src/config";
import { explainError, nestedErrorName } from "../src/errors";

const handoff = JSON.parse(
  readFileSync(new URL("../deployment-handoff.json", import.meta.url), "utf8"),
);
const chain = handoff.chainId;
const box = handoff.contracts.find(
  (c: { name: string }) => c.name === "HongbaoBox",
).address as Address;
const recipient = privateKeyToAccount(generatePrivateKey()).address;
const salt = keccak256(encodePacked(["string"], ["test-only packet salt"]));
const phrase = "恭喜发财 TEST  空格";

test("passphrase derivation uses exact packed UTF-8, 32-byte chain, 20-byte address and scalar reduction", () => {
  const digest = keccak256(
    encodePacked(
      ["string", "uint256", "address", "bytes32", "string"],
      ["imd-hongbao", BigInt(chain), box, salt, phrase],
    ),
  );
  const scalar =
    (BigInt(digest) %
      (0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n -
        1n)) +
    1n;
  assert.equal(
    passphraseAccount(chain, box, salt, phrase).address,
    privateKeyToAccount(toHex(scalar, { size: 32 })).address,
  );
  assert.notEqual(
    passphraseAccount(chain, box, salt, phrase).address,
    passphraseAccount(chain, box, salt, phrase.trim().toLowerCase()).address,
  );
  assert.notEqual(
    passphraseAccount(chain, box, salt, phrase).address,
    passphraseAccount(chain + 1, box, salt, phrase).address,
  );
  assert.notEqual(
    passphraseAccount(chain, box, salt, phrase).address,
    passphraseAccount(chain, recipient, salt, phrase).address,
  );
});
test("recipient-bound EIP-712 signatures reject altered packet, recipient, contract and chain", async () => {
  const signer = passphraseAccount(chain, box, salt, phrase);
  const typed = grabTypedData(chain, box, 1n, recipient);
  const signature = await signer.signTypedData(typed);
  assert.equal(signature.length, 132);
  assert.equal(
    await recoverTypedDataAddress({ ...typed, signature }),
    signer.address,
  );
  for (const changed of [
    grabTypedData(chain, box, 2n, recipient),
    grabTypedData(chain, box, 1n, box),
    grabTypedData(chain, recipient, 1n, recipient),
    grabTypedData(chain + 1, box, 1n, recipient),
  ]) {
    assert.notEqual(hashTypedData(changed), hashTypedData(typed));
    assert.notEqual(
      await recoverTypedDataAddress({ ...changed, signature }),
      signer.address,
    );
  }
});
test("amount parser never rounds excessive precision and rejects zero, negative, exponential and oversized inputs", () => {
  assert.equal(amountUnits("0.01"), 10n ** 16n);
  assert.equal(amountUnits("1.123456", 6), 1123456n);
  for (const invalid of [
    "0",
    "-1",
    "1e5",
    ".5",
    "01",
    "1.0000000000000000001",
    "Infinity",
    "999999999999999999999999999999999999999999999999",
  ])
    assert.throws(() => amountUnits(invalid));
  assert.throws(() => amountUnits("1.0000001", 6));
});
test("cryptographic suggestions include four random characters after the greeting", () => {
  const values = new Set(Array.from({ length: 50 }, suggestPassphrase));
  assert(values.size > 45);
  for (const value of values)
    assert.match(value, /^恭喜发财[A-HJ-NP-Z2-9]{4}$/);
});
test("eligibility respects exact expiry and 24-hour settlement boundary, creator and terminal state", () => {
  const p: Packet = {
    creator: recipient,
    amount: 995n * 10n ** 16n,
    slots: 5n,
    grabbed: 2n,
    lucky: true,
    expiry: 1000n,
    keyAddress: recipient,
    salt,
    state: 0,
  };
  assert.equal(packetEligibility(p, 999n, 87400n, recipient).grab, true);
  assert.equal(packetEligibility(p, 1000n, 87400n, recipient).grab, false);
  assert.equal(packetEligibility(p, 1000n, 87400n, recipient).reveal, true);
  assert.equal(packetEligibility(p, 1000n, 87400n, box).reveal, false);
  assert.equal(
    packetEligibility({ ...p, grabbed: 5n }, 900n, 87300n, recipient).reveal,
    true,
  );
  assert.equal(packetEligibility(p, 87399n, 87400n, recipient).settle, false);
  assert.equal(packetEligibility(p, 87400n, 87400n, recipient).settle, true);
  assert.equal(
    packetEligibility({ ...p, lucky: false }, 1000n, 0n, box).refund,
    true,
  );
  assert.deepEqual(
    packetEligibility({ ...p, state: 2 }, 90000n, 87400n, recipient),
    { grab: false, reveal: false, settle: false, refund: false },
  );
  assert(!validRecipient(box, box));
  assert(validRecipient(recipient, box));
});
test("Robinhood swap encodes six fields, attested hook, direction, exact approvals and no ETH for ERC-20", () => {
  const p = handoff.poolKey as PoolKey;
  for (const input of [p.currency0, p.currency1]) {
    const payload = swapPayload(p, input, 100n, 95n, true);
    assert.equal(payload.commands, "0x10");
    assert.equal(payload.value, 0n);
    const [actions, params] = decodeAbiParameters(
      parseAbiParameters("bytes,bytes[]"),
      payload.inputs[0],
    );
    assert.equal(actions, "0x060c0f");
    const [decoded] = decodeAbiParameters(
      parseAbiParameters(
        `(${poolKeyTuple} poolKey,bool zeroForOne,uint128 amountIn,uint128 amountOutMinimum,uint256 minHopPriceX36,bytes hookData)`,
      ),
      params[0],
    ) as unknown as [
      {
        poolKey: PoolKey;
        zeroForOne: boolean;
        amountIn: bigint;
        amountOutMinimum: bigint;
        minHopPriceX36: bigint;
        hookData: Hex;
      },
    ];
    assert.equal(decoded.poolKey.hooks.toLowerCase(), p.hooks);
    assert.equal(decoded.zeroForOne, input === p.currency0);
    assert.equal(decoded.amountIn, 100n);
    assert.equal(decoded.amountOutMinimum, 95n);
    assert.equal(decoded.minHopPriceX36, 0n);
    assert.equal(decoded.hookData, "0x");
    const [settleCurrency, settleAmount] = decodeAbiParameters(
      parseAbiParameters("address,uint256"),
      params[1],
    );
    const [takeCurrency, takeAmount] = decodeAbiParameters(
      parseAbiParameters("address,uint256"),
      params[2],
    );
    assert.equal(settleCurrency.toLowerCase(), input);
    assert.equal(settleAmount, 100n);
    assert.equal(
      takeCurrency.toLowerCase(),
      input === p.currency0 ? p.currency1 : p.currency0,
    );
    assert.equal(takeAmount, 95n);
  }
});
test("slippage uses integer floor and restricts the chosen range", () => {
  assert.equal(minimumOutput(10001n, "0.5"), 9950n);
  for (const x of ["0", "0.01", "5.01", "-1", "abc", "0.555"])
    assert.throws(() => minimumOutput(100n, x));
});
test("unknown wallet chain is added with the unchanged handoff and switched again", async () => {
  const n = JSON.parse(
    readFileSync(new URL("../network-handoff.json", import.meta.url), "utf8"),
  );
  const d = { ...handoff, ...n } as Deployment;
  const calls: { method: string; params?: readonly unknown[] }[] = [];
  await switchNetwork(
    {
      request: async (args) => {
        calls.push(args);
        if (calls.length === 1) throw { code: 4902 };
        return null;
      },
    },
    d,
  );
  assert.deepEqual(
    calls.map((c) => c.method),
    [
      "wallet_switchEthereumChain",
      "wallet_addEthereumChain",
      "wallet_switchEthereumChain",
    ],
  );
  assert.deepEqual(calls[1].params, [n.walletAddChain]);
  const rejected: string[] = [];
  await assert.rejects(() =>
    switchNetwork(
      {
        request: async ({ method }) => {
          rejected.push(method);
          throw Error("User rejected");
        },
      },
      d,
    ),
  );
  assert.deepEqual(rejected, ["wallet_switchEthereumChain"]);
});
test("recoverable errors are translated without disclosing raw wallet payloads", () => {
  assert.match(explainError(Error("WrongPassphrase"), "en"), /does not match/);
  assert.match(explainError(Error("User rejected request"), "en"), /cancelled/);
  assert.match(explainError(Error("insufficient funds for gas"), "en"), /ETH/);
  assert(
    !explainError(Error("private debug body"), "en").includes(
      "private debug body",
    ),
  );
});
test("nested quoter and router reverts identify insufficient liquidity and slippage", () => {
  const liquidity = encodeErrorResult({
    abi: protocolAbi.errors,
    errorName: "NotEnoughLiquidity",
    args: [salt],
  });
  assert.equal(
    nestedErrorName("UnexpectedRevertBytes", [liquidity]),
    "NotEnoughLiquidity",
  );
  const slippage = encodeErrorResult({
    abi: protocolAbi.errors,
    errorName: "V4TooLittleReceived",
    args: [100n, 90n],
  });
  assert.equal(
    nestedErrorName("ExecutionFailed", [0n, slippage]),
    "V4TooLittleReceived",
  );
  assert.equal(
    nestedErrorName("ExecutionFailed", [0n, "0x1234"]),
    "ExecutionFailed",
  );
});
