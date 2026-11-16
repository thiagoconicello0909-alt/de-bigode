import { spawn } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PORTA_BASE = 9333;
const ABAS_PADRAO = 10;
const VALIDADE_PAR = 120000;
const TOKENS_POR_RELOAD = 20;
const UA_PADRAO =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/157.0.0.0 Safari/537.36 Edg/157.0.0.0";

const estados = new Map();
const criando = new Map();
let proximaPorta = PORTA_BASE;
let ultimoErroFabrica = 0;

function acharExe() {
  return [
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  ].find((p) => fs.existsSync(p));
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
  for (let t = 0; t < 60 && !wsUrl; t++) {
    try {
      const r = await fetch(`http://127.0.0.1:${porta}/json/version`);
      if (r.ok) wsUrl = (await r.json()).webSocketDebuggerUrl;
    } catch {}
    if (!wsUrl) await sleep(400);
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
  return { ws, cmd, proc, perfil, ua, dominio: casa.domain, paginas: [], tamanho: 0, teto: 0, fila: [], ativo: false, mintando: false };
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
  await est.cmd("Page.navigate", { url: `https://${casa.domain}/` }, s);
  await sleep(5000);
  return { sessionId: s };
}

async function encerrarDominio(dominio) {
  const e = estados.get(dominio);
  estados.delete(dominio);
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
    const porta = proximaPorta++;
    const est = await abrirBrowser(casa, porta);
    est.tamanho = Math.max(2, Math.min(24, Number(casa.browserPages) || ABAS_PADRAO));
    est.teto = est.tamanho * 2;
    est.paginas = await Promise.all(Array.from({ length: est.tamanho }, () => novaPagina(est, casa)));
    est.ativo = true;
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

async function avaliar(est, pagina, expr) {
  const ev = await est.cmd("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true }, pagina.sessionId);
  if (ev.result?.exceptionDetails) {
    throw new Error(ev.result.exceptionDetails.exception?.description || ev.result.exceptionDetails.text);
  }
  const v = ev.result?.result?.value;
  if (typeof v !== "string") throw new Error("retorno inesperado do browser");
  return v;
}

/** Um div novo por token, sem remove e sem limpar o box. */
function exprTokens(casa) {
  const cdata = `${casa.tenantId}=${casa.deviceId}`;
  const sitekey = casa.turnstile?.sitekeyHeader || "0x4AAAAAAB0oRY23FyZnllMo";

  return `(async()=>{
    if (!window.turnstile) throw new Error("turnstile ausente");
    const cdata = ${JSON.stringify(cdata)};
    const sitekey = ${JSON.stringify(sitekey)};

    let box = document.getElementById("__cfbox");
    if (!box) {
      box = document.createElement("div");
      box.id = "__cfbox";
      box.style.cssText = "position:fixed;top:0;left:0;width:340px;height:110px;z-index:2147483647;background:#fff";
      document.body.appendChild(box);
    }

    const d = document.createElement("div");
    d.style.cssText = "position:absolute;top:0;left:0";
    box.appendChild(d);

    const token = await new Promise((res, rej) => {
      const tm = setTimeout(() => rej(new Error("timeout api_protection")), 12000);
      try {
        window.turnstile.render(d, {
          sitekey: sitekey,
          action: "api_protection",
          cData: cdata,
          size: "flexible",
          callback: (v) => { clearTimeout(tm); res(v); },
          "error-callback": (e) => { clearTimeout(tm); rej(new Error("erro api_protection " + e)); },
        });
      } catch (e) {
        clearTimeout(tm);
        rej(e);
      }
    });

    return JSON.stringify({ x: token });
  })()`;
}

async function resolverTokens(est, pagina, casa) {
  const bruto = await avaliar(est, pagina, exprTokens(casa));
  const t = JSON.parse(bruto);
  if (!t.x) throw new Error("token incompleto");
  return { x: t.x, h: "" };
}

async function recarregar(est, pagina, casa) {
  try {
    await est.cmd("Page.navigate", { url: `https://${casa.domain}/` }, pagina.sessionId);
  } catch {}
  await sleep(3000);
}

/** Fábrica: cada aba produz pares continuamente e recarrega a cada N tokens. */
function iniciarMintagem(est, casa, acao) {
  if (est.mintando) return;
  est.mintando = true;
  process.stdout.write(`  [fabrica] ${est.tamanho} abas em ${casa.domain}\n`);

  est.paginas.forEach((pagina, indice) => {
    (async () => {
      await sleep(200 * indice);
      let erros = 0;
      let desdeReload = 0;

      while (est.ativo) {
        if (est.fila.length >= est.teto) { await sleep(120); continue; }

        try {
          const par = await resolverTokens(est, pagina, casa);
          if (est.ativo) est.fila.push({ ...par, ts: Date.now() });
          erros = 0;
          desdeReload++;

          if (desdeReload >= TOKENS_POR_RELOAD) {
            desdeReload = 0;
            await recarregar(est, pagina, casa);
            continue;
          }
          await sleep(200 + Math.random() * 200);
        } catch (e) {
          erros++;
          desdeReload++;
          if (Date.now() - ultimoErroFabrica > 3000) {
            ultimoErroFabrica = Date.now();
            process.stdout.write(`  [fabrica] erro: ${e.message}\n`);
          }
          if (erros >= 3 || desdeReload >= TOKENS_POR_RELOAD) {
            desdeReload = 0;
            await recarregar(est, pagina, casa);
            continue;
          }
          await sleep(700 + Math.random() * 500);
        }
      }
    })();
  });
}

/** Pega um par pronto. Espera se a fábrica ainda não produziu. */
export async function obterPar(casa, acao = "login") {
  const est = await garantir(casa);
  iniciarMintagem(est, casa, acao);

  for (let t = 0; t < 1800; t++) {
    while (est.fila.length) {
      const par = est.fila.shift();
      if (Date.now() - par.ts < VALIDADE_PAR) return par;
    }
    if (!est.ativo) break;
    await sleep(60);
  }
  throw new Error("sem token disponivel");
}

/** Reserva: executa o login dentro da página, quando o HTTP não passa. */
export async function fetchNoBrowser(casa, payload, acao, par) {
  const est = await garantir(casa);
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
      "x-client-version": ${JSON.stringify(casa.clientVersion || "v242")},
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

/** Compatibilidade: login inteiro pelo browser, usando par da fila. */
export async function loginBrowser(casa, payload, acao = "login") {
  const par = await obterPar(casa, acao);
  return fetchNoBrowser(casa, payload, acao, par);
}