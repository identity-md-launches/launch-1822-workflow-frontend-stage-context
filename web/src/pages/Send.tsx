import { useRef, useState, type FormEvent } from "react";
import { decodeEventLog, keccak256, type Address, type Hex } from "viem";
import { useAccountState, useApp, useTransaction } from "../context";
import { protocolAbi } from "../config";
import {
  amountUnits,
  backupKey,
  fmt,
  passphraseAccount,
  randomSecret,
  suggestPassphrase,
  ZERO_BYTES32,
} from "../hongbao";
import { explainError } from "../errors";
import { ActionGate, CopyButton, Icon, TxStatus } from "../components/UI";

export function Send() {
  const { t, lang, runtime: r, address, activeAction } = useApp();
  const account = useAccountState();
  const [amount, setAmount] = useState("10");
  const [slots, setSlots] = useState("5");
  const [lucky, setLucky] = useState(true);
  const [passphrase, setPassphrase] = useState(suggestPassphrase);
  const [duration, setDuration] = useState("86400");
  const [validation, setValidation] = useState("");
  const [invalidField, setInvalidField] = useState("");
  const [draft, setDraft] = useState<{
    salt: Hex;
    secret: Hex;
    keyAddress: Address;
    snapshot: string;
    storageOK: boolean;
  }>();
  const [backedUp, setBackedUp] = useState(false);
  const [created, setCreated] = useState<{ id: string; phrase: string }>();
  const approval = useTransaction("packet-approval");
  const create = useTransaction("packet-create");
  const backupPanel = useRef<HTMLDivElement>(null);
  let gross = 0n;
  try {
    gross = amountUnits(amount);
  } catch {
    /* validated on submit */
  }
  const burn = gross / 200n;
  const net = gross - burn;
  const needsApproval =
    account.data?.allowance === undefined || account.data.allowance < gross;
  const snapshot = JSON.stringify([
    amount,
    slots,
    lucky,
    passphrase,
    duration,
    address,
  ]);
  const weak =
    Array.from(passphrase).length < 8 ||
    /^(恭喜发财|红包|hongbao|password|123456|发财)$/i.test(passphrase);
  function validate() {
    const value = amountUnits(amount);
    if (!/^\d+$/.test(slots) || Number(slots) < 1 || Number(slots) > 200)
      throw Error("InvalidSlots");
    if (value - value / 200n < BigInt(slots) * 10n ** 16n)
      throw Error("AmountTooSmall");
    if (Number(duration) < 600 || Number(duration) > 604800)
      throw Error("InvalidDuration");
    if (!passphrase) throw Error("InvalidPassphrase");
    return value;
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    setValidation("");
    setInvalidField("");
    let value: bigint;
    try {
      value = validate();
    } catch (e) {
      const field = /InvalidPassphrase/.test(String(e))
        ? "passphrase"
        : /InvalidSlots/.test(String(e))
          ? "slots"
          : /InvalidDuration/.test(String(e))
            ? "duration"
            : "amount";
      setValidation(explainError(e, lang));
      setInvalidField(field);
      document.getElementById(field)?.focus();
      return;
    }
    if (needsApproval) {
      await approval.run(async () => {
        const fresh = await account.refetch();
        if (!fresh.data || fresh.isError || (fresh.data.balance ?? 0n) < value)
          throw Error("InsufficientBalance");
        return {
          address: r.manifest.network.pairToken.address,
          abi: protocolAbi.erc20,
          functionName: "approve",
          args: [r.box.address, value],
        };
      });
      return;
    }
    let prepared = draft;
    if (!prepared || prepared.snapshot !== snapshot) {
      const salt = randomSecret();
      const secret = randomSecret();
      const keyAddress = passphraseAccount(
        r.chain.id,
        r.box.address,
        salt,
        passphrase,
      ).address;
      let storageOK = true;
      if (lucky) {
        try {
          localStorage.setItem(
            backupKey(
              r.chain.id,
              r.box.address,
              `pending:${keccak256(secret)}`,
            ),
            secret,
          );
        } catch {
          storageOK = false;
        }
      }
      prepared = { salt, secret, keyAddress, snapshot, storageOK };
      setDraft(prepared);
      setBackedUp(false);
      if (lucky) {
        requestAnimationFrame(() =>
          backupPanel.current?.scrollIntoView({
            behavior: "instant",
            block: "center",
          }),
        );
        return;
      }
    }
    if (lucky && !backedUp) {
      setValidation(explainError(Error("BackupRequired"), lang));
      return;
    }
    const final = prepared;
    await create.run(
      async () => {
        const fresh = await account.refetch();
        if (!fresh.data || fresh.isError || (fresh.data.balance ?? 0n) < value)
          throw Error("InsufficientBalance");
        if ((fresh.data.allowance ?? 0n) < value)
          throw Error("VerificationRequired");
        return {
          address: r.box.address,
          abi: r.box.abi,
          functionName: "create",
          args: [
            value,
            BigInt(slots),
            lucky,
            final.keyAddress,
            final.salt,
            BigInt(duration),
            lucky ? keccak256(final.secret) : ZERO_BYTES32,
          ],
        };
      },
      async (receipt) => {
        for (const log of receipt.logs) {
          if (log.address.toLowerCase() !== r.box.address.toLowerCase())
            continue;
          try {
            const decoded = decodeEventLog({
              abi: r.box.abi,
              eventName: "PacketCreated",
              data: log.data,
              topics: log.topics,
            });
            const id = (
              decoded.args as unknown as { id: bigint }
            ).id.toString();
            if (lucky) {
              try {
                localStorage.setItem(
                  backupKey(r.chain.id, r.box.address, id),
                  final.secret,
                );
                localStorage.removeItem(
                  backupKey(
                    r.chain.id,
                    r.box.address,
                    `pending:${keccak256(final.secret)}`,
                  ),
                );
              } catch {
                /* backup was acknowledged */
              }
            }
            setCreated({ id, phrase: passphrase });
            setDraft(undefined);
            return;
          } catch {
            /* other event */
          }
        }
        // The transaction remains successful even if a provider omits receipt logs. Recover from the explorer.
        setValidation(
          t(
            "交易已确认，但节点未返回红包编号。请在交易浏览器中查看 PacketCreated 事件。",
            "Confirmed, but the node did not return the packet ID. Check the PacketCreated event on the explorer.",
          ),
        );
      },
    );
  }
  if (created) {
    const shareLink = new URL(location.href);
    shareLink.hash = `/p/${created.id}`;
    const message = t(
      `送你一个 IMD 红包！\n${shareLink.href}\n口令：${created.phrase}`,
      `An IMD red packet for you!\n${shareLink.href}\nPassphrase: ${created.phrase}`,
    );
    return (
      <section className="panel success-panel">
        <div className="success-mark">
          <Icon name="check" size={32} />
        </div>
        <h1>{t("红包已发出", "Your packet is ready")}</h1>
        <p>
          {t(
            "把这份好运分享给朋友。",
            "Share a little good fortune with a friend.",
          )}
        </p>
        <label htmlFor="share-message">{t("分享消息", "Share message")}</label>
        <textarea id="share-message" readOnly rows={5} value={message} />
        <CopyButton
          value={message}
          label={t("复制消息和口令", "Copy message and passphrase")}
        />
        <a className="primary" href={`#/p/${created.id}`}>
          {t("查看红包", "View packet")} #{created.id}
          <Icon name="arrow" />
        </a>
        <p className="small muted">
          {t(
            "链接不包含口令。请只分享给信任的人，备份码不要分享。",
            "The link contains no passphrase. Share only with people you trust. Keep the reveal backup private.",
          )}
        </p>
        <TxStatus tx={create} />
        <button
          className="text-button"
          onClick={() => {
            setCreated(undefined);
            setBackedUp(false);
            setPassphrase(suggestPassphrase());
          }}
        >
          {t("再发一个", "Send another")}
        </button>
      </section>
    );
  }
  return (
    <section className="panel send-panel">
      <div className="panel-heading">
        <div>
          <h1>{t("发一份好运", "Send a little luck")}</h1>
          <p className="muted">
            {t(
              "用 IMD，把心意装进红包。",
              "Send an on-chain red packet with IMD.",
            )}
          </p>
        </div>
        <span className="heading-symbol" aria-hidden="true">
          <Icon name="packet" size={36} />
        </span>
      </div>
      <form onSubmit={(e) => void submit(e)} noValidate>
        <fieldset className="mode-switch">
          <legend className="sr-only">{t("红包类型", "Packet type")}</legend>
          <label className={lucky ? "selected" : ""}>
            <input
              type="radio"
              name="mode"
              checked={lucky}
              onChange={() => setLucky(true)}
            />
            <Icon name="gift" size={18} />
            {t("拼手气", "Lucky draw")}
          </label>
          <label className={!lucky ? "selected" : ""}>
            <input
              type="radio"
              name="mode"
              checked={!lucky}
              onChange={() => setLucky(false)}
            />
            <Icon name="packet" size={18} />
            {t("普通红包", "Equal split")}
          </label>
        </fieldset>
        <div className="form-pair">
          <div className="field">
            <label htmlFor="amount">{t("总金额", "Total amount")}</label>
            <div className="unit-input">
              <input
                id="amount"
                name="amount"
                inputMode="decimal"
                autoComplete="off"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                aria-invalid={invalidField === "amount"}
                aria-describedby="amount-help form-error"
              />
              <span>IMD</span>
            </div>
          </div>
          <div className="field">
            <label htmlFor="slots">{t("红包个数", "Number of slots")}</label>
            <input
              id="slots"
              name="slots"
              inputMode="numeric"
              autoComplete="off"
              value={slots}
              onChange={(e) => setSlots(e.target.value)}
              aria-invalid={invalidField === "slots"}
              aria-describedby="amount-help form-error"
            />
          </div>
        </div>
        <div className="form-meta" id="amount-help">
          <span>{t("每份至少 0.01 IMD", "At least 0.01 IMD per slot")}</span>
          <span>
            {t("余额", "Balance")}{" "}
            {account.data?.balance === undefined
              ? t("连接后显示", "Connect to view")
              : `${fmt(account.data.balance)} IMD`}
          </span>
        </div>
        <div className="field">
          <div className="label-row">
            <label htmlFor="passphrase">{t("红包口令", "Passphrase")}</label>
            <button
              type="button"
              className="text-button"
              onClick={() => setPassphrase(suggestPassphrase())}
            >
              {t("换一个", "Generate")}
            </button>
          </div>
          <input
            id="passphrase"
            name="passphrase"
            value={passphrase}
            onChange={(e) => setPassphrase(e.target.value)}
            autoComplete="off"
            spellCheck={false}
            aria-invalid={invalidField === "passphrase"}
            aria-describedby="phrase-hint form-error"
          />
          <p id="phrase-hint" className={`small ${weak ? "warning" : "muted"}`}>
            {weak
              ? t(
                  "口令较弱，建议至少 8 个字符并添加随机字符。",
                  "Weak passphrase. Use at least 8 characters and add random characters.",
                )
              : t(
                  "口令不上链。请只分享给信任的人。",
                  "The passphrase stays off-chain. Share it privately.",
                )}
          </p>
        </div>
        <div className="field duration-field">
          <label htmlFor="duration">{t("有效期", "Expires after")}</label>
          <select
            id="duration"
            value={duration}
            onChange={(e) => setDuration(e.target.value)}
          >
            <option value="600">{t("10 分钟", "10 minutes")}</option>
            <option value="3600">{t("1 小时", "1 hour")}</option>
            <option value="86400">{t("24 小时", "24 hours")}</option>
            <option value="259200">{t("3 天", "3 days")}</option>
            <option value="604800">{t("7 天", "7 days")}</option>
          </select>
        </div>
        <div className="amount-summary">
          <span>
            {t("装入红包", "In the packet")}
            <strong>{fmt(net)} IMD</strong>
          </span>
          <span>
            {t("销毁 0.5%", "0.5% burn")}
            <span>{fmt(burn)} IMD</span>
          </span>
        </div>
        {draft?.snapshot === snapshot && lucky && (
          <div ref={backupPanel} className="backup-panel">
            <h2>{t("保存开奖备份码", "Save your reveal backup")}</h2>
            <p className="small">
              {t(
                "此码仅显示一次，和口令不同。只有你能用它开奖。",
                "This code is shown once. It is different from the passphrase. Keep it private to reveal the draw.",
              )}
            </p>
            <code className="backup-code">{draft.secret}</code>
            <CopyButton value={draft.secret} />
            <p className="small">
              {draft.storageOK
                ? t(
                    "已保存在此浏览器。清除浏览器数据会丢失，请另存备份。",
                    "Saved in this browser. Clearing browser data removes it; keep a separate backup.",
                  )
                : t(
                    "此浏览器无法保存，请务必手动备份。",
                    "Browser storage is unavailable. Save this code yourself before continuing.",
                  )}
            </p>
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={backedUp}
                onChange={(e) => setBackedUp(e.target.checked)}
              />
              {t("我已安全保存备份码", "I saved my backup code")}
            </label>
          </div>
        )}
        <p id="form-error" role="alert" className="error">
          {validation}
        </p>
        <ActionGate>
          <button
            type="submit"
            className="primary"
            disabled={
              !!activeAction ||
              !account.data ||
              account.isError ||
              (draft?.snapshot === snapshot && lucky && !backedUp)
            }
          >
            <Icon name="packet" />
            {approval.busy
              ? t("授权处理中…", "Approving…")
              : create.busy
                ? t("发送处理中…", "Sending…")
                : needsApproval
                  ? t("授权 IMD · 第 1 步", "Approve IMD · step 1")
                  : draft?.snapshot === snapshot || !lucky
                    ? t("确认发红包", "Confirm and send packet")
                    : t("准备发红包 · 第 2 步", "Prepare packet · step 2")}
            <Icon name="arrow" />
          </button>
          <p className="small muted gate-note">
            {t(
              "先授权本次金额，再确认创建。另需 ETH 支付网络费用。",
              "Approve this amount, then confirm creation. ETH is needed for network fees.",
            )}
          </p>
        </ActionGate>
        <TxStatus tx={approval} />
        <TxStatus tx={create} />
      </form>
      <details className="details">
        <summary>{t("发出前，了解红包规则", "Before you send")}</summary>
        <p>
          {lucky
            ? t(
                "拼手气红包先登记收款人，领完或到期后由发送者开奖。发送者可以选择开奖或等待 24 小时后由任何人均分结算。Robinhood Chain 的排序器决定交易顺序。",
                "Lucky packets record recipients first. The sender reveals after filling or expiry, or can choose to wait for equal settlement after 24 hours. Robinhood Chain’s sequencer orders transactions.",
              )
            : t(
                "普通红包即时等分到账，最后一份包含舍入余数。过期后，任何人可触发退还未领取部分给发送者。",
                "Equal packets pay immediately. The last slot receives rounding dust. After expiry, anyone can return unclaimed IMD to the sender.",
              )}
        </p>
        <p>
          {t(
            "持有口令的人可用多个地址领取。公开的盐和密钥地址允许离线猜测弱口令。建议增加随机字符。没有可用的美元价格来源，金额仅以代币显示。",
            "Anyone with the passphrase can use multiple recipient addresses. The public salt and key address allow offline guessing of weak passphrases. Add random characters. No USD price source is available; amounts are shown in tokens.",
          )}
        </p>
      </details>
    </section>
  );
}
