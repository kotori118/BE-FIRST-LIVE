import {test} from 'node:test';
import assert from 'node:assert/strict';
import {startCatalog} from '../startup-sync.js';
test('renders prior data before sync finishes, then applies latest',async()=>{
 let finish;const gate=new Promise(r=>finish=r),events=[];let latest=false;
 const run=startCatalog({read:async()=>latest?'new':'old',refresh:async()=>{await gate;latest=true;},render:v=>events.push(v),state:v=>events.push(v)});
 await new Promise(r=>setImmediate(r));assert.deepEqual(events,['loading','old','refreshing']);finish();await run.done;assert.deepEqual(events.slice(-2),['new','ready']);
});
test('failure keeps the visible snapshot; stopping blocks late results',async()=>{
 const seen=[];const a=startCatalog({read:async()=>'old',refresh:async()=>{throw Error();},render:v=>seen.push(v),state:v=>seen.push(v)});await a.done;assert.ok(seen.includes('old'));assert.equal(seen.at(-1),'refresh-error');
 let finish;const gate=new Promise(r=>finish=r),late=[];const b=startCatalog({read:async()=>gate,refresh:async()=>{},render:v=>late.push(v),state:()=>{}});b.stop();finish('private');await b.done;assert.deepEqual(late,[]);
});
