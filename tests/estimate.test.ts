import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  allocateConserving, computeEstimate, DISCLAIMER, recordWeight, shipmentBilledWeight,
  type EstimateInput, type EstimateParams,
} from '../src/server/estimate';

const params: EstimateParams = {
  fx_rate: 30, fx_buffer: 0.01, shipping_rate_per_lb: 170, tax_threshold: 2000, warn_line: 1800,
  band: [1800, 2200], vat_rate: 0.05, tariff_rate_high: null,
  category_weights: [{ key: 'tee', min_lb: 0.5, max_lb: 1, approved: true }, { key: 'unapproved', min_lb: 1, max_lb: 2, approved: false }],
};
const base: EstimateInput = {
  quantity: 1, unit_price: 20, currency: 'USD', domestic_shipping: null, weight_lb: 1, weight_source: 'merchant',
};

test('整磅進位與最低 1 磅（貨件）', () => {
  assert.equal(shipmentBilledWeight(2.4), 3);
  assert.equal(shipmentBilledWeight(0.3), 1);
  assert.equal(shipmentBilledWeight(3), 3);
});

test('單件重量 0.1 磅進位、最低 0.2', () => {
  assert.equal(recordWeight(0.05), 0.2);
  assert.equal(recordWeight(1.01), 1.1);
  assert.equal(recordWeight(1.1), 1.1);
});

test('已知重量 → 點估；匯率含 1% 緩衝', () => {
  const r = computeEstimate(base, params);
  assert.equal(r.kind, 'point');
  assert.equal(r.result.goods_twd, Math.round(20 * 30 * 1.01)); // 606
  assert.deepEqual(r.result.shipping_twd, { low: 170, high: 170 });
  assert.equal(r.result.cif_twd!.low, 606 + 170);
  assert.equal(r.result.level, 'green');
  assert.equal(r.scenarios, null);
  assert.equal(r.result.disclaimer, DISCLAIMER);
});

test('假設重量（有核可）→ 區間並標示', () => {
  const r = computeEstimate({ ...base, weight_source: 'category_assumption', weight_lb: null, category_key: 'tee' }, params);
  assert.equal(r.kind, 'range');
  assert.match(r.result.weight_basis, /類別假設重量，非本商品實測/);
  assert.notEqual(r.result.shipping_twd!.low, r.result.shipping_twd!.high);
});

test('假設重量未核可 → 待查核，不給總額', () => {
  const r = computeEstimate({ ...base, weight_source: 'category_assumption', weight_lb: null, category_key: 'unapproved' }, params);
  assert.equal(r.kind, 'pending_check');
  assert.equal(r.result.total_twd, null);
});

test('無重量資訊 → 待查核：只列已知小計，不寫 0', () => {
  const r = computeEstimate({ ...base, weight_source: 'none', weight_lb: null }, params);
  assert.equal(r.kind, 'pending_check');
  assert.equal(r.result.total_twd, null);
  assert.equal(r.result.shipping_twd, null);
  assert.equal(r.result.known_subtotal_twd, 606);
  assert.ok(r.result.unknowns.includes('重量未知'));
});

test('匯率未設定 → 待查核', () => {
  const r = computeEstimate(base, { ...params, fx_rate: null });
  assert.equal(r.kind, 'pending_check');
  assert.equal(r.result.goods_twd, null);
});

test('完稅價格落在 1,800–2,200 帶寬 → 雙情境；不寫死關稅率', () => {
  // goods 20*30.3*3 = 1818；運費 1 磅 170 → CIF 1988
  const r = computeEstimate({ ...base, quantity: 3, weight_lb: 0.34 }, params);
  assert.ok(r.result.cif_twd!.low >= 1800 && r.result.cif_twd!.low <= 2200);
  assert.ok(r.scenarios?.exempt && r.scenarios?.taxable);
  assert.equal(r.scenarios!.taxable!.duty_twd.high, null); // 關稅率未設定 → 上界待確認
  assert.equal(r.scenarios!.taxable!.total_twd.high, null);
  assert.ok(r.result.unknowns.some((u) => u.includes('關稅率未設定')));
});

test('帶寬外且超過門檻 → 僅課稅情境（全額課稅，營業稅含完稅價格）', () => {
  const r = computeEstimate({ ...base, unit_price: 100 }, { ...params, tariff_rate_high: 0.1 });
  assert.equal(r.scenarios!.exempt, null);
  const cif = r.result.cif_twd!.low;
  assert.equal(r.scenarios!.taxable!.vat_twd.low, Math.round(cif * 0.05));
  assert.equal(r.result.level, 'red');
});

test('金額守恆分攤：尾差調整至最大品項，加總恆等於總額', () => {
  const parts = allocateConserving(1000, [1, 1, 1]);
  assert.equal(parts.reduce((a, b) => a + b, 0), 1000);
  const parts2 = allocateConserving(101, [5, 3, 2]);
  assert.equal(parts2.reduce((a, b) => a + b, 0), 101);
});
