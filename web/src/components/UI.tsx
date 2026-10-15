import { useState, type ReactNode } from "react";
import { getAddress, type Address } from "viem";
import { useApp, type useTransaction } from "../context";

export function Icon({
  name,
  size = 20,
}: {
  name:
    | "packet"
    | "arrow"
    | "gift"
    | "swap"
    | "copy"
    | "shield"
    | "crown"
    | "wallet"
    | "chevron"
    | "check";
  size?: number;
}) {
  const paths = {
    packet: (
      <>
        <rect x="5" y="2" width="14" height="20" rx="2" />
        <path d="M5 6q7 9 14 0" />
        <circle cx="12" cy="12" r="3" />
      </>
    ),
    arrow: (
      <>
        <path d="M4 12h16M14 6l6 6-6 6" />
      </>
    ),
    gift: (
      <>
        <path d="M3 9h18v4H3zM5 13v8h14v-8M12 9v12" />
        <path d="M12 9C3 9 5 1 9 4l3 5Zm0 0c9 0 7-8 3-5l-3 5Z" />
      </>
    ),
    swap: (
      <>
        <path d="M4 7h16m-4-4 4 4-4 4M20 17H4m4-4-4 4 4 4" />
      </>
    ),
    copy: (
      <>
        <rect x="8" y="8" width="12" height="13" rx="2" />
        <path d="M16 8V3H3v13h5" />
      </>
    ),
    shield: (
      <>
        <path d="m12 2 8 4v6c0 6-8 10-8 10S4 18 4 12V6l8-4Z" />
        <path d="m8 12 3 3 5-6" />
      </>
    ),
    crown: (
      <>
        <path d="m3 7 5 4 4-7 4 7 5-4-3 12H6L3 7Zm3 15h12" />
      </>
    ),
    wallet: (
      <>
        <path d="M20 7H4V4h15v3M4 7v14h17V7H4Z" />
        <path d="M21 12h-7v5h7" />
      </>
    ),
    chevron: <path d="m8 4 8 8-8 8" />,
    check: <path d="m4 12 5 5L20 6" />,
  };
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name]}
    </svg>
  );
}
export function CopyButton({
  value,
  label,
}: {
  value: string;
  label?: string;
}) {
  const { t } = useApp();
  const [message, setMessage] = useState("");
  return (
    <span className="copy-control">
      <button
        type="button"
        className="text-button"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(value);
            setMessage(t("已复制", "Copied"));
          } catch {
            setMessage(
              t("请手动选择并复制", "Select and copy the text manually"),
            );
          }
        }}
      >
        <Icon name="copy" size={16} />
        {label ?? t("复制", "Copy")}
      </button>
      <span role="status" className="small">
        {message}
      </span>
    </span>
  );
}
export function AddressView({
  address,
  label,
}: {
  address: Address;
  label?: string;
}) {
  const { runtime, t } = useApp();
  return (
    <div className="address-view">
      {label && <span className="small muted">{label}</span>}
      <a
        className="address"
        href={`${runtime.manifest.network.explorer}/address/${address}`}
        target="_blank"
        rel="noreferrer"
        aria-label={`${label ?? t("地址", "Address")} ${getAddress(address)} (${t("区块浏览器", "explorer")})`}
      >
        {getAddress(address)}
      </a>
      <CopyButton value={getAddress(address)} />
    </div>
  );
}
export function TxStatus({ tx }: { tx: ReturnType<typeof useTransaction> }) {
  const { runtime, t } = useApp();
  const labels = {
    idle: "",
    preparing: t("正在准备…", "Preparing…"),
    simulating: t("正在模拟交易…", "Simulating transaction…"),
    signing: t("请在钱包中确认", "Confirm in your wallet"),
    confirming: t(
      "已提交，等待链上确认…",
      "Submitted. Waiting for confirmation…",
    ),
    success: t("交易已确认", "Transaction confirmed"),
    error: "",
  };
  return (
    <div className="tx-status">
      <div role="status">{labels[tx.phase]}</div>
      {tx.error && (
        <p role="alert" className="error">
          {tx.error}
        </p>
      )}
      {tx.hash && (
        <a
          className="tx-link"
          href={`${runtime.manifest.network.explorer}/tx/${tx.hash}`}
          target="_blank"
          rel="noreferrer"
        >
          {t("在浏览器查看交易", "View transaction on explorer")} ↗
        </a>
      )}
    </div>
  );
}
export function ActionGate({ children }: { children: ReactNode }) {
  const { isConnected, correctChain, ready, setWalletOpen, t } = useApp();
  if (!isConnected)
    return (
      <>
        <button
          type="button"
          className="primary"
          onClick={() => setWalletOpen(true)}
        >
          <Icon name="wallet" />
          {t("连接钱包，开始使用", "Connect wallet to continue")}
        </button>
        <p className="small muted gate-note">
          {t(
            "连接后查看余额并确认交易。",
            "Connect to see your balance and confirm transactions.",
          )}
        </p>
      </>
    );
  if (!correctChain)
    return (
      <p className="notice">
        {t(
          "请使用顶部按钮切换到正确网络。",
          "Use the wallet button above to switch networks.",
        )}
      </p>
    );
  if (!ready)
    return (
      <p className="notice">
        {t(
          "链上验证未完成，交易暂不可用。请使用页面下方的重试按钮。",
          "On-chain verification is incomplete. Transactions are unavailable. Use Retry below.",
        )}
      </p>
    );
  return <>{children}</>;
}
