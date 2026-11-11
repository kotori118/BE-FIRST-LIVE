import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';

const source=readFileSync('gas/UniverseSync.gs','utf8');
const header=['SongID','Title','Artist','ReleaseDate','Form','CDTitle','IsTitleTrack'];
const row=['1001','Example','BE:FIRST','2026/11/03','アルバム','','FALSE'];
const plain=value=>JSON.parse(JSON.stringify(value));
function core(){const c=vm.createContext({});new vm.Script(source).runInContext(c);return c.LiveSongSyncCore;}
test('source normalization: stable IDs, slash dates, boolean false, blank artist',()=>{
  const c=core(),songs=c.normalize([header,row,['5001','Example','','','','','FALSE']]);
  assert.equal(songs.length,2);assert.equal(songs[0].releaseDate,'2026-11-03');assert.equal(songs[0].isTitleTrack,false);assert.equal(songs[1].artist,null);
  assert.equal(songs[0].songRef,'U:1001');
});
test('invalid source, duplicate ID and empty reads cannot form a sync',()=>{
  const c=core();assert.throws(()=>c.normalize([header,row,row]));assert.throws(()=>c.normalize([header]));
  assert.throws(()=>c.normalize([['SongID'],['1001']]));
  assert.throws(()=>c.normalize([header,[...row.slice(0,3),'2026/02/30',...row.slice(4)]]));
});
test('diffs update changed IDs, preserve missing references and avoid unchanged writes',()=>{
  const c=core(),songs=c.normalize([header,row]);
  const old={'1001':{data:plain(songs[0]),updateTime:'version-a'},'1002':{data:{...plain(songs[0]),universeSongId:'1002',songRef:'U:1002'},updateTime:'version-b'}};
  let plan=c.plan(songs,old);assert.equal(plan.updated,0);assert.equal(plan.unavailable,1);assert.equal(plan.changes[0].data.available,false);
  songs[0].title='Renamed';plan=c.plan(songs,old);assert.equal(plan.updated,1);assert.equal(plan.changes[0].id,'1001');
  assert.equal(plan.changes[0].updateTime,'version-a');assert.equal(old['1001'].data.title,'Example');
});
test('oversized batches fail before writing; literal property-like IDs stay independent',()=>{
  const c=core();const rows=[header,...Array.from({length:400},(_,i)=>[String(i),'Song','','','','',''])];
  assert.throws(()=>c.plan(c.normalize(rows),{}));
  assert.equal(c.normalize([header,['__proto__','Song','','','','',''],['constructor','Song','','','','','']]).length,2);
});
test('Firestore field codec preserves null/boolean and rejects unsupported structures',()=>{
  const c=core(),data={title:'Example',artist:null,available:false,count:3};assert.deepEqual(plain(c.decode(c.encode(data))),data);
  assert.throws(()=>c.encode({nested:{unsafe:true}}));
});

// Real REST commit against the local emulator, through the actual Apps Script adapter.
// No real Google token, API, spreadsheet or Firebase project is used by these tests.
function emulatorRuntime(){
  const host=process.env.FIRESTORE_EMULATOR_HOST;
  assert.match(host??'',/^(127\.0\.0\.1|localhost):\d+$/,'Only the local Firestore emulator is permitted');
  let rows=[header,row], failCommit=false, loseReply=false;
  const calls=[];
  const context=vm.createContext({console:{log(){}},PropertiesService:{getScriptProperties:()=>({getProperty:key=>key==='FIREBASE_PROJECT_ID'?'demo-live-connection':null})},
    SpreadsheetApp:{openById:()=>{throw new Error('SpreadsheetApp would require broader source permissions');}},
    ScriptApp:{getOAuthToken:()=> 'owner'},Utilities:{getUuid:randomUUID},LockService:{getScriptLock:()=>({tryLock:()=>true,releaseLock(){}})},
    UrlFetchApp:{fetch:(url,options)=>{
      if(url.startsWith('https://sheets.googleapis.com/v4/spreadsheets/')) {
        assert.equal(options.method,'get');assert.equal(options.payload,undefined);
        assert.ok(decodeURIComponent(url).includes("'06_Songs'!A1:G10000"));
        return {getResponseCode:()=>200,getContentText:()=>JSON.stringify({values:rows})};
      }
      assert.ok(url.startsWith('https://firestore.googleapis.com/v1/projects/demo-live-connection/'));
      calls.push({url,method:options.method,body:options.payload?JSON.parse(options.payload):null});
      if(failCommit&&options.method==='post'){failCommit=false;return {getResponseCode:()=>500,getContentText:()=>JSON.stringify({error:{status:'INTERNAL'}})};}
      const local=url.replace('https://firestore.googleapis.com',`http://${host}`);
      const args=['--silent','--show-error','--max-time','15','-X',options.method.toUpperCase(),'-H','Authorization: Bearer owner','-H','Content-Type: application/json','-w','\n%{http_code}',local];
      if(options.payload)args.push('--data-binary',options.payload);
      const output=execFileSync('curl',args,{encoding:'utf8',env:{...process.env,NO_PROXY:'127.0.0.1,localhost'}});const split=output.lastIndexOf('\n');
      if(loseReply&&options.method==='post'){loseReply=false;throw new Error('simulated lost reply');}
      return {getResponseCode:()=>Number(output.slice(split+1)),getContentText:()=>output.slice(0,split)};
    }}});
  new vm.Script(source).runInContext(context);
  return {context,calls,setRows:r=>rows=r,failNextCommit:()=>failCommit=true,loseNextReply:()=>loseReply=true};
}
test('actual REST sync: atomic catalog, no-op diff, source failure preservation and lost-response recovery',()=>{
  const rt=emulatorRuntime(),c=rt.context;
  const initial=c.previewUniverseSync();assert.equal(initial.sourceCount,1);assert.equal(rt.calls.filter(x=>x.method==='post').length,0);
  assert.equal(c.syncUniverseSongs().ok,true);
  let plan=c.previewUniverseSync();assert.equal(plan.changes,undefined);assert.equal(plan.added+plan.updated+plan.unavailable,0);
  const success=c.liveStatus_(c.liveConfig_());
  rt.setRows([header,row,row]);assert.throws(()=>c.syncUniverseSongs());
  assert.equal(c.liveCatalog_(c.liveConfig_())['1001'].data.title,'Example');
  const failed=c.liveStatus_(c.liveConfig_());assert.equal(c.LiveSongSyncCore.decode(failed.fields).state,'ERROR');
  assert.deepEqual(plain(failed.fields.lastSuccessAt),plain(success.fields.lastSuccessAt));
  rt.setRows([header,[row[0],'Renamed',...row.slice(2)]]);rt.failNextCommit();assert.throws(()=>c.syncUniverseSongs());
  assert.equal(c.liveCatalog_(c.liveConfig_())['1001'].data.title,'Example');
  rt.loseNextReply();assert.equal(c.syncUniverseSongs().recovered,true);
  assert.equal(c.liveCatalog_(c.liveConfig_())['1001'].data.title,'Renamed');
  assert.equal(c.LiveSongSyncCore.decode(c.liveStatus_(c.liveConfig_()).fields).state,'OK');
  // Two writes: exactly one song plus its status; no independent halfway state.
  assert.ok(rt.calls.some(x=>x.body?.writes?.length===2));
});
test('source scope stays read-only and API errors include the enabling project without credentials',()=>{
  const manifest=JSON.parse(readFileSync('gas/appsscript.json','utf8'));
  assert.ok(manifest.oauthScopes.includes('https://www.googleapis.com/auth/spreadsheets.readonly'));
  assert.ok(!manifest.oauthScopes.includes('https://www.googleapis.com/auth/spreadsheets'));
  const context=vm.createContext({ScriptApp:{getOAuthToken:()=> 'secret-test-token'},UrlFetchApp:{fetch:(url,options)=>{
    assert.equal(options.method,'get');assert.equal(options.headers.Authorization,'Bearer secret-test-token');
    return {getResponseCode:()=>403,getContentText:()=>JSON.stringify({error:{status:'PERMISSION_DENIED',details:[{reason:'SERVICE_DISABLED',metadata:{consumer:'projects/123456'}}]}})};
  }}});
  new vm.Script(source).runInContext(context);
  assert.throws(()=>context.liveRows_({spreadsheet:'test-sheet'}),error=>{
    assert.match(error.message,/Sheets API 403/);assert.match(error.message,/SERVICE_DISABLED/);assert.match(error.message,/projects\/123456/);assert.ok(!error.message.includes('secret-test-token'));return true;
  });
});
