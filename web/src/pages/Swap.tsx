import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { type Address } from "viem";
import { useAccountState, useApp, useTransaction } from "../context";
import { protocolAbi } from "../config";
import { amountUnits, fmt, sameAddress } from "../hongbao";
import { minimumOutput, poolId, swapPayload } from "../swap";
import { explainError } from "../errors";
import { ActionGate, AddressView, Icon, TxStatus } from "../components/UI";

export function Swap() {
  const {
    t,
    lang,
    runtime: r,
    client,
    address,
    health,
    activeAction,
  } = useApp();
  const account = useAccountState();
  const pool = r.manifest.poolKey;
  const network = r.manifest.network;
  const [buy, setBuy] = useState(true);
  const [amount, setAmount] = useState("1");
  const [slippage, setSlippage] = useState("0.5");
  const [quote, setQuote] = useState<{
    input: bigint;
    output: bigint;
    fingerprint: string;
    at: number;
  }>();
  const [quoting, setQuoting] = useState(false);
  const [error, setError] = useState("");
  const approval = useTransaction("swap-token-approval");
  const permit = useTransaction("swap-permit2");
  const swap = useTransaction("swap-execute");
  const input: Address = buy ? network.pairToken.address : r.token.address;
  const inputSymbol = buy ? network.pairToken.symbol : "HONGBAO";
  const outputSymbol = buy ? "HONGBAO" : network.pairToken.symbol;
  const inputDecimals = buy
    ? network.pairToken.decimals
    : (account.data?.launchDecimals ?? 18);
  const outputDecimals = buy
    ? (account.data?.launchDecimals ?? 18)
    : network.pairToken.decimals;
  let value = 0n;
  let minimum = 0n;
  try {
    value = amountUnits(amount, inputDecimals);
    minimum = quote ? minimumOutput(quote.output, slippage) : 0n;
  } catch {
    /* show errors on action */
  }
  const fingerprint = JSON.stringify([buy, amount, slippage]);
  const quoteValid =
    quote?.fingerprint === fingerprint && Date.now() - quote.at < 30_000;
  const state = useQuery({
    queryKey: ["pool"],
    enabled: !!health.data?.verified && !health.isError && !!pool,
    queryFn: async () => {
      if (
        !pool ||
        ![pool.currency0, pool.currency1].some((c) =>
          sameAddress(c, r.token.address),
        ) ||
        ![pool.currency0, pool.currency1].some((c) =>
          sameAddress(c, network.pairToken.address),
        )
      )
        throw Error("VerificationRequired");
      const codes = await Promise.all(
        [
          network.uniswapV4.quoter,
          network.uniswapV4.universalRouter,
          network.uniswapV4.permit2,
          network.uniswapV4.stateView,
          network.uniswapV4.poolManager,
          pool.hooks,
        ].map((address) => client.getCode({ address })),
      );
      if (codes.some((c) => !c || c === "0x"))
        throw Error("VerificationRequired");
      const [slot, liquidity] = await Promise.all([
        client.readContract({
          address: network.uniswapV4.stateView,
          abi: protocolAbi.stateView,
          functionName: "getSlot0",
          args: [poolId(pool)],
        }),
        client.readContract({
          address: network.uniswapV4.stateView,
          abi: protocolAbi.stateView,
          functionName: "getLiquidity",
          args: [poolId(pool)],
        }),
      ]);
      return { slot, liquidity };
    },
    refetchInterval: 15_000,
    retry: 1,
  });
  const allowances = useQuery({
    queryKey: ["swap-allowances", address, input],
    enabled: !!address && !!state.data && !state.isError,
    queryFn: async () => {
      if (!address) throw Error("VerificationRequired");
      const [erc20, allowance, block] = await Promise.all([
        client.readContract({
          address: input,
          abi: protocolAbi.erc20,
          functionName: "allowance",
          args: [address, network.uniswapV4.permit2],
        }),
        client.readContract({
          address: network.uniswapV4.permit2,
          abi: protocolAbi.permit2,
          functionName: "allowance",
          args: [address, input, network.uniswapV4.universalRouter],
        }),
        client.getBlock(),
      ]);
      return {
        erc20,
        permit: allowance[0],
        expiration: allowance[1],
        timestamp: block.timestamp,
      };
    },
    refetchInterval: 5000,
    retry: 1,
  });
  const needToken = !allowances.data || allowances.data.erc20 < value;
  const needPermit =
    !allowances.data ||
    allowances.data.permit < value ||
    BigInt(allowances.data.expiration) < allowances.data.timestamp + 60n;
  // A v4 swap may cross empty ticks into a funded range. Active liquidity alone is not a quote gate.
  const poolReady =
    !!pool && !!state.data && state.data.slot[0] > 0n && !state.isError;
  const balance = buy ? account.data?.balance : account.data?.launchBalance;
  async function getQuote() {
    setQuoting(true);
    setError("");
    setQuote(undefined);
    try {
      if (!pool || !poolReady) throw Error("NoLiquidity");
      const exactAmount = amountUnits(amount, inputDecimals);
      minimumOutput(1n, slippage);
      const result = await client.simulateContract({
        address: network.uniswapV4.quoter,
        abi: protocolAbi.quoter,
        functionName: "quoteExactInputSingle",
        args: [
          {
            poolKey: pool,
            zeroForOne: sameAddress(input, pool.currency0),
            exactAmount,
            hookData: "0x",
          },
        ],
        ...(address ? { account: address } : {}),
      });
      if (result.result[0] <= 0n || result.result[0] > 2n ** 128n - 1n)
        throw Error("NoLiquidity");
      setQuote({
        input: exactAmount,
        output: result.result[0],
        fingerprint,
        at: Date.now(),
      });
    } catch (e) {
      setError(explainError(e, lang));
    } finally {
      setQuoting(false);
    }
  }
  async function executeStep() {
    if (!quoteValid) {
      await getQuote();
      return;
    }
    if (needToken) {
      await approval.run(async () => {
        const fresh = await account.refetch();
        if (
          !fresh.data ||
          fresh.isError ||
          (buy
            ? (fresh.data.balance ?? 0n)
            : (fresh.data.launchBalance ?? 0n)) < value
        )
          throw Error("InsufficientBalance");
        return {
          address: input,
          abi: protocolAbi.erc20,
          functionName: "approve",
          args: [network.uniswapV4.permit2, value],
        };
      });
    } else if (needPermit) {
      await permit.run(async () => {
        const block = await client.getBlock();
        return {
          address: network.uniswapV4.permit2,
          abi: protocolAbi.permit2,
          functionName: "approve",
          args: [
            input,
            network.uniswapV4.universalRouter,
            value,
            Number(block.timestamp + 1800n),
          ],
        };
      });
    } else {
      await swap.run(
        async () => {
          if (
            !quote ||
            quote.fingerprint !== fingerprint ||
            Date.now() - quote.at >= 30_000
          )
            throw Error("QuoteExpired");
          if (!pool || !poolReady) throw Error("NoLiquidity");
          const [fresh, balances] = await Promise.all([
            allowances.refetch(),
            account.refetch(),
          ]);
          if (
            !fresh.data ||
            fresh.isError ||
            !balances.data ||
            balances.isError ||
            fresh.data.erc20 < value ||
            fresh.data.permit < value ||
            BigInt(fresh.data.expiration) <= fresh.data.timestamp + 60n
          )
            throw Error("VerificationRequired");
          if (
            (buy
              ? (balances.data.balance ?? 0n)
              : (balances.data.launchBalance ?? 0n)) < value
          )
            throw Error("InsufficientBalance");
          const payload = swapPayload(
            pool,
            input,
            value,
            minimumOutput(quote.output, slippage),
            !!network.uniswapV4.extendedSwapParams,
          );
          return {
            address: network.uniswapV4.universalRouter,
            abi: protocolAbi.router,
            functionName: "execute",
            args: [
              payload.commands,
              payload.inputs,
              fresh.data.timestamp + 300n,
            ],
            value: payload.value,
          };
        },
        () => setQuote(undefined),
      );
    }
  }
  return (
    <section className="panel swap-panel">
      <div className="panel-heading">
        <div>
          <h1>{t("兑换 HONGBAO", "Swap HONGBAO")}</h1>
          <p className="muted">
            {t(
              "通过已部署的 Uniswap v4 交易池兑换。",
              "Trade through the deployed Uniswap v4 pool.",
            )}
          </p>
        </div>
        <Icon name="swap" size={32} />
      </div>
      <p className="notice">
        {t(
          "红包使用 IMD。HONGBAO 是独立代币。",
          "Red packets use IMD. HONGBAO is a separate token.",
        )}
      </p>
      <div className="field">
        <label htmlFor="swap-amount">
          {t("支付", "You pay")} · {inputSymbol}
        </label>
        <div className="unit-input">
          <input
            id="swap-amount"
            inputMode="decimal"
            value={amount}
            onChange={(e) => {
              setAmount(e.target.value);
              setError("");
            }}
          />
          <span>{inputSymbol}</span>
        </div>
        <p className="small muted">
          {t("余额", "Balance")}: {fmt(balance, inputDecimals)} {inputSymbol}
        </p>
      </div>
      <button
        type="button"
        className="direction-button"
        aria-label={t("切换兑换方向", "Reverse swap direction")}
        onClick={() => {
          setBuy(!buy);
          setQuote(undefined);
          setError("");
        }}
        disabled={!!activeAction}
      >
        <Icon name="swap" />
      </button>
      <div className="receive-amount">
        <span className="small">
          {t("预计收到", "Estimated receive")} · {outputSymbol}
        </span>
        <strong>
          {quote?.fingerprint === fingerprint
            ? fmt(quote.output, outputDecimals)
            : "—"}
        </strong>
      </div>
      <div className="field duration-field">
        <label htmlFor="slippage">{t("滑点上限", "Slippage limit")} (%)</label>
        <input
          id="slippage"
          inputMode="decimal"
          value={slippage}
          onChange={(e) => setSlippage(e.target.value)}
        />
      </div>
      {quote?.fingerprint === fingerprint && (
        <dl className="stats-list">
          <div>
            <dt>{t("最低收到", "Minimum received")}</dt>
            <dd>
              {fmt(minimum, outputDecimals)} {outputSymbol}
            </dd>
          </div>
          <div>
            <dt>{t("兑换比率", "Exchange rate")}</dt>
            <dd>
              1 {inputSymbol} ≈{" "}
              {fmt(
                (quote.output * 10n ** BigInt(inputDecimals)) / quote.input,
                outputDecimals,
              )}{" "}
              {outputSymbol}
            </dd>
          </div>
          <div>
            <dt>{t("报价有效期", "Quote validity")}</dt>
            <dd>
              {quoteValid
                ? t("30 秒", "30 seconds")
                : t("已过期，请刷新", "Expired; refresh quote")}
            </dd>
          </div>
        </dl>
      )}
      <p role="alert" className="error">
        {error}
      </p>
      {!poolReady && (
        <p className="notice">
          {state.isError || health.isError
            ? t(
                "无法验证交易池，兑换暂停。",
                "Pool verification failed. Swapping is paused.",
              )
            : t("正在读取交易池…", "Reading the pool…")}
        </p>
      )}
      {poolReady && state.data?.liquidity === 0n && (
        <p className="small muted">
          {t(
            "当前价格区间没有流动性。报价会检查此方向是否可跨区间成交。",
            "The current price range has no liquidity. A quote checks whether this direction can reach a funded range.",
          )}
        </p>
      )}
      <ActionGate>
        <button
          className="primary"
          disabled={
            !!activeAction ||
            quoting ||
            !poolReady ||
            !allowances.data ||
            allowances.isError ||
            account.isError
          }
          onClick={() => void executeStep()}
        >
          {quoting
            ? t("正在报价…", "Quoting…")
            : approval.busy
              ? t("授权处理中…", "Approving token…")
              : permit.busy
                ? t("授权路由处理中…", "Approving router…")
                : swap.busy
                  ? t("兑换处理中…", "Swapping…")
                  : !quoteValid
                    ? t("获取报价", "Get quote")
                    : needToken
                      ? t(
                          `授权 ${inputSymbol} 给 Permit2 · 1/3`,
                          `Approve ${inputSymbol} to Permit2 · 1/3`,
                        )
                      : needPermit
                        ? t(
                            "授权路由使用代币 · 2/3",
                            "Approve router spending · 2/3",
                          )
                        : t("确认兑换 · 3/3", "Confirm swap · 3/3")}
          <Icon name="arrow" />
        </button>
      </ActionGate>
      {quote && (
        <button
          className="text-button"
          disabled={quoting || !!activeAction || !poolReady}
          onClick={() => void getQuote()}
        >
          {t("刷新报价", "Refresh quote")}
        </button>
      )}
      <TxStatus tx={approval} />
      <TxStatus tx={permit} />
      <TxStatus tx={swap} />
      <p className="small muted">
        {t(
          "仅授权本次金额。路由授权 30 分钟后失效。成交前先模拟，交易期限 5 分钟，ETH 仅支付网络费用。没有可用的美元价格来源。",
          "Approve only this amount. Router permission expires in 30 minutes. Swaps are simulated first, with a 5-minute deadline. ETH covers network fees only. USD pricing is unavailable.",
        )}
      </p>
      <details className="details">
        <summary>{t("交易池与授权信息", "Pool and approval details")}</summary>
        <dl className="stats-list">
          <div>
            <dt>{t("池手续费", "Pool fee")}</dt>
            <dd>{pool ? pool.fee / 10000 : "…"}%</dd>
          </div>
          <div>
            <dt>{t("当前活跃流动性", "Active liquidity (raw)")}</dt>
            <dd>{state.data?.liquidity.toString() ?? "…"}</dd>
          </div>
          <div>
            <dt>{t("Permit2 授权额度", "Token allowance to Permit2")}</dt>
            <dd>
              {fmt(allowances.data?.erc20, inputDecimals)} {inputSymbol}
            </dd>
          </div>
          <div>
            <dt>{t("路由授权额度", "Router allowance")}</dt>
            <dd>
              {fmt(allowances.data?.permit, inputDecimals)} {inputSymbol}
            </dd>
          </div>
        </dl>
        <AddressView
          address={network.uniswapV4.universalRouter}
          label="Universal Router"
        />
        <AddressView address={network.uniswapV4.permit2} label="Permit2" />
        <AddressView
          address={network.uniswapV4.quoter}
          label={t("报价合约", "Quoter")}
        />
        <AddressView
          address={network.uniswapV4.poolManager}
          label="Pool Manager"
        />
        <AddressView address={network.uniswapV4.stateView} label="State View" />
        <AddressView
          address={network.uniswapV4.positionManager}
          label="Position Manager"
        />
        {pool && (
          <AddressView
            address={pool.hooks}
            label={t("池初始化钩子", "Pool initialization hook")}
          />
        )}
      </details>
    </section>
  );
}
