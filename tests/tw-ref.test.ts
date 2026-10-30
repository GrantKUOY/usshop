import test from 'node:test';
import assert from 'node:assert/strict';
import { candidateView } from '../src/server/items.ts';

const base = { id: 1, name: 'x', sale_price: 10, list_price: 10, tw_ref_price: null, same_spec_basis: null };
const label = async (o: object) => (await candidateView(null as any, { ...base, ...o }, false)).tw_ref;

test('台灣價：查無 → 台灣未售', async () => {
  assert.deepEqual(await label({ same_spec_basis: '台灣官方店面查無此設計款商品' }), { price: null, label: '台灣未售' });
});
test('台灣價：未查價 → 待查；有價 → 出價格', async () => {
  assert.deepEqual(await label({}), { price: null, label: '待查' });
  assert.equal((await label({ same_spec_basis: '同設計款對照', tw_ref_price: 3480 })).price, 3480);
});
