import { spawn } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { loadCasas } from "./src/storage.js";

const [nome, cred] = process.argv.slice(2);
const casa = loadCasas()[nome];
const i = cred.indexOf(":");
const body = JSON.parse(casa.bodyTemplate);
body.json.username = cred.slice(0, i);
body.json.password = cred.slice(i + 1);

const exe = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
].find((p) => fs.existsSync(p));
if (!exe) { console.log("nao achei Chrome nem Edge"); process.exit(0); }

const UA = casa.headers?.["user-agent"]
  || "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/157.0.0.0 Safari/537.36 Edg/157.0.0.0";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const port = 9333;
const perfil = path.join(os.tmpdir(), "chk_" + Date.now());

const proc = spawn(exe, [
  "--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${perfil}`,
  "--no-first-run", "--no-default-browser-check", "--disable-gpu",
  "--disable-blink-features=AutomationControlled", `--user-agent=${UA}`, "--lang=pt-BR",
], { stdio: "ignore" });

let wsUrl = null;
for (let t = 0; t < 40 && !wsUrl; t++) {
  try { const r = await fetch(`http://127.0.0.1:${port}/json/version`); if (r.ok) wsUrl = (await r.json()).webSocketDebuggerUrl; } catch {}
  if (!wsUrl) await sleep(500);
}
if (!wsUrl) { console.log("chrome nao abriu"); proc.kill(); process.exit(0); }

const ws = new WebSocket(wsUrl);
const pend = new Map();
let seq = 0;
ws.addEventListener("message", (ev) => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } });
const cmd = (method, params, sessionId) => new Promise((res) => { const n = ++seq; pend.set(n, res); ws.send(JSON.stringify({ id: n, method, params, ...(sessionId ? { sessionId } : {}) })); });
await new Promise((r) => ws.addEventListener("open", r));

const criado = await cmd("Target.createTarget", { url: "about:blank" });
const sessionId = (await cmd("Target.attachToTarget", { targetId: criado.result.targetId, flatten: true })).result.sessionId;
await cmd("Page.enable", {}, sessionId);
await cmd("Runtime.enable", {}, sessionId);
await cmd("Emulation.setUserAgentOverride", { userAgent: UA, acceptLanguage: "pt-BR,pt;q=0.9", platform: "Win32" }, sessionId);

await cmd("Page.navigate", { url: `https://${casa.domain}/` }, sessionId);
await sleep(7000);

const api = `https://${casa.apiHost}/api/frontend/trpc`;
const cdata = `${casa.tenantId}=${casa.deviceId}`;

const expr = `(async()=>{
  const log = [];
  const h = {"content-type":"application/json","tenantid":${JSON.stringify(casa.tenantId)},"x-request-source":"web_client",
    "x-client-version":${JSON.stringify(casa.clientVersion)},"x-device-id":${JSON.stringify(casa.deviceId)},
    "x-device-type":"DesktopOS","x-trace-id":"ABCDEFGH","client-language":"pt-BR"};

  const tk = (sitekey, action) => new Promise((res, rej) => {
    const d = document.createElement("div");
    d.style.cssText = "position:fixed;top:10px;left:10px;width:320px;height:90px;z-index:999999;background:#fff";
    document.body.appendChild(d);
    const t = setTimeout(() => rej(new Error("timeout " + action)), 90000);
    window.turnstile.render(d, { sitekey, action, cData: ${JSON.stringify(cdata)}, size: "flexible",
      callback: (v) => { clearTimeout(t); res(v); },
      "error-callback": (e) => { clearTimeout(t); rej(new Error("erro " + action + " " + e)); } });
  });

  const xTok = await tk("0x4AAAAAAB0oRY23FyZnllMo", "api_protection");
  const hTok = await tk("0x4AAAAAAAiHEkDee-yqSdMj", "login");
  log.push("xTok=" + xTok.length + " hTok=" + hTok.length);

  const payload = JSON.parse(${JSON.stringify(JSON.stringify(body))});
  payload.json.hToken = hTok;
  if (payload.meta && payload.meta.values) delete payload.meta.values.hToken;

  const r = await fetch(${JSON.stringify(api)} + "/auth.login", {
    method:"POST", headers: {...h, "x-token": xTok}, body: JSON.stringify(payload), credentials:"omit"});
  const t = await r.text();
  log.push("login=" + r.status + " " + t.replace(/\\s+/g," ").slice(0, 200));
  if (r.status !== 200) return log.join("\\n");

  let j; try { j = JSON.parse(t); } catch { return log.join("\\n") + "\\n(json invalido)"; }
  const tkv = j?.result?.data?.json?.data?.token || j?.result?.data?.json?.token || j?.result?.data?.token || j?.token;
  if (!tkv) return log.join("\\n") + "\\n(sem token)";

  const rt = await fetch(${JSON.stringify(api)} + "/auth.token", {
    method:"POST", headers: {...h, authorization: "Bearer " + tkv}, body: '{"json":{}}', credentials:"omit"});
  const jt = await rt.json();
  const d = jt?.result?.data?.json?.data || jt?.result?.data?.json || {};
  log.push("authToken=" + rt.status + " " + JSON.stringify(jt).slice(0, 400));
  if (!d.authTag) return log.join("\\n");

  const hh = {...h, authorization: "Bearer " + tkv, "x-auth-tag": d.authTag, "x-token-data": d.tokenData || "", "x-tag": d.tag || "", userid: String(d.userId || ""), channelid: "0"};
  for (const proc of ["user.details", "user.assets", "vip.info"]) {
    const rr = await fetch(${JSON.stringify(api)} + "/" + proc + "?input=" + encodeURIComponent('{"json":{}}'), {headers: hh, credentials:"omit"});
    const tt = await rr.text();
    log.push(proc + "=" + rr.status + " " + tt.replace(/\\s+/g," ").slice(0, 200));
  }
  return log.join("\\n");
})()`;

const ev = await cmd("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true }, sessionId);
console.log(ev.result?.exceptionDetails ? "EXC: " + ev.result.exceptionDetails.text + " " + (ev.result.exceptionDetails.exception?.description || "") : ev.result?.result?.value);

ws.close();
proc.kill();
try { fs.rmSync(perfil, { recursive: true, force: true }); } catch {}
process.exit(0);