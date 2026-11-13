import fs from "fs";
import path from "path";
import axios from "axios";
import { ROOT } from "./src/paths.js";
import { loadCasas, saveCasas } from "./src/storage.js";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const MAX_BUNDLES = 60;
const MAX_BYTES = 40 * 1024 * 1024;

const arg = process.argv[2];
if (!arg) { console.error("uso: node procs.js <casa|dominio>"); process.exit(1); }

const casas = loadCasas();
const casa = casas[arg];
const dominio = casa ? casa.domain : (/^[\w.-]+\.[a-z]{2,}$/i.test(arg) ? arg : null);
if (!dominio) { console.error(`❌ casa '${arg}' não existe e não parece um domínio`); process.exit(1); }

const BOM = /vip|member|wallet|balance|saldo|perfil|profile|info|account|user|fund|deposit|cash|money|summary/i;
const RUIM = /^(vue|react|axios|core-js|regenerator|tslib|dayjs|pinia|lodash|zone|nanoid|clsx|qs)\./i;
const EXT = /\.(js|mjs|css|png|jpe?g|svg|webp|woff2?|ttf|ico|json|map)(\?|$)/i;
const PROC = /^[a-z][a-z0-9]*\.[a-zA-Z][a-zA-Z0-9_]{2,}(\.[a-zA-Z][a-zA-Z0-9_]+)?$/;

async function baixar(url, binario = false) {
  for (let i = 0; i < 3; i++) {
    try {
      const r = await axios.get(url, {
        timeout: 25000,
        responseType: binario ? "arraybuffer" : "text",
        headers: { "user-agent": UA, accept: "*/*" },
        validateStatus: () => true,
        maxContentLength: 20 * 1024 * 1024,
      });
      if (r.status !== 200) return "";
      return binario ? Buffer.from(r.data).toString("utf-8") : (typeof r.data === "string" ? r.data : "");
    } catch {
      if (i === 2) return "";
      await new Promise((r) => setTimeout(r, 600 * (i + 1)));
    }
  }
  return "";
}

const base = `https://${dominio}`;
console.log(`→ ${base}`);

const html = await baixar(`${base}/`);
if (!html) { console.error("❌ home não abriu (domínio errado, geo-block ou Cloudflare)"); process.exit(1); }

function absoluto(s) {
  try {
    return new URL(s, base + "/").href;
  } catch {
    return null;
  }
}

const urls = new Set();
for (const m of html.matchAll(/(?:src|href)\s*=\s*["']([^"']+\.m?js[^"']*)["']/gi)) {
  const u = absoluto(m[1]);
  if (u && u.startsWith(base)) urls.add(u);
}
for (const m of html.matchAll(/["'`]((?:\.{0,2}\/)?(?:assets|js|_nuxt|static|build)\/[^"'`\s]+\.m?js)["'`]/gi)) {
  const u = absoluto(m[1]);
  if (u && u.startsWith(base)) urls.add(u);
}

const lista = [...urls].slice(0, MAX_BUNDLES);
console.log(`→ ${lista.length} bundle(s) para baixar`);

let blob = html;
let total = Buffer.byteLength(html);
for (const u of lista) {
  if (total > MAX_BYTES) { console.log("  (limite de bytes atingido)"); break; }
  const t = await baixar(u);
  if (!t) continue;
  total += Buffer.byteLength(t);
  blob += "\n" + t;
  console.log(`  ok ${u.replace(base, "").slice(0, 72)} (${(t.length / 1024).toFixed(0)}kb)`);
}

const achados = new Map();
const registrar = (proc) => {
  if (!PROC_OK.test(proc) || RUIM.test(proc) || EXT.test(proc)) return;  let score = 0;
  if (BOM.test(proc)) score += 8;
  if (/\b(info|detail|get|list|me|config|summary|balance)\b/i.test(proc)) score += 4;
  if (/^(vip|member|wallet|user|account|perfil|profile)\./i.test(proc)) score += 6;
  if (/^(vip|member|wallet|user|account|perfil|profile)\.(info|detail|profile|perfil|me|balance|summary)$/i.test(proc)) score += 10;
  if (score === 0) return;
  if (proc.length > 46) score -= 3;
  achados.set(proc, Math.max(achados.get(proc) || 0, score));
};

const PROC_OK = /^[A-Za-z][A-Za-z0-9_]*\.[A-Za-z][A-Za-z0-9_]{2,}(\.[A-Za-z][A-Za-z0-9_]+)?$/;

// 1) caminhos completos de URL
for (const m of blob.matchAll(/\/trpc\/([A-Za-z][A-Za-z0-9_]*\.[A-Za-z][A-Za-z0-9_.]+)/g)) registrar(m[1].replace(/[.\s]+$/, ""));

// 2) strings literais com ponto (delimitadas por aspas)
for (const m of blob.matchAll(/["'`]([a-z][a-z0-9]*\.[a-zA-Z][a-zA-Z0-9_.]{2,})["'`]/g)) registrar(m[1]);

// 3) router aninhado minificado: {ns:{proc:...}}
for (const m of blob.matchAll(/[{[,]\s*([A-Za-z][A-Za-z0-9_]{2,})\s*:\s*\{([^{}]{0,400})\}/g)) {
  const ns = m[1];
  if (RUIM.test(ns)) continue;
  for (const k of m[2].matchAll(/[{[,]\s*([A-Za-z][A-Za-z0-9_]{2,})\s*[:,}]/g)) registrar(`${ns}.${k[1]}`);
}

const ordenada = [...achados.entries()].sort((a, b) => b[1] - a[1]).map(([p]) => p).slice(0, 150);
if (!ordenada.length) {
  console.log("\n⚠️ nenhuma procedure encontrada. O bundle pode montar as rotas dinamicamente.");
  console.log("   Use o record.js (login + perfil) e o har2casa.js.");
  process.exit(0);
}

const dir = path.join(ROOT, "db", "procs");
fs.mkdirSync(dir, { recursive: true });
const saida = path.join(dir, `${(casa ? arg : dominio).replace(/[^\w.-]/g, "_")}.json`);
fs.writeFileSync(saida, JSON.stringify(ordenada, null, 2));

if (casa) {
  casa.perfilProcs = ordenada;
  saveCasas(casas);
  console.log(`\n✅ ${ordenada.length} candidatas salvas em ${saida} e gravadas na casa '${arg}'`);
  console.log(`   Teste: node vip.js ${arg} usuario:senha`);
} else {
  console.log(`\n✅ ${ordenada.length} candidatas salvas em ${saida}`);
  console.log("   Cadastre a casa primeiro (Gerenciar casas → Adicionar) para usar no run.");
}

console.log("\nTop 30:");
console.log(ordenada.slice(0, 30).join("\n"));
process.exit(0);