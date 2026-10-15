import assert from "node:assert/strict";
import { readFile, readdir, stat } from "node:fs/promises";
import {
  root,
  handoff,
  network,
  pinnedAbi,
  abiHash,
  sha256,
  readJson,
} from "./shared.mjs";

const dist = `${root}dist/`;
const manifest = await readJson(`${dist}imd-deployment.json`);
// Assignment inputs are optional after delivery; when present, verify the preserved build inputs too.
for (const [name, expected] of [
  ["deployment.json", handoff],
  ["network.json", network],
]) {
  let original;
  try {
    original = await readJson(`${root}.imd/reads/${name}`);
  } catch (error) {
    if (error.code === "ENOENT") continue;
    throw error;
  }
  assert.deepEqual(expected, original, `Preserved handoff ${name}`);
}
assert.deepEqual(
  Object.keys(manifest).sort(),
  [
    "version",
    "launchId",
    "chainId",
    "sourceCommit",
    "attestationHash",
    "contracts",
    "assets",
    ...(handoff.poolKey ? ["poolKey"] : []),
    ...Object.keys(network),
  ].sort(),
);
for (const key of [
  "version",
  "launchId",
  "chainId",
  "sourceCommit",
  "attestationHash",
])
  assert.deepEqual(manifest[key], handoff[key]);
assert.deepEqual(manifest.poolKey, handoff.poolKey);
assert.deepEqual(manifest.network, network.network);
assert.deepEqual(manifest.walletAddChain, network.walletAddChain);
assert.equal(manifest.chainId, manifest.network.chainId);
assert.deepEqual(
  manifest.contracts.map(({ name, address, abiHash }) => ({
    name,
    address,
    abiHash,
  })),
  handoff.contracts.map(({ name, address, abiHash }) => ({
    name,
    address,
    abiHash,
  })),
);
const safe = (path) =>
  typeof path === "string" &&
  /^[A-Za-z0-9_./-]+$/.test(path) &&
  !path.startsWith("/") &&
  !path.split("/").includes("..");
for (const c of manifest.contracts) {
  assert(safe(c.abiPath));
  const abi = await readJson(dist + c.abiPath);
  assert(Array.isArray(abi));
  assert.equal(abiHash(abi), c.abiHash, `ABI hash: ${c.name}`);
  assert.deepEqual(abi, JSON.parse(pinnedAbi(c.name)), `Pinned ABI: ${c.name}`);
}
const walk = async (dir = "") =>
  (
    await Promise.all(
      (await readdir(dist + dir, { withFileTypes: true })).map(async (e) => {
        assert(!e.isSymbolicLink(), "No symlinks");
        return e.isDirectory() ? walk(`${dir}${e.name}/`) : `${dir}${e.name}`;
      }),
    )
  ).flat();
assert.deepEqual(
  manifest.assets.map((a) => a.path).sort(),
  (await walk()).filter((p) => p !== "imd-deployment.json").sort(),
);
assert(manifest.assets.length <= 128);
let size = (await stat(`${dist}imd-deployment.json`)).size;
for (const a of manifest.assets) {
  assert(safe(a.path));
  assert(/^[a-f0-9]{64}$/.test(a.sha256));
  const content = await readFile(dist + a.path);
  assert(content.length <= 8388608);
  assert.equal(sha256(content), a.sha256, a.path);
  size += content.length;
}
assert(size < 8 * 1024 * 1024, "Export must leave room in 8 MiB submission");
console.log(
  `Verified handoff, network, pool key, ${manifest.contracts.length} pinned ABIs and all ${manifest.assets.length} assets (${size} bytes).`,
);
