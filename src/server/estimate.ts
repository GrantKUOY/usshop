// 到手成本試算（DEV_SPEC 第 7.2 節）。純函式、無 I/O，結果連同參數快照存入 Estimate。
export const FORMULA_VERSION = 'v1-item';
export const DISCLAIMER = '以海關實際認定為準';

export type CategoryWeight = { key: string; min_lb: number; max_lb: number; approved: boolean };

export type EstimateParams = {
  fx_rate: number | null; // 美金試算匯率（Grant 手填）；未設定 → 待查核
  fx_buffer: number; // 預設 0.01
  shipping_rate_per_lb: number; // 預設 170
  tax_threshold: number; // 2000（CIF）
  warn_line: number; // 1800
  band: [number, number]; // [1800, 2200]
  vat_rate: number; // 0.05
  tariff_rate_high: number | null; // 關稅率上界；不寫死，未設定則稅額上界標待確認
  category_weights: CategoryWeight[];
};

export type EstimateInput = {
  quantity: number;
  unit_price: number;
  currency: string;
  domestic_shipping: number | null; // 外幣；未知 = null（不當 0）
  weight_lb: number | null;
  weight_source: 'merchant' | 'measured' | 'category_assumption' | 'none';
  category_key?: string | null;
};

export type Range = { low: number; high: number };
export type EstimateOutput = {
  kind: 'point' | 'range' | 'pending_check';
  result: {
    goods_twd: number | null;
    domestic_shipping_twd: number | null;
    shipping_twd: Range | null;
    cif_twd: Range | null;
    level: 'green' | 'yellow' | 'red' | null;
    total_twd: { low: number; high: number | null } | null;
    known_subtotal_twd: number | null;
    unknowns: string[];
    notes: string[];
    weight_basis: string;
    disclaimer: string;
  };
  scenarios: null | {
    exempt: { total_twd: Range } | null;
    taxable: { vat_twd: Range; duty_twd: { low: number; high: number | null }; total_twd: { low: number; high: number | null } } | null;
  };
};

const round = (n: number) => Math.round(n);
/** 單件重量記錄精度：0.1 磅進位，最低 0.2 磅（僅供記錄與分攤權重） */
export const recordWeight = (lb: number) => Math.max(0.2, Math.ceil(lb * 10 - 1e-9) / 10);
/** 貨件計費重量：總重無條件進位至整磅，最低 1 磅（貨件階段使用） */
export const shipmentBilledWeight = (totalLb: number) => Math.max(1, Math.ceil(totalLb - 1e-9));

/** 金額守恆分攤：按權重比例，尾差調整至金額最大者，加總恆等於 total（整數） */
export function allocateConserving(total: number, weights: number[]): number[] {
  const sum = weights.reduce((a, b) => a + b, 0);
  if (!weights.length || sum <= 0) return weights.map(() => 0);
  const parts = weights.map((w) => Math.floor((total * w) / sum));
  const diff = total - parts.reduce((a, b) => a + b, 0);
  parts[parts.indexOf(Math.max(...parts))] += diff;
  return parts;
}

export function computeEstimate(input: EstimateInput, p: EstimateParams): EstimateOutput {
  const unknowns: string[] = [];
  const notes: string[] = ['境內運費、國際運費、稅費為估算，非精確值', `稅費判斷${DISCLAIMER}`];

  const pending = (goods: number | null, weightBasis: string): EstimateOutput => ({
    kind: 'pending_check',
    result: {
      goods_twd: goods,
      domestic_shipping_twd: null,
      shipping_twd: null,
      cif_twd: null,
      level: null,
      total_twd: null,
      known_subtotal_twd: goods,
      unknowns,
      notes,
      weight_basis: weightBasis,
      disclaimer: DISCLAIMER,
    },
    scenarios: null,
  });

  // 匯率：只支援 USD（其他幣別需另設匯率，待確認）
  let rate: number | null = null;
  if (input.currency !== 'USD') unknowns.push(`幣別 ${input.currency} 無試算匯率`);
  else if (!p.fx_rate) unknowns.push('試算匯率尚未設定');
  else rate = p.fx_rate * (1 + p.fx_buffer);
  const goods = rate === null ? null : round(input.quantity * input.unit_price * rate);

  // 重量三層
  let wLow: number | null = null;
  let wHigh: number | null = null;
  let basis = '無重量資訊';
  if (input.weight_source === 'merchant' || input.weight_source === 'measured') {
    if (input.weight_lb && input.weight_lb > 0) {
      wLow = wHigh = recordWeight(input.weight_lb);
      basis = input.weight_source === 'merchant' ? '商家標示重量' : '實測重量';
    }
  } else if (input.weight_source === 'category_assumption') {
    const cw = p.category_weights.find((c) => c.key === input.category_key && c.approved);
    if (cw) {
      wLow = recordWeight(cw.min_lb);
      wHigh = recordWeight(cw.max_lb);
      basis = '類別假設重量，非本商品實測';
      notes.push('以類別假設重量估算；最終採購確認前應換成實際重量並重算');
    } else unknowns.push('類別假設重量尚無 Grant 核可紀錄');
  }
  if (wLow === null) {
    if (!unknowns.some((u) => u.startsWith('類別'))) unknowns.push('重量未知');
    return pending(goods, basis);
  }
  if (goods === null || rate === null) return pending(goods, basis);

  const fxRate = rate;
  const domestic = input.domestic_shipping === null ? null : round(input.domestic_shipping * fxRate);
  if (domestic === null) {
    unknowns.push('境內運費未提供（未計入）');
  }
  const ship: Range = {
    low: round(wLow * input.quantity * p.shipping_rate_per_lb),
    high: round(wHigh! * input.quantity * p.shipping_rate_per_lb),
  };
  notes.push('代運費以單件重量×單價估算；貨件階段依總重整磅進位重算');
  const base = goods + (domestic ?? 0);
  const cif: Range = { low: base + ship.low, high: base + ship.high };
  const level = cif.high > p.tax_threshold ? 'red' : cif.high > p.warn_line ? 'yellow' : 'green';

  const dual = cif.low <= p.band[1] && cif.high >= p.band[0];
  const taxableOnly = !dual && cif.low > p.band[1];
  const exempt = taxableOnly ? null : { total_twd: cif };
  let taxable: NonNullable<EstimateOutput['scenarios']>['taxable'] = null;
  if (dual || taxableOnly) {
    // 關稅率不寫死：下界只含營業稅（關稅以 0 計為下界事實），上界需 Grant 設定關稅率上界
    const vat = (c: number, duty: number) => round((c + duty) * p.vat_rate);
    const dutyHigh = p.tariff_rate_high === null ? null : round(cif.high * p.tariff_rate_high);
    const vatHigh = dutyHigh === null ? null : vat(cif.high, dutyHigh);
    taxable = {
      vat_twd: { low: vat(cif.low, 0), high: vatHigh ?? vat(cif.high, 0) },
      duty_twd: { low: 0, high: dutyHigh },
      total_twd: {
        low: cif.low + vat(cif.low, 0),
        high: dutyHigh === null || vatHigh === null ? null : cif.high + dutyHigh + vatHigh,
      },
    };
    if (p.tariff_rate_high === null) {
      unknowns.push('關稅率未設定：課稅情境僅含營業稅下限，稅額上界待確認');
    }
  }

  const lows = [exempt?.total_twd.low, taxable?.total_twd.low].filter((x): x is number => x !== undefined);
  const high = taxable ? taxable.total_twd.high : cif.high;
  const total = { low: Math.min(...lows), high };

  return {
    // 三態只反映重量層級；稅費雙情境另見 scenarios
    kind: wLow === wHigh ? 'point' : 'range',
    result: {
      goods_twd: goods,
      domestic_shipping_twd: domestic,
      shipping_twd: ship,
      cif_twd: cif,
      level,
      total_twd: total,
      known_subtotal_twd: goods,
      unknowns,
      notes: dual ? [...notes, '完稅價格落在免稅門檻帶寬內，並列「符合免稅條件」與「可能課稅」兩種情境'] : notes,
      weight_basis: basis,
      disclaimer: DISCLAIMER,
    },
    scenarios: dual || taxableOnly ? { exempt, taxable } : null,
  };
}
