import { useEffect, useState } from "react";
import { useAccountState, useApp } from "./context";
import { Wallet } from "./components/Wallet";
import { AddressView, Icon } from "./components/UI";
import { Send } from "./pages/Send";
import { OpenPacket, Packet } from "./pages/Packet";
import { Swap } from "./pages/Swap";
import { Funds } from "./pages/Funds";
import { fmt } from "./hongbao";

function PacketArt() {
  return (
    <svg
      className="packet-art"
      viewBox="0 0 440 340"
      fill="none"
      aria-hidden="true"
    >
      <path d="M36 280h368" stroke="currentColor" strokeOpacity=".25" />
      <g transform="rotate(-12 130 170)">
        <rect x="60" y="70" width="164" height="215" rx="14" fill="#e9ba70" />
        <rect x="68" y="78" width="148" height="199" rx="10" stroke="#a46b34" />
        <path d="M60 103q82 85 164 0" stroke="#a46b34" strokeWidth="2" />
      </g>
      <g transform="rotate(8 265 165)">
        <rect x="165" y="42" width="186" height="242" rx="16" fill="#b72c32" />
        <rect
          x="174"
          y="51"
          width="168"
          height="224"
          rx="11"
          stroke="#efcd8d"
        />
        <path d="M166 82q92 98 184 0" stroke="#efcd8d" strokeWidth="2" />
        <circle cx="258" cy="127" r="25" fill="#edcc86" />
        <circle cx="258" cy="127" r="20" stroke="#a46b34" />
        <path d="M250 119h16v16h-16z" fill="#a92429" />
        <path
          d="M207 216h102M226 228h64"
          stroke="#edcc86"
          strokeWidth="2"
          strokeLinecap="round"
        />
      </g>
      <path
        d="m379 65 3 9 9 3-9 3-3 9-3-9-9-3 9-3 3-9ZM56 37l2 6 6 2-6 2-2 6-2-6-6-2 6-2 2-6Z"
        fill="#a46b34"
      />
      <circle cx="390" cy="240" r="6" stroke="#a46b34" />
    </svg>
  );
}
export default function App() {
  const {
    t,
    lang,
    setLang,
    runtime: r,
    health,
    activeAction,
    pendingTx,
    recovered,
  } = useApp();
  const account = useAccountState();
  const [hash, setHash] = useState(location.hash);
  useEffect(() => {
    const update = () => {
      setHash(location.hash);
      window.scrollTo(0, 0);
    };
    addEventListener("hashchange", update);
    return () => removeEventListener("hashchange", update);
  }, []);
  const packetMatch = /^#\/p\/([1-9]\d*)$/.exec(hash);
  const packetId =
    packetMatch && BigInt(packetMatch[1]) < 2n ** 256n
      ? BigInt(packetMatch[1])
      : undefined;
  const tab =
    hash.startsWith("#/p/") || hash === "#/grab"
      ? "grab"
      : hash === "#/swap"
        ? "swap"
        : hash === "#/funds"
          ? "funds"
          : "send";
  const nav = [
    {
      id: "send",
      href: "#/",
      icon: "packet" as const,
      label: t("发红包", "Send"),
    },
    {
      id: "grab",
      href: "#/grab",
      icon: "gift" as const,
      label: t("抢红包", "Grab"),
    },
    {
      id: "swap",
      href: "#/swap",
      icon: "swap" as const,
      label: t("兑换", "Swap"),
    },
    {
      id: "funds",
      href: "#/funds",
      icon: "wallet" as const,
      label: t("资金", "Funds"),
    },
  ];
  return (
    <>
      <a
        className="skip-link"
        href="#main"
        onClick={(event) => {
          event.preventDefault();
          const main = document.getElementById("main");
          main?.focus({ preventScroll: true });
          main?.scrollIntoView({ block: "start" });
        }}
      >
        {t("跳至内容", "Skip to content")}
      </a>
      <header className="site-header">
        <a className="brand" href="#/" aria-label="IMD Hongbao">
          <span className="brand-mark">
            <Icon name="packet" size={26} />
          </span>
          <span>
            <strong>{t("IMD 红包", "IMD Hongbao")}</strong>
            <span className="brand-subtitle">
              {t("心意上链，好运相传", "A little good fortune")}
            </span>
          </span>
        </a>
        <div className="header-actions">
          <button
            type="button"
            className="language-button"
            onClick={() => setLang(lang === "zh" ? "en" : "zh")}
            aria-label={lang === "zh" ? "Switch to English" : "切换到中文"}
          >
            {lang === "zh" ? "EN" : "中文"}
          </button>
          <Wallet />
        </div>
      </header>
      <div className="page-layout">
        <main id="main" tabIndex={-1}>
          <nav className="tabs" aria-label={t("主要导航", "Main navigation")}>
            {nav.map((item) => (
              <a
                key={item.id}
                href={item.href}
                aria-current={tab === item.id ? "page" : undefined}
              >
                <Icon name={item.icon} size={18} />
                {item.label}
              </a>
            ))}
          </nav>
          {tab === "send" ? (
            <Send />
          ) : tab === "swap" ? (
            <Swap />
          ) : tab === "funds" ? (
            <Funds />
          ) : packetId ? (
            <Packet key={packetId.toString()} id={packetId} />
          ) : (
            <OpenPacket />
          )}
          {activeAction && (
            <p className="notice" role="status">
              {t(
                "有交易正在处理中，请等待确认后再进行下一步。",
                "A transaction is in progress. Wait for confirmation before the next action.",
              )}
            </p>
          )}
          {pendingTx && (
            <p className="small">
              <a
                href={`${r.manifest.network.explorer}/tx/${pendingTx.hash}`}
                target="_blank"
                rel="noreferrer"
              >
                {t("查看待确认交易", "View pending transaction")} ↗
              </a>
            </p>
          )}
          {recovered && (
            <p className="notice" role="status">
              {recovered.status === "success"
                ? t(
                    "先前提交的交易已确认。",
                    "The previously submitted transaction confirmed.",
                  )
                : t(
                    "先前提交的交易已撤销。",
                    "The previously submitted transaction reverted.",
                  )}{" "}
              <a
                href={`${r.manifest.network.explorer}/tx/${recovered.hash}`}
                target="_blank"
                rel="noreferrer"
              >
                {t("查看交易", "View transaction")}
              </a>
              {recovered.packetId && (
                <>
                  {" "}
                  ·{" "}
                  <a href={`#/p/${recovered.packetId}`}>
                    {t("查看红包", "View packet")} #{recovered.packetId}
                  </a>
                </>
              )}
            </p>
          )}
        </main>
        <aside className="story-side">
          <div className="story-art">
            <PacketArt />
          </div>
          <h2>
            {t("一份心意，\n满满好运。", "A small gift.\nA shared moment.")}
          </h2>
          <p className="story-copy">
            {t(
              "把 IMD 装进红包，把口令送给朋友。让每一次打开，都多一份期待。",
              "Tuck some IMD into a red packet. Share the passphrase with a friend, and give them something to open.",
            )}
          </p>
          <div className="how-it-works">
            <div>
              <span className="step-number">1</span>
              <div>
                <h3>{t("装入心意", "Fill a packet")}</h3>
                <p>
                  {t(
                    "选择金额、份数和领取方式。",
                    "Choose the amount, slots and split.",
                  )}
                </p>
              </div>
            </div>
            <div>
              <span className="step-number">2</span>
              <div>
                <h3>{t("分享口令", "Share the passphrase")}</h3>
                <p>
                  {t(
                    "私下分享链接与口令。",
                    "Send the link and passphrase privately.",
                  )}
                </p>
              </div>
            </div>
            <div>
              <span className="step-number">3</span>
              <div>
                <h3>{t("一起开红包", "Open it together")}</h3>
                <p>
                  {t(
                    "普通即时到账，拼手气等待开奖。",
                    "Equal shares pay now; lucky shares follow the draw.",
                  )}
                </p>
              </div>
            </div>
          </div>
          <div className="trust-note">
            <Icon name="shield" size={22} />
            <p>
              {t(
                "无需托管 · 无管理员\n每一份红包，都记录在链上。",
                "No custodian. No administrator.\nEvery packet is recorded on-chain.",
              )}
            </p>
          </div>
        </aside>
      </div>
      <footer className="site-footer">
        <div className="footer-top">
          <span className="network-label">
            <span
              className={
                health.data && !health.isError
                  ? "status-dot online"
                  : "status-dot"
              }
            />
            {r.chain.name}
            <span className="small">
              {r.manifest.network.testnet
                ? t("测试网", "Testnet")
                : t("主网", "Mainnet")}
            </span>
          </span>
          <span className="small muted">
            {t(
              "红包用 IMD · 网络费用用 ETH",
              "Packets in IMD · Network fees in ETH",
            )}
          </span>
        </div>
        <div className="connection-state" role="status">
          {health.isError ? (
            <>
              <span>
                {t(
                  "链上连接不可用，交易已暂停。",
                  "Chain connection unavailable. Transactions are paused.",
                )}
              </span>
              <button
                type="button"
                className="text-button"
                onClick={() => {
                  void health.refetch();
                  void account.refetch();
                }}
              >
                {t("重试连接", "Retry connection")}
              </button>
            </>
          ) : health.data ? (
            <span>
              {t("部署与 ABI 已验证", "Deployment and ABIs verified")}
              {account.data && !account.isError
                ? ` · ${t("区块", "Block")} ${account.data.blockNumber}`
                : ""}
            </span>
          ) : (
            <span>
              {t(
                "正在验证部署与链上连接…",
                "Verifying deployment and chain connection…",
              )}
            </span>
          )}
        </div>
        {account.isError && (
          <p className="small error">
            {t(
              "余额刷新失败，操作暂停。",
              "Balance refresh failed. Actions are paused.",
            )}
          </p>
        )}
        <details className="deployment-details">
          <summary>{t("合约与部署信息", "Contracts and deployment")}</summary>
          <div className="contracts-grid">
            {r.manifest.contracts.map((c) => (
              <AddressView key={c.name} address={c.address} label={c.name} />
            ))}
            <AddressView
              address={r.manifest.network.pairToken.address}
              label="IMD"
            />
          </div>
          <dl className="stats-list">
            <div>
              <dt>{t("钱包 ETH", "Wallet ETH")}</dt>
              <dd>{fmt(account.data?.nativeBalance)} ETH</dd>
            </div>
            <div>
              <dt>{t("已创建红包总数", "Total packets created")}</dt>
              <dd>
                {account.data ? (account.data.nextId - 1n).toString() : "—"}
              </dd>
            </div>
            <div>
              <dt>{t("源代码提交", "Source commit")}</dt>
              <dd className="address">{r.manifest.sourceCommit}</dd>
            </div>
            <div>
              <dt>{t("部署证明", "Attestation")}</dt>
              <dd className="address">{r.manifest.attestationHash}</dd>
            </div>
          </dl>
          <a
            className="text-button"
            href="./imd-deployment.json"
            target="_blank"
            rel="noreferrer"
          >
            {t("查看部署清单", "View deployment manifest")} ↗
          </a>
        </details>
        <p className="footer-signoff">
          IMD Hongbao <span>·</span>{" "}
          {t("小小红包，心意不小。", "A little packet goes a long way.")}
        </p>
      </footer>
    </>
  );
}
