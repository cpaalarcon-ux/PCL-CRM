import test from 'node:test';import assert from 'node:assert/strict';
import {ageDebtors,bandFor,daysBetween,BANDS} from '../supabase/functions/staff-workspace-v12/debtors-rules.mjs';

test('bands run from the invoice date',()=>{
 assert.equal(daysBetween('2026-01-01','2026-01-31'),30);
 assert.deepEqual([0,30,31,60,61,90,91,400].map(bandFor),['current','current','d31_60','d31_60','d61_90','d61_90','over90','over90']);
 assert.equal(BANDS.length,4);
});

test('open invoices are aged per customer; receipts reduce them; later receipts and later invoices are ignored',()=>{
 const invoices=[
  {row_id:'s1',invoice:'INV1',date:'2026-01-05',customer:'Fictional Duka Ltd',pin:'P000000001A',gross:1160,posted:true},
  {row_id:'s2',invoice:'INV2',date:'2026-02-20',customer:'Fictional Duka Ltd',pin:'P000000001A',gross:580,posted:true},
  {row_id:'s3',invoice:'INV3',date:'2026-03-25',customer:'fictional  mali shop',pin:'',gross:2320,posted:false},
  {row_id:'s4',invoice:'INV4',date:'2026-03-30',customer:'Fictional Duka Ltd',pin:'P000000001A',gross:100,posted:true},
  {row_id:'s5',invoice:'CN1',date:'2026-03-10',customer:'Fictional Duka Ltd',pin:'P000000001A',gross:-116,posted:true},
  {row_id:'s6',invoice:'INV6',date:'2026-04-10',customer:'Fictional Duka Ltd',pin:'P000000001A',gross:999,posted:true}];
 const allocations=[
  {sales_row_id:'s1',amount:1160,receipt_date:'2026-01-20'},   // INV1 paid in full
  {sales_row_id:'s2',amount:80.5,receipt_date:'2026-03-01'},
  {sales_row_id:'s2',amount:-80.5,receipt_date:'2026-03-01'},   // reversed
  {sales_row_id:'s2',amount:200,receipt_date:'2026-03-02'},
  {sales_row_id:'s3',amount:500,receipt_date:'2026-04-05'}];     // after the as-of date
 const r=ageDebtors({invoices,allocations,asOf:'2026-03-31'});
 assert.equal(r.settled_count,1,'INV1 is settled and not listed');
 const duka=r.customers.find(c=>c.pin==='P000000001A');
 assert.deepEqual(duka.invoices.map(i=>[i.invoice,i.open,i.band]),[['INV2',380,'d31_60'],['CN1',-116,'current'],['INV4',100,'current']]);
 assert.equal(duka.total,364);assert.equal(duka.buckets.current,-16);assert.equal(duka.buckets.d31_60,380);
 const mali=r.customers.find(c=>c.customer.toLowerCase().includes('mali'));assert.equal(mali.total,2320,'a receipt dated after the as-of date is not counted');assert.equal(mali.buckets.current,2320);
 assert.equal(r.totals.total,2684);assert.equal(r.totals.posted,364);assert.equal(r.totals.not_posted,2320);
 assert.equal(r.customers.length,2);
 assert.equal(ageDebtors({invoices,allocations,asOf:'2026-03-31'}).totals.over90,0);
 const later=ageDebtors({invoices,allocations,asOf:'2026-06-30'});
 assert.equal(later.customers.find(c=>c.pin==='P000000001A').invoices.find(i=>i.invoice==='INV2').band,'over90');
 assert.equal(later.customers.find(c=>c.customer.toLowerCase().includes('mali')).total,1820,'the April receipt now counts');
});
