import fs from "fs";
import axios from "axios";
const TLS = "http://127.0.0.1:3334";
const casa = JSON.parse(fs.readFileSync("db/casas.json","utf8"))[process.argv[2]||"w78777"];
const conta = process.argv[3]||"";
const proxies = fs.readFileSync("proxy.txt","utf8").split(/\r?\n/).map(l=>l.trim()).filter(Boolean);
const norm = l => { if(/^https?:\/\//.test(l)) return l; const p=l.split(":"); return p.length===4?`http://${p[2]}:${p[3]}@${p[0]}:${p[1]}`:l; };
const corta = (s,n=200)=>String(s||"").replace(/\s+/g," ").slice(0,n);
async function pedir(url,headers,body,proxy){ const t=Date.now(); try{ const r=await axios.post(`${TLS}/${body?"post":"get"}`,{url,headers,body:body||"",...(proxy?{proxy}:{})},{timeout:25000,validateStatus:()=>true}); return {status:r.data?.status,text:r.data?.text,tempo:Date.now()-t}; }catch(e){ return {erro:e.code||e.message,tempo:Date.now()-t}; } }
try{ const h=await axios.get(`${TLS}/health`,{timeout:4000}); console.log(`tlsproxy ok pool=${h.data?.pool} sem=${h.data?.sem}`); }catch(e){ console.log(`tlsproxy MORTO ${e.code||e.message}`); process.exit(0); }
const cab={...(casa.headers||{}),tenantid:casa.tenantId,"x-client-version":casa.clientVersion,"x-device-type":casa.deviceType,"x-device-id":casa.deviceId};
const corpo=casa.bodyTemplate.replace(/"username":"[^"]*"/,`"username":"${conta.split(":")[0]}"`).replace(/"password":"[^"]*"/,`"password":"${conta.split(":").slice(1).join(":")}"`);
const url=`https://${casa.apiHost}${casa.loginPath}`;
const d=await pedir(url,cab,corpo,null);
console.log(`direto: ${d.status?`HTTP ${d.status} em ${d.tempo}ms`:d.erro}`);
if(d.text) console.log("  "+corta(d.text));
for(const raw of proxies.slice(0,2)){ const r=await pedir(url,cab,corpo,norm(raw)); console.log(`proxy: ${r.status?`HTTP ${r.status} em ${r.tempo}ms`:r.erro}`); if(r.text&&r.status!==200) console.log("  "+corta(r.text,120)); }
process.exit(0);
