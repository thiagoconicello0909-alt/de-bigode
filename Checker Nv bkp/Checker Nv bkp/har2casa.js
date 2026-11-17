import fs from "fs";
import { loadCasas, saveCasas } from "./src/storage.js";

const [arquivo, nomeCasa] = process.argv.slice(2);
if (!arquivo) { console.error("uso: node har2casa.js <captura.jsonl|.har> [casa]"); process.exit(1); }

const SALDO = /"(balance|goldCoin|gameGold|game_gold|walletBalance|wallet_balance|saldo|money|available|credit)"/;
const VIP = /"(vipLevel|vip_level|vip|level|grade|vipName|vip_name|levelName)"/;

function normalizar(texto) {
  if (texto.trimStart().startsWith("{")) {
    const har = JSON.parse(texto);
    return (har.log?.entries || []).map((e) => ({
      metodo: e.request.method,
      url: e.request.url,
      headers: Object.fromEntries((e.request.headers || []).map((h) => [h.name.toLowerCase(), h.value])),
      body: e.request.postData?.text || "",
      status: e.response?.status || 0,
      respBody: e.response?.content?.text || "",
    }));
  }
  const pendentes = new Map();
  const out = [];
  for (const linha of texto.split("\n")) {
    if (!linha.trim()) continue;
    let o;
    try { o = JSON.parse(linha); } catch { continue; }
    if (o.tipo === "req") {
      pendentes.set(o.url + o.t, { metodo: o.metodo, url: o.url, headers: o.headers || {}, body: o.body || "", status: 0, respBody: "" });
    } else if (o.tipo === "res") {
      let alvo = null;
      for (const [k, v] of pendentes) if (v.url === o.url) { alvo = v; pendentes.delete(k); }
      if (alvo) { alvo.status = o.status; alvo.respBody = o.body || ""; out.push(alvo); }
    }
  }
  return out;
}

const entradas = normalizar(fs.readFileSync(arquivo, "utf-8"));
const trpc = entradas.filter((e) => e.url.includes("/trpc/"));
if (!trpc.length) { console.log("nenhuma chamada /trpc/ na captura"); process.exit(0); }

const host = new URL(trpc[0].url).hostname;

const procs = new Map();
for (const e of trpc) {
  if (new URL(e.url).hostname !== host) continue;
  const proc = new URL(e.url).pathname.split("/trpc/")[1];
  if (!proc || /^auth\./.test(proc)) continue;
  const score = (e.status === 200 ? 5 : 0) + (SALDO.test(e.respBody) ? 10 : 0) + (VIP.test(e.respBody) ? 6 : 0) +
    (e.headers.authorization ? 3 : 0) + (e.metodo === "POST" ? 1 : 0);
  const atual = procs.get(proc);
  if (!atual || score > atual.score) procs.set(proc, { proc, metodo: e.metodo, body: e.body, status: e.status, score, headers: e.headers, respBody: e.respBody });
}

const ordenado = [...procs.values()].sort((a, b) => b.score - a.score);
console.log("proc".padEnd(34), "met", "status", "score", "chaves");
for (const p of ordenado.slice(0, 15)) {
  const chaves = [...new Set([...p.respBody.matchAll(/"([a-zA-Z_]{3,24})"\s*:/g)].map((m) => m[1]))].slice(0, 8).join(",");
  console.log(p.proc.padEnd(34), p.metodo.padEnd(4), String(p.status).padEnd(6), String(p.score).padEnd(5), chaves);
}

const melhor = ordenado.find((p) => p.status === 200 && (SALDO.test(p.respBody) || VIP.test(p.respBody)));
if (!melhor) {
  console.log("\n⚠️ nenhuma procedure devolveu chave de saldo/VIP.");
  console.log("   Abra o perfil na janela do record e capture de novo.");
  process.exit(0);
}

if (nomeCasa) {
  const casas = loadCasas();
  const casa = casas[nomeCasa];
  if (!casa) { console.log("casa não encontrada no casas.json"); process.exit(0); }
  const VOLATIL = new Set(["authorization", "cookie", "content-length", "host", "connection", "origin", "referer", "x-trace-id", "accept-encoding", "sec-fetch-dest", "sec-fetch-mode", "sec-fetch-site", "priority"]);
  const headers = {};
  for (const [k, v] of Object.entries(melhor.headers)) if (!VOLATIL.has(k.toLowerCase())) headers[k] = v;
  casa.headers = { ...(casa.headers || {}), ...headers };
  casa.apiHost = host;
  casa.perfilPath = new URL(melhor.url).pathname;
  casa.perfilBody = melhor.body || '{"json":{}}';
  casa.perfilProcs = ordenado.filter((p) => p.status === 200).map((p) => p.proc.split("/trpc/")[1]).slice(0, 40);
  saveCasas(casas);
  console.log(`\n✅ perfil vinculado: ${casa.perfilPath}`);
  console.log(`   ${casa.perfilProcs.length} procedures guardadas como reserva`);
}