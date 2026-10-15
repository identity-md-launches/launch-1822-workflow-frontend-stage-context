import {
  encodeAbiParameters,
  keccak256,
  parseAbiParameters,
  zeroAddress,
  type Address,
  type Hex,
} from "viem";
import type { PoolKey } from "./config";

export const poolKeyTuple =
  "(address currency0, address currency1, uint24 fee, int24 tickSpacing, address hooks)";
export const poolId = (pool: PoolKey) =>
  keccak256(encodeAbiParameters(parseAbiParameters(poolKeyTuple), [pool]));
export function swapPayload(
  pool: PoolKey,
  input: Address,
  amount: bigint,
  minimum: bigint,
  extended: boolean,
) {
  const zeroForOne = input.toLowerCase() === pool.currency0.toLowerCase();
  if (!zeroForOne && input.toLowerCase() !== pool.currency1.toLowerCase())
    throw Error("Input outside attested pool");
  const output = zeroForOne ? pool.currency1 : pool.currency0;
  const fields = `${poolKeyTuple} poolKey, bool zeroForOne, uint128 amountIn, uint128 amountOutMinimum, ${extended ? "uint256 minHopPriceX36, " : ""}bytes hookData`;
  const params = [
    encodeAbiParameters(parseAbiParameters(`(${fields})`), [
      extended
        ? [pool, zeroForOne, amount, minimum, 0n, "0x"]
        : [pool, zeroForOne, amount, minimum, "0x"],
    ]),
    encodeAbiParameters(
      parseAbiParameters("address currency, uint256 amount"),
      [input, amount],
    ),
    encodeAbiParameters(
      parseAbiParameters("address currency, uint256 amount"),
      [output, minimum],
    ),
  ];
  return {
    commands: "0x10" as Hex,
    inputs: [
      encodeAbiParameters(parseAbiParameters("bytes actions, bytes[] params"), [
        "0x060c0f",
        params,
      ]),
    ],
    value: input.toLowerCase() === zeroAddress ? amount : 0n,
  };
}
export function minimumOutput(quote: bigint, slippage: string) {
  if (!/^(?:\d+)(?:\.\d{1,2})?$/.test(slippage)) throw Error("InvalidSlippage");
  const bps = Math.round(Number(slippage) * 100);
  if (bps < 10 || bps > 500) throw Error("InvalidSlippage");
  return (quote * BigInt(10000 - bps)) / 10000n;
}
