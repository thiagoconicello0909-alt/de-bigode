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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const port = 9333;
const perfil = path.join(os.tmpdir(), "chk_" + Date.now());
const proc = spawn(exe, ["--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${perfil}`, "--no-first-run", "--no-default-browser-check", "--disable-gpu"], { stdio: "ignore" });

let wsUrl = null;
for (let t = 0; t < 40 && !wsUrl; t++) {
  try { const r = await fetch(`http://127.0.0.1:${port}/json/version`); if (r.ok) wsUrl = (await r.json()).webSocketDebuggerUrl; } catch {}
  if (!wsUrl) await sleep(500);
}
if (!wsUrl) { console.log("chrome nao abriu o debug"); proc.kill(); process.exit(0); }

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

await cmd("Page.navigate", { url: `https://${casa.domain}/` }, sessionId);
await sleep(7000);

const avaliar = async (expr) => {
  const ev = await cmd("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true }, sessionId);
  if (ev.result?.exceptionDetails) return "EXC: " + ev.result.exceptionDetails.text + " " + (ev.result.exceptionDetails.exception?.description || "");
  const v = ev.result?.result?.value;
  return typeof v === "string" ? v.replace(/\s+/g, " ") : JSON.stringify(v);
};

const url = `https://${casa.apiHost}${casa.loginPath}`;
const cdata = `${casa.tenantId}=${casa.deviceId}`;

const expr = `(async()=>{
  const cdata = ${JSON.stringify(cdata)};
  const url = ${JSON.stringify(url)};
  const payload = ${JSON.stringify(JSON.stringify(body))};

  const tk = (sitekey, action) => new Promise((res, rej) => {
    const d = document.createElement("div");
    d.style.cssText = "position:fixed;top:0;left:0;z-index:999999;width:320px;height:90px";
    document.body.appendChild(d);
    const t = setTimeout(() => rej(new Error("timeout " + action)), 90000);
    turnstile.render(d, {
      sitekey, action, cData: cdata, size: "flexible",
      callback: (tok) => { clearTimeout(t); res(tok); },
      "error-callback": (e) => { clearTimeout(t); rej(new Error("erro " + action + " " + e)); }
    });
  });

  const header = await tk("0x4AAAAAAB0oRY23FyZnllMo", "api_protection");
  const corpoTok = await tk("0x4AAAAAAAiHEkDee-yqSdMj", "login");

  const b = JSON.parse(payload);
  b.json.hToken = corpoTok;
  if (b.meta && b.meta.values) b.meta.values.hToken = [corpoTok];

  const r = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "tenantid": ${JSON.stringify(casa.tenantId)},
      "x-token": header,
      "x-request-source": "web_client",
      "x-client-version": ${JSON.stringify(casa.clientVersion)},
      "x-device-id": ${JSON.stringify(casa.deviceId)},
      "x-device-type": "DesktopOS",
      "x-trace-id": "ABCDEFGH",
      "client-language": "pt-BR"
    },
    body: JSON.stringify(b),
    credentials: "omit"
  });
  const t = await r.text();
  return "hdr=" + header.length + " body=" + corpoTok.length + " STATUS=" + r.status + " BODY=" + t.slice(0,400);
})()`;

console.log(await avaliar(expr));

ws.close();
proc.kill();
try { fs.rmSync(perfil, { recursive: true, force: true }); } catch {}
process.exit(0);