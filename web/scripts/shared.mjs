import { readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { keccak256, toBytes } from "viem";

export const root = fileURLToPath(new URL("../../", import.meta.url));
export const canonical = (value) =>
  Array.isArray(value)
    ? value.map(canonical)
    : value && typeof value === "object"
      ? Object.fromEntries(
          Object.keys(value)
            .sort()
            .map((key) => [key, canonical(value[key])]),
        )
      : value;
export const abiHash = (abi) =>
  keccak256(toBytes(JSON.stringify(canonical(abi)))).slice(2);
export const sha256 = (bytes) =>
  createHash("sha256").update(bytes).digest("hex");
export const readJson = async (path) =>
  JSON.parse(await readFile(path, "utf8"));
export const handoff = await readJson(`${root}web/deployment-handoff.json`);
export const network = await readJson(`${root}web/network-handoff.json`);
export function pinnedAbi(name) {
  if (
    !/^[A-Za-z][A-Za-z0-9_]*$/.test(name) ||
    !/^[a-f0-9]{40}$/.test(handoff.sourceCommit)
  )
    throw Error("Invalid pinned source reference");
  return execFileSync(
    "git",
    ["show", `${handoff.sourceCommit}:docs/abi/${name}.json`],
    { cwd: root, encoding: "utf8" },
  );
}
