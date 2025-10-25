import {hexToBytes, bytesToString, validateFrame} from './common.js';

const statusEl = document.getElementById('status');
const decapEl = document.getElementById('decap');
const resultEl = document.getElementById('result');
const hexEl = document.getElementById('hex');
const historyEl = document.getElementById('history');
const btnRefresh = document.getElementById('btnRefresh');
let lastFrame = null;
let lastMediaUrl = null;
// When true, loadHistory will not auto-display the most recent frame.
// Used when the user clicks "Actualizar" to send+clear the current view
// but we don't want the freshly-saved frame to immediately reappear.
let suppressAutoDisplay = false;

function setStatus(msg){ statusEl.textContent = msg; }

async function loadHistory(){
  setStatus('Cargando historial...');
  const res = await fetch('/api/history');
  const hist = await res.json();
  historyEl.innerHTML = '';
  // Show newest first
  for (let i = hist.length - 1; i >= 0; i--) {
    const item = hist[i];
    const div = document.createElement('div');
    div.className = 'layer';
    const date = new Date(item._ts || Date.now()).toLocaleString();
    // create content area and delete button
    const pre = document.createElement('pre');
    pre.textContent = JSON.stringify(item, null, 2);
    const header = document.createElement('h3');
    header.textContent = date;
    const controls = document.createElement('div');
    controls.style.marginTop = '6px';
    const btnDel = document.createElement('button');
    btnDel.textContent = 'Eliminar';
    btnDel.style.marginLeft = '8px';
    btnDel.addEventListener('click', async ()=>{
      const ok = confirm('¿Eliminar esta entrada del historial?');
      if (!ok) return;
      await deleteHistory(item._ts);
    });
    controls.appendChild(btnDel);

    div.appendChild(header);
    div.appendChild(pre);
    div.appendChild(controls);
    historyEl.appendChild(div);
  }
  if (hist.length) {
     // Only auto-display if we're not suppressing AND the view is empty
     // This prevents re-displaying after manual clear via Actualizar
     if (!suppressAutoDisplay && decapEl.textContent === '') {
       processFrame(hist[hist.length-1]);
     } else {
       setStatus('Historial cargado (vista no actualizada).');
     }
   } else {
     setStatus('Sin historial.');
   }
   if (!suppressAutoDisplay) setStatus('Conectado. Historial cargado.');
}

function processFrame(frame){
  try{
    // keep reference to the last frame shown so "Actualizar" can act on it
    lastFrame = frame;
    const bytes = hexToBytes(frame.frameHex);
    const check = validateFrame(bytes);
    decapEl.textContent = JSON.stringify({
      srcIP: check.srcIP, dstIP: check.dstIP,
      srcPort: check.srcPort, dstPort: check.dstPort,
      contentType: check.contentType, bytes: bytes.length
    }, null, 2);
    hexEl.textContent = frame.frameHex;
    if (check.ok){
        // clear previous media URL if any
        if (lastMediaUrl){ URL.revokeObjectURL(lastMediaUrl); lastMediaUrl = null; }

        // Handle different content types: text, image, video, others
        if (check.contentType && check.contentType.startsWith('text/')) {
          const len = frame.appHeader.len;
          const payload = bytes.slice(bytes.length - len);
          const payloadText = bytesToString(payload);
          resultEl.textContent = `✅ Integridad OK\nPayload: ${payloadText}`;
        } else if (check.contentType && check.contentType.startsWith('image/')){
          // Image: create a blob and display
          const blob = new Blob([check.payload], {type: check.contentType});
          const url = URL.createObjectURL(blob);
          lastMediaUrl = url;
          resultEl.innerHTML = '';
          const img = document.createElement('img');
          img.src = url;
          img.style.maxWidth = '100%';
          img.alt = 'Imagen recibida';
          resultEl.appendChild(document.createTextNode('✅ Integridad OK\nImagen recibida:\n'));
          resultEl.appendChild(img);
        } else if (check.contentType && check.contentType.startsWith('video/')){
          // Video: create a blob and display with controls
          const blob = new Blob([check.payload], {type: check.contentType});
          const url = URL.createObjectURL(blob);
          lastMediaUrl = url;
          resultEl.innerHTML = '';
          const vid = document.createElement('video');
          vid.controls = true;
          vid.src = url;
          vid.style.maxWidth = '100%';
          resultEl.appendChild(document.createTextNode('✅ Integridad OK\nVideo recibido:\n'));
          resultEl.appendChild(vid);
        } else {
          resultEl.textContent = '✅ Integridad OK\nPayload: (binario)';
        }
    } else {
      resultEl.textContent = '❌ Error detectado: FCS/Checksum no válido.';
    }
  }catch(e){
    resultEl.textContent = '❌ No se pudo decapsular el frame.';
  }
}

function connectWS(){
  const wsProto = location.protocol === 'https:' ? 'wss' : 'ws';
  const wsUrl = `${wsProto}://${location.host}`;
  const ws = new WebSocket(wsUrl);
  ws.onopen = ()=> setStatus('Conectado al servidor.');
  ws.onmessage = (ev)=>{
    const msg = JSON.parse(ev.data);
    if (msg.type === 'frame') processFrame(msg.payload);
  };
  ws.onclose = ()=> {
    setStatus('Desconectado. Intentando reconectar...');
    setTimeout(connectWS, 1000);
  };
}

async function deleteHistory(ts){
  try{
    setStatus('Eliminando entrada...');
    const res = await fetch(`/api/history/${ts}`, {method: 'DELETE'});
    if (res.ok){
      setStatus('Entrada eliminada. Actualizando...');
      // Prevent loadHistory from auto-displaying the latest frame after deletion
      suppressAutoDisplay = true;
      // clear the current "Último frame recibido" view so it doesn't reappear
      decapEl.textContent = '';
      // revoke media url if any
      if (lastMediaUrl){ URL.revokeObjectURL(lastMediaUrl); lastMediaUrl = null; }
      resultEl.textContent = '';
      hexEl.textContent = '';
      lastFrame = null;
      await loadHistory();
      // keep suppressAutoDisplay briefly disabled so future incoming frames behave normally
      suppressAutoDisplay = false;
    } else {
      setStatus('No se pudo eliminar la entrada.');
    }
  }catch(e){
    console.error(e);
    setStatus('Error al eliminar.');
  }
}

function refreshPage(){
  // If there's nothing to process (already cleared), just update status
  if (!lastFrame && decapEl.textContent === '' && resultEl.textContent === '' && hexEl.textContent === ''){
    setStatus('Vista ya está limpia.');
    return;
  }

  // Behave like the Emisor "Reiniciar" button AND also persist the last frame
  // to history (if it isn't already). Do this without causing the saved frame
  // to immediately re-display in the "Último frame recibido" area.
  (async () => {
    try{
      if (btnRefresh) btnRefresh.disabled = true;
      // If there's a lastFrame, try to persist it (avoid duplicates)
      if (lastFrame){
        try{
          // suspend auto-display while we update history
          suppressAutoDisplay = true;
          // check current history for duplication
          const r = await fetch('/api/history');
          const h = await r.json();
          const exists = h.some(item => item.frameHex && lastFrame.frameHex && item.frameHex === lastFrame.frameHex);
          if (!exists){
            setStatus('Guardando último frame en historial...');
            await fetch('/api/frame', {
              method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(lastFrame)
            });
          } else {
            setStatus('Último frame ya en historial. Limpiando vista...');
          }
        }catch(e){
          console.error('Error guardando frame:', e);
          // still proceed to clear the view
        }
      }

      // Clear UI (behave like Emisor reset)
  decapEl.textContent = '';
  // revoke media url if any
  if (lastMediaUrl){ URL.revokeObjectURL(lastMediaUrl); lastMediaUrl = null; }
  resultEl.textContent = '';
  hexEl.textContent = '';
      lastFrame = null;

      // refresh history list (will respect suppressAutoDisplay)
      await loadHistory();
      setStatus('Vista reiniciada. Historial actualizado.');
    }catch(e){
      console.error(e);
      setStatus('Error al reiniciar y guardar.');
    } finally {
      suppressAutoDisplay = false;
      if (btnRefresh) btnRefresh.disabled = false;
    }
  })();
}

btnRefresh?.addEventListener('click', refreshPage);

await loadHistory();
connectWS();
