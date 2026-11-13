import { tlsPost } from "./tls.js";

/**
 * Verificação profunda — lista de bônus pendentes.
 * Rota de referência: /discount (aba canReceive, filtro "Pendente")
 * Endpoint padrão: POST /api/active/receivedAwardList
 *
 * status: 0 = pendente | timeDay: 60 = últimos 60 dias
 * Retorno: { ok, hit, total, somaTotal, itens[], erro }
 * Autossuficiente: não depende de headers.js nem de buildHeaders.
 */

const MAX_ITENS = 10;

const UA =
  "Mozilla/5.0 (Linux; Android 14; SM-G991B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.6822.114 Mobile Safari/537.36";

const CAMPOS = [
  "id", "activeId", "ruleId", "template", "activeType", "activeTypeText",
  "activeName", "bonusEnum", "bonusText", "reward", "status",
  "logCreateTime", "periodTime", "receiveTimeRemark", "canReceiveTime", "canGo",
];

const soNumero = (v) => {
  const n = Number(String(v ?? "").replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? n : 0;
};

function nonce() {
  const h = () => Math.floor(Math.random() * 16).toString(16);
  let s = "";
  for (let i = 0; i < 32; i++) s += h();
  return s;
}

function enxugar(item) {
  const o = {};
  for (const k of CAMPOS) if (item?.[k] !== undefined && item?.[k] !== null) o[k] = item[k];
  return o;
}

function extrairLista(payload) {
  const d = payload?.data ?? payload ?? {};
  const lista = d.list || d.records || d.rows || d.pendingRewardList || [];
  const total = soNumero(d.total ?? d.count ?? lista.length);
  const soma = lista.reduce((acc, it) => acc + soNumero(it?.reward), 0);
  const somaTotal = soNumero(d.totalReward ?? d.totalAmount ?? d.sumReward ?? soma);
  return { lista: Array.isArray(lista) ? lista : [], total, soma, somaTotal };
}

export async function verificarBonus({ casa, token, deviceId, traceId }) {
  const cfg = casa.deepCheck || {};
  const endpoint = cfg.endpoint;
  const res = { ok: false, hit: false, total: 0, somaTotal: 0, itens: [], erro: null };

  if (!endpoint) {
    res.erro = "sem endpoint";
    return res;
  }
  if (!token) {
    res.erro = "sem token de sessão";
    return res;
  }

  const body = { ...(cfg.body || {}) };
  body.page = Number(body.page) || 1;
  body.pageSize = Math.min(Number(body.pageSize) || MAX_ITENS, MAX_ITENS);

  const host = casa.apiHost || casa.domain;
  const lang = casa.lang || "pt";
  const origin = `https://${casa.domain}`;

  const qs = new URLSearchParams({
    siteCode: String(casa.siteCode || ""),
    token: String(token),
    language: lang,
  });

  const headers = {
    Accept: "application/json, text/plain, */*",
    "Accept-Encoding": "identity",
    "accept-language": lang === "en" ? "en-US,en;q=0.9" : "pt-BR,pt;q=0.9",
    "Content-Type": "application/json",
    "content-type": "application/json",
    "sec-ch-ua": '"Not A;Brand";v="99", "Chromium";v="134"',
    "sec-ch-ua-mobile": "?1",
    "sec-ch-ua-platform": '"Android"',
    domain: casa.domain,
    platformType: 5,
    Nonce: nonce(),
    siteCode: String(casa.siteCode || ""),
    "x-custom-referer": origin,
    Referer: `${origin}/`,
    Origin: origin,
    appversion: "1.1.97",
    currency: casa.currency || "BRL",
    auth: "",
    token: String(token),
    newJwt: "",
    language: lang,
    "user-agent": casa.userAgent || UA,
  };

  if (deviceId) headers["x-device-id"] = deviceId;
  if (traceId) headers["x-trace-id"] = traceId;

  const raw = JSON.stringify(body);
  headers["content-length"] = Buffer.byteLength(raw).toString();

  try {
    const text = await tlsPost(`https://${host}${endpoint}?${qs.toString()}`, headers, raw);
    const payload = JSON.parse(text || "{}");

    if (Number(payload?.code) !== 1) {
      res.erro = payload?.msg || `code ${payload?.code}`;
      return res;
    }

    const { lista, total, soma, somaTotal } = extrairLista(payload);
    res.ok = true;
    res.total = total;
    res.somaTotal = somaTotal || soma;
    res.itens = lista.slice(0, MAX_ITENS).map(enxugar);
    res.hit = lista.length > 0;
  } catch (e) {
    res.erro = e?.response?.status ? `HTTP ${e.response.status}` : (e?.message || "erro");
  }

  return res;
}

export default verificarBonus;