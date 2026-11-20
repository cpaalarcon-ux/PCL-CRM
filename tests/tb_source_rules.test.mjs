import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import {sourceAmount,mappingConflict,isProfitLossForYear,isControlRow,columnLetters,amountProblem} from '../supabase/functions/staff-workspace-v12/tb-source-rules.mjs';
test('amounts are read the way an accountant reads them, and nothing is guessed',()=>{
 for(const [raw,value] of [[1200.5,1200.5],['1,200.50',1200.5],['(4,607,918.04)',-4607918.04],['-35',-35],['35-',-35],['KES 1,000',1000],['−200',-200],['',0],[null,0],['-',0],['—',0]])assert.equal(sourceAmount(raw).value,value,String(raw));
 for(const raw of ['abc','1,2','12.345','1,000.00.00',new Date(),true,{result:1}])assert.equal(sourceAmount(raw).ok,false,String(raw));
 assert.equal(sourceAmount('(1,000.00)').converted,true);assert.equal(sourceAmount(10).converted,false);
});
test('rows and columns are named for the preparer',()=>{
 assert.equal(columnLetters(1),'A');assert.equal(columnLetters(27),'AA');
 assert.match(amountProblem({row:10,column:5,label:'Debit',raw:'x1',problem:'is not a number'}),/Excel row 10, column E \(Debit\): "x1" is not a number/);
 assert.equal(isControlRow('Grand total'),true);assert.equal(isControlRow('Totals payable'),false);
});
test('profit or loss for the year stays in retained earnings or the current result',()=>{
 for(const n of ['Profit/Loss for the Year','Profit for the year','Net loss','Current year profit'])assert.equal(isProfitLossForYear(n),true,n);
 for(const n of ['Retained earnings','Profit and loss account','Revaluation surplus','Profit on disposal','Loss on exchange'])assert.equal(isProfitLossForYear(n),false,n);
 assert.match(mappingConflict('Profit/Loss for the Year','33000'),/cannot go to 33000/);
 assert.match(mappingConflict('Profit/Loss for the Year','10020'),/cannot go to 10020/);
 assert.equal(mappingConflict('Profit/Loss for the Year','31000'),'');assert.equal(mappingConflict('Profit/Loss for the Year','32000'),'');
 assert.equal(mappingConflict('Revaluation surplus','33000'),'');
});
test('the browser copy of the rules is identical to the server copy',()=>{
 assert.equal(fs.readFileSync(new URL('../staff-tb-source-rules.mjs',import.meta.url),'utf8'),fs.readFileSync(new URL('../supabase/functions/staff-workspace-v12/tb-source-rules.mjs',import.meta.url),'utf8'));
});
