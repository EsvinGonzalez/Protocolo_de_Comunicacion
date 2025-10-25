export function toHex(bytes){return Array.from(bytes).map(b=>b.toString(16).padStart(2,'0')).join(' ');}
export function hexToBytes(hexStr){const c=hexStr.replace(/\s+/g,'');const o=new Uint8Array(c.length/2);for(let i=0;i<o.length;i++)o[i]=parseInt(c.substr(i*2,2),16);return o;}
export function stringToBytes(str){return new TextEncoder().encode(str);} export function bytesToString(bytes){return new TextDecoder().decode(bytes);}
export function numToBytes(num,size){const arr=new Uint8Array(size);for(let i=size-1;i>=0;i--){arr[i]=num&0xff;num>>=8;}return arr;}
export function ipToBytes(ip){return new Uint8Array(ip.split('.').map(x=>parseInt(x,10)));}
export function macToBytes(mac){return new Uint8Array(mac.split(':').map(x=>parseInt(x,16)));}
export function concatBytes(...arrs){let t=arrs.reduce((s,a)=>s+a.length,0);const o=new Uint8Array(t);let p=0;for(const a of arrs){o.set(a,p);p+=a.length;}return o;}
export function checksum16(bytes){let sum=0;for(let i=0;i<bytes.length;i+=2){const w=(bytes[i]<<8)+(bytes[i+1]||0);sum+=w;sum=(sum&0xFFFF)+(sum>>>16);}return (~sum)&0xFFFF;}
export function crc16(bytes){let crc=0xFFFF;for(let b of bytes){crc^=(b<<8);for(let i=0;i<8;i++){if(crc&0x8000)crc=(crc<<1)^0x1021;else crc<<=1;crc&=0xFFFF;}}return crc;}
export function buildFrame({appHeader, transHeader, netHeader, linkHeader, payload}){
  const appBytes=concatBytes(stringToBytes(appHeader.contentType+'\0'), numToBytes(appHeader.len,4));
  const transBytes=concatBytes(numToBytes(transHeader.srcPort,2), numToBytes(transHeader.dstPort,2),
    numToBytes(transHeader.seq,4), numToBytes(transHeader.ack,4),
    new Uint8Array([(transHeader.flags.SYN?1:0)|(transHeader.flags.ACK?2:0)|(transHeader.flags.FIN?4:0)]),
    numToBytes(transHeader.checksum,2));
  const netBytes=concatBytes(new Uint8Array([(netHeader.version<<4)]), new Uint8Array([netHeader.ttl]),
    new Uint8Array([netHeader.proto]), ipToBytes(netHeader.srcIP), ipToBytes(netHeader.dstIP));
  const linkNoFcs=concatBytes(macToBytes(linkHeader.srcMAC), macToBytes(linkHeader.dstMAC), numToBytes(linkHeader.type,2));
  const noFcs=concatBytes(linkNoFcs, netBytes, transBytes, appBytes, payload);
  const fcs=crc16(noFcs); const frame=concatBytes(linkNoFcs, numToBytes(fcs,2), netBytes, transBytes, appBytes, payload);
  return {frame,fcs};
}
export function validateFrame(bytes){
  let off=0; const srcMAC=bytes.slice(off,off+6); off+=6; const dstMAC=bytes.slice(off,off+6); off+=6;
  const type=(bytes[off]<<8)+bytes[off+1]; off+=2; const fcs=(bytes[off]<<8)+bytes[off+1]; off+=2;
  const version=bytes[off]>>4; off+=1; const ttl=bytes[off]; off+=1; const proto=bytes[off]; off+=1;
  const srcIP=bytes.slice(off,off+4); off+=4; const dstIP=bytes.slice(off,off+4); off+=4;
  const srcPort=(bytes[off]<<8)+bytes[off+1]; off+=2; const dstPort=(bytes[off]<<8)+bytes[off+1]; off+=2;
  const seq=(bytes[off]<<24)+(bytes[off+1]<<16)+(bytes[off+2]<<8)+bytes[off+3]; off+=4;
  const ack=(bytes[off]<<24)+(bytes[off+1]<<16)+(bytes[off+2]<<8)+bytes[off+3]; off+=4;
  const flags=bytes[off]; off+=1; const chksum=(bytes[off]<<8)+bytes[off+1]; off+=2;
  let i=off; while(i<bytes.length && bytes[i]!==0) i++; const contentTypeBytes=bytes.slice(off,i); off=i+1;
  const contentType=bytesToString(contentTypeBytes); const len=(bytes[off]<<24)+(bytes[off+1]<<16)+(bytes[off+2]<<8)+bytes[off+3]; off+=4;
  const payload=bytes.slice(off);
  const pseudo=new Uint8Array([ (srcPort>>8)&0xff, srcPort&0xff, (dstPort>>8)&0xff, dstPort&0xff,
    (seq>>24)&0xff,(seq>>16)&0xff,(seq>>8)&0xff,seq&0xff, (ack>>24)&0xff,(ack>>16)&0xff,(ack>>8)&0xff,ack&0xff, flags, 0x00 ]);
  const chk2=checksum16(concatBytes(pseudo, payload));
  const linkNoFcs=concatBytes(srcMAC, dstMAC, new Uint8Array([(type>>8)&0xff, type&0xff]));
  const frameNoFcs=concatBytes(linkNoFcs, bytes.slice(14+2));
  const fcs2=crc16(frameNoFcs);
  return { ok:(chksum===chk2)&&(fcs===fcs2)&&(payload.length===len), contentType, payload,
    srcIP:Array.from(srcIP).join('.'), dstIP:Array.from(dstIP).join('.'), srcPort, dstPort };
}
