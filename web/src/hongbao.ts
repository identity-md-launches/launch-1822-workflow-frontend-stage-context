import {
  encodePacked,
  formatUnits,
  isAddress,
  keccak256,
  parseUnits,
  toHex,
  zeroAddress,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

const CURVE_ORDER =
  0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
export const ZERO_BYTES32 = `0x${"00".repeat(32)}` as Hex;
export const randomSecret = () =>
  toHex(crypto.getRandomValues(new Uint8Array(32)));
export function suggestPassphrase() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return (
    "恭喜发财" +
    Array.from(
      crypto.getRandomValues(new Uint8Array(4)),
      (v) => alphabet[v % 32],
    ).join("")
  );
}
export function passphraseAccount(
  chainId: number,
  box: Address,
  salt: Hex,
  passphrase: string,
) {
  const digest = keccak256(
    encodePacked(
      ["string", "uint256", "address", "bytes32", "string"],
      ["imd-hongbao", BigInt(chainId), box, salt, passphrase],
    ),
  );
  return privateKeyToAccount(
    toHex((BigInt(digest) % (CURVE_ORDER - 1n)) + 1n, { size: 32 }),
  );
}
export function grabTypedData(
  chainId: number,
  box: Address,
  id: bigint,
  recipient: Address,
) {
  return {
    domain: {
      name: "IMD Hongbao",
      version: "1",
      chainId,
      verifyingContract: box,
    },
    types: {
      Grab: [
        { name: "id", type: "uint256" },
        { name: "recipient", type: "address" },
      ],
    },
    primaryType: "Grab",
    message: { id, recipient },
  } as const;
}
export function amountUnits(value: string, decimals = 18) {
  if (
    !/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value) ||
    (value.split(".")[1]?.length ?? 0) > decimals
  )
    throw Error("InvalidAmount");
  const result = parseUnits(value, decimals);
  if (result <= 0n || result > 2n ** 128n - 1n) throw Error("InvalidAmount");
  return result;
}
export const fmt = (value: bigint | undefined, decimals = 18) =>
  value === undefined ? "…" : formatUnits(value, decimals);
export const short = (address: string) =>
  `${address.slice(0, 6)}…${address.slice(-4)}`;
export const sameAddress = (a?: string, b?: string) =>
  !!a && !!b && a.toLowerCase() === b.toLowerCase();
export const validRecipient = (value: string, box: Address) =>
  isAddress(value) &&
  !sameAddress(value, zeroAddress) &&
  !sameAddress(value, box);
export type Packet = {
  creator: Address;
  amount: bigint;
  slots: bigint;
  grabbed: bigint;
  lucky: boolean;
  expiry: bigint;
  keyAddress: Address;
  salt: Hex;
  state: number;
};
export function packetEligibility(
  p: Packet,
  now: bigint,
  settlementTime: bigint,
  address?: Address,
) {
  const open = p.state === 0;
  return {
    grab: open && now < p.expiry && p.grabbed < p.slots,
    reveal:
      open &&
      p.lucky &&
      sameAddress(address, p.creator) &&
      (p.grabbed === p.slots || now >= p.expiry),
    settle: open && p.lucky && now >= settlementTime,
    refund: open && !p.lucky && now >= p.expiry,
  };
}
export const backupKey = (chainId: number, box: Address, id: string) =>
  `imd-hongbao:reveal:${chainId}:${box.toLowerCase()}:${id}`;
