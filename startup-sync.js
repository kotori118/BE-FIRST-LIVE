// Pure startup coordinator; no persistent browser data or offline mode.
export function startCatalog({read,refresh,render,state}) {
  let stopped=false;
  const show=value=>{if(!stopped)render(value);};
  const notify=value=>{if(!stopped)state(value);};
  const done=(async()=>{
    notify('loading');
    try { show(await read()); } catch { notify('initial-error'); }
    if(stopped)return;
    notify('refreshing');
    try { await refresh(); if(!stopped){show(await read());notify('ready');} }
    catch(error){notify(error.code==='not-configured'?'not-configured':'refresh-error');}
  })();
  return {done,stop(){stopped=true;}};
}
