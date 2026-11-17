import fs from "fs";
import path from "path";
import crypto from "crypto";
import axios from "axios";
import { ROOT } from "./paths.js";
import { getNextProxy, banirProxy } from "./proxy.js";
import { c } from "./ui.js";
import { obterClearance } from "./cloudflare.js";
import { obterTokensTurnstile } from "./turnstile.js";
import { obterPar, fetchNoBrowser } from "./browser.js";

const TLS_URL = "http://127.0.0.1:3334";
const TIMEOUT_REQ = 12000;
const MAX_TENT = 3;

let minInterval = 0;
let nextSlot = 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function setRateLimit(ms) {
  minInterval = Math.max(0, Number(ms) || 0);
}

async function gate() {
  if (!minInterval) return;
  const now = Date.now();
  const slot = Math.max(now, nextSlot);
  nextSlot = slot + minInterval * (0.75 + Math.random() * 0.5);
  const wait = slot - now;
  if (wait > 0) await sleep(wait);
}

let cacheCookies = { mtime: 0, mapa: new Map() };

function cookiesPara(host) {
  const alvo = String(host || "").toLowerCase();
  if (!alvo) return null;
  try {
    const arq = path.join(ROOT, "cookies.txt");
    const st = fs.statSync(arq);
    if (st.mtimeMs !== cacheCookies.mtime) {
      const mapa = new Map();
      for (const l of fs.readFileSync(arq, "utf-8").split(/\r?\n/)) {
        const t = l.trim();
        if (!t || t.startsWith("#")) continue;
        const sep = t.indexOf("|") >= 0 ? t.indexOf("|") : t.indexOf("\t");
        if (sep < 0) continue;
        mapa.set(t.slice(0, sep).trim().toLowerCase(), t.slice(sep + 1).trim());
      }
      cacheCookies = { mtime: st.mtimeMs, mapa };
    }
  } catch {}
  if (cacheCookies.mapa.has(alvo)) return cacheCookies.mapa.get(alvo);
  for (const [h, cook] of cacheCookies.mapa) if (alvo.endsWith(h)) return cook;
  return null;
}

function randomTrace(len = 8) {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let out = "";
  for (let i = 0; i < len; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

export function buildHeaders(casa, auth = {}) {
  const a = typeof auth === "string" ? { token: auth } : (auth || {});
  const headers = { ...(casa.headers || {}) };

  headers.origin = `https://${casa.domain}`;
  headers.referer = `https://${casa.domain}/`;
  headers.tenantid = String(casa.tenantId);
  headers["x-device-id"] = casa.deviceId;
  headers["x-device-type"] = casa.deviceType || "DesktopOS";
  headers["x-client-version"] = casa.clientVersion || "v240";
  headers["x-trace-id"] = randomTrace();
  headers["client-language"] = casa.language || "pt-BR";
  headers["x-request-source"] = "web_client";
  headers["content-type"] = "application/json";
  headers.accept = headers.accept || "*/*";

  if (!headers["sec-fetch-site"]) {
    headers["sec-fetch-site"] = "cross-site";
    headers["sec-fetch-mode"] = "cors";
    headers["sec-fetch-dest"] = "empty";
  }
  if (!headers.priority) headers.priority = "u=1, i";

  if (!casa.fingerprint) {
    casa.fingerprint = crypto.randomUUID();
    casa.fingerprintRequest = crypto.randomUUID();
  }
  headers["x-fingerprint-id"] = casa.fingerprint;
  headers["x-fingerprint-request-id"] = casa.fingerprintRequest;

  if (casa.channelId !== undefined && casa.channelId !== null) headers.channelid = String(casa.channelId);

  if (casa._cfUA) headers["x-force-ua"] = casa._cfUA;
  const cook = casa._cfCookie || cookiesPara(casa.apiHost || casa.domain);
  if (cook) headers.cookie = cook;

  if (a.token) {
    const scheme = casa.authScheme;
    headers.authorization = scheme === "" ? a.token : `${scheme || "Bearer"} ${a.token}`;
  } else {
    delete headers.authorization;
  }

  const setH = (k, v) => {
    if (v !== undefined && v !== null && v !== "") headers[k] = String(v);
    else delete headers[k];
  };
  setH("x-auth-tag", a.authTag);
  setH("x-token-data", a.tokenData);
  setH("x-tag", a.tag);
  setH("userid", a.userId);

  delete headers["content-length"];
  return headers;
}

export function credVariants(auth) {
  const a = typeof auth === "string" ? { token: auth } : (auth || {});
  const lista = [a.authTag, a.tokenData, a.token].filter((x) => typeof x === "string" && x.length > 8);
  const unicos = [...new Set(lista)];
  return unicos.length ? unicos : [null];
}

export function withAuth(auth, cred) {
  const a = typeof auth === "string" ? { token: auth } : { ...(auth || {}) };
  if (!cred) return a;
  return { ...a, authTag: cred, tokenData: cred };
}

export function extractAuth(norm) {
  const d = norm?.data || {};
  return {
    authTag: typeof d.authTag === "string" ? d.authTag : typeof d.tag === "string" ? d.tag : null,
    tag: typeof d.tag === "string" ? d.tag : null,
    tokenData: typeof d.tokenData === "string" ? d.tokenData : null,
    userId: d.userId ?? null,
  };
}

export function withRouter(casa, procedure) {
  const prefix = casa.loginPath.replace(/[^/]+$/, "");
  return prefix + procedure;
}

export function infoPath(casa) {
  return casa.infoPath || withRouter(casa, "user.assets");
}

export function buildQuery(path, input) {
  const q = encodeURIComponent(JSON.stringify(input ?? { json: {} }));
  return `${path}${path.includes("?") ? "&" : "?"}input=${q}`;
}

const RATE = /muitas solicita|too many|rate limit|429|aguarde um momento/i;
const HTML_RE = /<!doctype|<html|just a moment|attention required|cf-error|cloudflare|verificando/i;
const REDE_RE = /timeout|ECONNRESET|socket|offline|proxy|sobrecarregado|sem sessao|aborted/i;

function comToken(payload, hToken) {
  if (!hToken) return payload;
  const copia = JSON.parse(JSON.stringify(payload || { json: {} }));
  copia.json = copia.json || {};
  copia.json.hToken = hToken;
  if (copia.meta && copia.meta.values) delete copia.meta.values.hToken;
  return copia;
}

async function postCru(url, headers, corpo) {
  const proxy = getNextProxy();
  try {
    const res = await axios.post(`${TLS_URL}/post`, {
      url,
      headers,
      body: JSON.stringify(corpo ?? { json: {} }),
      ...(proxy ? { proxy } : {}),
    }, { timeout: TIMEOUT_REQ, validateStatus: () => true });

    if (res.status === 429 && proxy) banirProxy(proxy, 60000);
    return { status: res.status, texto: String(res.data?.text ?? ""), erro: res.data?.error };
  } catch (e) {
    if (proxy) banirProxy(proxy, 30000);
    throw e;
  }
}

/** auth.login/registe: token vem da fábrica, o POST sai pelo proxy. */
async function authViaFabrica(casa, url, payload, auth, acao) {
  if (casa._precisaToken !== true) {
    const tent = await postCru(url, buildHeaders(casa, auth), payload);
    if (tent.status === 200 && !HTML_RE.test(tent.texto.slice(0, 400))) {
      casa._precisaToken = false;
      return tent.texto;
    }
    casa._precisaToken = true;
  }

  for (let k = 0; k < 3; k++) {
    const par = await obterPar(casa, acao);
    const headers = buildHeaders(casa, auth);
    headers["x-token"] = par.x;
    const tent = await postCru(url, headers, comToken(payload, par.h));
    if (tent.status === 200 && !HTML_RE.test(tent.texto.slice(0, 400))) return tent.texto;
    await sleep(150);
  }

  const par = await obterPar(casa, acao);
  return fetchNoBrowser(casa, payload, acao, par);
}

async function request(casa, metodo, path, payload, auth) {
  const isGet = metodo === "GET";
  const url = isGet
    ? `https://${casa.apiHost}${buildQuery(path, payload)}`
    : `https://${casa.apiHost}${path}`;

  const ehAuth = /\/auth\.(login|registe)/.test(path);

  if (ehAuth && casa.browserLogin) {
    try {
      return await authViaFabrica(casa, url, payload, auth, /registe/.test(path) ? "register" : "login");
    } catch {
      // cai no fluxo tradicional abaixo
    }
  }

  let corpo = payload;
  let ultimoErro = "";
  let semCookie = false;
  let clearances = 0;
  let tokensUsados = 0;

  for (let t = 1; t <= MAX_TENT; t++) {
    if (!ehAuth) await gate();
    const proxy = getNextProxy();

    const headers = buildHeaders(casa, auth);
    if (semCookie) delete headers.cookie;
    if (ehAuth && casa._xToken) headers["x-token"] = casa._xToken;

    if (ehAuth && casa._xTokenBody) {
      corpo = {
        ...(corpo || {}),
        json: { ...((corpo || {}).json || {}), hToken: casa._xTokenBody },
        meta: { ...((corpo || {}).meta || {}), values: { ...(((corpo || {}).meta || {}).values || {}), hToken: [casa._xTokenBody] } },
      };
    }

    let res;
    try {
      res = await axios.post(`${TLS_URL}/${isGet ? "get" : "post"}`, {
        url,
        headers,
        body: isGet ? "" : JSON.stringify(corpo ?? { json: {} }),
        ...(proxy ? { proxy } : {}),
      }, { timeout: TIMEOUT_REQ, validateStatus: () => true });
    } catch (e) {
      ultimoErro = `TLSProxy offline: ${e.message}`;
      if (proxy) banirProxy(proxy, 30000);
      if (t < MAX_TENT) { await sleep(250 * t + Math.random() * 150); continue; }
      throw new Error(ultimoErro);
    }

    if (res.data?.error) {
      ultimoErro = `TLSProxy: ${res.data.error}`;
      if (proxy) banirProxy(proxy, 30000);
      if (t < MAX_TENT && REDE_RE.test(ultimoErro)) { await sleep(300 * t); continue; }
      throw new Error(ultimoErro);
    }

    if (res.status !== 200) {
      ultimoErro = `TLSProxy status ${res.status}`;
      if (t < MAX_TENT) { await sleep(300 * t); continue; }
      throw new Error(ultimoErro);
    }

    const text = res.data?.text ?? "";
    const cab = text.slice(0, 800);

    if (RATE.test(cab) && t < MAX_TENT) {
      if (proxy) banirProxy(proxy, 60000);
      await sleep(2500);
      continue;
    }

    if (HTML_RE.test(cab)) {
      if (t >= MAX_TENT) return text;

      if (proxy && !casa.rotativa && clearances < 1) {
        clearances++;
        const cf = await obterClearance(casa, proxy);
        if (cf) {
          casa._cfCookie = cf.cookie;
          casa._cfUA = cf.ua || null;
          semCookie = false;
          await sleep(500);
          continue;
        }
        await sleep(700);
        continue;
      }

      if (ehAuth && tokensUsados < 1) {
        tokensUsados++;
        casa._xToken = null;
        casa._xTokenBody = null;

        const tok = await obterTokensTurnstile({
          dominio: casa.domain,
          tenantId: casa.tenantId,
          deviceId: casa.deviceId,
          sitekeyBody: casa.turnstile?.sitekeyBody,
          sitekeyHeader: casa.turnstile?.sitekeyHeader,
          action: casa.turnstile?.action,
          actionBody: casa.turnstile?.actionBody,
        });

        if (tok) {
          casa._xToken = tok.header || null;
          casa._xTokenBody = tok.body || null;
          await sleep(250);
          continue;
        }
      }

      await sleep(900);
      continue;
    }

    return text;
  }

  throw new Error(ultimoErro || "falha na requisição");
}

export const post = (casa, path, body, auth) => request(casa, "POST", path, body, auth);
export const get = (casa, path, input, auth) => request(casa, "GET", path, input, auth);

export function normalize(raw) {
  let obj = raw;
  if (typeof obj === "string") {
    const bruto = obj.trim();
    if (bruto.startsWith("<") || HTML_RE.test(bruto)) {
      const titulo = (bruto.match(/<title[^>]*>([^<]{0,120})/i) || [])[1] || "";
      return { ok: false, code: "HTML", msg: `HTML/bloqueio do Cloudflare${titulo ? ` — ${titulo.trim()}` : ""}` };
    }
    try {
      obj = JSON.parse(bruto);
    } catch {
      return { ok: false, code: "parse", msg: bruto.slice(0, 160) };
    }
  }
  if (!obj || typeof obj !== "object") return { ok: false, code: "empty", msg: "resposta vazia" };

  const err = obj.error?.json || obj.error;
  if (err) {
    return {
      ok: false,
      code: err.data?.code ?? err.code ?? null,
      msg: err.message || err.data?.message || "erro",
      data: null,
    };
  }

  const payload = obj.result?.data?.json ?? obj.result?.data ?? obj.data?.json ?? obj.data ?? obj;
  const code = payload?.code ?? payload?.errorCode ?? 0;
  const msg = String(payload?.msg || payload?.message || "");
  const okFlag = obj.result !== undefined || code === 0 || code === "0" || code === 200 || code === "200";

  return { ok: okFlag, code, msg, data: payload };
}

export function deepFind(root, keys, maxDepth = 8) {
  const queue = [[root, 0]];
  const wanted = keys.map((k) => k.toLowerCase());
  while (queue.length) {
    const [node, depth] = queue.shift();
    if (!node || typeof node !== "object" || depth > maxDepth) continue;
    for (const [k, v] of Object.entries(node)) {
      if (v === null || v === "" || typeof v === "object") continue;
      if (wanted.includes(k.toLowerCase())) return v;
    }
    for (const v of Object.values(node)) if (v && typeof v === "object") queue.push([v, depth + 1]);
  }
  return null;
}

export function hasData(payload) {
  if (payload === null || payload === undefined) return false;
  if (Array.isArray(payload)) return payload.length > 0;
  if (typeof payload === "object") {
    return Object.keys(payload).filter((k) => !["code", "msg", "message", "success"].includes(k)).length > 0;
  }
  return true;
}

const perfilOk = new Map();
export function marcarPerfilOk(domain, path) { perfilOk.set(domain, path); }
export function perfilConhecido(domain) { return perfilOk.get(domain) || null; }

export const PERFIL_PROCS = [
  "user.assets",
  "vip.info",
  "vip.vip",
  "user.details",
  "user.info",
  "main.perfil",
  "member.info",
  "user.me",
];

export const PROBE_PATHS = ["user.assets", "vip.info", "vip.vip", "main.perfil"];

export async function probe(casa, auth) {
  const found = [];
  for (const proc of PROBE_PATHS) {
    const path = withRouter(casa, proc);
    for (const metodo of ["GET", "POST"]) {
      for (const payload of [{ json: {} }, { json: { type: 1 } }]) {
        try {
          const raw = metodo === "GET" ? await get(casa, path, payload, auth) : await post(casa, path, payload, auth);
          const norm = normalize(raw);
          if (norm.ok && hasData(norm.data)) {
            found.push({ path, body: payload, metodo, sample: norm.data });
            break;
          }
        } catch {}
      }
      if (found.length && found[found.length - 1].path === path) break;
    }
    if (found.length >= 6) break;
  }
  return found;
}

export async function probePerfil(casa, auth) {
  const lista = [...new Set([perfilConhecido(casa.domain), ...(casa.perfilProcs || []), ...PERFIL_PROCS].filter(Boolean))];
  for (const proc of lista) {
    const path = proc.includes("/trpc/") ? proc : withRouter(casa, proc);
    for (const metodo of ["GET", "POST"]) {
      try {
        const raw = metodo === "GET" ? await get(casa, path, { json: {} }, auth) : await post(casa, path, { json: {} }, auth);
        const norm = normalize(raw);
        if (norm.ok && hasData(norm.data)) {
          marcarPerfilOk(casa.domain, path);
          return { path, body: { json: {} }, metodo, sample: norm.data };
        }
      } catch {}
    }
  }
  return null;
}

export function probeLog(line) {
  process.stdout.write(`  ${c.DIM}${line}${c.RESET}\n`);
}