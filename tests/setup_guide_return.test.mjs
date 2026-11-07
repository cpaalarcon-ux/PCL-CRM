import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const guide=await readFile(new URL('../staff-setup-guide.mjs',import.meta.url),'utf8'),pilot=await readFile(new URL('../staff-pilot.mjs',import.meta.url),'utf8');

test('opening client accounts from the setup guide offers a way back to the checklist, and no other entry point inherits it',()=>{
 assert.match(guide,/a==='accounts'\)await ctx\.openClientAccounts\(id,\{onReturn:\(\)=>open\(id\),returnLabel:'Back to setup and reporting'\}\)/,'the guide asks for a return to its own checklist');
 assert.match(pilot,/clientAccountReturnLabel=options\.returnLabel\|\|'Return to purchase mapping'/,'the purchase mapping return keeps its own wording');
 assert.match(pilot,/clientAccountSetup\(b\.dataset\.clientAccounts,\{onReturn:null\}\)/,'opening the list from the clients table clears any earlier return');
 assert.match(pilot,/\$\{esc\(clientAccountReturnLabel\)\}/,'the label is escaped');
});
