export async function requestSync({db,auth,doc,runTransaction,serverTimestamp,getDocFromServer}){
  const endpoint=localStorage.getItem('liveArchiveSyncEndpoint')||'';
  if(!/^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(endpoint))throw Object.assign(new Error('not configured'),{code:'not-configured'});
  const id=crypto.randomUUID(),ref=doc(db,'syncRequests','current');
  await runTransaction(db,async tx=>{await tx.get(ref);tx.set(ref,{requestId:id,requestedAt:serverTimestamp(),state:'PENDING'});});
  // The response is opaque; the authoritative completion is read from protected Firestore.
  void fetch(endpoint,{method:'POST',mode:'no-cors',credentials:'omit',headers:{'Content-Type':'text/plain'},body:JSON.stringify({requestId:id})}).catch(()=>{});
  for(let i=0;i<30;i++){
    if(!auth?.currentUser||!navigator.onLine)throw new Error('disconnected');
    await new Promise(resolve=>setTimeout(resolve,2000));
    const result=await getDocFromServer(ref),value=result.data();
    if(value?.requestId!==id)throw new Error('replaced');
    if(value.state==='DONE')return;
    if(value.state==='ERROR')throw new Error('sync failed');
  }
  throw new Error('sync timeout');
}
