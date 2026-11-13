import fs from "fs";
import path from "path";
import crypto from "crypto";
import { ROOT } from "./src/paths.js";
import { loadCasas, saveCasas } from "./src/storage.js";

const nome = process.argv[2];
const esquema = process.argv[3] || "";
if (!nome) { console.error("uso: node addcasa.js <nome> [raw|bearer]"); process.exit(1); }

const arquivo = path.join(ROOT, "curl.txt");
if (!fs.existsSync(arquivo)) { console.error("crie curl.txt com o curl de auth.login"); process.exit(1); }

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
const domain = (headers.origin || "").replace(/^https?:\/\//, "").replace(/\/.*$/, "") || url.hostname;
if (!tenantId) { console.error("header tenantid ausente"); process.exit(1); }

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

const casas = loadCasas();
const chave = Object.keys(casas).includes(nome) ? `${nome}_2` : nome;
casas[chave] = casa;
saveCasas(casas);

console.log(`✅ casa '${chave}' gravada`);
console.log(`   domain=${casa.domain} apiHost=${casa.apiHost} tenant=${casa.tenantId}`);
console.log(`   login=${casa.loginPath} authScheme="${casa.authScheme}"`);
console.log(`\nAgora: node vip.js ${chave} USUARIO:SENHA`);