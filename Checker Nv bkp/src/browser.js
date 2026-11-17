// browser.js v5 — estoque primeiro, trava por aba, um token por reload
import { spawn } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import * as stock from "./tokens.js";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PORTA_BASE = Number(process.env.CHK_PORTA) || 9333;
const ABAS_PADRAO = 4;
const ESPERA_BROWSER = 45000;
const ESPERA_MINT = 40000;
const UA_PADRAO =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/157.0.0.0 Safari/537.36 Edg/157.0.0.0";

const estados = new Map();
const criando = new Map();
const desdeReload = new Map();
const travas = new Map();
let rodizio = 0;
let mintando = null;

function acharExe() {
  return [
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  ].find((p) => fs.existsSync(p));
}

async function portaOcupada(porta) {
  try {
    const r = await fetch(`http://127.0.0.1:${porta}/json/version`, { signal: AbortSignal.timeout(400) });
    return r.ok;
  } catch {
    return false;
  }
}

async function acharPorta() {
  for (let i = 0; i < 60; i++) {
    const p = PORTA_BASE + i;
    if (!(await portaOcupada(p))) return p;
  }
  throw new Error("sem porta livre para o browser");
}

async function comTrava(chave, fn) {
  const anterior = travas.get(chave) || Promise.resolve();
  let liberar;
  const atual = new Promise((r) => (liberar = r));
  travas.set(chave, anterior.then(() => atual));
  await anterior;
  try {
    return await fn();
  } finally {
    liberar();
  }
}

async function abrirBrowser(casa, porta) {
  const exe = acharExe();
  if (!exe) throw new Error("Chrome/Edge nao encontrado");
  const ua = casa.headers?.["user-agent"] || UA_PADRAO;
  const perfil = path.join(os.tmpdir(), `chk_${porta}_${Date.now()}`);
  const proc = spawn(exe, [
    "--headless=new",
    `--remote-debugging-port=${porta}`,
    `--user-data-dir=${perfil}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-gpu",
    "--disable-dev-shm-usage",
    "--disable-background-timer-throttling",
    "--disable-renderer-backgrounding",
    "--disable-backgrounding-occluded-windows",
    "--disable-features=CalculateNativeWinOcclusion",
    "--disable-blink-features=AutomationControlled",
    `--user-agent=${ua}`,
    "--lang=pt-BR",
  ], { stdio: "ignore" });

  let wsUrl = null;
  for (let t = 0; t < 40 && !wsUrl; t++) {
    try {
      const r = await fetch(`http://127.0.0.1:${porta}/json/version`, { signal: AbortSignal.timeout(800) });
      if (r.ok) {
        const info = await r.json();
        if (info?.webSocketDebuggerUrl?.includes(`:${porta}/`)) wsUrl = info.webSocketDebuggerUrl;
      }
    } catch {}
    if (!wsUrl) await sleep(400);
  }
  if (!wsUrl) {
    try { proc.kill(); } catch {}
    throw new Error(`browser nao abriu o debug na porta ${porta}`);
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
  return { ws, cmd, proc, perfil, ua, dominio: casa.domain, paginas: [], tamanho: 0, ativo: true };
}

async function carregar(est, pagina, casa, ms = 8000) {
  try {
    await est.cmd("Page.navigate", { url: `https://${casa.domain}/` }, pagina.sessionId);
  } catch {}
  const fim = Date.now() + ms;
  while (Date.now() < fim) {
    try {
      const ev = await est.cmd(
        "Runtime.evaluate",
        { expression: "document.readyState === 'complete' && !!window.turnstile", returnByValue: true },
        pagina.sessionId,
      );
      if (ev.result?.result?.value === true) return true;
    } catch {}
    await sleep(250);
  }
  return false;
}

async function novaPagina(est, casa) {
  const c = await est.cmd("Target.createTarget", { url: "about:blank" });
  const s = (await est.cmd("Target.attachToTarget", { targetId: c.result.targetId, flatten: true })).result.sessionId;
  await est.cmd("Page.enable", {}, s);
  await est.cmd("Runtime.enable", {}, s);
  await est.cmd("Emulation.setUserAgentOverride", {
    userAgent: est.ua,
    acceptLanguage: "pt-BR,pt;q=0.9",
    platform: "Win32",
  }, s);
  const pagina = { sessionId: s };
  await carregar(est, pagina, casa);
  return pagina;
}

async function encerrarDominio(dominio) {
  const e = estados.get(dominio);
  estados.delete(dominio);
  desdeReload.delete(dominio);
  if (!e) return;
  e.ativo = false;
  try { e.ws.close(); } catch {}
  try { e.proc.kill(); } catch {}
  try { fs.rmSync(e.perfil, { recursive: true, force: true }); } catch {}
}

export async function fecharBrowser(dominio) {
  if (dominio) return encerrarDominio(dominio);
  await Promise.all([...estados.keys()].map((d) => encerrarDominio(d)));
}

async function garantir(casa) {
  const chave = casa.domain;
  const pronto = estados.get(chave);
  if (pronto && pronto.paginas.length) return pronto;
  if (criando.has(chave)) return criando.get(chave);

  const tarefa = (async () => {
    await encerrarDominio(chave);
    const porta = await acharPorta();
    const est = await abrirBrowser(casa, porta);
    est.tamanho = Math.max(2, Math.min(16, Number(casa.browserPages) || ABAS_PADRAO));
    est.paginas = await Promise.all(
      Array.from({ length: est.tamanho }, () => novaPagina(est, casa)),
    );
    est.paginas = est.paginas.filter(Boolean);
    if (!est.paginas.length) throw new Error("nenhuma aba abriu");
    estados.set(chave, est);
    criando.delete(chave);
    return est;
  })().catch((e) => {
    criando.delete(chave);
    throw e;
  });

  criando.set(chave, tarefa);
  return tarefa;
}

async function garantirComPrazo(casa) {
  return Promise.race([
    garantir(casa),
    sleep(ESPERA_BROWSER).then(() => {
      throw new Error("browser nao subiu");
    }),
  ]);
}

async function avaliar(est, pagina, expr) {
  const ev = await est.cmd("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true }, pagina.sessionId);
  if (ev.result?.exceptionDetails) {
    throw new Error(ev.result.exceptionDetails.exception?.description || ev.result.exceptionDetails.text);
  }
  const v = ev.result?.result?.value;
  if (typeof v !== "string") throw new Error("retorno inesperado do browser");
  return v;
}

/** Um par de widgets (X-Token api_protection + hToken login), um de cada vez. */
function exprTokens(casa) {
  const cdata = `${casa.tenantId}=${casa.deviceId}`;
  const skX = casa.turnstile?.sitekeyHeader || "0x4AAAAAAB0oRY23FyZnllMo";
  const skH = casa.turnstile?.sitekeyLogin || "0x4AAAAAAAiHEkDee-yqSdMj";

  return `(async()=>{
    if (!window.turnstile) throw new Error("turnstile ausente");
    const cdata = ${JSON.stringify(cdata)};

    function alvo(id, top) {
      let b = document.getElementById(id);
      if (!b) {
        b = document.createElement("div");
        b.id = id;
        b.style.cssText = "position:fixed;left:0;width:340px;height:110px;z-index:2147483647;background:#fff;top:" + top;
        document.body.appendChild(b);
      }
      const d = document.createElement("div");
      d.style.cssText = "position:absolute;top:0;left:0";
      b.appendChild(d);
      return d;
    }

    function um(id, sitekey, action, top) {
      return new Promise((res, rej) => {
        const tm = setTimeout(() => rej(new Error("timeout " + action)), 12000);
        try {
          window.turnstile.render(alvo(id, top), {
            sitekey: sitekey,
            action: action,
            cData: cdata,
            size: "flexible",
            callback: (v) => { clearTimeout(tm); res(v); },
            "error-callback": (e) => { clearTimeout(tm); rej(new Error("erro " + action + " " + e)); },
          });
        } catch (e) {
          clearTimeout(tm);
          rej(e);
        }
      });
    }

    const x = await um("__cfboxX", ${JSON.stringify(skX)}, "api_protection", "0px");
    const h = await um("__cfboxH", ${JSON.stringify(skH)}, "login", "120px");

    return JSON.stringify({ x, h });
  })()`;
}

async function resolverTokens(est, pagina, casa) {
  const bruto = await avaliar(est, pagina, exprTokens(casa));
  const t = JSON.parse(bruto);
  if (!t.x || !t.h) throw new Error("token incompleto");
  return { x: t.x, h: t.h };
}

function guardarPar(casa, par) {
  try {
    stock.guardar?.(casa.domain, par.x, par.h);
  } catch {}
}

function lerStock(dominio) {
  try {
    const t = stock.consumir?.(dominio);
    if (!t) return null;
    if (typeof t === "string") return { x: t, h: "" };
    if (t.x) return { x: t.x, h: t.h || "" };
    return null;
  } catch {
    return null;
  }
}

/** Minta um par numa aba e guarda no estoque. Usado pela fábrica. */
export async function mintarPar(casa) {
  const est = await garantirComPrazo(casa);
  if (!est.paginas.length) throw new Error("sem abas");
  const pagina = est.paginas[rodizio++ % est.paginas.length];

  return comTrava(pagina.sessionId, async () => {
    if (desdeReload.get(pagina.sessionId)) {
      desdeReload.set(pagina.sessionId, 0);
      await carregar(est, pagina, casa);
    }

    let par;
    try {
      par = await resolverTokens(est, pagina, casa);
    } catch (e) {
      if (/turnstile ausente|retorno inesperado|timeout/.test(e.message)) {
        await carregar(est, pagina, casa);
        par = await resolverTokens(est, pagina, casa);
      } else {
        throw e;
      }
    }

    guardarPar(casa, par);
    desdeReload.set(pagina.sessionId, 1);
    return par;
  });
}

/** Estoque primeiro. Browser só se o estoque estiver vazio. */
export async function obterPar(casa) {
  const doEstoque = lerStock(casa.domain);
  if (doEstoque) return doEstoque;

  if (!mintando) {
    mintando = mintarPar(casa).finally(() => {
      mintando = null;
    });
  }
  return Promise.race([
    mintando,
    sleep(ESPERA_MINT).then(() => {
      throw new Error("estoque vazio e mint lento");
    }),
  ]);
}

/** Reserva: executa o login dentro da página, quando o HTTP não passa. */
export async function fetchNoBrowser(casa, payload, acao, par) {
  const est = await garantirComPrazo(casa);
  const pagina = est.paginas[0];
  const api = `https://${casa.apiHost}/api/frontend/trpc`;
  const url = acao === "register" ? `${api}/auth.registe` : `${api}/auth.login`;

  const expr = `(async()=>{
    const p = ${JSON.stringify(payload)};
    if (${JSON.stringify(par.h || "")}) {
      p.json.hToken = ${JSON.stringify(par.h || "")};
      if (p.meta && p.meta.values) delete p.meta.values.hToken;
    }
    const h = {
      "content-type": "application/json",
      "tenantid": ${JSON.stringify(String(casa.tenantId))},
      "x-request-source": "web_client",
      "x-client-version": ${JSON.stringify(casa.clientVersion || "v240")},
      "x-device-id": ${JSON.stringify(casa.deviceId)},
      "x-device-type": "DesktopOS",
      "x-trace-id": Math.random().toString(36).slice(2, 10).toUpperCase(),
      "client-language": "pt-BR",
      "x-token": ${JSON.stringify(par.x || "")}
    };
    const r = await fetch(${JSON.stringify(url)}, { method: "POST", headers: h, body: JSON.stringify(p), credentials: "omit" });
    return await r.text();
  })()`;

  return avaliar(est, pagina, expr);
}

/** Reserva: executa o login dentro da página, quando o HTTP não passa. */
export async function loginNaPagina(casa, payload, acao = "login", par) {
  const p = par || (await obterPar(casa));
  return fetchNoBrowser(casa, payload, acao, p);
}

export const loginBrowser = loginNaPagina;