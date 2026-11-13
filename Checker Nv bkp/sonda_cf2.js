// sonda_cf2.js — descobre O QUE dispara a WAF: IP, host ou formato da requisicao.
// Uso: node sonda_cf2.js 5853 api.ycyd123.com 9mulm4.com
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { execFile } from "child_process";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const apiHost = (process.argv[3] || "api.ycyd123.com").trim();
const domain  = (process.argv[4] || "9mulm4.com").trim();

const UA120 =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

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
  if (a.length === 2) return `http://${a[0]}:${a[1]}`;
  return `http://${p}`;
}

const PROXY = proxyUrl(lerProxy());
const mask = (u) => (u ? u.replace(/\/\/([^:]+):([^@]+)@/, "//$1:***@") : "sem proxy");

const FULL = [
  `user-agent: ${UA120}`,
  "accept: text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "accept-language: pt-BR,pt;q=0.9,en;q=0.8",
  'sec-ch-ua: "Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
  "sec-ch-ua-mobile: ?0",
  'sec-ch-ua-platform: "Windows"',
  "sec-fetch-site: none",
  "sec-fetch-mode: navigate",
  "sec-fetch-dest: document",
  "sec-fetch-user: ?1",
  "upgrade-insecure-requests: 1",
  "priority: u=0, i",
];
const MIN = [`user-agent: ${UA120}`, "accept: text/html"];

function run(url, { useProxy, hdrs, http1 = false }) {
  return new Promise((res) => {
    const args = ["-s", "--compressed", "--max-time", "30", "-w", "\n__CODE__%{http_code}", url];
    if (http1) args.push("--http1.1");
    if (useProxy && PROXY) args.push("--proxy", PROXY);
    for (const h of hdrs) args.push("-H", h);
    execFile("curl.exe", args, { maxBuffer: 32 * 1024 * 1024, timeout: 35000 }, (err, stdout) => {
      const out = String(stdout || "");
      const m = out.match(/__CODE__(\d{3})\s*$/);
      res({
        code: m ? Number(m[1]) : 0,
        body: out.replace(/__CODE__\d{3}\s*$/, ""),
        err: err && !m ? String(err.message || err) : null,
      });
    });
  });
}

function classificar(code, body) {
  const b = (body || "").toLowerCase();
  if (b.includes("attention required")) return "WAF";
  if (b.includes("just a moment") || b.includes("cf_chl") || b.includes("challenge-platform")) return "DESAFIO";
  if (code === 200 && (body || "").length > 400) return "OK";
  if (code === 0) return "ERRO";
  if (code >= 400) return "HTTP " + code;
  return "?" + code;
}

const testes = [
  ["A", "direto  apiHost  GET /",         `https://${apiHost}/`, { useProxy: false, hdrs: FULL }],
  ["B", "proxy   apiHost  GET /",         `https://${apiHost}/`, { useProxy: true,  hdrs: FULL }],
  ["C", "proxy   domain   GET /",         `https://${domain}/`,  { useProxy: true,  hdrs: FULL }],
  ["D", "direto  domain   GET /",         `https://${domain}/`,  { useProxy: false, hdrs: FULL }],
  ["E", "proxy   apiHost  http1.1",       `https://${apiHost}/`, { useProxy: true,  hdrs: FULL, http1: true }],
  ["F", "proxy   apiHost  headers minimos", `https://${apiHost}/`, { useProxy: true, hdrs: MIN }],
  ["G", "proxy   apiHost  sem sec-fetch", `https://${apiHost}/`, { useProxy: true,  hdrs: FULL.filter(h => !h.startsWith("sec-fetch")) }],
];

console.log("proxy  :", mask(PROXY));
console.log("apiHost:", apiHost, "| domain:", domain);
console.log("UA     :", UA120, "\n");

const r = {};
for (const [id, nome, url, opt] of testes) {
  const t0 = Date.now();
  const { code, body, err } = await run(url, opt);
  const cls = classificar(code, body);
  r[id] = cls;
  const extra = cls === "OK" ? "len=" + body.length : (body || "").slice(0, 90).replace(/\s+/g, " ");
  console.log(`[${id}] ${nome} → ${cls} (${code}, ${Date.now() - t0}ms)${err ? " " + err : ""}`);
  if (cls !== "OK") console.log("     " + extra);
  await new Promise(s => setTimeout(s, 700));
}

console.log("\nVEREDITO:");
if (r.A === "OK" && r.B !== "OK") console.log("  → faixa/ASN da Autobot barrada. O IP e residencial mas o ASN tem regra. Troque de proxy.");
else if (r.C === "OK" && r.B !== "OK") console.log("  → apiHost tem regra mais dura que o site. Roteie o login pelo domain.");
else if (r.A !== "OK" && r.B !== "OK" && r.C !== "OK" && r.D !== "OK") console.log("  → WAF exige cf_clearance mesmo para GET. Proximo passo: sessao fixa + AntiCloudflareTask.");
else if (r.A === "OK" && r.B === "OK" && r.C === "OK") console.log("  → GET passa. O bloqueio e no POST de login: e formato de requisicao. Ver UA/JA3 e cookies.");
else console.log("  → resultado misto, leia a tabela acima.");