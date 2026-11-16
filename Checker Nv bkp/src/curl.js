import { v4 as uuidv4 } from "uuid";

// Headers voláteis: descartados no cadastro, reconstruídos a cada tentativa.
const DROP = new Set([
  "content-length", "host", "connection", "cookie",
  "x-trace-id", "x-device-id", "origin", "referer", "accept-encoding",
  "sec-fetch-dest", "sec-fetch-mode", "sec-fetch-site", "priority",
]);

// Plataforma ycyd123: auth.login é protegida por WAF — o login sai pelo browser.
const PLATAFORMA = /ycyd123\.com$/i;
const SITEKEY_HEADER = "0x4AAAAAAB0oRY23FyZnllMo";
const SITEKEY_BODY = "0x4AAAAAAAiHEkDee-yqSdMj";

function tokenize(text) {
  const tokens = [];
  const pattern = /"((?:\\.|[^"\\])*)"|'([^']*)'|([^\s'"\\]+)|\\(.)/gs;
  let token = "";
  let end = 0;
  for (const match of text.matchAll(pattern)) {
    if (/\s/.test(text.slice(end, match.index))) {
      if (token) tokens.push(token);
      token = "";
    }
    token += match[1] !== undefined
      ? match[1].replace(/\\(["\\$`])/g, "$1")
      : match[2] ?? match[3] ?? (match[4] === "\n" ? "" : match[4]);
    end = match.index + match[0].length;
  }
  if (token) tokens.push(token);
  return tokens;
}

function hostOf(value) {
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) ? url.hostname : null;
  } catch {
    return null;
  }
}

/** Divide um bloco com vários curls colados. */
export function splitCurls(text) {
  return text
    .split(/\n(?=\s*curl\s)|\n\s*-{3,}\s*\n/i)
    .map((s) => s.trim())
    .filter((s) => s.length > 10);
}

export function parseCurl(text) {
  const tokens = tokenize(text);
  const headers = {};
  let url = null;
  let body = null;

  for (let i = 0; i < tokens.length; i++) {
    const value = tokens[i];
    let header;
    if (value === "-H" || value === "--header") header = tokens[++i];
    else if (value.startsWith("--header=")) header = value.slice(9);
    else if (value.startsWith("-H") && value.length > 2) header = value.slice(2);
    else if (value === "--url") url = tokens[++i];
    else if (value.startsWith("--url=")) url = value.slice(6);
    else if (["--data-raw", "--data", "--data-binary", "-d", "--data-ascii"].includes(value)) body = tokens[++i];
    else if (value.startsWith("--data-raw=")) body = value.slice(11);
    else if (value.startsWith("--data=")) body = value.slice(7);
    else if (!url && /^https?:\/\//i.test(value)) url = value;

    if (header) {
      const sep = header.indexOf(":");
      if (sep > 0) headers[header.slice(0, sep).trim().toLowerCase()] = header.slice(sep + 1).trim();
    }
  }

  if (!url) return { error: "URL não encontrada no curl." };

  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return { error: "URL inválida." };
  }
  if (!["http:", "https:"].includes(parsed.protocol)) return { error: "Protocolo inválido." };
  if (!parsed.pathname.includes("/trpc/")) return { error: "Endpoint não é tRPC (sem /trpc/ no path)." };

  const apiHost = parsed.hostname;
  const path = parsed.pathname;
  const domain = headers.domain || hostOf(headers.origin) || hostOf(headers.referer) || apiHost;
  const tenantId = headers.tenantid || headers["tenant-id"] || null;

  if (!tenantId) return { error: "Header 'tenantid' não encontrado." };
  if (!domain) return { error: "Não consegui extrair o domain (origin/referer)." };

  const authRaw = headers.authorization || "";
  const authScheme = /^[A-Za-z][A-Za-z0-9_-]*\s+/.test(authRaw) ? authRaw.split(/\s+/)[0] : (authRaw ? "" : null);

  const kept = {};
  for (const [k, v] of Object.entries(headers)) if (!DROP.has(k) && k !== "authorization") kept[k] = v;

  return {
    apiHost,
    path,
    domain,
    tenantId,
    headers: kept,
    body,
    authScheme,
    deviceId: headers["x-device-id"] || uuidv4(),
    clientVersion: headers["x-client-version"] || "v242",
    deviceType: headers["x-device-type"] || "DesktopOS",
  };
}

const DEFAULT_LOGIN = "/api/frontend/trpc/auth.login";
const INFO_PROC = /member\.(info|detail)$|wallet\.(balance|info)$/;
const PERFIL_PROC = /member\.(perfil|profile|info|detail|me)$|user\.(perfil|profile|info|me)$|vip\.(info|perfil)$|perfil\.|account\.info$/;
const PASS_KEY = /pass|pwd|senha/i;

/** Detecta se o body de login já traz a senha em hash. */
function passModeOf(body) {
  if (!body) return "plain";
  let parsed;
  try {
    parsed = JSON.parse(body);
  } catch {
    return "plain";
  }
  const walk = (node, depth = 0) => {
    if (!node || typeof node !== "object" || depth > 8) return null;
    for (const [k, v] of Object.entries(node)) {
      if (typeof v === "string" && PASS_KEY.test(k)) {
        if (/^[a-f0-9]{32}$/i.test(v)) return "md5";
        if (/^[a-f0-9]{64}$/i.test(v)) return "sha256";
        return "plain";
      }
      if (v && typeof v === "object") {
        const achado = walk(v, depth + 1);
        if (achado) return achado;
      }
    }
    return null;
  };
  return walk(parsed) || "plain";
}

/**
 * Monta o registro da casa a partir do curl colado.
 * Aceita curl de login, de token, de member.info/saldo, de perfil ou de saque.
 */
export function buildCasa(parsed) {
  const isLogin = /auth\.login$/.test(parsed.path);
  const isToken = /auth\.token$/.test(parsed.path);
  const isInfo = INFO_PROC.test(parsed.path);
  const isPerfil = PERFIL_PROC.test(parsed.path);

  let loginPath, tokenPath;
  if (isLogin) {
    loginPath = parsed.path;
    tokenPath = parsed.path.replace(/auth\.login$/, "auth.token");
  } else if (isToken) {
    tokenPath = parsed.path;
    loginPath = parsed.path.replace(/auth\.token$/, "auth.login");
  } else {
    loginPath = DEFAULT_LOGIN;
    tokenPath = DEFAULT_LOGIN.replace(/auth\.login$/, "auth.token");
  }

  const casa = {
    domain: parsed.domain,
    apiHost: parsed.apiHost,
    tenantId: parsed.tenantId,
    loginPath,
    tokenPath,
    deviceId: parsed.deviceId,
    clientVersion: parsed.clientVersion,
    deviceType: parsed.deviceType,
    headers: parsed.headers,
    authScheme: parsed.authScheme === null ? "Bearer" : parsed.authScheme,
    bodyTemplate: isLogin && parsed.body ? parsed.body : null,
    passMode: isLogin && parsed.body ? passModeOf(parsed.body) : "plain",
  };

  // casa da plataforma: já nasce com o login pelo browser e as sitekeys
  if (PLATAFORMA.test(casa.apiHost)) {
    casa.captchaId = SITEKEY_BODY;
    casa.browserLogin = true;
    casa.channelId = 0;
    casa.turnstile = {
      sitekeyBody: SITEKEY_BODY,
      sitekeyHeader: SITEKEY_HEADER,
      action: "api_protection",
      actionBody: "login",
    };
  }

  if (isInfo) casa.infoPath = parsed.path;

  if (isPerfil) {
    casa.perfilPath = parsed.path;
    casa.perfilBody = parsed.body || '{"json":{}}';
  }

  if (!isLogin && !isToken && !isInfo && !isPerfil && parsed.path) {
    casa.extraPath = parsed.path;
    casa.extraBody = parsed.body || null;
  }

  return casa;
}

export const DEFAULT_BODY = JSON.stringify({
  json: {
    username: "",
    password: "",
    hToken: null,
    lastLoginDevice: "",
    loginDeviceModel: "web Windows NT 10.0 windows Windows NT 10.0; Win64; x64",
    appType: "DesktopOS",
    channelId: 0,
  },
  meta: { values: { hToken: ["undefined"] } },
});