import { useEffect, useState, type FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { hashTypedData, isHex, keccak256, type Address, type Hex } from "viem";
import { useApp, useTransaction } from "../context";
import {
  backupKey,
  fmt,
  grabTypedData,
  packetEligibility,
  passphraseAccount,
  sameAddress,
  validRecipient,
  type Packet as PacketData,
} from "../hongbao";
import {
  ActionGate,
  AddressView,
  CopyButton,
  Icon,
  TxStatus,
} from "../components/UI";

export function OpenPacket() {
  const { t } = useApp();
  const [id, setId] = useState("");
  const [error, setError] = useState("");
  return (
    <section className="panel open-panel">
      <div className="panel-heading">
        <div>
          <h1>{t("接住这份好运", "Open a red packet")}</h1>
          <p className="muted">
            {t(
              "有朋友的红包链接？输入编号即可打开。",
              "Have a packet from a friend? Enter its ID to open it.",
            )}
          </p>
        </div>
        <Icon name="gift" size={36} />
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!/^[1-9]\d*$/.test(id) || BigInt(id) >= 2n ** 256n) {
            setError(t("请输入有效的红包编号。", "Enter a valid packet ID."));
            return;
          }
          location.hash = `/p/${id}`;
        }}
      >
        <div className="field">
          <label htmlFor="packet-id">{t("红包编号", "Packet ID")}</label>
          <input
            id="packet-id"
            inputMode="numeric"
            placeholder="1"
            value={id}
            onChange={(e) => setId(e.target.value)}
            aria-describedby="id-error"
          />
        </div>
        <p id="id-error" role="alert" className="error">
          {error}
        </p>
        <button className="primary" type="submit">
          {t("打开红包", "Open packet")}
          <Icon name="arrow" />
        </button>
      </form>
      <p className="small muted">
        {t(
          "编号位于分享链接的 #/p/ 后面。查看红包无需连接钱包。",
          "The ID follows #/p/ in the share link. Viewing a packet does not require a wallet.",
        )}
      </p>
    </section>
  );
}
export function Packet({ id }: { id: bigint }) {
  const {
    t,
    lang,
    runtime: r,
    client,
    address,
    health,
    activeAction,
  } = useApp();
  const [passphrase, setPassphrase] = useState("");
  const [recipient, setRecipient] = useState("");
  const [secret, setSecret] = useState("");
  const [savedSecret, setSavedSecret] = useState<Hex>();
  const grab = useTransaction("grab");
  const reveal = useTransaction("reveal");
  const settle = useTransaction("settle");
  const refund = useTransaction("refund");
  useEffect(() => {
    try {
      const saved = localStorage.getItem(
        backupKey(r.chain.id, r.box.address, id.toString()),
      );
      setSavedSecret(
        saved && isHex(saved) && saved.length === 66
          ? (saved as Hex)
          : undefined,
      );
    } catch {
      setSavedSecret(undefined);
    }
    setSecret("");
    setPassphrase("");
    setRecipient("");
  }, [id, r]);
  const packet = useQuery({
    queryKey: ["packet", id.toString()],
    enabled: !!health.data?.verified && !health.isError,
    queryFn: async () => {
      const block = await client.getBlock();
      const read = (functionName: string, args: readonly unknown[] = [id]) =>
        client.readContract({
          address: r.box.address,
          abi: r.box.abi,
          functionName,
          args,
          blockNumber: block.number,
        });
      const p = (await read("packet")) as PacketData;
      const [grabbers, best, remaining, settlement, commitment, creatorCredit] =
        await Promise.all([
          read("grabbers"),
          read("bestLuck"),
          read("remaining"),
          p.lucky ? read("settlementTime") : 0n,
          read("revealCommitments"),
          read("claimable", [p.creator]),
        ]);
      return {
        p,
        grabbers: grabbers as readonly [readonly Address[], readonly bigint[]],
        best: best as Address,
        remaining: remaining as bigint,
        settlement: settlement as bigint,
        commitment: commitment as Hex,
        creatorCredit: creatorCredit as bigint,
        timestamp: block.timestamp,
        blockNumber: block.number,
      };
    },
    refetchInterval: 5000,
    retry: 1,
  });
  const info = packet.data;
  useEffect(() => {
    if (
      savedSecret ||
      !info?.p.lucky ||
      info.p.state !== 0 ||
      !sameAddress(address, info.p.creator)
    )
      return;
    try {
      const pending = localStorage.getItem(
        backupKey(r.chain.id, r.box.address, `pending:${info.commitment}`),
      );
      if (
        pending &&
        isHex(pending) &&
        pending.length === 66 &&
        keccak256(pending as Hex) === info.commitment
      ) {
        setSavedSecret(pending as Hex);
        localStorage.setItem(
          backupKey(r.chain.id, r.box.address, id.toString()),
          pending,
        );
      }
    } catch {
      /* manual restoration remains available */
    }
  }, [
    info?.commitment,
    info?.p.lucky,
    info?.p.creator,
    info?.p.state,
    address,
    savedSecret,
    id,
    r,
  ]);
  const date = (timestamp: bigint) =>
    new Date(Number(timestamp) * 1000).toLocaleString(
      lang === "zh" ? "zh-CN" : "en-GB",
      { dateStyle: "medium", timeStyle: "short" },
    );
  const stateNames = [
    t("领取中", "Open"),
    t("已领完", "Completed"),
    t("已开奖", "Revealed"),
    t("已均分结算", "Settled equally"),
    t("已退款", "Refunded"),
  ];
  if (!info)
    return (
      <section className="panel">
        <h1>
          {t("红包", "Packet")} #{id.toString()}
        </h1>
        {packet.isError ? (
          <>
            <p role="alert" className="error">
              {t(
                "无法读取红包。请检查编号和网络后重试。",
                "Unable to read this packet. Check the ID and network, then retry.",
              )}
            </p>
            <button className="secondary" onClick={() => void packet.refetch()}>
              {t("重新读取", "Retry packet")}
            </button>
          </>
        ) : (
          <p role="status">
            {health.isError
              ? t(
                  "链上连接不可用，请使用下方重试按钮。",
                  "Chain connection unavailable. Use Retry below.",
                )
              : t("正在读取链上红包…", "Reading packet from the chain…")}
          </p>
        )}
        <a className="text-button" href="#/grab">
          {t("输入其他编号", "Enter another ID")}
        </a>
      </section>
    );
  const { p } = info;
  const eligibility = packetEligibility(
    p,
    info.timestamp,
    info.settlement,
    address,
  );
  const dest = (recipient || address || "") as Address;
  const duplicate = info.grabbers[0].some((a) => sameAddress(a, dest));
  const remainingSlots = p.slots - p.grabbed;
  const stale = packet.isError;
  async function submitGrab(e: FormEvent) {
    e.preventDefault();
    await grab.run(
      async () => {
        if (!validRecipient(dest, r.box.address))
          throw Error("InvalidRecipient");
        if (!passphrase) throw Error("InvalidPassphrase");
        const fresh = await packet.refetch();
        if (!fresh.data || fresh.isError) throw Error("VerificationRequired");
        const signer = passphraseAccount(
          r.chain.id,
          r.box.address,
          fresh.data.p.salt,
          passphrase,
        );
        if (!sameAddress(signer.address, fresh.data.p.keyAddress))
          throw Error("WrongPassphrase");
        const typedData = grabTypedData(r.chain.id, r.box.address, id, dest);
        const digest = await client.readContract({
          address: r.box.address,
          abi: r.box.abi,
          functionName: "grabDigest",
          args: [id, dest],
        });
        if (digest !== hashTypedData(typedData))
          throw Error("InvalidSignature");
        const signature = await signer.signTypedData(typedData);
        return {
          address: r.box.address,
          abi: r.box.abi,
          functionName: "grab",
          args: [id, dest, signature],
        };
      },
      () => {
        setPassphrase("");
      },
    );
  }
  const statusLabel =
    p.state === 0 && remainingSlots === 0n
      ? t("已领完，待开奖", "Full · awaiting settlement")
      : p.state === 0 && info.timestamp >= p.expiry
        ? t("已到期，待结算", "Expired · awaiting settlement")
        : stateNames[p.state];
  return (
    <section className="panel packet-panel">
      <div className="panel-heading">
        <div>
          <h1>{t("好运红包", "A little good fortune")}</h1>
          <p className="muted">
            #{id.toString()} ·{" "}
            {p.lucky ? t("拼手气", "Lucky draw") : t("普通红包", "Equal split")}
          </p>
        </div>
        <span className="heading-symbol">
          <Icon name="packet" size={36} />
        </span>
      </div>
      <div className="packet-summary">
        <span>{t("红包金额", "Packet amount")}</span>
        <strong className="packet-amount">
          {fmt(p.amount)} <span>IMD</span>
        </strong>
        <div className="packet-progress">
          <span>
            {t("剩余", "Available")}{" "}
            <strong>
              {remainingSlots.toString()} / {p.slots.toString()}
            </strong>
          </span>
          <span className="status-label">{statusLabel}</span>
        </div>
        <progress
          value={Number(p.grabbed)}
          max={Number(p.slots)}
          aria-label={t("已领取份数", "Grabbed slots")}
        />
        <span className="small muted">
          {t("到期", "Expires")} {date(p.expiry)}
        </span>
      </div>
      {stale && (
        <p className="error" role="alert">
          {t(
            "无法刷新，交易暂停。",
            "Refresh failed. Transactions are paused.",
          )}
        </p>
      )}
      {eligibility.grab && (
        <form onSubmit={(e) => void submitGrab(e)}>
          <div className="field">
            <label htmlFor="grab-phrase">
              {t("输入红包口令", "Enter the passphrase")}
            </label>
            <input
              id="grab-phrase"
              autoComplete="off"
              type="password"
              value={passphrase}
              onChange={(e) => setPassphrase(e.target.value)}
              aria-describedby="grab-help"
            />
            <p className="small muted" id="grab-help">
              {p.lucky
                ? t(
                    "先占一个名额，发送者开奖后到账。",
                    "Reserve your slot now; receive IMD after the sender reveals.",
                  )
                : t(
                    "领取成功后，IMD 即时到账。",
                    "Receive your equal share of IMD when the grab confirms.",
                  )}
            </p>
          </div>
          <details className="details">
            <summary>{t("替其他地址领取", "Grab for another address")}</summary>
            <label htmlFor="recipient">
              {t(
                "收款地址（默认当前钱包）",
                "Recipient (defaults to your wallet)",
              )}
            </label>
            <input
              id="recipient"
              className="address-input"
              autoComplete="off"
              spellCheck={false}
              placeholder={address ?? "0x…"}
              value={recipient}
              onChange={(e) => setRecipient(e.target.value.trim())}
            />
            <p className="small muted">
              {t(
                "你的钱包支付网络费用，红包仅转给此地址。",
                "Your wallet pays the network fee; only this address receives the packet.",
              )}
            </p>
          </details>
          {dest && (
            <p className="small recipient-preview">
              {t("收款地址", "Recipient")}:{" "}
              <span className="address">{dest}</span>
            </p>
          )}
          <ActionGate>
            <button
              className="primary"
              type="submit"
              disabled={!!activeAction || duplicate || stale}
            >
              {grab.busy
                ? t("领取处理中…", "Grabbing…")
                : duplicate
                  ? t("此地址已领取", "Already grabbed by this recipient")
                  : t("抢红包", "Grab red packet")}
              <Icon name="gift" />
            </button>
          </ActionGate>
          <TxStatus tx={grab} />
        </form>
      )}
      {p.lucky && p.state === 0 && (
        <div className="lifecycle">
          <h2>{t("开红包与结算", "Reveal and settlement")}</h2>
          <p>
            {t(
              "发送者可选择开奖，也可让红包在宽限期后均分。Robinhood Chain 的排序器决定交易顺序。",
              "The sender can choose a lucky reveal or let the packet settle equally after the grace period. Robinhood Chain’s sequencer orders transactions.",
            )}
          </p>
          <p className="small">
            {t("任何人可均分结算的时间", "Anyone can settle equally from")}:{" "}
            <strong>{date(info.settlement)}</strong>
          </p>
          {sameAddress(address, p.creator) && (
            <>
              <p className="small">
                {savedSecret
                  ? t(
                      "已找到此浏览器保存的备份码。",
                      "A reveal backup was found in this browser.",
                    )
                  : t(
                      "此浏览器没有备份码，请从备份恢复。",
                      "No backup in this browser. Restore it from your saved code.",
                    )}
              </p>
              <label htmlFor="reveal-secret">
                {t("恢复备份码（可选）", "Restore backup code (optional)")}
              </label>
              <input
                id="reveal-secret"
                type="password"
                autoComplete="off"
                placeholder={t(
                  "0x 开头的 32 字节备份码",
                  "32-byte backup code starting with 0x",
                )}
                value={secret}
                onChange={(e) => setSecret(e.target.value.trim())}
              />
              <button
                className="primary"
                disabled={!!activeAction || !eligibility.reveal || stale}
                onClick={() =>
                  void reveal.run(
                    async () => {
                      const backup = secret || savedSecret;
                      if (
                        !backup ||
                        !isHex(backup) ||
                        backup.length !== 66 ||
                        keccak256(backup as Hex) !== info.commitment
                      )
                        throw Error("WrongSecret");
                      return {
                        address: r.box.address,
                        abi: r.box.abi,
                        functionName: "reveal",
                        args: [id, backup],
                      };
                    },
                    () => {
                      try {
                        localStorage.removeItem(
                          backupKey(r.chain.id, r.box.address, id.toString()),
                        );
                      } catch {
                        /* optional */
                      }
                      setSavedSecret(undefined);
                      setSecret("");
                    },
                  )
                }
              >
                {reveal.busy
                  ? t("开奖处理中…", "Revealing…")
                  : t("开红包", "Reveal lucky packet")}
              </button>
              {!eligibility.reveal && (
                <p className="small muted">
                  {t(
                    "红包领完或到期后可开奖。",
                    "Reveal becomes available once full or expired.",
                  )}
                </p>
              )}
              <TxStatus tx={reveal} />
            </>
          )}
          <ActionGate>
            <button
              className="secondary"
              disabled={!!activeAction || !eligibility.settle || stale}
              onClick={() =>
                void settle.run(() => ({
                  address: r.box.address,
                  abi: r.box.abi,
                  functionName: "settle",
                  args: [id],
                }))
              }
            >
              {settle.busy
                ? t("结算处理中…", "Settling…")
                : t("均分结算", "Settle equally")}
            </button>
          </ActionGate>
          <TxStatus tx={settle} />
        </div>
      )}
      {!p.lucky && p.state === 0 && !eligibility.grab && (
        <div className="lifecycle">
          <h2>{t("退还未领取的红包", "Return unclaimed IMD")}</h2>
          <p>
            {t(
              "任何人可操作，剩余 IMD 退还原发送者。",
              "Anyone can trigger this; the remaining IMD returns to the sender.",
            )}{" "}
            {fmt(info.remaining)} IMD
          </p>
          <ActionGate>
            <button
              className="primary"
              disabled={!!activeAction || !eligibility.refund || stale}
              onClick={() =>
                void refund.run(() => ({
                  address: r.box.address,
                  abi: r.box.abi,
                  functionName: "refund",
                  args: [id],
                }))
              }
            >
              {refund.busy
                ? t("退款处理中…", "Refunding…")
                : t("退还剩余 IMD", "Refund remaining IMD")}
            </button>
          </ActionGate>
          <TxStatus tx={refund} />
        </div>
      )}
      <div className="results">
        <div className="section-heading">
          <h2>{t("领取记录", "Packet results")}</h2>
          <span className="muted small">
            {p.grabbed.toString()} / {p.slots.toString()}
          </span>
        </div>
        {!info.grabbers[0].length ? (
          <p className="empty-note">
            {t(
              "还没有人领取。把红包分享给朋友吧。",
              "No grabs yet. Share the packet with a friend.",
            )}
          </p>
        ) : (
          <ol className="grabbers">
            {info.grabbers[0].map((a, i) => (
              <li key={a}>
                <div className="grabber-top">
                  <span>
                    {t("第", "#")}
                    {i + 1}
                    {lang === "zh" ? " 份" : ""}
                  </span>
                  <strong>
                    {p.lucky && p.state === 0
                      ? t("待开奖", "Awaiting draw")
                      : `${fmt(info.grabbers[1][i])} IMD`}
                  </strong>
                  {sameAddress(a, info.best) && (
                    <span className="best-luck">
                      <Icon name="crown" size={18} />
                      {t("手气最佳", "Best luck")}
                    </span>
                  )}
                </div>
                <AddressView address={a} />
              </li>
            ))}
          </ol>
        )}
        {(p.state === 3 || p.state === 4) && (
          <p className="notice">
            {t(
              "如果 IMD 拒绝转账，款项会记入待领取余额。请前往资金工具查看。",
              "If IMD refused a transfer, its amount was credited as a deferred payout. Check Funds to claim it.",
            )}{" "}
            <a href="#/funds">
              {t("查看待领取款项", "Check deferred payouts")}
            </a>
          </p>
        )}
        {info.creatorCredit > 0n && (
          <p className="notice">
            {t("发送者待领取款项", "Sender’s deferred balance")}:{" "}
            {fmt(info.creatorCredit)} IMD
          </p>
        )}
      </div>
      <details className="details">
        <summary>
          {t("发送者与链上信息", "Sender and on-chain details")}
        </summary>
        <AddressView address={p.creator} label={t("发送者", "Sender")} />
        <p className="small">
          {t("最近区块", "Latest block")}: {info.blockNumber.toString()} ·{" "}
          {date(info.timestamp)}
        </p>
        <p className="small">
          {t("未付款项", "Unpaid liability")}: {fmt(info.remaining)} IMD
        </p>
        <CopyButton
          value={location.href}
          label={t("复制红包链接", "Copy packet link")}
        />
      </details>
    </section>
  );
}
