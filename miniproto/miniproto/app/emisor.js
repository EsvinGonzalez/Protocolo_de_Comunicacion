import {toHex, stringToBytes, numToBytes, concatBytes, checksum16, buildFrame} from './common.js';

const ui = {
  contentType: document.getElementById('contentType'),
  textInput: document.getElementById('textInput'),
  fileInput: document.getElementById('fileInput'),
  txType: document.getElementById('txType'),
  srcIP: document.getElementById('srcIP'),
  dstIP: document.getElementById('dstIP'),
  srcMAC: document.getElementById('srcMAC'),
  dstMAC: document.getElementById('dstMAC'),
  srcPort: document.getElementById('srcPort'),
  dstPort: document.getElementById('dstPort'),
  ttl: document.getElementById('ttl'),
  mtu: document.getElementById('mtu'),
  btnEncap: document.getElementById('btnEncap'),
  btnSend: document.getElementById('btnSend'),
  btnError: document.getElementById('btnError'),
  btnReset: document.getElementById('btnReset'),
  layerApp: document.querySelector('#layerApp pre'),
  layerTrans: document.querySelector('#layerTrans pre'),
  layerNet: document.querySelector('#layerNet pre'),
  layerLink: document.querySelector('#layerLink pre'),
  layerPhy: document.querySelector('#layerPhy pre'),
  log: document.getElementById('log'),
};

let current = { frameHex: '', frameBytes: null, frameObj: null };

function log(msg){ ui.log.value += msg + '\n'; ui.log.scrollTop = ui.log.scrollHeight; }

function autoDst(txType){
  if (txType === 'broadcast') return { ip:'255.255.255.255', mac:'FF:FF:FF:FF:FF:FF' };
  if (txType === 'multicast') {
    const ip = '239.1.1.1';
    const parts = ip.split('.').map(n=>parseInt(n,10));
    const mac = `01:00:5E:${(parts[1]&0x7F).toString(16).padStart(2,'0')}:${parts[2].toString(16).padStart(2,'0')}:${parts[3].toString(16).padStart(2,'0')}`.toUpperCase();
    return { ip, mac };
  }
  return null;
}

function readSelectedFile(){
  return new Promise((resolve) => {
    const f = ui.fileInput.files?.[0];
    if (!f) return resolve(null);
    const reader = new FileReader();
    reader.onload = () => resolve(new Uint8Array(reader.result));
    reader.readAsArrayBuffer(f);
  });
}

async function encapsulate(){
  ui.log.value='';
  ui.layerApp.textContent = ui.layerTrans.textContent = ui.layerNet.textContent = ui.layerLink.textContent = ui.layerPhy.textContent = '';
  current = { frameHex:'', frameBytes:null, frameObj:null };

  const contentType = ui.contentType.value;
  const txType = ui.txType.value;
  let dstIp = ui.dstIP.value.trim();
  let dstMac = ui.dstMAC.value.trim();
  const auto = autoDst(txType);
  if (auto){ dstIp = auto.ip; dstMac = auto.mac; ui.dstIP.value = dstIp; ui.dstMAC.value = dstMac; }

  let payload;
  const fileBytes = await readSelectedFile();
  if (fileBytes) payload = fileBytes; else payload = stringToBytes(ui.textInput.value || 'Hola, Redes!');

  const appHeader = { contentType, len: payload.length };
  ui.layerApp.textContent = JSON.stringify(appHeader, null, 2);

  const transHeader = {
    srcPort: parseInt(ui.srcPort.value,10)||4000,
    dstPort: parseInt(ui.dstPort.value,10)||5000,
    seq: Math.floor(Math.random()*1e6),
    ack: 0,
    flags: {SYN:true,ACK:false,FIN:false},
    checksum: 0
  };
  const tmp = concatBytes(
    numToBytes(transHeader.srcPort,2),
    numToBytes(transHeader.dstPort,2),
    numToBytes(transHeader.seq,4),
    numToBytes(transHeader.ack,4),
    new Uint8Array([ (transHeader.flags.SYN?1:0) | (transHeader.flags.ACK?2:0) | (transHeader.flags.FIN?4:0) ]),
    new Uint8Array([0])
  );
  transHeader.checksum = checksum16(concatBytes(tmp, payload));
  ui.layerTrans.textContent = JSON.stringify(transHeader, null, 2);

  const netHeader = { version:4, ttl: parseInt(ui.ttl.value,10)||64, proto:17, srcIP: ui.srcIP.value.trim(), dstIP: dstIp };
  ui.layerNet.textContent = JSON.stringify(netHeader, null, 2);

  const linkHeader = { srcMAC: ui.srcMAC.value.trim(), dstMAC: dstMac, type: 0x0800, fcs: 0 };
  const { frame } = buildFrame({appHeader, transHeader, netHeader, linkHeader, payload});

  const hex = toHex(frame);
  current.frameHex = hex;
  current.frameBytes = frame;
  current.frameObj = {appHeader, transHeader, netHeader, linkHeader, txType, frameHex:hex, frameLen: frame.length};

  ui.layerLink.textContent = JSON.stringify(linkHeader, null, 2);
  ui.layerPhy.textContent = hex;

  const mtu = parseInt(ui.mtu.value,10)||512;
  if (frame.length > mtu) log(`⚠️ MTU=${mtu}: frame de ${frame.length} bytes. Se requiere fragmentación (simulada).`);
  else log(`✅ Encapsulación OK. Tamaño total: ${frame.length} bytes.`);

  ui.btnSend.disabled = false;
  ui.btnError.disabled = false;
}

function introduceError(){
  if (!current.frameBytes) return;
  const bytes = new Uint8Array(current.frameBytes);
  const pos = Math.max(20, Math.floor(Math.random()*bytes.length));
  bytes[pos] ^= 0x01;
  current.frameBytes = bytes;
  current.frameHex = toHex(bytes);
  ui.layerPhy.textContent = current.frameHex;
  log(`⚡ Se introdujo un error en el byte ${pos}.`);
}

async function sendToLAN(){
  if (!current.frameObj) return;
  const payload = { ...current.frameObj };
  payload.frameHex = current.frameHex;
  const res = await fetch('/api/frame', {
    method: 'POST',
    headers: {'Content-Type':'application/json'},
    body: JSON.stringify(payload)
  });
  if (res.ok) log('📡 Enviado a LAN y guardado en historial.');
  else log('❌ No se pudo enviar al servidor.');
}

function resetAll(){
  ui.textInput.value = ''; ui.fileInput.value = '';
  ui.layerApp.textContent = ui.layerTrans.textContent = ui.layerNet.textContent = ui.layerLink.textContent = ui.layerPhy.textContent = '';
  ui.log.value = '';
  current = { frameHex:'', frameBytes:null, frameObj:null };
  ui.btnSend.disabled = true; ui.btnError.disabled = true;
}

ui.btnEncap.addEventListener('click', encapsulate);
ui.btnError.addEventListener('click', introduceError);
ui.btnSend.addEventListener('click', sendToLAN);
ui.btnReset.addEventListener('click', resetAll);

log('Bienvenido. Encapsula y luego usa "Transmitir a LAN".');

function genLocalMac(){
  const h = ()=>Math.floor(Math.random()*256).toString(16).padStart(2,'0');
  return `02:00:${h()}:${h()}:${h()}:${h()}`.toUpperCase();
}

async function applyAutofill(){
  try{
    // get client IP as seen by server
    const res = await fetch('/api/whoami');
    if (res.ok){
      const data = await res.json();
      if (data.ip && (!ui.srcIP.value || ui.srcIP.value.trim()==='')) ui.srcIP.value = data.ip;
    }
    // fill MAC if empty (simulated)
    if (!ui.srcMAC.value || ui.srcMAC.value.trim()==='') ui.srcMAC.value = genLocalMac();
    // sensible defaults
    if (!ui.srcPort.value) ui.srcPort.value = 4000;
    if (!ui.dstPort.value) ui.dstPort.value = 5000;
    if (!ui.ttl.value) ui.ttl.value = 64;
    if (!ui.mtu.value) ui.mtu.value = 1500;
  }catch(e){
    console.warn('Autofill failed:', e);
  }
}

// Run autofill on load (if enabled)
applyAutofill();
