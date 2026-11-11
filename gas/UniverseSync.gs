/** Standalone LIVE script. Never add this file to the existing Universe GAS project. */
var LiveSongSyncCore = (function () {
  var COLUMNS = ['SongID','Title','Artist','ReleaseDate','Form','CDTitle','IsTitleTrack'];
  var FIELDS = ['songRef','universeSongId','title','artist','releaseDate','form','cdTitle','isTitleTrack','available'];
  function fail(message) { var e = new Error(message); e.code = 'SOURCE_INVALID'; throw e; }
  function text(value) { return String(value == null ? '' : value).trim(); }
  function normalize(rows) {
    if (!rows.length) fail('06_Songsが空です');
    var header = rows[0].map(text), seen = Object.create(null), songs = [];
    COLUMNS.forEach(function (key) { if (header.filter(function (h) { return h === key; }).length !== 1) fail('必須列がないか重複しています: ' + key); });
    rows.slice(1).forEach(function (row) {
      if (row.every(function (v) { return !text(v); })) return;
      function get(key) { return text(row[header.indexOf(key)]); }
      var id = get('SongID'), title = get('Title'), date = get('ReleaseDate').replace(/\//g,'-'), flag = get('IsTitleTrack').toUpperCase();
      if (!/^[A-Za-z0-9_-]{1,120}$/.test(id) || !title || Object.prototype.hasOwnProperty.call(seen,id)) fail('SongIDが不正または重複しています: ' + id);
      if (date && (!/^\d{4}-\d{2}-\d{2}$/.test(date) || isNaN(Date.parse(date)) || new Date(date).toISOString().slice(0,10) !== date)) fail('発売日が不正です: ' + id);
      if (['','TRUE','FALSE'].indexOf(flag) < 0) fail('IsTitleTrackが不正です: ' + id);
      seen[id] = true;
      songs.push({songRef:'U:'+id,universeSongId:id,title:title,artist:get('Artist')||null,releaseDate:date||null,form:get('Form')||null,cdTitle:get('CDTitle')||null,isTitleTrack:flag==='TRUE',available:true});
    });
    if (!songs.length) fail('楽曲が0件です。前回の正常データを保持します');
    return songs;
  }
  function plan(songs, existing) {
    var incoming = Object.create(null), changes = [], adds = 0, updates = 0, missing = 0;
    songs.forEach(function (song) {
      var id = song.universeSongId, old = existing[id]; incoming[id] = true;
      if (!old || FIELDS.some(function (key) { return old.data[key] !== song[key]; })) {
        changes.push({id:id,data:song,updateTime:old ? old.updateTime : null});
        if (old) updates++; else adds++;
      }
    });
    Object.keys(existing).forEach(function (id) {
      var old = existing[id];
      if (!incoming[id] && old.data.available !== false) {
        var data = {}; FIELDS.forEach(function (key) { data[key] = old.data[key]; }); data.available = false;
        changes.push({id:id,data:data,updateTime:old.updateTime}); missing++;
      }
    });
    if (changes.length > 399) { var e = new Error('変更が399曲を超えています。今回の書込は行いません'); e.code = 'BATCH_TOO_LARGE'; throw e; }
    return {changes:changes,added:adds,updated:updates,unavailable:missing,sourceCount:songs.length,befirstCount:songs.filter(function (s) { return s.artist==='BE:FIRST'; }).length};
  }
  function encode(data) {
    var fields = {};
    Object.keys(data).forEach(function (key) {
      var value = data[key];
      if (value == null) fields[key] = {nullValue:null};
      else if (typeof value === 'boolean') fields[key] = {booleanValue:value};
      else if (typeof value === 'number' && Number.isInteger(value)) fields[key] = {integerValue:String(value)};
      else if (typeof value === 'string') fields[key] = {stringValue:value};
      else throw new Error('未対応のフィールド型: ' + key);
    });
    return fields;
  }
  function decode(fields) {
    var data = {};
    Object.keys(fields || {}).forEach(function (key) {
      var v = fields[key];
      if ('nullValue' in v) data[key] = null;
      else if ('stringValue' in v) data[key] = v.stringValue;
      else if ('booleanValue' in v) data[key] = v.booleanValue;
      else if ('integerValue' in v) data[key] = Number(v.integerValue);
      else if ('timestampValue' in v) data[key] = v.timestampValue;
      else throw new Error('未対応のFirestore型: ' + key);
    });
    return data;
  }
  return Object.freeze({normalize:normalize,plan:plan,encode:encode,decode:decode});
})();

function liveConfig_() {
  var props = PropertiesService.getScriptProperties();
  var project = props.getProperty('FIREBASE_PROJECT_ID') || 'live-record-3e3b6';
  var spreadsheet = props.getProperty('UNIVERSE_SPREADSHEET_ID') || '1-1AY6-BACOaGW3HIgYS0UjFMPSh-cjvYMMnJ_UYoRFY';
  if (!/^[a-z][a-z0-9-]{4,61}[a-z0-9]$/.test(project) || !/^[\w-]+$/.test(spreadsheet)) throw new Error('接続先の設定が不正です');
  return {project:project,spreadsheet:spreadsheet,database:'projects/'+project+'/databases/(default)'};
}
function liveGoogleRequest_(method,url,body,allowMissing,service) {
  var response;
  try {
    var options = {method:method,headers:{Authorization:'Bearer '+ScriptApp.getOAuthToken()},contentType:'application/json',muteHttpExceptions:true};
    if (body) options.payload = JSON.stringify(body);
    response = UrlFetchApp.fetch(url,options);
  } catch (ignored) { var uncertain = new Error('通信結果を確認できません。再実行前に同期状態を確認してください'); uncertain.code='NETWORK_UNCERTAIN'; throw uncertain; }
  var code = response.getResponseCode(), json;
  try { json = JSON.parse(response.getContentText()); } catch (ignored) { json = {}; }
  if (code === 404 && allowMissing) return null;
  if (code < 200 || code >= 300) {
    var status = json.error && json.error.status || 'HTTP_'+code;
    var detail = (json.error && json.error.details || []).filter(function (d) { return d.reason; })[0];
    var reason = detail ? ' / '+detail.reason : '';
    var consumer = detail && detail.metadata && detail.metadata.consumer ? ' / '+detail.metadata.consumer : '';
    var error = new Error(service+' '+code+' ('+status+reason+consumer+')。OAuthスコープ・API有効化・実行アカウントのアクセス権を確認してください');
    error.code = status; throw error;
  }
  return json;
}
function liveRequest_(method,path,body,allowMissing) {
  return liveGoogleRequest_(method,'https://firestore.googleapis.com/v1/'+path,body,allowMissing,'Firestore');
}
function liveRows_(cfg) {
  // SpreadsheetApp.openById requires the broader spreadsheets scope.
  // Sheets values.get supports spreadsheets.readonly, so the source stays read-only.
  var url = 'https://sheets.googleapis.com/v4/spreadsheets/'+cfg.spreadsheet+'/values/'+encodeURIComponent("'06_Songs'!A1:G10000")+'?valueRenderOption=FORMATTED_VALUE&majorDimension=ROWS';
  var response = liveGoogleRequest_('get',url,null,false,'Sheets API');
  var rows = response.values || [];
  if (rows.length >= 10000) throw new Error('06_Songsの取得上限に達しました。切り詰めたデータは同期しません');
  return rows;
}
function liveStatus_(cfg) { return liveRequest_('get',cfg.database+'/documents/syncStatus/current',null,true); }
function liveCatalog_(cfg) {
  var documents = Object.create(null), token = '', pages = 0;
  do {
    if (++pages > 20) throw new Error('楽曲一覧の取得上限を超えました');
    var result = liveRequest_('get',cfg.database+'/documents/universeSongs?pageSize=300'+(token?'&pageToken='+encodeURIComponent(token):''));
    (result.documents || []).forEach(function (doc) {
      var id = doc.name.split('/').pop(), data = LiveSongSyncCore.decode(doc.fields);
      if (!/^[\w-]{1,120}$/.test(id) || data.universeSongId !== id || !doc.updateTime) throw new Error('既存楽曲の構造を確認できません');
      documents[id] = {data:data,updateTime:doc.updateTime};
    });
    token = result.nextPageToken || '';
  } while (token);
  return documents;
}
function liveWrite_(cfg,path,fields,previous) {
  return {update:{name:cfg.database+'/documents/'+path,fields:fields},currentDocument:previous ? {updateTime:previous} : {exists:false}};
}
function liveSummary_(plan) { return {sourceCount:plan.sourceCount,befirstCount:plan.befirstCount,added:plan.added,updated:plan.updated,unavailable:plan.unavailable}; }

/** First user-run step: reads Universe, confirms Firestore IAM and writes ONE diagnostic doc. */
function checkLiveConnection() {
  var cfg = liveConfig_(), songs = LiveSongSyncCore.normalize(liveRows_(cfg));
  liveRequest_('get',cfg.database);
  var path = cfg.database+'/documents/diagnostics/gasConnection';
  var previous = liveRequest_('get',path,null,true);
  var fields = LiveSongSyncCore.encode({message:'LIVE_GAS_CONNECTION',sourceCount:songs.length,befirstCount:songs.filter(function(s){return s.artist==='BE:FIRST';}).length});
  fields.checkedAt = {timestampValue:new Date().toISOString()};
  liveRequest_('post',cfg.database+'/documents:commit',{writes:[{update:{name:path,fields:fields},currentDocument:previous ? {updateTime:previous.updateTime} : {exists:false}}]});
  var result = {ok:true,universeSongs:songs.length,befirstSongs:songs.filter(function(s){return s.artist==='BE:FIRST';}).length,firestoreRead:true,firestoreWrite:true};
  console.log(JSON.stringify(result)); return result;
}
/** Read-only: no song, source or status writes. */
function previewUniverseSync() {
  var cfg = liveConfig_();
  var result = liveSummary_(LiveSongSyncCore.plan(LiveSongSyncCore.normalize(liveRows_(cfg)),liveCatalog_(cfg)));
  console.log(JSON.stringify(result)); return result;
}
function syncUniverseSongs() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) return {skipped:true,reason:'同期実行中'};
  var cfg, previous, attempt = Utilities.getUuid(), committed = false;
  try {
    cfg = liveConfig_(); previous = liveStatus_(cfg);
    var plan = LiveSongSyncCore.plan(LiveSongSyncCore.normalize(liveRows_(cfg)),liveCatalog_(cfg));
    var old = previous ? LiveSongSyncCore.decode(previous.fields) : {};
    var now = new Date().toISOString();
    var status = LiveSongSyncCore.encode({state:'OK',errorCode:null,attemptId:attempt,sourceCount:plan.sourceCount,befirstCount:plan.befirstCount,changedCount:plan.changes.length,catalogVersion:(old.catalogVersion||0)+(plan.changes.length?1:0)});
    status.lastSuccessAt = {timestampValue:now};
    status.lastChangedAt = plan.changes.length ? {timestampValue:now} : previous && previous.fields.lastChangedAt || {nullValue:null};
    var writes = plan.changes.map(function (change) { return liveWrite_(cfg,'universeSongs/'+change.id,LiveSongSyncCore.encode(change.data),change.updateTime); });
    writes.push(liveWrite_(cfg,'syncStatus/current',status,previous && previous.updateTime));
    // Firestore commit is atomic: every changed song AND the successful status switch together.
    liveRequest_('post',cfg.database+'/documents:commit',{writes:writes}); committed = true;
    var result = liveSummary_(plan); result.ok = true;
    console.log(JSON.stringify(result)); return result;
  } catch (error) {
    // A response can be lost after a successful commit. Never call that a failed sync blindly.
    if (cfg && error.code === 'NETWORK_UNCERTAIN') {
      try { var current = liveStatus_(cfg); if (current && LiveSongSyncCore.decode(current.fields).attemptId === attempt) return {ok:true,recovered:true}; } catch (ignored) {}
      throw error;
    }
    if (cfg && !committed) {
      try {
        var fields = previous ? JSON.parse(JSON.stringify(previous.fields)) : {};
        fields.state = {stringValue:'ERROR'};
        fields.errorCode = {stringValue:String(error.code || 'SYNC_FAILED')};
        fields.lastAttemptAt = {timestampValue:new Date().toISOString()};
        // Guarded by the last observed updateTime; cannot overwrite a newer successful sync.
        liveRequest_('post',cfg.database+'/documents:commit',{writes:[liveWrite_(cfg,'syncStatus/current',fields,previous && previous.updateTime)]});
      } catch (ignored) { /* The old song snapshot remains intact even when status cannot be written. */ }
    }
    throw error;
  } finally { lock.releaseLock(); }
}
/** Optional, ONLY after the manual IAM test and first sync succeed. No source editing rights. */
function installLiveTimeTrigger() {
  var handler = 'syncUniverseSongs';
  var exists = ScriptApp.getProjectTriggers().some(function (t) { return t.getHandlerFunction() === handler; });
  if (!exists) ScriptApp.newTrigger(handler).timeBased().everyMinutes(15).create();
  return {installed:true,intervalMinutes:15};
}
