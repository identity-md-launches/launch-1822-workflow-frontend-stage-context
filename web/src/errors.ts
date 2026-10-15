import {
  BaseError,
  ContractFunctionRevertedError,
  decodeErrorResult,
  type Hex,
} from "viem";
import { protocolAbi } from "./config";

const messages: Record<string, [string, string]> = {
  InvalidAmount: [
    "请输入大于 0 的金额，最多 18 位小数。",
    "Enter a positive amount with no more than the token’s decimal places.",
  ],
  InvalidSlots: [
    "红包个数应为 1 至 200。",
    "Choose between 1 and 200 packets.",
  ],
  InvalidDuration: [
    "有效期应为 10 分钟至 7 天。",
    "Choose a duration from 10 minutes to 7 days.",
  ],
  AmountTooSmall: [
    "扣除 0.5% 后，每份至少需要 0.01 IMD。",
    "After the 0.5% burn, each slot needs at least 0.01 IMD.",
  ],
  InvalidPassphrase: [
    "请输入口令。口令不会发送到链上。",
    "Enter a passphrase. It stays off-chain.",
  ],
  WrongPassphrase: [
    "口令不匹配，请检查大小写、空格和红包编号。",
    "Passphrase does not match. Check spaces, letter case and the packet ID.",
  ],
  InvalidRecipient: [
    "请输入有效的收款地址，不能是零地址或红包合约。",
    "Enter a valid recipient, other than the zero address or packet contract.",
  ],
  UnknownPacket: [
    "找不到这个红包，请检查编号。",
    "Packet not found. Check the packet ID.",
  ],
  PacketClosed: [
    "红包已结算，请刷新查看结果。",
    "This packet has closed. Refresh to see the result.",
  ],
  PacketExpired: [
    "红包已过期，请查看结算选项。",
    "This packet expired. Check the settlement options.",
  ],
  PacketFull: [
    "红包已领完，请查看结果。",
    "All slots are taken. View the results.",
  ],
  AlreadyGrabbed: [
    "此地址已经领过这个红包。",
    "This recipient has already grabbed this packet.",
  ],
  InvalidSignature: [
    "口令签名无效，请重新输入口令。",
    "The passphrase signature is invalid. Enter the passphrase again.",
  ],
  NotReady: [
    "需等红包领完或到期后才能开红包。",
    "Wait until the packet fills or expires before revealing.",
  ],
  WrongSecret: [
    "备份码不匹配，请使用创建时保存的备份码。",
    "The backup code does not match. Use the code saved when creating this packet.",
  ],
  TooEarly: [
    "还没到结算时间，请查看链上时间。",
    "Settlement is not available yet. Check the on-chain time.",
  ],
  NotCreator: [
    "只有发红包的钱包可以开奖。",
    "Only the creator’s wallet can reveal the packet.",
  ],
  NotRecipient: [
    "只有原收款人可以更改到账地址。",
    "Only the original recipient can redirect a deferred payout.",
  ],
  NothingToClaim: [
    "此地址没有待领取的款项。",
    "There is no deferred payout for this address.",
  ],
  NoSurplus: [
    "没有可回收的额外 IMD。",
    "There is no unassigned IMD to recover.",
  ],
  InexactTransfer: [
    "IMD 转账金额不一致，交易已撤销。",
    "IMD transferred an unexpected amount. The transaction was reverted.",
  ],
  InvalidSlippage: [
    "滑点请输入 0.1% 至 5%，最多两位小数。",
    "Enter slippage from 0.1% to 5%, with up to two decimal places.",
  ],
  InsufficientBalance: [
    "IMD 或代币余额不足，请减少金额。",
    "Insufficient token balance. Reduce the amount.",
  ],
  QuoteExpired: [
    "报价已过期或金额已变更，请重新报价。",
    "The quote expired or the amount changed. Request a new quote.",
  ],
  NoLiquidity: [
    "此池暂无可用流动性，兑换暂不可用。",
    "The pool has no active liquidity. Swapping is unavailable.",
  ],
  BackupRequired: [
    "请先保存备份码并确认。",
    "Save the backup code and confirm before creating.",
  ],
  NetworkChanged: [
    "钱包或网络已变更，请检查后重试。",
    "The wallet or network changed. Check the connection and retry.",
  ],
  VerificationRequired: [
    "链上验证尚未完成，请重试连接。",
    "On-chain verification is incomplete. Retry the connection.",
  ],
  TransactionReplaced: [
    "交易已被替换或取消，请在浏览器核对结果后再操作。",
    "The transaction was replaced or cancelled. Check its result on the explorer before continuing.",
  ],
  ConfirmationPending: [
    "交易已提交，暂时无法确认。请勿重复发送，页面将继续查询状态。",
    "The transaction was submitted, but confirmation is unavailable. Do not resubmit; this page will keep checking.",
  ],
  NotEnoughLiquidity: [
    "此方向没有足够的流动性完成兑换，请减少金额或稍后再试。",
    "Not enough liquidity for this swap direction and amount. Reduce the amount or try again later.",
  ],
  V4TooLittleReceived: [
    "收到的数量低于滑点下限，请刷新报价。",
    "The output is below your slippage limit. Refresh the quote.",
  ],
  TransactionDeadlinePassed: [
    "兑换期限已过，请刷新报价后重试。",
    "The swap deadline passed. Refresh the quote and retry.",
  ],
  AllowanceExpired: [
    "路由授权已过期，请重新授权。",
    "Router permission expired. Approve it again.",
  ],
  InsufficientAllowance: [
    "路由授权额度不足，请重新授权。",
    "Router allowance is too low. Approve it again.",
  ],
  ERC20InsufficientAllowance: [
    "代币授权额度不足，请重新授权本次金额。",
    "The token allowance is too low. Approve this amount again.",
  ],
  ERC20InsufficientBalance: [
    "代币余额不足，请减少金额。",
    "The token balance is too low. Reduce the amount.",
  ],
};
export function nestedErrorName(
  name: string,
  args?: readonly unknown[],
): string {
  const inner =
    name === "UnexpectedRevertBytes"
      ? args?.[0]
      : name === "ExecutionFailed"
        ? args?.[1]
        : undefined;
  if (typeof inner !== "string" || !inner.startsWith("0x")) return name;
  try {
    const decoded = decodeErrorResult({
      abi: protocolAbi.errors,
      data: inner as Hex,
    });
    return decoded.errorName;
  } catch {
    return name;
  }
}
export function explainError(error: unknown, lang: "zh" | "en") {
  const raw = error instanceof Error ? error.message : String(error);
  const reverted =
    error instanceof BaseError
      ? (error.walk(
          (e) => e instanceof ContractFunctionRevertedError,
        ) as ContractFunctionRevertedError)
      : undefined;
  const name = nestedErrorName(
    reverted?.data?.errorName ?? raw,
    reverted?.data?.args,
  );
  if (messages[name]) return messages[name][lang === "zh" ? 0 : 1];
  if (/user rejected|user denied|rejected the request|4001/i.test(raw))
    return lang === "zh"
      ? "已取消钱包请求，可以重试。"
      : "Wallet request cancelled. You can try again.";
  if (/insufficient funds/i.test(raw))
    return lang === "zh"
      ? "ETH 不足以支付网络费用。"
      : "Not enough ETH for the network fee.";
  if (/revert|ExecutionFailed|V4TooLittleReceived|ERC20/i.test(raw))
    return lang === "zh"
      ? `模拟或交易失败${reverted?.data?.errorName ? `（${reverted.data.errorName}）` : ""}。请刷新余额、授权或报价；拼手气红包可等待均分结算。`
      : `Simulation or transaction failed${reverted?.data?.errorName ? ` (${reverted.data.errorName})` : ""}. Refresh balances, approvals or the quote; lucky packets can use equal settlement when ready.`;
  return lang === "zh"
    ? "无法完成请求。请检查网络连接并重试。"
    : "Request failed. Check the network connection and try again.";
}
