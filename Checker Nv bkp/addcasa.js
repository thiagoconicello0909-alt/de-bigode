import fs from "fs";
import path from "path";
import crypto from "crypto";
import axios from "axios";
import { ROOT } from "./src/paths.js";
import { loadCasas, saveCasas } from "./src/storage.js";

const nome = process.argv[2];
const esquema = process.argv[3] || "";
if (!nome) { console.error("uso: node addcasa.js <nome> [raw|bearer]"); process.exit(1); }

const arquivo = path.join(ROOT, "curl.txt");
if (!fs.existsSync(arquivo)) { console.error("crie curl.txt com o curl de auth.login"); process.exit(1); }

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/157.0.0.0 Safari/537.36 Edg/157.0.0.0";
const PLATAFORMA = /ycyd123\.com$/i;
const SITEKEY_PADRAO = { header: "0x4AAAAAAB0oRY23FyZnllMo", body: "0x4AAAAAAAiHEkDee-yqSdMj" };

const texto = fs.readFileSync(arquivo, "utf-8").replace(/\\\r?\n/g, " ").replace(/\r/g, "");

const urlM = texto.match(/https?:\/\/[^\s'"]+/);
if (!urlM) { console.error("URL não encontrada"); process.exit(1); }
const url = new URL(urlM[0]);
if (!url.pathname.includes("/trpc/auth.login")) { console.error(`path inesperado: ${url.pathname}`); process.exit(1); }

const headers = {};
for (const m of texto.matchAll(/-H\s+'([^']*)'|-H\s+"([^"]*)"/g)) {
  const bruto = (m[1] ?? m[2] ?? "").trim();
  const sep = bruto.indexOf(":");
  if (sep > 0) headers[bruto.slice(0, sep).trim().toLowerCase()] = bruto.slice(sep + 1).trim();
}

const bodyM = texto.match(/--data-raw\s+'([^']*)'|--data-raw\s+"([^"]*)"/);
if (!bodyM) { console.error("body do login não encontrado"); process.exit(1); }
const body = bodyM[1] ?? bodyM[2];
try { JSON.parse(body); } catch { console.error("body não é JSON válido"); process.exit(1); }

const tenantId = headers.tenantid || headers["tenant-id"];
const origem = headers.origin || headers.referer || "";
const domain = origem.replace(/^https?:\/\//, "").replace(/\/.*$/, "") || url.hostname;
if (!tenantId) { console.error("header tenantid ausente"); process.exit(1); }

/** Lê as sitekeys do Turnstile direto no bundle do site. */
async function sitekeysDoSite(dominio) {
  try {
    const pagina = await axios.get(`https://${dominio}/`, {
      headers: { "user-agent": UA, accept: "text/html,application/xhtml+xml" },
      timeout: 20000,
      validateStatus: () => true,
    });
    const html = String(pagina.data || "");
    const m = html.match(/src="(https?:\/\/[^"]+\/assets\/[^"]+\.js)"/) || html.match(/src="(\/assets\/[^"]+\.js)"/);
    if (!m) return null;
    const alvo = m[1].startsWith("http") ? m[1] : `https://${dominio}${m[1]}`;

    const resp = await axios.get(alvo, { headers: { "user-agent": UA }, timeout: 30000, validateStatus: () => true });
    const js = String(resp.data || "");

    const chaves = [...new Set(js.match(/0x4[A-Za-z0-9_-]{15,}/g) || [])];
    if (chaves.length < 2) return null;

    const maisPerto = (pos) => {
      let achou = null;
      let dist = Infinity;
      for (const k of chaves) {
        const p = js.indexOf(k);
        if (p < 0) continue;
        const d = Math.abs(p - pos);
        if (d < dist) { dist = d; achou = k; }
      }
      return achou;
    };

    const idxProt = js.indexOf("api_protection");
    const header = idxProt >= 0 ? maisPerto(idxProt) : null;
    const bodyKey = chaves.find((k) => k !== header) || null;
    if (!header || !bodyKey) return null;

    return { header, body: bodyKey };
  } catch {
    return null;
  }
}

const DROP = new Set(["content-length", "host", "connection", "cookie", "x-trace-id", "origin", "referer", "accept-encoding", "sec-fetch-dest", "sec-fetch-mode", "sec-fetch-site", "priority", "channelid"]);
const mantidos = {};
for (const [k, v] of Object.entries(headers)) if (!DROP.has(k) && k !== "authorization") mantidos[k] = v;

const casa = {
  domain,
  apiHost: url.hostname,
  tenantId,
  loginPath: url.pathname,
  tokenPath: url.pathname.replace(/auth\.login$/, "auth.token"),
  deviceId: headers["x-device-id"] || crypto.randomUUID(),
  clientVersion: headers["x-client-version"] || "v240",
  deviceType: headers["x-device-type"] || "DesktopOS",
  headers: mantidos,
  authScheme: esquema === "bearer" ? "Bearer" : "",
  bodyTemplate: body,
  passMode: "plain",
};

if (PLATAFORMA.test(casa.apiHost)) {
  const sk = (await sitekeysDoSite(casa.domain)) || SITEKEY_PADRAO;
  casa.captchaId = sk.body;
  casa.browserLogin = true;
  casa.channelId = 0;
  casa.lang = "pt";
  casa.turnstile = {
    sitekeyBody: sk.body,
    sitekeyHeader: sk.header,
    action: "api_protection",
    actionBody: "login",
  };
}

const casas = loadCasas();
const chave = Object.keys(casas).includes(nome) ? `${nome}_2` : nome;
casas[chave] = casa;
saveCasas(casas);

console.log(`✅ casa '${chave}' gravada`);
console.log(`   domain=${casa.domain} apiHost=${casa.apiHost} tenant=${casa.tenantId}`);
console.log(`   login=${casa.loginPath} authScheme="${casa.authScheme}"`);
if (casa.browserLogin) {
  console.log(`   🔓 plataforma ycyd123 — browserLogin ativo`);
  console.log(`   sitekey header=${casa.turnstile.sitekeyHeader}`);
  console.log(`   sitekey body  =${casa.turnstile.sitekeyBody}`);
} else {
  console.log(`   ⚠ host fora da plataforma ycyd123 — sem browserLogin (vai precisar de captcha)`);
}
console.log(`\nAgora: node vip.js ${chave} USUARIO:SENHA`);