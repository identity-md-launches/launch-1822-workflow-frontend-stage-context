import { createConfig, http } from "wagmi";
import { coinbaseWallet, injected } from "wagmi/connectors";
import {
  createPublicClient,
  custom,
  defineChain,
  erc20Abi,
  fallback,
  isAddress,
  keccak256,
  parseAbi,
  toBytes,
  type Abi,
  type Address,
  type Hex,
} from "viem";

export type PoolKey = {
  currency0: Address;
  currency1: Address;
  fee: number;
  tickSpacing: number;
  hooks: Address;
};
export type Deployment = {
  version: 1;
  launchId: string;
  chainId: number;
  sourceCommit: string;
  attestationHash: string;
  contracts: {
    name: string;
    address: Address;
    abiHash: string;
    abiPath: string;
  }[];
  assets: { path: string; sha256: string }[];
  poolKey?: PoolKey;
  network: {
    chainId: number;
    name: string;
    testnet: boolean;
    rpcUrls: string[];
    explorer: string;
    nativeCurrency: { name: string; symbol: string; decimals: number };
    faucets: unknown[];
    uniswapV4: {
      poolManager: Address;
      universalRouter: Address;
      quoter: Address;
      stateView: Address;
      positionManager: Address;
      permit2: Address;
      extendedSwapParams?: boolean;
    };
    pairToken: {
      address: Address;
      symbol: string;
      name: string;
      decimals: number;
    };
  };
  walletAddChain?: {
    chainId: Hex;
    chainName: string;
    rpcUrls: string[];
    nativeCurrency: { name: string; symbol: string; decimals: number };
    blockExplorerUrls: string[];
  };
};
export type Provider = {
  request: (args: {
    method: string;
    params?: readonly unknown[];
  }) => Promise<unknown>;
};
export const canonical = (value: unknown): unknown =>
  Array.isArray(value)
    ? value.map(canonical)
    : value && typeof value === "object"
      ? Object.fromEntries(
          Object.keys(value)
            .sort()
            .map((key) => [
              key,
              canonical((value as Record<string, unknown>)[key]),
            ]),
        )
      : value;
export const hashAbi = (abi: Abi) =>
  keccak256(toBytes(JSON.stringify(canonical(abi)))).slice(2);
export const protocolAbi = {
  erc20: erc20Abi,
  permit2: parseAbi([
    "function allowance(address owner, address token, address spender) view returns (uint160 amount, uint48 expiration, uint48 nonce)",
    "function approve(address token, address spender, uint160 amount, uint48 expiration)",
  ]),
  router: parseAbi([
    "function execute(bytes commands, bytes[] inputs, uint256 deadline) payable",
    "error ExecutionFailed(uint256 commandIndex, bytes message)",
    "error TransactionDeadlinePassed()",
    "error V4TooLittleReceived(uint256 minAmountOutReceived, uint256 amountReceived)",
  ]),
  quoter: parseAbi([
    "struct PoolKey { address currency0; address currency1; uint24 fee; int24 tickSpacing; address hooks; }",
    "struct QuoteExactSingleParams { PoolKey poolKey; bool zeroForOne; uint128 exactAmount; bytes hookData; }",
    "function quoteExactInputSingle(QuoteExactSingleParams params) returns (uint256 amountOut, uint256 gasEstimate)",
    "error UnexpectedRevertBytes(bytes revertData)",
    "error NotEnoughLiquidity(bytes32 poolId)",
  ]),
  stateView: parseAbi([
    "function getSlot0(bytes32 poolId) view returns (uint160 sqrtPriceX96, int24 tick, uint24 protocolFee, uint24 lpFee)",
    "function getLiquidity(bytes32 poolId) view returns (uint128 liquidity)",
  ]),
  errors: parseAbi([
    "error UnexpectedRevertBytes(bytes revertData)",
    "error NotEnoughLiquidity(bytes32 poolId)",
    "error ExecutionFailed(uint256 commandIndex, bytes message)",
    "error TransactionDeadlinePassed()",
    "error V4TooLittleReceived(uint256 minAmountOutReceived, uint256 amountReceived)",
    "error AllowanceExpired(uint256 deadline)",
    "error InsufficientAllowance(uint256 amount)",
    "error ERC20InsufficientBalance(address sender, uint256 balance, uint256 needed)",
    "error ERC20InsufficientAllowance(address spender, uint256 allowance, uint256 needed)",
  ]),
};

function safeAsset(path: string) {
  return (
    /^[A-Za-z0-9_./-]+$/.test(path) &&
    !path.startsWith("/") &&
    !path.split("/").includes("..")
  );
}
export async function loadDeployment() {
  const base = new URL(import.meta.env.BASE_URL, location.href.split("#")[0]);
  const response = await fetch(new URL("imd-deployment.json", base), {
    cache: "no-cache",
  });
  if (!response.ok)
    throw Error("Deployment configuration unavailable / 无法加载部署配置");
  const manifest: Deployment = await response.json();
  if (
    manifest.version !== 1 ||
    manifest.chainId !== manifest.network?.chainId ||
    !manifest.network.rpcUrls.length
  )
    throw Error("Invalid deployment network");
  if (
    !manifest.contracts.length ||
    manifest.contracts.some(
      (c) => !isAddress(c.address) || !safeAsset(c.abiPath),
    )
  )
    throw Error("Invalid deployment contracts");
  const contracts = await Promise.all(
    manifest.contracts.map(async (c) => {
      const res = await fetch(new URL(c.abiPath, base));
      if (!res.ok) throw Error(`ABI unavailable: ${c.name}`);
      const abi: Abi = await res.json();
      if (!Array.isArray(abi) || hashAbi(abi) !== c.abiHash)
        throw Error(`ABI verification failed: ${c.name}`);
      return { ...c, abi };
    }),
  );
  const contract = (name: string) => {
    const result = contracts.find((c) => c.name === name);
    if (!result) throw Error(`Missing contract: ${name}`);
    return result;
  };
  const chain = defineChain({
    id: manifest.chainId,
    name: manifest.network.name,
    nativeCurrency: manifest.network.nativeCurrency,
    rpcUrls: { default: { http: manifest.network.rpcUrls } },
    blockExplorers: {
      default: { name: "Explorer", url: manifest.network.explorer },
    },
    testnet: manifest.network.testnet,
  });
  const transports = () =>
    manifest.network.rpcUrls.map((url) =>
      http(url, { timeout: 8000, retryCount: 0, batch: true }),
    );
  const walletConfig = createConfig({
    chains: [chain],
    multiInjectedProviderDiscovery: true,
    connectors: [
      injected(),
      coinbaseWallet({
        appName: "IMD Hongbao",
        appLogoUrl: new URL("favicon.svg", base).href,
        preference: { options: "all" },
      }),
    ],
    transports: { [chain.id]: fallback(transports(), { retryCount: 0 }) },
  });
  const readClient = (provider?: Provider) =>
    createPublicClient({
      chain,
      pollingInterval: 5000,
      transport: fallback(
        [
          ...transports(),
          ...(provider
            ? [
                custom(
                  {
                    request: async (args) => {
                      const id = await provider.request({
                        method: "eth_chainId",
                      });
                      if (Number(id) !== chain.id)
                        throw Error("Wallet is on another network");
                      return provider.request(
                        args as { method: string; params?: readonly unknown[] },
                      );
                    },
                  },
                  { retryCount: 0 },
                ),
              ]
            : []),
        ],
        { retryCount: 0 },
      ),
    });
  return {
    manifest,
    chain,
    walletConfig,
    readClient,
    box: contract("HongbaoBox"),
    token: contract("LaunchToken"),
    base,
  };
}
export type Runtime = Awaited<ReturnType<typeof loadDeployment>>;

export async function switchNetwork(
  provider: Provider,
  deployment: Deployment,
) {
  const params = [{ chainId: `0x${deployment.chainId.toString(16)}` }];
  try {
    await provider.request({ method: "wallet_switchEthereumChain", params });
  } catch (error) {
    const e = error as {
      code?: number;
      message?: string;
      cause?: { code?: number };
      data?: { originalError?: { code?: number } };
    };
    const unknown =
      e.code === 4902 ||
      e.cause?.code === 4902 ||
      e.data?.originalError?.code === 4902 ||
      /unknown chain|unrecognized chain|chain.*not.*(added|configured|supported)/i.test(
        e.message ?? "",
      );
    if (!unknown || !deployment.walletAddChain) throw error;
    await provider.request({
      method: "wallet_addEthereumChain",
      params: [deployment.walletAddChain],
    });
    await provider.request({ method: "wallet_switchEthereumChain", params });
  }
}
