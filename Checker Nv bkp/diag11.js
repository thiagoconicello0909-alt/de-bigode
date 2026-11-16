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

const candidatos = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
];
const exe = candidatos.find((p) => fs.existsSync(p));
if (!exe) {
  console.log("nao achei Chrome nem Edge");
  process.exit(0);
}
console.log("usando:", exe);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const port = 9333;
const perfil = path.join(os.tmpdir(), "chk_" + Date.now());

const proc = spawn(exe, [
  "--headless=new",
  `--remote-debugging-port=${port}`,
  `--user-data-dir=${perfil}`,
  "--no-first-run",
  "--no-default-browser-check",
  "--disable-gpu",
], { stdio: "ignore" });

let wsUrl = null;
for (let t = 0; t < 40 && !wsUrl; t++) {
  try {
    const r = await fetch(`http://127.0.0.1:${port}/json/version`);
    if (r.ok) wsUrl = (await r.json()).webSocketDebuggerUrl;
  } catch {}
  if (!wsUrl) await sleep(500);
}
if (!wsUrl) {
  console.log("chrome nao abriu o debug");
  proc.kill();
  process.exit(0);
}

const ws = new WebSocket(wsUrl);
const pend = new Map();
let seq = 0;
ws.addEventListener("message", (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pend.has(m.id)) {
    pend.get(m.id)(m);
    pend.delete(m.id);
  }
});
const cmd = (method, params, sessionId) =>
  new Promise((res) => {
    const n = ++seq;
    pend.set(n, res);
    ws.send(JSON.stringify({ id: n, method, params, ...(sessionId ? { sessionId } : {}) }));
  });

await new Promise((r) => ws.addEventListener("open", r));

const criado = await cmd("Target.createTarget", { url: "about:blank" });
const targetId = criado.result.targetId;
const anexado = await cmd("Target.attachToTarget", { targetId, flatten: true });
const sessionId = anexado.result.sessionId;

await cmd("Page.enable", {}, sessionId);
await cmd("Runtime.enable", {}, sessionId);
await cmd("Page.navigate", { url: `https://${casa.domain}/` }, sessionId);
await sleep(7000);

const est = await cmd("Runtime.evaluate", {
  expression: "document.readyState + ' | ' + location.href + ' | ' + document.title",
  returnByValue: true,
}, sessionId);
console.log("pagina:", est.result?.result?.value ?? JSON.stringify(est).slice(0, 300));

const url = `https://${casa.apiHost}${casa.loginPath}`;
const expr = `(async()=>{
  const r = await fetch(${JSON.stringify(url)}, {
    method:"POST",
    headers:{"content-type":"application/json","tenantid":${JSON.stringify(casa.tenantId)}},
    body:${JSON.stringify(JSON.stringify(body))},
    credentials:"include"
  });
  const t = await r.text();
  return "STATUS=" + r.status + " BODY=" + t.slice(0,500);
})()`;

const ev = await cmd("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true }, sessionId);
const valor = ev.result?.result?.value;

if (typeof valor === "string") {
  console.log(String(valor).replace(/\s+/g, " "));
} else {
  console.log("retorno inesperado:");
  console.log(JSON.stringify(ev).slice(0, 1200));
}

ws.close();
proc.kill();
try { fs.rmSync(perfil, { recursive: true, force: true }); } catch {}
process.exit(0);