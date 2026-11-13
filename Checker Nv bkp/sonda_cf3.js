// sonda_cf3.js — testa o request REAL do curl.txt contra apiHost e contra o domain.
// Uso: node sonda_cf3.js 5853
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { execFile } from "child_process";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const DOMAIN_PADRAO = "9mulm4.com";

function lerProxy() {
  const f = path.join(ROOT, "proxy.txt");
  if (!fs.existsSync(f)) return null;
  const l = fs.readFileSync(f, "utf8").split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  return l.length ? l[0] : null;
}
function proxyUrl(p) {
  if (!p) return null;
  const a = p.split(":");
  if (a.length === 4) return `http://${a[2]}:${a[3]}@${a[0]}:${a[1]}`;
  return `http://${p}`;
}
const PROXY = proxyUrl(lerProxy());

const txt = fs.readFileSync(path.join(ROOT, "curl.txt"), "utf8").replace(/\\\r?\n/g, " ");
const urlM = txt.match(/['"](https?:\/\/[^'"]+)['"]/);
if (!urlM) { console.log("curl.txt sem URL"); process.exit(1); }
const base = new URL(urlM[1]);

const headers = [];
const hRe = /-H\s+(['"])([\s\S]*?)\1/g;
let m;
while ((m = hRe.exec(txt))) headers.push(m[2]);
const bM = txt.match(/(?:--data-raw|--data-binary|--data|-d)\s+(['"])([\s\S]*?)\1/);
const body = bM ? bM[2] : null;
const method = (txt.match(/-X\s+([A-Z]+)/) || [])[1] || (body ? "POST" : "GET");

const limpos = headers.filter(h => {
  const k = h.split(":")[0].toLowerCase().trim();
  return k && k !== "host" && k !== "content-length";
});

console.log("apiHost :", base.host);
console.log("path    :", base.pathname + base.search);
console.log("method  :", method, "| body:", body ? body.length + " bytes" : "sem body");
console.log("proxy   :", PROXY ? "sim" : "nao", "\n");

function run(url, useProxy) {
  return new Promise(res => {
    const args = ["-s", "--compressed", "--max-time", "30", "-w", "\n__CODE__%{http_code}", "-X", method, url];
    if (useProxy && PROXY) args.push("--proxy", PROXY);
    for (const h of limpos) args.push("-H", h);
    if (body) args.push("--data-raw", body);
    execFile("curl.exe", args, { maxBuffer: 32 * 1024 * 1024, timeout: 35000 }, (err, stdout) => {
      const out = String(stdout || "");
      const c = out.match(/__CODE__(\d{3})\s*$/);
      res({ code: c ? Number(c[1]) : 0, body: out.replace(/__CODE__\d{3}\s*$/, "") });
    });
  });
}

function classificar(code, b) {
  const s = (b || "").toLowerCase();
  if (s.includes("attention required")) return "WAF";
  if (s.includes("just a moment") || s.includes("cf_chl")) return "DESAFIO";
  if (code === 200) return "OK";
  if (code === 0) return "ERRO";
  return "HTTP " + code;
}

const apiUrl = base.href;
const domUrl = (p) => `https://${DOMAIN_PADRAO}${p}${base.search}`;
const pApi = base.pathname.startsWith("/api") ? base.pathname : "/api" + base.pathname;

const testes = [
  ["A", "apiHost  proxy  path original", apiUrl, true],
  ["B", "apiHost  direto  path original", apiUrl, false],
  ["C", "domain   proxy   path original", domUrl(base.pathname), true],
  ["D", "domain   direto  path original", domUrl(base.pathname), false],
  ["E", "domain   proxy   /api + path",   domUrl(pApi), true],
  ["F", "domain   direto  /api + path",   domUrl(pApi), false],
];

const r = {};
for (const [id, nome, u, px] of testes) {
  const t0 = Date.now();
  const { code, body: b } = await run(u, px);
  const cls = classificar(code, b);
  r[id] = cls;
  console.log(`[${id}] ${nome} → ${cls} (${code}, ${Date.now() - t0}ms, ${(b || "").length}b)`);
  if (cls !== "OK") console.log("     " + (b || "").slice(0, 110).replace(/\s+/g, " "));
  else console.log("     " + (b || "").slice(0, 110).replace(/\s+/g, " "));
  await new Promise(s => setTimeout(s, 800));
}

console.log("\nVEREDITO:");
if (r.A === "OK") console.log("  → o POST passa no apiHost. O WAF era so no GET /. Mantem o host atual.");
else if (r.C === "OK" || r.D === "OK" || r.E === "OK" || r.F === "OK")
  console.log("  → o domain serve a API. Trocar o host do login para o domain resolve.");
else console.log("  → nem o domain aceita a API. Precisa cf_clearance no apiHost (clearance e por hostname).");