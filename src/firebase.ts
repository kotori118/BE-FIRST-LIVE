import {initializeApp} from 'firebase/app';
import {getAuth,GoogleAuthProvider,signInWithPopup,signOut} from 'firebase/auth';
import {initializeFirestore,memoryLocalCache,doc,collection,getDocFromServer,getDocsFromServer,runTransaction,onSnapshot,serverTimestamp,writeBatch} from 'firebase/firestore';
import {collections,schemas,emptyDataset,type Dataset,type Song,type Collection} from '../shared/model';
import {validateDataset,mergeLocalSong,canonicalDatasetJson,validateFreshInitialArchive} from '../shared/domain';
// @ts-expect-error shared JavaScript transport
import {requestSync} from '../sync-request.js';
const UID='xBt1XGXQjUg0UI9opk18Y76bucQ2';
let cfg;try{cfg=JSON.parse(localStorage.getItem('liveArchiveFirebaseConfig')||'null');}catch{cfg=null;}
export const configured=!!(cfg?.apiKey&&cfg?.projectId&&cfg?.appId&&cfg?.authDomain);
const app=configured?initializeApp(cfg):null;
export const auth=app?getAuth(app):null;
const db=app?initializeFirestore(app,{localCache:memoryLocalCache()}):null;
type Control={activeDatasetId:string;previousDatasetId:string|null;revision:number};
export type State={control:Control;data:Dataset;songs:Song[];syncedAt:string|null};
function store(){if(!db||auth?.currentUser?.uid!==UID)throw Error('本人のGoogleアカウントでログインしてください');if(!navigator.onLine)throw Error('インターネットに接続してください');return db;}
const ref=()=>doc(store(),'users',UID,'control','state');
const path=(id:string)=>`users/${UID}/datasets/${id}`;
function check(c:Control,e:any){if(c.activeDatasetId!==e.datasetId||c.revision!==e.revision)throw Error('他の端末で変更されました。最新を読み直して保存する内容を選んでください');}
async function read():Promise<State>{for(let i=0;i<2;i++){const a=(await getDocFromServer(ref())).data() as Control;const data=emptyDataset();await Promise.all(collections.map(async c=>{const s=await getDocsFromServer(collection(store(),path(a.activeDatasetId),c));(data[c] as unknown[])=s.docs.map(d=>d.data());}));const [b,songs,status]=await Promise.all([getDocFromServer(ref()),getDocsFromServer(collection(store(),'universeSongs')),getDocFromServer(doc(store(),'syncStatus/current'))]);if(b.data()?.revision!==a.revision)continue;return {control:a,data:validateDataset(data),songs:songs.docs.map(d=>({...d.data(),ref:d.data().songRef}) as Song).filter(s=>s.artist==='BE:FIRST'),syncedAt:status.data()?.lastSuccessAt?.toDate?.().toISOString()??null};}throw Error('更新中です。再読み込みしてください');}
async function save(input:any){const old=await read();check(old.control,input.expected);const next=validateDataset(input.data);if(old.data.shows.some(s=>!next.shows.some(n=>n.id===s.id)))throw Error('公演削除の影響確認は次の実装段階で対応します');const changes:any[]=[];for(const c of collections){for(const e of old.data[c])if(!next[c].some(n=>n.id===e.id))changes.push({c,id:e.id,remove:true});for(const e of next[c]){const previous=old.data[c].find(n=>n.id===e.id);if(JSON.stringify(previous)!==JSON.stringify(e))changes.push({c,id:e.id,data:{...e,revision:(previous?.revision??-1)+1}});}}if(changes.length>400)throw Error('一度の編集は400件までです');await runTransaction(store(),async tx=>{const current=(await tx.get(ref())).data() as Control;check(current,input.expected);for(const e of changes){const target=doc(store(),path(current.activeDatasetId),e.c,e.id);if(e.remove)tx.delete(target);else tx.set(target,e.data);}tx.update(ref(),{revision:current.revision+1});});}
async function restore(input:any){
 if(input.confirmed!==true)throw Error('内容確認が必要です');const data=validateDataset(input.data),old=await read();check(old.control,input.expected);const id=crypto.randomUUID(),meta=doc(store(),path(id));await runTransaction(store(),async tx=>{tx.set(meta,{ready:false,schemaVersion:1});});
 const items=collections.flatMap(c=>data[c].map(e=>({c,e})));for(let i=0;i<items.length;i+=400){const batch=writeBatch(store());for(const {c,e}of items.slice(i,i+400))batch.set(doc(store(),path(id),c,e.id),e);await batch.commit();}
 const verified=emptyDataset();await Promise.all(collections.map(async c=>{const snap=await getDocsFromServer(collection(store(),path(id),c));(verified[c] as unknown[])=snap.docs.map(d=>d.data());}));if(canonicalDatasetJson(verified)!==canonicalDatasetJson(data))throw Error('復元の照合に失敗しました。現在のデータを保持しています');
 await runTransaction(store(),async tx=>{const c=(await tx.get(ref())).data() as Control;check(c,input.expected);tx.update(meta,{ready:true});tx.update(ref(),{activeDatasetId:id,previousDatasetId:c.activeDatasetId,revision:c.revision+1});});
}
/** Dedicated first import. Unlike restoreBackup, cannot replace ANY existing LIVE record. */
async function importInitialArchive(input:any){
 if(input.confirmed!==true || input.confirmationText!=='初期登録を承認')
   throw Error('初期登録の明示的な承認が必要です');
 const old=await read();
 check(old.control,input.expected);
 const data=validateDataset(input.data);
 validateFreshInitialArchive(old.data,data,old.songs);
 // restore stages a new dataset and verifies every document before switching
 // the active pointer. Its final revision check also detects concurrent edits.
 await restore({...input,data,confirmed:true});
 return {ok:true,shows:data.shows.length,setlists:data.shows.filter(s=>s.hasSavedSetlist).length};
}
export async function invoke<T=unknown>(name:string,input:any={}):Promise<T>{store();let result:unknown;if(name==='bootstrap'){result=await runTransaction(store(),async tx=>{const r=ref(),s=await tx.get(r);if(s.exists())return s.data();const id=crypto.randomUUID(),control={activeDatasetId:id,previousDatasetId:null,revision:0};tx.set(doc(store(),path(id)),{ready:true,schemaVersion:1});tx.set(r,control);return control;});}else if(name==='getState')result=await read();else if(name==='syncUniverse')result=await requestSync({db:store(),auth,doc,runTransaction,serverTimestamp,getDocFromServer});else if(name==='saveDatasetChanges')result=await save(input);else if(name==='saveEntity'){const current=await read();check(current.control,input.expected);const c=input.collection as Collection,entity=schemas[c].parse(input.entity),old=current.data[c].find(e=>e.id===entity.id);if((old?.revision??null)!==input.expectedEntityRevision)throw Error('編集が競合しています');(current.data[c] as unknown[])=[...current.data[c].filter(e=>e.id!==entity.id),entity];result=await save({...input,data:current.data});}else if(name==='importInitialArchive')result=await importInitialArchive(input);else if(name==='restoreBackup')result=await restore(input);else if(name==='rollbackRestore'){if(!input.confirmedLossOfEdits)throw Error('確認が必要です');result=await runTransaction(store(),async tx=>{const c=(await tx.get(ref())).data() as Control;check(c,input.expected);if(!c.previousDatasetId)throw Error('戻せるデータがありません');const meta=await tx.get(doc(store(),path(c.previousDatasetId)));if(!meta.data()?.ready)throw Error('直前データを確認できません');tx.update(ref(),{activeDatasetId:c.previousDatasetId,revision:c.revision+1});});}else if(name==='confirmSongMerge'){if(!input.confirmed)throw Error('確認が必要です');const c=await read();result=await save({...input,data:mergeLocalSong(c.data,input.localRef,input.universeRef)});}else throw Error('未対応の操作です');return result as T;}
export async function login(){if(auth)await signInWithPopup(auth,new GoogleAuthProvider());}
export async function logout(){if(auth)await signOut(auth);}
export function watchState(uid:string,refresh:()=>void,fail:(e:Error)=>void){return onSnapshot(doc(store(),'users',uid,'control','state'),{includeMetadataChanges:true},s=>{if(!s.metadata.fromCache)refresh();},fail);}
