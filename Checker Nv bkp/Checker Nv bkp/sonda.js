import fs from "fs";
import path from "path";
import axios from "axios";
import { ROOT } from "./src/paths.js";
import { loadCasas, saveCasas } from "./src/storage.js";
import { loadProxies, getNextProxy } from "./src/proxy.js";
import { startTlsProxy } from "./src/tls.js";
import { buildHeaders, normalize } from "./src/trpc.js";
import { login } from "./src/login.js";

const TLS = "http://127.0.0.1:3334";
const SALDO = /"(balance|goldCoin|gameGold|walletBalance|saldo|money|available|amount)"/i;
const VIP = /"(vipLevel|vip_level|vip|level|grade)"/i;

const [nome, cred] = process.argv.slice(2);
if (!nome || !cred || !cred.includes(":")) { console.error("uso: node sonda2.js <casa> usuario:senha"); process.exit(1); }
const casas = loadCasas();
const casa = casas[nome];
if (!casa) { console.error("casa não encontrada"); process.exit(1); }
const i = cred.indexOf(":");

loadProxies(path.join(ROOT, "proxy.txt"));
await startTlsProxy();

const auth = await login(casa, cred.slice(0, i).trim(), cred.slice(i + 1).trim());
console.log(`login ok=${auth.ok} userId=${auth.userId ?? "-"}`);
if (!auth.ok) process.exit(0);

const P = casa.loginPath.replace(/[^/]+$/, "");
const MODOS = [
  ["raw-tag", (h) => { h.authorization = auth.authTag; }],
  ["raw-data", (h) => { h.authorization = auth.tokenData; }],
  ["raw-token", (h) => { h.authorization = auth.token; }],
  ["bearer-tag", (h) => { h.authorization = `Bearer ${auth.authTag}`; }],
  ["hdr-token", (h) => { h.token = auth.authTag; }],
  ["hdr-auth", (h) => { h.auth = auth.authTag; }],
  ["hdr-x-auth-token", (h) => { h["x-auth-token"] = auth.authTag; }],
  ["hdr-authorization-cookie", (h) => { h.cookie = `token=${auth.tokenData}`; h.authorization = auth.authTag; }],
];

function headersDe(fn) {
  const h = { ...buildHeaders(casa, auth) };
  delete h.authorization;
  delete h.cookie;
  fn(h);
  return h;
}

async function bater(proc, metodo, bodyObj, fn) {
  const alvo = P + proc;
  const url = metodo === "GET"
    ? `https://${casa.apiHost}${alvo}?input=${encodeURIComponent(JSON.stringify(bodyObj))}`
    : `https://${casa.apiHost}${alvo}`;
  const proxy = getNextProxy();
  try {
    const r = await axios.post(`${TLS}/${metodo === "GET" ? "get" : "post"}`, {
      url, headers: headersDe(fn), body: metodo === "GET" ? "" : JSON.stringify(bodyObj),
      ...(proxy ? { proxy } : {}),
    }, { timeout: 20000, validateStatus: () => true });
    const texto = String(r.data?.text ?? r.data?.error ?? "");
    const norm = normalize(texto);
    const dados = norm.ok && norm.data && typeof norm.data === "object" && Object.keys(norm.data).length > 1;
    return { proc, metodo, texto, dados, marcado: SALDO.test(texto) || VIP.test(texto), erro: !norm.ok };
  } catch (e) {
    return { proc, metodo, texto: "EXC " + e.message, dados: false, marcado: false, erro: true };
  }
}

console.log("\n=== credencial (vip.info + main.perfil) ===");
let escolhido = null;
for (const [rotulo, fn] of MODOS) {
  const r = await bater("vip.info", "GET", { json: {} }, fn);
  const ok = r.dados || r.marcado;
  console.log(`  [${ok ? "OK" : "401"}] ${rotulo} ${ok ? r.texto.replace(/\s+/g, " ").slice(0, 130) : ""}`);
  if (ok && !escolhido) escolhido = [rotulo, fn];
}
if (!escolhido) {
  console.log("\n❌ nenhum formato de credencial autenticou. Rode o headers.js.");
  process.exit(0);
}
console.log(`\n✅ formato: ${escolhido[0]}`);

const arquivo = path.join(ROOT, "db", "procs", `${nome}.json`);
let procs = ["main.perfil", "user.assets", "vip.info", "vip.vip", "member.info", "wallet.balance", "wallet.info", "user.info", "label.balance"];
if (fs.existsSync(arquivo)) { try { procs = [...new Set([...procs, ...JSON.parse(fs.readFileSync(arquivo, "utf-8"))])]; } catch {} }
procs = procs.slice(0, 40);

console.log(`\n=== ${procs.length} procedures (só o que não for 401) ===`);
const bons = [];
for (const proc of procs) {
  for (const metodo of ["GET", "POST"]) {
    const r = await bater(proc, metodo, { json: {} }, escolhido[1]);
    if (r.dados || r.marcado) {
      console.log(`${r.marcado ? "⭐" : "  "} [200] ${metodo} ${proc} ${r.texto.replace(/\s+/g, " ").slice(0, 240)}`);
      bons.push({ proc, metodo, texto: r.texto, marcado: r.marcado });
      break;
    }
    if (!r.erro && r.texto.includes("NOT_FOUND")) console.log(`  [404] ${metodo} ${proc}`);
  }
}

const marcados = bons.filter((b) => b.marcado);
console.log(`\n=== ${marcados.length} com saldo/VIP ===`);
for (const m of marcados) console.log(`  ${m.metodo} ${P}${m.proc}`);

if (marcados.length) {
  casa.perfilPath = P + marcados[0].proc;
  casa.perfilBody = '{"json":{}}';
  casa.perfilProcs = marcados.map((m) => m.proc);
  casa.authScheme = escolhido[0].startsWith("raw") ? "" : "Bearer";
  saveCasas(casas);
  console.log(`\n✅ vinculado ${casa.perfilPath} | authScheme="${casa.authScheme}"`);
  console.log(`   Confirme: node vip.js ${nome} ${cred}`);
} else {
  fs.mkdirSync(path.join(ROOT, "db", "sonda"), { recursive: true });
  fs.writeFileSync(path.join(ROOT, "db", "sonda", `${nome}-ok.json`), JSON.stringify(bons, null, 2));
  console.log("⚠️ autenticou mas nada trouxe saldo. Rode o headers.js abaixo.");
}
process.exit(0);