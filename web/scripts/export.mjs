import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import {
  root,
  handoff,
  network,
  pinnedAbi,
  abiHash,
  sha256,
} from "./shared.mjs";

const dist = `${root}dist/`;
await mkdir(`${dist}abi`, { recursive: true });
const contracts = [];
for (const { name, address, abiHash: expected } of handoff.contracts) {
  const raw = pinnedAbi(name);
  if (abiHash(JSON.parse(raw)) !== expected)
    throw Error(`Pinned ABI hash mismatch: ${name}`);
  const abiPath = `abi/${name}.json`;
  await writeFile(`${dist}${abiPath}`, raw);
  contracts.push({ name, address, abiHash: expected, abiPath });
}
const paths = async (dir = "") =>
  (
    await Promise.all(
      (await readdir(dist + dir, { withFileTypes: true })).map(async (entry) =>
        entry.isDirectory()
          ? paths(`${dir}${entry.name}/`)
          : `${dir}${entry.name}`,
      ),
    )
  ).flat();
const assets = [];
for (const path of (await paths())
  .filter((path) => path !== "imd-deployment.json")
  .sort()) {
  const bytes = await readFile(dist + path);
  if (bytes.length > 8388608) throw Error(`Asset too large: ${path}`);
  assets.push({ path, sha256: sha256(bytes) });
}
if (assets.length > 128) throw Error("More than 128 assets");
const { launchId, chainId, sourceCommit, attestationHash, poolKey } = handoff;
await writeFile(
  `${dist}imd-deployment.json`,
  JSON.stringify(
    {
      version: 1,
      launchId,
      chainId,
      sourceCommit,
      attestationHash,
      contracts,
      assets,
      ...(poolKey ? { poolKey } : {}),
      ...network,
    },
    null,
    2,
  ) + "\n",
);
await import("./verify.mjs");
