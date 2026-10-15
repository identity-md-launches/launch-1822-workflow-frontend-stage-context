import { useEffect, useRef, useState } from "react";
import {
  useConnect,
  useConnectors,
  useConnection,
  useDisconnect,
  type Connector,
} from "wagmi";
import { switchNetwork, type Provider } from "../config";
import { useApp } from "../context";
import { short } from "../hongbao";
import { explainError } from "../errors";
import { AddressView, Icon } from "./UI";

export const OPEN_IN = [
  {
    id: "metamask",
    name: "MetaMask",
    href: (url: string) =>
      `https://link.metamask.io/dapp/${url.replace(/^https?:\/\//, "")}`,
  },
  {
    id: "coinbase",
    name: "Coinbase Wallet",
    href: (url: string) =>
      `https://go.cb-w.com/dapp?cb_url=${encodeURIComponent(url)}`,
  },
  {
    id: "rabby",
    name: "Rabby",
    href: (url: string) =>
      `https://go.rabby.io/mobile/?_cmd=open-dapp&dapp=${encodeURIComponent(url)}`,
  },
  {
    id: "phantom",
    name: "Phantom",
    href: (url: string) =>
      `https://phantom.app/ul/browse/${encodeURIComponent(url)}?ref=${encodeURIComponent(new URL(url).origin)}`,
  },
];
export function Wallet() {
  const {
    t,
    lang,
    runtime,
    walletOpen: open,
    setWalletOpen: setOpen,
    activeAction,
  } = useApp();
  const { address, isConnected, chainId, connector } = useConnection();
  const { mutateAsync: connect } = useConnect();
  const { mutate: disconnect } = useDisconnect();
  const connectors = useConnectors();
  const [pending, setPending] = useState("");
  const [error, setError] = useState("");
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const named = connectors.some(
    (c) => c.type === "injected" && c.id !== "injected",
  );
  const mobile =
    /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) &&
    !named &&
    !("ethereum" in window);
  const listed = [
    ...connectors.filter((c) => c.type === "injected"),
    ...connectors.filter((c) => c.type !== "injected"),
  ].filter(
    (c) =>
      !(c.id === "injected" && named) && (!mobile || c.type !== "injected"),
  );
  const wrongChain = isConnected && chainId !== runtime.chain.id;
  useEffect(() => {
    if (open) dialog.current?.showModal();
    else {
      dialog.current?.close();
    }
  }, [open]);
  async function switchChain() {
    if (!connector) return;
    setPending("switch");
    setError("");
    try {
      await switchNetwork(
        (await connector.getProvider()) as Provider,
        runtime.manifest,
      );
    } catch (e) {
      setError(explainError(e, lang));
      setOpen(true);
    } finally {
      setPending("");
    }
  }
  async function choose(c: Connector) {
    setPending(c.uid);
    setError("");
    try {
      // Connect first, then explicitly implement unknown-chain add + switch.
      await connect({ connector: c });
      await switchNetwork(
        (await c.getProvider()) as Provider,
        runtime.manifest,
      );
      setOpen(false);
    } catch (e) {
      setError(explainError(e, lang));
    } finally {
      setPending("");
    }
  }
  const label = (c: Connector) =>
    c.id === "injected"
      ? t("浏览器钱包", "Browser wallet")
      : c.id === "coinbaseWalletSDK"
        ? mobile
          ? "Coinbase Smart Wallet"
          : "Coinbase Wallet"
        : c.name;
  return (
    <>
      <button
        type="button"
        ref={trigger}
        className={`wallet-button ${wrongChain ? "wrong-chain" : ""}`}
        disabled={!!pending || !!activeAction}
        onClick={() => (wrongChain ? void switchChain() : setOpen(true))}
      >
        <Icon name="wallet" size={18} />
        <span>
          {pending === "switch"
            ? t("切换中…", "Switching…")
            : wrongChain
              ? t(
                  `切换到 ${runtime.chain.name}`,
                  `Switch to ${runtime.chain.name}`,
                )
              : address
                ? short(address)
                : t("连接钱包", "Connect wallet")}
        </span>
      </button>
      <dialog
        ref={dialog}
        className="wallet-dialog"
        onCancel={() => setOpen(false)}
        onClose={() => {
          setOpen(false);
          trigger.current?.focus();
        }}
        onClick={(e) => {
          if (e.target === dialog.current) setOpen(false);
        }}
        onKeyDown={(e) => {
          if (e.key !== "Tab") return;
          const items = Array.from(
            dialog.current?.querySelectorAll<HTMLElement>(
              "button:not(:disabled), a[href], input:not(:disabled)",
            ) ?? [],
          ).filter((el) => el.getClientRects().length);
          const first = items[0],
            last = items.at(-1);
          if (e.shiftKey && document.activeElement === first) {
            e.preventDefault();
            last?.focus();
          } else if (!e.shiftKey && document.activeElement === last) {
            e.preventDefault();
            first?.focus();
          }
        }}
        aria-labelledby="wallet-title"
      >
        <div className="sheet-content">
          <div className="section-heading">
            <h2 id="wallet-title">
              {isConnected
                ? t("我的钱包", "Your wallet")
                : t("连接钱包", "Connect a wallet")}
            </h2>
            <button
              className="icon-button"
              aria-label={t("关闭", "Close")}
              onClick={() => setOpen(false)}
            >
              ×
            </button>
          </div>
          {isConnected && address ? (
            <>
              <AddressView address={address} />
              <p className="muted small">
                {wrongChain
                  ? t("当前网络不匹配", "Connected to a different network")
                  : runtime.chain.name}
              </p>
              {wrongChain && (
                <button
                  className="wallet-row"
                  disabled={!!pending}
                  onClick={switchChain}
                >
                  {t(
                    `切换到 ${runtime.chain.name}`,
                    `Switch to ${runtime.chain.name}`,
                  )}
                </button>
              )}
              <button
                className="wallet-row"
                onClick={() => {
                  disconnect();
                  setOpen(false);
                }}
              >
                {t("断开连接", "Disconnect")}
              </button>
            </>
          ) : (
            <>
              <p className="muted small">
                {t(
                  "私钥留在你的钱包中。网络费用以 ETH 支付。",
                  "Your keys stay in your wallet. Network fees are paid in ETH.",
                )}
              </p>
              {mobile &&
                OPEN_IN.map((w) => (
                  <a
                    className="wallet-row"
                    key={w.id}
                    href={w.href(location.href)}
                  >
                    <img
                      width="28"
                      height="28"
                      src={`./wallets/${w.id}.svg`}
                      alt=""
                    />
                    {t(`在 ${w.name} 中打开`, `Open in ${w.name}`)}
                  </a>
                ))}
              {listed.map((c) => (
                <button
                  className="wallet-row"
                  disabled={!!pending}
                  key={c.uid}
                  onClick={() => void choose(c)}
                >
                  {c.icon ? (
                    <img width="28" height="28" src={c.icon} alt="" />
                  ) : c.id === "coinbaseWalletSDK" ? (
                    <img
                      width="28"
                      height="28"
                      src="./wallets/coinbase.svg"
                      alt=""
                    />
                  ) : (
                    <Icon name="wallet" size={28} />
                  )}
                  <span>
                    {label(c)}
                    {pending === c.uid && t(" · 正在打开…", " · opening…")}
                  </span>
                </button>
              ))}
              {!mobile && !named && (
                <p className="small muted">
                  {t(
                    "没有浏览器钱包？可用 Coinbase 创建通行密钥钱包，或在手机钱包的浏览器打开此页面。",
                    "No browser wallet? Use Coinbase to create a passkey wallet, or open this page in your phone wallet’s browser.",
                  )}
                </p>
              )}
            </>
          )}
          <p role="alert" className="error">
            {error}
          </p>
        </div>
      </dialog>
    </>
  );
}
