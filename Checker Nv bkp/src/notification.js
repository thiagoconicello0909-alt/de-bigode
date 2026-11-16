import { spawn } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PORT = 9333;
const UA_PADRAO =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/157.0.0.0 Safari/537.36 Edg/157.0.0.0";

let estado = null;
let fila = Promise.resolve();

function acharExe() {
  return [
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  ].find((p) => fs.existsSync(p));
}

async function iniciar(casa) {
  const exe = acharExe();
  if (!exe) throw new Error("Chrome/Edge nao encontrado");

  const ua = casa.headers?.["user-agent"] || UA_PADRAO;
  const perfil = path.join(os.tmpdir(), "chk_" + Date.now());
  const proc = spawn(exe, [
    "--headless=new",
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${perfil}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-gpu",
    "--disable-blink-features=AutomationControlled",
    `--user-agent=${ua}`,
    "--lang=pt-BR",
  ], { stdio: "ignore" });

  let wsUrl = null;
  for (let t = 0; t < 60 && !wsUrl; t++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/version`);
      if (r.ok) wsUrl = (await r.json()).webSocketDebuggerUrl;
    } catch {}
    if (!wsUrl) await sleep(500);
  }
  if (!wsUrl) {
    proc.kill();
    throw new Error("browser nao abriu o debug");
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
  const sessionId = (await cmd("Target.attachToTarget", { targetId: criado.result.targetId, flatten: true })).result.sessionId;

  await cmd("Page.enable", {}, sessionId);
  await cmd("Runtime.enable", {}, sessionId);
  await cmd("Emulation.setUserAgentOverride", {
    userAgent: ua,
    acceptLanguage: "pt-BR,pt;q=0.9",
    platform: "Win32",
  }, sessionId);

  return { ws, cmd, sessionId, proc, perfil, dominio: null };
}

async function encerrar() {
  if (!estado) return;
  try { estado.ws.close(); } catch {}
  try { estado.proc.kill(); } catch {}
  try { fs.rmSync(estado.perfil, { recursive: true, force: true }); } catch {}
  estado = null;
}

export async function fecharBrowser() {
  await encerrar();
}

async function garantir(casa) {
  if (!estado) estado = await iniciar(casa);
  if (estado.dominio !== casa.domain) {
    await estado.cmd("Page.navigate", { url: `https://${casa.domain}/` }, estado.sessionId);
    await sleep(6000);
    estado.dominio = casa.domain;
  }
  return estado;
}

async function executar(casa, payload, acao) {
  const est = await garantir(casa);

  const api = `https://${casa.apiHost}/api/frontend/trpc`;
  const url = acao === "register" ? `${api}/auth.registe` : `${api}/auth.login`;
  const cdata = `${casa.tenantId}=${casa.deviceId}`;
  const sitekeyHeader = casa.turnstile?.sitekeyHeader || "0x4AAAAAAB0oRY23FyZnllMo";
  const sitekeyBody = casa.turnstile?.sitekeyBody || casa.captchaId;

  const expr = `(async()=>{
    if (!window.turnstile) throw new Error("turnstile ausente");
    let box = document.getElementById("__cfbox");
    if (!box) {
      box = document.createElement("div");
      box.id = "__cfbox";
      box.style.cssText = "position:fixed;top:0;left:0;width:340px;height:190px;z-index:2147483647;background:#fff";
      document.body.appendChild(box);
    }
    box.innerHTML = "";
    const cdata = ${JSON.stringify(cdata)};
    const tk = (sitekey, action) => new Promise((res, rej) => {
      const d = document.createElement("div");
      box.appendChild(d);
      const t = setTimeout(() => rej(new Error("timeout " + action)), 70000);
      window.turnstile.render(d, { sitekey, action, cData: cdata, size: "flexible",
        callback: (v) => { clearTimeout(t); res(v); },
        "error-callback": (e) => { clearTimeout(t); rej(new Error("erro " + action + " " + e)); } });
    });
    const [xTok, hTok] = await Promise.all([
      tk(${JSON.stringify(sitekeyHeader)}, "api_protection"),
      tk(${JSON.stringify(sitekeyBody)}, ${JSON.stringify(acao === "register" ? "register" : "login")}),
    ]);

    const p = ${JSON.stringify(payload)};
    if (hTok) {
      p.json.hToken = hTok;
      if (p.meta && p.meta.values) delete p.meta.values.hToken;
    }

    const r = await fetch(${JSON.stringify(url)}, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "tenantid": ${JSON.stringify(String(casa.tenantId))},
        "x-request-source": "web_client",
        "x-client-version": ${JSON.stringify(casa.clientVersion || "v242")},
        "x-device-id": ${JSON.stringify(casa.deviceId)},
        "x-device-type": "DesktopOS",
        "x-trace-id": Math.random().toString(36).slice(2, 10).toUpperCase(),
        "client-language": "pt-BR",
        "x-token": xTok
      },
      body: JSON.stringify(p),
      credentials: "omit"
    });
    return await r.text();
  })()`;

  const ev = await est.cmd("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true }, est.sessionId);
  if (ev.result?.exceptionDetails) {
    throw new Error(ev.result.exceptionDetails.exception?.description || ev.result.exceptionDetails.text);
  }
  const v = ev.result?.result?.value;
  if (typeof v !== "string") throw new Error("retorno inesperado do browser");
  return v;
}

/** Login pela rota auth.* usando o browser (passa o WAF do Cloudflare). */
export async function loginBrowser(casa, payload, acao = "login") {
  const tarefa = fila.then(async () => {
    let ultimo;
    for (let t = 1; t <= 3; t++) {
      try {
        return await executar(casa, payload, acao);
      } catch (e) {
        ultimo = e;
        if (/nao encontrado|nao abriu/.test(e.message)) {
          await encerrar();
          await sleep(800);
        } else {
          await sleep(600 * t);
        }
      }
    }
    throw ultimo;
  });
  fila = tarefa.catch(() => {});
  return tarefa;
}