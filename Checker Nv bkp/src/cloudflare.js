import fs from "fs";
import path from "path";
import axios from "axios";
import { ROOT } from "./paths.js";
import { loadCaptchaConfig } from "./captcha.js";

const cache = new Map(); // proxy -> { cookie, ua, expira }
const TTL = 20 * 60 * 1000;
const LOG = path.join(ROOT, "hits", "cf_erros.txt");

function registrar(msg) {
  try {
    fs.mkdirSync(path.dirname(LOG), { recursive: true });
    fs.appendFileSync(LOG, `[${new Date().toISOString()}] ${msg}\n`, "utf-8");
  } catch {}
}

/** Resolve o desafio do Cloudflare para um proxy e devolve o cf_clearance. */
export async function obterClearance(casa, proxy) {
  const cfg = loadCaptchaConfig();
  if (cfg.provider !== "capsolver" || !cfg.apiKey || !proxy) return null;

  const chave = `${casa.domain}|${proxy}`;
  const guardado = cache.get(chave);
  if (guardado && guardado.expira > Date.now()) return guardado;

  try {
    const criar = await axios.post("https://api.capsolver.com/createTask", {
      clientKey: cfg.apiKey,
      task: { type: "AntiCloudflareTask", websiteURL: `https://${casa.domain}/`, proxy },
    }, { timeout: 30000 });

    if (criar.data?.errorId) throw new Error(criar.data.errorDescription || criar.data.errorCode);
    const taskId = criar.data?.taskId;
    if (!taskId) throw new Error("sem taskId");

    for (let i = 0; i < 40; i++) {
      await new Promise((r) => setTimeout(r, 2500));
      const r = await axios.post("https://api.capsolver.com/getTaskResult", { clientKey: cfg.apiKey, taskId }, { timeout: 30000 });
      const d = r.data || {};
      if (d.errorId) throw new Error(d.errorDescription || d.errorCode);
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