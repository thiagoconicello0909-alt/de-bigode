import fs from "fs";
import path from "path";
import axios from "axios";
import { ROOT } from "./paths.js";
import { loadCaptchaConfig } from "./captcha.js";

const cache = new Map();
const TTL = 20 * 60 * 1000;
const LOG = path.join(ROOT, "hits", "cf_erros.txt");

function registrar(msg) {
  try {
    fs.mkdirSync(path.dirname(LOG), { recursive: true });
    fs.appendFileSync(LOG, `[${new Date().toISOString()}] ${msg}\n`, "utf-8");
  } catch {}
}

/**
 * Resolve o desafio do Cloudflare e devolve o cf_clearance.
 * `html` é obrigatório pelo provedor: é a página de desafio recebida.
 */
export async function obterClearance(casa, proxy, html, url) {
  const cfg = loadCaptchaConfig();
  if (cfg.provider !== "capsolver" || !cfg.apiKey || !proxy) return null;
  if (!html) return null;

  const alvo = url || `https://${casa.apiHost}/`;
  const chave = `${alvo}|${proxy}`;
  const guardado = cache.get(chave);
  if (guardado && guardado.expira > Date.now()) return guardado;

  try {
    const criar = await axios.post("https://api.capsolver.com/createTask", {
      clientKey: cfg.apiKey,
      task: {
        type: "AntiCloudflareTask",
        websiteURL: alvo,
        proxy,
        html,
      },
    }, { timeout: 40000, validateStatus: () => true });

    if (criar.data?.errorId) throw new Error(`${criar.data.errorCode} ${criar.data.errorDescription || ""}`);
    const taskId = criar.data?.taskId;
    if (!taskId) throw new Error("sem taskId");

    for (let i = 0; i < 40; i++) {
      await new Promise((r) => setTimeout(r, 2500));
      const r = await axios.post("https://api.capsolver.com/getTaskResult", {
        clientKey: cfg.apiKey, taskId,
      }, { timeout: 30000, validateStatus: () => true });
      const d = r.data || {};
      if (d.errorId) throw new Error(`${d.errorCode} ${d.errorDescription || ""}`);
      if (d.status === "ready") {
        const tok = d.solution?.token || d.solution?.cf_clearance;
        if (!tok) return null;
        const saida = { cookie: `cf_clearance=${tok}`, ua: d.solution?.userAgent || null, expira: Date.now() + TTL };
        cache.set(chave, saida);
        return saida;
      }
    }
    throw new Error("timeout do provedor");
  } catch (e) {
    registrar(`${casa.domain} | ${e.message}`);
    return null;
  }
}