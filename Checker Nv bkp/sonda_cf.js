// sonda_cf.js — diz se o proxy está bloqueado pelo Cloudflare
// uso: node sonda_cf.js <casa> [usuario:senha]
import axios from "axios";
import path from "path";
import { ROOT } from "./src/paths.js";
import { loadCasas } from "./src/storage.js";
import { loadProxies, getNextProxy } from "./src/proxy.js";
import { buildHeaders } from "./src/trpc.js";
import { DEFAULT_BODY } from "./src/curl.js";

const TLS = "http://127.0.0.1:3334";
const [nomeCasa, conta] = process.argv.slice(2);

async function pegar(url, headers, body = "") {
  const proxy = getNextProxy();
  const ini = Date.now();
  try {
    const r = await axios.post(`${TLS}/get`, { url, headers, body, ...(proxy ? { proxy } : {}) }, {
      timeout: 25000, validateStatus: () => true,
    });
    return { ms: Date.now() - ini, status: r.status, texto: String(r.data?.text ?? ""), ident: r.data?.ident, erro: r.data?.error };
  } catch (e) {
    return { ms: Date.now() - ini, status: 0, texto: "", erro: e.message };
  }
}

async function main() {
  if (!nomeCasa) {
    console.log("uso: node sonda_cf.js <casa> [usuario:senha]");
    process.exit(1);
  }
  const casas = loadCasas();
  const casa = casas[nomeCasa];
  if (!casa) { console.log(`casa '${nomeCasa}' não existe`); process.exit(1); }

  loadProxies(path.join(ROOT, "proxy.txt"));
  const proxy = getNextProxy();
  console.log("proxy:", proxy || "NENHUM");
  console.log("apiHost:", casa.apiHost, "| domain:", casa.domain);

  const trace = await pegar(`https://${casa.domain}/cdn-cgi/trace`, { accept: "text/plain" });
  console.log(`\n[1] cdn-cgi/trace → status=${trace.status} ${trace.ms}ms`);
  if (trace.texto) {
    for (const l of trace.texto.split("\n")) {
      if (/^(ip|loc|colo|warp|http)=/.test(l)) console.log("   ", l.trim());
    }
  } else console.log("   ", trace.erro || "(vazio)");

  const url = `https://${casa.apiHost}${casa.loginPath}`;
  const body = casa.bodyTemplate || DEFAULT_BODY;
  const r = await pegar(url, buildHeaders(casa, {}), body);
  console.log(`\n[2] login → status=${r.status} ${r.ms}ms ident=${r.ident || "-"}`);
  const cab = r.texto.slice(0, 400).replace(/\s+/g, " ");
  console.log("   ", cab || r.erro || "(vazio)");
  const titulo = (r.texto.match(/<title[^>]*>([^<]{0,120})/i) || [])[1];
  console.log("\nveredito:");
  if (r.texto.trim().startsWith("{")) console.log("   ✅ passou pelo Cloudflare (resposta JSON)");
  else if (/just a moment|checking your browser/i.test(r.texto)) console.log("   ⚠ desafio JS do Cloudflare — precisa de cf_clearance");
  else if (/attention required|access denied|1020/i.test(r.texto)) console.log("   ❌ IP bloqueado pelo Cloudflare (WAF)");
  else console.log(`   ? resposta inesperada${titulo ? ` — título: ${titulo.trim()}` : ""}`);
  process.exit(0);
}

main();