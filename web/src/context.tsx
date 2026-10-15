import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useConnection, useWalletClient } from "wagmi";
import { getConnection } from "wagmi/actions";
import {
  decodeEventLog,
  isAddress,
  type Abi,
  type Address,
  type Hash,
  type TransactionReceipt,
} from "viem";
import type { Provider, Runtime } from "./config";
import { protocolAbi } from "./config";
import { sameAddress } from "./hongbao";
import { explainError } from "./errors";

type Lang = "zh" | "en";
type PendingTx = { hash: Hash; account: Address; label: string };
const Context = createContext<ReturnType<typeof useAppState> | null>(null);
function useAppState(runtime: Runtime) {
  const [lang, setLang] = useState<Lang>(() => {
    try {
      return localStorage.getItem("hongbao:language") === "en" ? "en" : "zh";
    } catch {
      return "zh";
    }
  });
  const [walletOpen, setWalletOpen] = useState(false);
  const { address, chainId, connector, isConnected } = useConnection();
  const [provider, setProvider] = useState<Provider>();
  const pendingKey = `imd-hongbao:pending-tx:${runtime.chain.id}:${runtime.box.address}`;
  const [pendingTx, setPendingTx] = useState<PendingTx | undefined>(() => {
    try {
      const value = JSON.parse(sessionStorage.getItem(pendingKey) ?? "null");
      return value &&
        /^0x[a-fA-F0-9]{64}$/.test(value.hash) &&
        isAddress(value.account)
        ? value
        : undefined;
    } catch {
      return undefined;
    }
  });
  const [recovered, setRecovered] = useState<{
    hash: Hash;
    status: string;
    packetId?: string;
  }>();
  const actionLock = useRef(!!pendingTx);
  const [activeAction, setActiveAction] = useState("");
  const queryClient = useQueryClient();
  useEffect(() => {
    try {
      if (pendingTx)
        sessionStorage.setItem(pendingKey, JSON.stringify(pendingTx));
      else sessionStorage.removeItem(pendingKey);
    } catch {
      /* pending remains in memory */
    }
  }, [pendingTx, pendingKey]);
  useEffect(() => {
    document.documentElement.lang = lang === "zh" ? "zh-CN" : "en";
    try {
      localStorage.setItem("hongbao:language", lang);
    } catch {
      /* optional preference */
    }
  }, [lang]);
  useEffect(() => {
    let current = true;
    setProvider(undefined);
    if (
      isConnected &&
      connector &&
      typeof connector.getProvider === "function" &&
      chainId === runtime.chain.id
    )
      connector
        .getProvider()
        .then((p) => {
          if (current) setProvider(p as Provider);
        })
        .catch(() => {});
    return () => {
      current = false;
    };
  }, [connector, chainId, isConnected, runtime]);
  const client = useMemo(
    () => runtime.readClient(provider),
    [runtime, provider],
  );
  const receiptRecovery = useQuery({
    queryKey: ["pending-receipt", pendingTx?.hash],
    enabled: !!pendingTx && !activeAction,
    queryFn: async () => {
      if (!pendingTx) throw Error("No pending transaction");
      return client.getTransactionReceipt({ hash: pendingTx.hash });
    },
    retry: 1,
    refetchInterval: 5000,
  });
  useEffect(() => {
    if (!receiptRecovery.data || activeAction || !pendingTx) return;
    const receipt = receiptRecovery.data;
    let packetId: string | undefined;
    for (const log of receipt.logs) {
      if (!sameAddress(log.address, runtime.box.address)) continue;
      try {
        const event = decodeEventLog({
          abi: runtime.box.abi,
          eventName: "PacketCreated",
          data: log.data,
          topics: log.topics,
        });
        packetId = (event.args as unknown as { id: bigint }).id.toString();
      } catch {
        /* another event */
      }
    }
    setRecovered({
      hash: receipt.transactionHash,
      status: receipt.status,
      packetId,
    });
    setPendingTx(undefined);
    actionLock.current = false;
    void queryClient.invalidateQueries({
      predicate: (q) =>
        q.queryKey[0] !== "pending-receipt" && q.queryKey[0] !== "health",
    });
  }, [receiptRecovery.data, pendingTx, activeAction, queryClient, runtime]);
  const health = useQuery({
    queryKey: ["health", runtime.chain.id, !!provider],
    queryFn: async () => {
      const actual = await client.getChainId();
      if (actual !== runtime.chain.id) throw Error("VerificationRequired");
      const targets = [
        ...runtime.manifest.contracts.map((c) => c.address),
        runtime.manifest.network.pairToken.address,
      ];
      const codes = await Promise.all(
        targets.map((address) => client.getCode({ address })),
      );
      if (codes.some((code) => !code || code === "0x"))
        throw Error("VerificationRequired");
      const imd = await client.readContract({
        address: runtime.box.address,
        abi: runtime.box.abi,
        functionName: "imd",
      });
      if (
        !sameAddress(imd as string, runtime.manifest.network.pairToken.address)
      )
        throw Error("VerificationRequired");
      const decimals = await client.readContract({
        address: runtime.manifest.network.pairToken.address,
        abi: protocolAbi.erc20,
        functionName: "decimals",
      });
      if (decimals !== runtime.manifest.network.pairToken.decimals)
        throw Error("VerificationRequired");
      return { verified: true, at: Date.now() };
    },
    retry: 1,
    staleTime: 60_000,
    refetchInterval: 60_000,
  });
  const correctChain = isConnected && chainId === runtime.chain.id;
  const ready = correctChain && !!health.data?.verified && !health.isError;
  return {
    runtime,
    lang,
    setLang,
    t: (zh: string, en: string) => (lang === "zh" ? zh : en),
    client,
    health,
    address,
    isConnected,
    correctChain,
    ready,
    walletOpen,
    setWalletOpen,
    actionLock,
    activeAction: activeAction || (pendingTx ? "pending-recovery" : ""),
    setActiveAction,
    pendingTx,
    setPendingTx,
    recovered,
  };
}
export function AppProvider({
  runtime,
  children,
}: {
  runtime: Runtime;
  children: ReactNode;
}) {
  const state = useAppState(runtime);
  return <Context.Provider value={state}>{children}</Context.Provider>;
}
export function useApp() {
  const context = useContext(Context);
  if (!context) throw Error("App context missing");
  return context;
}
export function useAccountState() {
  const { runtime: r, client, address, health } = useApp();
  return useQuery({
    queryKey: ["account-state", address],
    enabled: !!health.data?.verified && !health.isError,
    queryFn: async () => {
      const block = await client.getBlock();
      const readBox = (functionName: string, args: unknown[] = []) =>
        client.readContract({
          address: r.box.address,
          abi: r.box.abi,
          functionName,
          args,
          blockNumber: block.number,
        });
      const token = r.manifest.network.pairToken.address;
      const [
        nextId,
        escrow,
        boxBalance,
        balance,
        allowance,
        claimable,
        launchBalance,
        launchDecimals,
        nativeBalance,
      ] = await Promise.all([
        readBox("nextPacketId"),
        readBox("totalEscrow"),
        client.readContract({
          address: token,
          abi: protocolAbi.erc20,
          functionName: "balanceOf",
          args: [r.box.address],
          blockNumber: block.number,
        }),
        address
          ? client.readContract({
              address: token,
              abi: protocolAbi.erc20,
              functionName: "balanceOf",
              args: [address],
              blockNumber: block.number,
            })
          : undefined,
        address
          ? client.readContract({
              address: token,
              abi: protocolAbi.erc20,
              functionName: "allowance",
              args: [address, r.box.address],
              blockNumber: block.number,
            })
          : undefined,
        address ? readBox("claimable", [address]) : undefined,
        address
          ? client.readContract({
              address: r.token.address,
              abi: r.token.abi,
              functionName: "balanceOf",
              args: [address],
              blockNumber: block.number,
            })
          : undefined,
        client.readContract({
          address: r.token.address,
          abi: r.token.abi,
          functionName: "decimals",
          blockNumber: block.number,
        }),
        address
          ? client.getBalance({ address, blockNumber: block.number })
          : undefined,
      ]);
      return {
        nextId: nextId as bigint,
        escrow: escrow as bigint,
        boxBalance,
        balance,
        allowance,
        claimable: claimable as bigint | undefined,
        launchBalance: launchBalance as bigint | undefined,
        launchDecimals: Number(launchDecimals),
        nativeBalance,
        timestamp: block.timestamp,
        blockNumber: block.number,
      };
    },
    refetchInterval: 5000,
    retry: 1,
  });
}
export type ContractCall = {
  address: Address;
  abi: Abi;
  functionName: string;
  args?: readonly unknown[];
  value?: bigint;
};
export function useTransaction(label: string) {
  const {
    runtime,
    client,
    address,
    ready,
    lang,
    actionLock,
    setActiveAction,
    setPendingTx,
  } = useApp();
  const { data: wallet } = useWalletClient();
  const queryClient = useQueryClient();
  const [phase, setPhase] = useState<
    | "idle"
    | "preparing"
    | "simulating"
    | "signing"
    | "confirming"
    | "success"
    | "error"
  >("idle");
  const [error, setError] = useState("");
  const [hash, setHash] = useState<Hash>();
  const busy = ["preparing", "simulating", "signing", "confirming"].includes(
    phase,
  );
  async function run(
    prepare: () => Promise<ContractCall> | ContractCall,
    onSuccess?: (receipt: TransactionReceipt) => Promise<void> | void,
  ) {
    if (actionLock.current) return;
    actionLock.current = true;
    setActiveAction(label);
    setError("");
    setHash(undefined);
    setPhase("preparing");
    let broadcastHash: Hash | undefined;
    let confirmed = false;
    let replaced = false;
    try {
      if (!ready || !wallet || !address) throw Error("VerificationRequired");
      const call = await prepare();
      if ((await wallet.getChainId()) !== runtime.chain.id)
        throw Error("NetworkChanged");
      setPhase("simulating");
      const simulation = await client.simulateContract({
        ...call,
        account: address,
      });
      const active = getConnection(runtime.walletConfig);
      if (
        !sameAddress(active.address, address) ||
        active.chainId !== runtime.chain.id
      )
        throw Error("NetworkChanged");
      setPhase("signing");
      const txHash = await wallet.writeContract({
        ...simulation.request,
        chain: runtime.chain,
        account: address,
      });
      broadcastHash = txHash;
      setPendingTx({ hash: txHash, account: address, label });
      setHash(txHash);
      setPhase("confirming");
      const receipt = await client.waitForTransactionReceipt({
        hash: txHash,
        timeout: 180_000,
        confirmations: 1,
        onReplaced: ({ transaction, reason }) => {
          setHash(transaction.hash);
          broadcastHash = transaction.hash;
          replaced = reason !== "repriced";
          setPendingTx({ hash: transaction.hash, account: address, label });
        },
      });
      confirmed = true;
      if (replaced) throw Error("TransactionReplaced");
      if (receipt.status !== "success") throw Error("Transaction reverted");
      await onSuccess?.(receipt);
      await queryClient.invalidateQueries({
        predicate: (q) => q.queryKey[0] !== "health",
      });
      setPhase("success");
    } catch (e) {
      setError(
        explainError(
          broadcastHash && !confirmed ? Error("ConfirmationPending") : e,
          lang,
        ),
      );
      setPhase("error");
    } finally {
      if (!broadcastHash || confirmed) {
        setPendingTx(undefined);
        actionLock.current = false;
      }
      setActiveAction("");
    }
  }
  return {
    run,
    phase,
    error,
    hash,
    busy,
    clear: () => {
      setError("");
      setPhase("idle");
    },
  };
}
