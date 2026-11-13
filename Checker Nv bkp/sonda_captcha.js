// sonda_captcha.js — diagnóstico isolado do Turnstile
// uso: node sonda_captcha.js <casa> <usuario> <senha> [--header] [--repetir=N]
import axios from "axios";
import { loadCasas } from "./src/storage.js";
import { loadProxies, getNextProxy } from "./src/proxy.js";
import { startTlsProxy } from "./src/tls.js";
import { buildHeaders } from "./src/trpc.js";
import { DEFAULT_BODY } from "./src/curl.js";
import { loadCaptchaConfig, solveTurnstile, obterSitekey } from "./src/captcha.js";
import { ROOT } from "./src/paths.js";
import path from "path";

const TLS = "http://127.0.0.1:3334";
const args = process.argv.slice(2);
const nomeCasa = args[0];
const usuario = args[1];
const senha = args[2];
const usarHeader = args.includes("--header");
const repetir = Number((args.find((a) => a.startsWith("--repetir=")) || "--repetir=1").split("=")[1]) || 1;

const linha = (t) => console.log(`\n── ${t} ${"─".repeat(Math.max(0, 58 - t.length))}`);

function resumo(txt) {
  const t = String(txt || "");
  const tipo = t.trim().startsWith("<") ? "HTML" : "JSON";
  return `[${tipo} | ${t.length} bytes] ${t.slice(0, 1200).replace(/\s+/g, " ")}`;
}

async function req(metodo, url, headers, body) {
  const proxy = getNextProxy();
  const ini = Date.now();
  try {
    const r = await axios.post(`${TLS}/${metodo}`, { url, headers, body: body || "", ...(proxy ? { proxy } : {}) }, {
      timeout: 30000, validateStatus: () => true,
    });
    return { ms: Date.now() - ini, status: r.status, texto: r.data?.text ?? JSON.stringify(r.data) };
  } catch (e) {
    return { ms: Date.now() - ini, status: 0, texto: `ERRO: ${e.message}` };
  }
}

async function main() {
  if (!nomeCasa || !usuario || !senha) {
    console.log("uso: node sonda_captcha.js <casa> <usuario> <senha> [--header] [--repetir=N]");
    process.exit(1);
  }

  const casas = loadCasas();
  const casa = casas[nomeCasa];
  if (!casa) { console.log(`casa "${nomeCasa}" não existe. Cadastradas: ${Object.keys(casas).join(", ")}`); process.exit(1); }

  loadProxies(path.join(ROOT, "proxy.txt"));
  await startTlsProxy();

  const cfg = loadCaptchaConfig();
  linha("CONFIG");
  console.log("domain   :", casa.domain);
  console.log("apiHost  :", casa.apiHost);
  console.log("loginPath:", casa.loginPath);
  console.log("provedor :", cfg.provider, cfg.apiKey ? `(key ...${cfg.apiKey.slice(-6)})` : "(SEM KEY)");
  console.log("proxy    :", getNextProxy() || "nenhum");
  console.log("bodyTemplate:", (casa.bodyTemplate || DEFAULT_BODY).slice(0, 400));

  linha("1) PROCURANDO SITEKEY NA PÁGINA");
  const sitekey = await obterSitekey(casa);
  console.log("sitekey:", sitekey || "NÃO ENCONTRADA");

  if (sitekey) {
    linha("2) RESOLVENDO TURNSTILE");
    const tok = await solveTurnstile(casa.domain, sitekey);
    console.log("token:", tok ? `${tok.slice(0, 40)}... (${tok.length} chars)` : "FALHOU (veja hits/captcha_erros.txt)");

    linha("3) LOGIN SEM TOKEN (controle)");
    const base = JSON.parse(casa.bodyTemplate || DEFAULT_BODY);
    const inj = (n) => {
      for (const k of Object.keys(n)) {
        if (n[k] && typeof n[k] === "object") { inj(n[k]); continue; }
        const l = k.toLowerCase();
        if (/user|login|account|phone|mobile/.test(l)) n[k] = usuario;
        else if (/pass|pwd|senha/.test(l)) n[k] = senha;
      }
    };
    inj(base);
    const urlLogin = `https://${casa.apiHost}${casa.loginPath}`;

    const sem = await req("post", urlLogin, buildHeaders(casa, {}), JSON.stringify(base));
    console.log(`status=${sem.status} ${sem.ms}ms → ${resumo(sem.texto)}`);

    if (tok) {
      for (let i = 1; i <= repetir; i++) {
        linha(`4.${i}) LOGIN COM TOKEN NOVO${usarHeader ? " (via header)" : " (no corpo)"}`);
        const tokNovo = i === 1 ? tok : await solveTurnstile(casa.domain, sitekey);
        if (!tokNovo) { console.log("solver falhou"); continue; }

        const corpo = JSON.parse(JSON.stringify(base));
        const alvos = [corpo];
        if (corpo.json && typeof corpo.json === "object") alvos.push(corpo.json);

        if (usarHeader) {
          for (const a of alvos) { a.__h = true; }
          const h = buildHeaders(casa, {});
          h["cf-turnstile-response"] = tokNovo;
          h["x-turnstile-token"] = tokNovo;
          const r = await req("post", urlLogin, h, JSON.stringify(corpo));
          console.log(`status=${r.status} ${r.ms}ms → ${resumo(r.texto)}`);
        } else {
          for (const a of alvos) {
            a.cfToken = tokNovo; a.cf_token = tokNovo;
            a["cf-turnstile-response"] = tokNovo;
            a.turnstileToken = tokNovo; a.turnstile_token = tokNovo;
            a.captchaToken = tokNovo; a.captcha = tokNovo; a.hToken = tokNovo;
          }
          const r = await req("post", urlLogin, buildHeaders(casa, {}), JSON.stringify(corpo));
          console.log(`status=${r.status} ${r.ms}ms → ${resumo(r.texto)}`);
        }
      }
    }
  }

  linha("FIM");
  console.log("Registros de erro do solver: hits/captcha_erros.txt");
  process.exit(0);
}

main();