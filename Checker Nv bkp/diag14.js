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
await sleep(6000);

const cdata = `${casa.tenantId}=${casa.deviceId}`;

const expr = `(async()=>{
  const out = [];
  for (let i = 0; i < 40; i++) { if (window.turnstile) break; await new Promise(r => setTimeout(r, 500)); }
  out.push("turnstile=" + (typeof window.turnstile));
  if (!window.turnstile) return out.join(" | ");

  const d = document.createElement("div");
  d.style.cssText = "position:fixed;top:0;left:0;width:320px;height:90px;z-index:999999;background:#fff";
  document.body.appendChild(d);

  let tok = null, err = null;
  try {
    window.turnstile.render(d, {
      sitekey: "0x4AAAAAAB0oRY23FyZnllMo",
      action: "api_protection",
      cData: ${JSON.stringify(cdata)},
      size: "flexible",
      callback: (t) => { tok = t; },
      "error-callback": (e) => { err = String(e); }
    });
    out.push("render ok");
  } catch (e) { out.push("render throw: " + e.message); }

  for (let i = 0; i < 25; i++) { if (tok || err) break; await new Promise(r => setTimeout(r, 1000)); }
  out.push("tok=" + (tok ? tok.length : 0));
  out.push("err=" + (err || "nao"));
  out.push("iframe=" + document.querySelectorAll("iframe").length);
  out.push("html=" + d.innerHTML.replace(/\\s+/g, " ").slice(0, 180));
  return out.join(" | ");
})()`;

const ev = await cmd("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true }, sessionId);
console.log(ev.result?.exceptionDetails ? "EXC: " + ev.result.exceptionDetails.text : ev.result?.result?.value);

ws.close();
proc.kill();
try { fs.rmSync(perfil, { recursive: true, force: true }); } catch {}
process.exit(0);