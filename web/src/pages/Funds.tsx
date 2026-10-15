import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { isAddress, type Address } from "viem";
import { useAccountState, useApp, useTransaction } from "../context";
import { amountUnits, fmt, sameAddress, validRecipient } from "../hongbao";
import { ActionGate, AddressView, TxStatus } from "../components/UI";

export function Funds() {
  const { t, runtime: r, address, client, health, activeAction } = useApp();
  const account = useAccountState();
  const [recipient, setRecipient] = useState("");
  const [to, setTo] = useState("");
  const [tokenTo, setTokenTo] = useState("");
  const [amount, setAmount] = useState("");
  const dest = (recipient || address || "") as Address;
  const destination = (to || dest) as Address;
  const credit = useQuery({
    queryKey: ["credit", dest],
    enabled: !!health.data?.verified && !health.isError && isAddress(dest),
    queryFn: async () =>
      (await client.readContract({
        address: r.box.address,
        abi: r.box.abi,
        functionName: "claimable",
        args: [dest],
      })) as bigint,
    refetchInterval: 5000,
  });
  const claim = useTransaction("claim");
  const recover = useTransaction("surplus");
  const transfer = useTransaction("transfer");
  const surplus = account.data
    ? account.data.boxBalance - account.data.escrow
    : undefined;
  const canRedirect =
    sameAddress(dest, address) || sameAddress(dest, destination);
  return (
    <section className="panel">
      <div className="panel-heading">
        <div>
          <h1>{t("取回你的 IMD", "Recover your IMD")}</h1>
          <p className="muted">
            {t(
              "领取暂存款项，查看合约资金。",
              "Claim deferred payouts and inspect contract funds.",
            )}
          </p>
        </div>
      </div>
      <h2>{t("待领取款项", "Deferred payouts")}</h2>
      <p className="small muted">
        {t(
          "均分结算或退款时，如 IMD 拒绝转账，款项会在这里保留。只有原收款人可以改收款地址。",
          "If IMD refused a settlement or refund transfer, the payout stays here. Only its recipient can redirect it.",
        )}
      </p>
      <div className="field">
        <label htmlFor="credit-recipient">
          {t(
            "原收款地址（默认当前钱包）",
            "Original recipient (defaults to your wallet)",
          )}
        </label>
        <input
          id="credit-recipient"
          spellCheck={false}
          autoComplete="off"
          placeholder={address ?? "0x…"}
          value={recipient}
          onChange={(e) => setRecipient(e.target.value.trim())}
        />
      </div>
      <div className="balance-line">
        <span>{t("可领取", "Available to claim")}</span>
        <strong>{fmt(credit.isError ? undefined : credit.data)} IMD</strong>
      </div>
      <div className="field">
        <label htmlFor="credit-to">
          {t(
            "到账地址（默认原收款地址）",
            "Destination (defaults to original recipient)",
          )}
        </label>
        <input
          id="credit-to"
          spellCheck={false}
          autoComplete="off"
          placeholder={dest || "0x…"}
          value={to}
          onChange={(e) => setTo(e.target.value.trim())}
        />
      </div>
      {!canRedirect && (
        <p className="error">
          {t(
            "请连接原收款人的钱包以更改到账地址。",
            "Connect the original recipient’s wallet to change the destination.",
          )}
        </p>
      )}
      <ActionGate>
        <button
          className="primary"
          disabled={
            !!activeAction || !credit.data || credit.isError || !canRedirect
          }
          onClick={() =>
            void claim.run(() => {
              if (
                !validRecipient(dest, r.box.address) ||
                !validRecipient(destination, r.box.address)
              )
                throw Error("InvalidRecipient");
              return {
                address: r.box.address,
                abi: r.box.abi,
                functionName: "claim",
                args: [dest, destination],
              };
            })
          }
        >
          {claim.busy
            ? t("领取处理中…", "Claiming…")
            : t("领取暂存 IMD", "Claim deferred IMD")}
        </button>
      </ActionGate>
      <TxStatus tx={claim} />
      <div className="lifecycle">
        <h2>{t("合约资金", "Contract funds")}</h2>
        <dl className="stats-list">
          <div>
            <dt>{t("红包与待领取款项", "Packet and deferred liabilities")}</dt>
            <dd>{fmt(account.data?.escrow)} IMD</dd>
          </div>
          <div>
            <dt>{t("合约 IMD 余额", "Contract IMD balance")}</dt>
            <dd>{fmt(account.data?.boxBalance)} IMD</dd>
          </div>
          <div>
            <dt>{t("额外转入", "Unassigned surplus")}</dt>
            <dd>{fmt(surplus)} IMD</dd>
          </div>
        </dl>
        <p className="small muted">
          {t(
            "请勿直接转账至合约。额外转入的 IMD 不属于红包，可被任何人回收给自己。红包和暂存款项不受影响。",
            "Do not send IMD directly to the contract. Unassigned IMD belongs to no packet and anyone can recover it to their own wallet. Packet and deferred balances remain protected.",
          )}
        </p>
        <ActionGate>
          <button
            className="secondary"
            disabled={
              !!activeAction ||
              surplus === undefined ||
              surplus <= 0n ||
              account.isError
            }
            onClick={() =>
              void recover.run(() => ({
                address: r.box.address,
                abi: r.box.abi,
                functionName: "recoverSurplus",
              }))
            }
          >
            {recover.busy
              ? t("回收处理中…", "Recovering…")
              : t("回收额外 IMD 到当前钱包", "Recover surplus to this wallet")}
          </button>
        </ActionGate>
        <TxStatus tx={recover} />
      </div>
      <details className="details">
        <summary>{t("转账 HONGBAO 代币", "Transfer HONGBAO tokens")}</summary>
        <p className="small muted">
          {t(
            "HONGBAO 是独立的代币，不能用于创建 IMD 红包。转账不可撤销，请核对完整地址。",
            "HONGBAO is a separate token and cannot fund IMD packets. Transfers are final; verify the complete recipient address.",
          )}
        </p>
        <p>
          {t("余额", "Balance")}:{" "}
          {fmt(account.data?.launchBalance, account.data?.launchDecimals ?? 18)}{" "}
          HONGBAO
        </p>
        <label htmlFor="token-to">{t("收款地址", "Recipient address")}</label>
        <input
          id="token-to"
          value={tokenTo}
          spellCheck={false}
          onChange={(e) => setTokenTo(e.target.value.trim())}
        />
        <label htmlFor="token-amount">{t("金额", "Amount")} · HONGBAO</label>
        <input
          id="token-amount"
          inputMode="decimal"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />
        <ActionGate>
          <button
            className="secondary"
            disabled={!!activeAction || !account.data || account.isError}
            onClick={() =>
              void transfer.run(() => {
                if (!validRecipient(tokenTo, r.box.address))
                  throw Error("InvalidRecipient");
                const value = amountUnits(amount, account.data?.launchDecimals);
                if ((account.data?.launchBalance ?? 0n) < value)
                  throw Error("InsufficientBalance");
                return {
                  address: r.token.address,
                  abi: r.token.abi,
                  functionName: "transfer",
                  args: [tokenTo as Address, value],
                };
              })
            }
          >
            {transfer.busy
              ? t("转账处理中…", "Transferring…")
              : t("确认转账 HONGBAO", "Confirm HONGBAO transfer")}
          </button>
        </ActionGate>
        <TxStatus tx={transfer} />
        <AddressView address={r.token.address} label="HONGBAO" />
      </details>
    </section>
  );
}
