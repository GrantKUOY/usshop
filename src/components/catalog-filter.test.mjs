import test from 'node:test';
import assert from 'node:assert/strict';
import {filterItems,audienceCounts,visibleCategories,normalizeFilter,matchesQuery,initialFilter,isFiltered} from '../../public/app/catalog-filter.js';

const items=[
 {id:1,name:'Align 高腰瑜伽褲 28吋',spec_label:'黑色',merchant:'lululemon 官網',audience:'women',category:'leggings'},
 {id:2,name:'Align 高腰短褲 6吋',spec_label:'Black',merchant:'lululemon 官網',audience:'women',category:'shorts'},
 {id:3,name:'Daydrift 寬腿褲',spec_label:'高腰寬腿褲',merchant:'lululemon 官網',audience:'women',category:'pants'},
 {id:4,name:'Everywhere Belt Bag 腰包 1L',spec_label:'',merchant:'Lululemon',audience:'accessories',category:'bags_accessories'},
 {id:5,name:'舊資料未分類',spec_label:'',merchant:'某商家',audience:null,category:'other'},
];
const ids=r=>r.map(c=>c.id);

test('預設不篩選，全部顯示',()=>{assert.deepEqual(ids(filterItems(items,initialFilter())),[1,2,3,4,5]);assert.equal(isFiltered(initialFilter()),false);});
test('對象篩選；null 對象只出現在「全部」',()=>{
 assert.deepEqual(ids(filterItems(items,{...initialFilter(),audience:'women'})),[1,2,3]);
 assert.deepEqual(ids(filterItems(items,{...initialFilter(),audience:'men'})),[]);
 assert.deepEqual(audienceCounts(items),{all:5,women:3,men:0,accessories:1});
});
test('品類篩選；缺 category 視為 other',()=>{
 assert.deepEqual(ids(filterItems(items,{...initialFilter(),category:'shorts'})),[2]);
 assert.deepEqual(ids(filterItems([{id:9,name:'x'}],{...initialFilter(),category:'other'})),[9]);
});
test('搜尋：名稱、規格、商家，不分大小寫，且與分類 AND',()=>{
 assert.deepEqual(ids(filterItems(items,{...initialFilter(),q:'BLACK'})),[2]);
 assert.deepEqual(ids(filterItems(items,{...initialFilter(),q:'寬腿'})),[3]);
 assert.deepEqual(ids(filterItems(items,{...initialFilter(),q:'LULULEMON'})),[1,2,3,4]);
 assert.deepEqual(ids(filterItems(items,{...initialFilter(),audience:'accessories',q:'align'})),[]);
 assert.equal(matchesQuery({name:null,spec_label:undefined},'  '),true);
});
test('品類 chips 只列有商品者，依固定順序',()=>{
 assert.deepEqual(visibleCategories(items,'all'),['leggings','pants','shorts','bags_accessories','other']);
 assert.deepEqual(visibleCategories(items,'women'),['leggings','pants','shorts']);
 assert.deepEqual(visibleCategories(items,'men'),[]);
});
test('切換對象後失效的品類退回全部',()=>{
 assert.equal(normalizeFilter(items,{audience:'accessories',category:'shorts',q:''}).category,'all');
 assert.equal(normalizeFilter(items,{audience:'women',category:'shorts',q:''}).category,'shorts');
});
