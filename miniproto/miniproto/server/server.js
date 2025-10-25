import express from 'express';
import cors from 'cors';
import { WebSocketServer } from 'ws';
import http from 'http';
import fs from 'fs';
import path from 'path';
import os from 'os';

const app = express();
app.use(cors());
app.use(express.json({limit: '50mb'}));

const __dirname = path.resolve();
// The project layout places the front-end `app/` folder one level above this server
// script (miniproto/app). Use '..' to reach it. Store history in this server's
// own `data/` directory (miniproto/server/data).
const APP_DIR = path.join(__dirname, '..', 'app');
const DATA_DIR = path.join(__dirname, 'data');
const HISTORY_FILE = path.join(DATA_DIR, 'history.json');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, {recursive: true});
if (!fs.existsSync(HISTORY_FILE)) fs.writeFileSync(HISTORY_FILE, '[]', 'utf-8');

app.use('/app', express.static(APP_DIR));

// Return the client's IP as seen by the server (useful for autofill in the emisor)
app.get('/api/whoami', (req, res) => {
  try {
    let ip = req.socket.remoteAddress || req.ip || '';
    // normalize IPv4-mapped IPv6 addresses
    if (ip.startsWith('::ffff:')) ip = ip.replace('::ffff:', '');
    res.json({ ip });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

app.get('/api/history', (req, res) => {
  const content = fs.readFileSync(HISTORY_FILE, 'utf-8');
  res.json(JSON.parse(content));
});

app.post('/api/frame', (req, res) => {
  const frame = req.body;
  frame._ts = Date.now();
  const list = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf-8'));
  list.push(frame);
  fs.writeFileSync(HISTORY_FILE, JSON.stringify(list, null, 2));
  broadcast(JSON.stringify({type:'frame', payload: frame}));
  res.json({ok:true});
});

// DELETE a single history entry by timestamp
app.delete('/api/history/:ts', (req, res) => {
  try {
    const ts = Number(req.params.ts);
    const list = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf-8')) || [];
    const filtered = list.filter(item => Number(item._ts) !== ts);
    fs.writeFileSync(HISTORY_FILE, JSON.stringify(filtered, null, 2));
    // notify clients that history changed
    broadcast(JSON.stringify({type: 'history-deleted', payload: {ts}}));
    res.json({ok:true, removed: list.length - filtered.length});
  } catch (err) {
    console.error('Error deleting history entry:', err);
    res.status(500).json({ok:false, error: String(err)});
  }
});

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

function broadcast(msg){
  wss.clients.forEach(c => { if (c.readyState === 1) c.send(msg); });
}

wss.on('connection', ws => {
  ws.send(JSON.stringify({type:'hello', payload:'Welcome to MiniProto WS'}));
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  const nets = os.networkInterfaces();
  const IPs = [];
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) IPs.push(net.address);
    }
  }
  console.log('MiniProto LAN server running:');
  IPs.forEach(ip => console.log(`  http://${ip}:${PORT}/app/index.html (Emisor)`));
  IPs.forEach(ip => console.log(`  http://${ip}:${PORT}/app/receptor.html (Receptor)`));
});
