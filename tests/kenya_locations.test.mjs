import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
const server=await import('../supabase/functions/staff-workspace-v12/kenya-locations.mjs');
const page=await import('../staff-kenya-locations.mjs');
const {cleanValue,fieldFor}=await import('../supabase/functions/staff-workspace-v12/client-master-rules.mjs');
const rules=await import('../staff-kyc-grid-rules.mjs');

// Constituencies per county as printed in the IEBC list of registered voters per constituency (2022). 47 counties, 290 constituencies.
const PER_COUNTY={Mombasa:6,Kwale:4,Kilifi:7,'Tana River':3,Lamu:2,'Taita Taveta':4,Garissa:6,Wajir:6,Mandera:6,Marsabit:4,Isiolo:2,Meru:9,'Tharaka-Nithi':3,Embu:4,Kitui:8,Machakos:8,Makueni:6,Nyandarua:5,Nyeri:6,Kirinyaga:4,"Murang'a":7,Kiambu:12,Turkana:6,'West Pokot':4,Samburu:3,'Trans Nzoia':5,'Uasin Gishu':6,'Elgeyo/Marakwet':4,Nandi:6,Baringo:6,Laikipia:3,Nakuru:11,Narok:6,Kajiado:5,Kericho:6,Bomet:5,Kakamega:12,Vihiga:5,Bungoma:9,Busia:7,Siaya:6,Kisumu:7,'Homa Bay':8,Migori:8,Kisii:9,Nyamira:4,'Nairobi City':17};

test('the list matches the IEBC document: 47 counties, 290 constituencies, the printed count per county',()=>{
 assert.equal(server.COUNTIES.length,47);
 assert.equal(server.COUNTIES.reduce((n,c)=>n+c.constituencies.length,0),290);
 assert.deepEqual(Object.fromEntries(server.COUNTIES.map(c=>[c.name,c.constituencies.length])),PER_COUNTY);
 assert.deepEqual(server.COUNTIES.map(c=>c.code),Array.from({length:47},(_,i)=>i+1));
 const codes=server.COUNTIES.flatMap(c=>c.constituencies.map(x=>x.code));
 assert.deepEqual(codes,Array.from({length:290},(_,i)=>i+1),'constituency codes run 1 to 290 in county order');
 for(const n of ['Kimilili','Dadaab','Kilgoris','Mt. Elgon','Chuka/Igambang\'ombe'])assert.ok(server.COUNTIES.some(c=>c.constituencies.some(x=>x.name===n)),n);
 for(const n of ['Unguja','Kimilil','Daadab'])assert.ok(!server.COUNTIES.some(c=>c.constituencies.some(x=>x.name===n)),n+' is not a Kenyan constituency name');
});
test('the page copy is byte for byte the server copy',()=>{
 assert.equal(readFileSync(new URL('../staff-kenya-locations.mjs',import.meta.url),'utf8'),readFileSync(new URL('../supabase/functions/staff-workspace-v12/kenya-locations.mjs',import.meta.url),'utf8'));
 assert.deepEqual(page.COUNTIES,server.COUNTIES);
});
test('names are matched without guessing: case, spaces and punctuation are ignored, aliases are listed, nothing else is accepted',()=>{
 assert.equal(server.canonicalCounty('  murang a '),"Murang'a");assert.equal(server.canonicalCounty('NAIROBI'),'Nairobi City');assert.equal(server.canonicalCounty('Elgeyo Marakwet'),'Elgeyo/Marakwet');assert.equal(server.canonicalCounty('Homabay'),'Homa Bay');
 assert.equal(server.canonicalCounty('Nairobi West'),null);assert.equal(server.canonicalCounty(''),null);assert.equal(server.canonicalCounty('Bungom'),null);
 assert.equal(server.canonicalConstituency('Nairobi','westlands'),'Westlands');assert.equal(server.canonicalConstituency('Kiambu','Kiambu'),'Kiambu');
 assert.equal(server.canonicalConstituency('Kisumu','Westlands'),null,'a constituency of another county is refused');
 assert.equal(server.canonicalConstituency('','Westlands'),null);
 assert.deepEqual(server.constituencyNames('Lamu'),['Lamu East','Lamu West']);assert.deepEqual(server.constituencyNames('nowhere'),[]);
 assert.equal(server.locationProblem('Kisumu',''),null);assert.match(server.locationProblem('','Nyakach'),/county first/);assert.match(server.locationProblem('Atlantis','Nyakach'),/47 counties/);
});
test('the server stores both facts under their listed names and refuses a constituency from another county',()=>{
 assert.equal(fieldFor('district').label,'Constituency (sub-county)');
 assert.deepEqual(cleanValue('county','nairobi'),{ok:true,value:'Nairobi City'});
 assert.equal(cleanValue('county','Atlantis').ok,false);
 assert.deepEqual(cleanValue('district','kiambaa',{county:'Kiambu'}),{ok:true,value:'Kiambaa'});
 assert.match(cleanValue('district','Kiambaa',{county:'Nairobi'}).error,/not a constituency of Nairobi City County/);
 assert.match(cleanValue('district','Kiambaa').error,/county first/);
});
test('the set-up page rules offer the list, read a choice back under its listed name, and check the pair',()=>{
 assert.equal(rules.kindOf('county'),'choice');assert.equal(rules.kindOf('district'),'choice');assert.equal(rules.kindOf('city_town'),'text');
 assert.equal(rules.choiceOptions('county').length,47);assert.equal(rules.choiceOptions('district','Kisumu').length,7);assert.deepEqual(rules.choiceOptions('district',''),[]);
 assert.equal(rules.toStored('county','nairobi'),'Nairobi City');assert.equal(rules.toStored('district','westlands',{county:'Nairobi City'}),'Westlands');
 assert.equal(rules.cellProblem('county','Nairobi'),null);assert.match(rules.cellProblem('county','Atlantis'),/47 counties/);
 assert.equal(rules.cellProblem('district','Westlands',{county:'Nairobi City'}),null);assert.match(rules.cellProblem('district','Westlands',{county:'Kisumu'}),/not a constituency of Kisumu County/);
 assert.deepEqual(rules.LAYOUT.flatMap(s=>(s.groups||[]).flatMap(g=>g.rows.flat())).filter(c=>c&&c.key==='district').map(c=>c.label),['Constituency (sub-county)']);
});
