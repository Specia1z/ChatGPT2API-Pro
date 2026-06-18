// 根据后台支付网关配置动态决定价格显示单位。
// 仅当「只有 LDC 积分支付可用」时切换为积分单位；否则默认人民币。

export type CurrencyInfo = {
  symbol: string;     // "¥" 或 ""
  unit: string;       // "元" 或 "积分"
  suffix: string;     // "/月" 或 " 积分/月"
  rate: number;       // 价格乘数：人民币场景=1，纯积分场景=credit rate
  isCredit: boolean;  // 是否为纯积分模式
};

export function getCurrencyInfo(settings: any): CurrencyInfo {
  const alipayEnabled = !!settings?.alipay_enabled;
  let creditEnabled = false;
  let creditRate = 1;
  try {
    const cc = JSON.parse(settings?.credit_config || "{}");
    creditEnabled = !!cc?.enabled;
    if (cc?.rate > 0) creditRate = cc.rate;
  } catch {}

  if (creditEnabled && !alipayEnabled) {
    return { symbol: "", unit: "积分", suffix: " 积分/月", rate: creditRate, isCredit: true };
  }
  return { symbol: "¥", unit: "元", suffix: "/月", rate: 1, isCredit: false };
}

export function formatPrice(amount: number, currency: CurrencyInfo): string {
  const val = amount * currency.rate;
  if (currency.isCredit) {
    return `${Math.round(val)} 积分`;
  }
  return `¥${val % 1 === 0 ? val : val.toFixed(2)}`;
}
