import axios from "axios";
import { getNextProxy } from "./proxy.js";
import { c } from "./ui.js";

const TLS_URL = "http://127.0.0.1:3334";

let minInterval = 0;
let nextSlot = 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Define o espaçamento mínimo (ms) entre requisições de toda a sessão. */
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
  headers["content-type"] = "application/json";
  headers.accept = headers.accept || "*/*";
  const cred = a.authTag || a.tokenData || a.token;
  const scheme = casa.authScheme;
  if (cred) headers.authorization = scheme === "" ? cred : `${scheme || "Bearer"} ${cred}`;
  else delete headers.authorization;
  delete headers["content-length"];
  return headers;
}

/** Todas as credenciais possíveis da sessão, na ordem de preferência. */
export function credVariants(auth) {
  const a = typeof auth === "string" ? { token: auth } : (auth || {});
  const lista = [a.authTag, a.tokenData, a.token].filter((x) => typeof x === "string" && x.length > 8);
  const unicos = [...new Set(lista)];
  return unicos.length ? unicos : [null];
}

export function withAuth(auth, cred) {
  const a = typeof auth === "string" ? { token: auth } : { ...(auth || {}) };
  if (!cred) return a;
  return { ...a, authTag: cred, tokenData: cred, token: cred };
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

/** tRPC query: input vai na query string, urlencoded. */
export function buildQuery(path, input) {
  const q = encodeURIComponent(JSON.stringify(input ?? { json: {} }));
  return `${path}${path.includes("?") ? "&" : "?"}input=${q}`;
}

const RATE = /muitas solicita|too many|rate limit|429|aguarde um momento/i;
const RETRYABLE = /timeout|ECONNRESET|socket|502|503|504|offline|proxy|cloudflare|<!doctype|just a moment|attention required/i;

async function request(casa, metodo, path, payload, auth) {
  const isGet = metodo === "GET";
  const url = isGet
    ? `https://${casa.apiHost}${buildQuery(path, payload)}`
    : `https://${casa.apiHost}${path}`;

  let ultimoErro = "";
  for (let tentativa = 1; tentativa <= 6; tentativa++) {
    await gate();
    const proxy = getNextProxy();
    let res;
    try {
      res = await axios.post(`${TLS_URL}/${isGet ? "get" : "post"}`, {
        url,
        headers: buildHeaders(casa, auth),
        body: isGet ? "" : JSON.stringify(payload ?? { json: {} }),
        ...(proxy ? { proxy } : {}),
      }, { timeout: 30000, validateStatus: () => true });
    } catch (e) {
      ultimoErro = `TLSProxy offline: ${e.message}`;
      if (tentativa < 6) { await sleep(1200 * tentativa + Math.random() * 700); continue; }
      throw new Error(ultimoErro);
    }

    if (res.data?.error) {
      ultimoErro = `TLSProxy: ${res.data.error}`;
      if (tentativa < 6 && RETRYABLE.test(ultimoErro)) { await sleep(1200 * tentativa + Math.random() * 700); continue; }
      throw new Error(ultimoErro);
    }
    if (res.status !== 200) {
      ultimoErro = `TLSProxy status ${res.status}`;
      if (tentativa < 6 && RETRYABLE.test(ultimoErro)) { await sleep(1500 * tentativa + Math.random() * 900); continue; }
      throw new Error(ultimoErro);
    }

    const text = res.data?.text ?? "";
    const cabeca = text.slice(0, 600);

    if (tentativa < 6 && RATE.test(cabeca)) {
      await sleep(9000 * tentativa + Math.random() * 2500);
      continue;
    }
    if (tentativa < 6 && RETRYABLE.test(cabeca)) {
      await sleep(2000 * tentativa + Math.random() * 1200);
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
    if (bruto.startsWith("<") || /<!doctype|cloudflare|just a moment|attention required|cf-error/i.test(bruto)) {
      return { ok: false, code: "HTML", msg: "HTML/bloqueio do Cloudflare" };
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

const LABEL_KEYS = /^(name|title|label|channelname|bankname|bank_name|methodname|withdrawname|payname|pay_name|typename|type_name|desc|description|remark|account_name)$/;

export function collectLabels(root, max = 30) {
  const out = new Set();
  const queue = [[root, 0]];
  while (queue.length && out.size < max) {
    const [node, depth] = queue.shift();
    if (!node || typeof node !== "object" || depth > 9) continue;
    for (const [k, v] of Object.entries(node)) {
      if (typeof v === "string" && LABEL_KEYS.test(k.toLowerCase())) {
        const val = v.trim();
        if (val && val.length <= 40 && !/^\d+$/.test(val)) out.add(val);
      } else if (typeof v === "number" && /^(type|channeltype|channel_type|withdrawtype)$/i.test(k)) {
        out.add(`tipo=${v}`);
      }
    }
    for (const v of Object.values(node)) if (v && typeof v === "object") queue.push([v, depth + 1]);
  }
  return [...out];
}

export function hasData(payload) {
  if (payload === null || payload === undefined) return false;
  if (Array.isArray(payload)) return payload.length > 0;
  if (typeof payload === "object") {
    const keys = Object.keys(payload).filter((k) => !["code", "msg", "message", "success"].includes(k));
    return keys.length > 0;
  }
  return true;
}

/** Procedures candidatas para a página /main/perfil (VIP + saldo). */
export const PERFIL_PROCS = [
  "main.perfil",
  "user.assets",
  "vip.info",
  "vip.vip",
  "member.info",
  "member.perfil",
  "member.profile",
  "member.detail",
  "member.me",
  "user.perfil",
  "user.profile",
  "user.info",
  "user.me",
  "perfil.info",
  "account.info",
  "wallet.info",
  "wallet.balance",
];

export const PROBE_PATHS = ["main.perfil", "user.assets", "vip.info", "vip.vip"];

export async function probe(casa, auth) {
  const found = [];
  for (const proc of PROBE_PATHS) {
    const path = withRouter(casa, proc);
    for (const metodo of ["GET", "POST"]) {
      for (const payload of [{ json: {} }, { json: { type: 1 } }]) {
        try {
          const raw = metodo === "GET"
            ? await get(casa, path, payload, auth)
            : await post(casa, path, payload, auth);
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

/** Descobre o endpoint de perfil (VIP/saldo) de uma casa. */
export async function probePerfil(casa, auth) {
  const lista = [...new Set([...(casa.perfilProcs || []), ...PERFIL_PROCS])];
  for (const proc of lista) {
    const path = withRouter(casa, proc);
    for (const metodo of ["GET", "POST"]) {
      for (const payload of [{ json: {} }, ...(auth?.userId ? [{ json: { userId: auth.userId } }] : [])]) {
        try {
          const raw = metodo === "GET"
            ? await get(casa, path, payload, auth)
            : await post(casa, path, payload, auth);
          const norm = normalize(raw);
          if (norm.ok && hasData(norm.data)) return { path, body: payload, metodo, sample: norm.data };
        } catch {}
      }
    }
  }
  return null;
}

export function probeLog(line) {
  process.stdout.write(`  ${c.DIM}${line}${c.RESET}\n`);
}