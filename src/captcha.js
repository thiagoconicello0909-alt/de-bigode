import fs from "fs";
import path from "path";
import axios from "axios";
import { ROOT } from "./paths.js";
import { obterTokensTurnstile, ehSitekeyTurnstile } from "./turnstile.js";

const FILE = path.join(ROOT, "db", "captcha.json");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const DEFAULT = { provider: "disabled", apiKey: "", customApiUrl: "" };

export function loadCaptchaConfig() {
  try {
    if (!fs.existsSync(FILE)) return { ...DEFAULT };
    return { ...DEFAULT, ...JSON.parse(fs.readFileSync(FILE, "utf-8")) };
  } catch {
    return { ...DEFAULT };
  }
}

export function saveCaptchaConfig(cfg) {
  const dir = path.dirname(FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify({ ...DEFAULT, ...cfg }, null, 2), "utf-8");
}

function normalizar(res) {
  if (!res) return null;
  if (typeof res === "string") {
    const s = res.trim();
    return s ? { hToken: s, geeToken: s } : null;
  }
  if (typeof res !== "object") return null;

  const pega = (...ks) => {
    for (const k of ks) {
      const v = res[k];
      if (typeof v === "string" && v.trim()) return v.trim();
    }
    return null;
  };

  const token = pega("hToken", "htoken", "geeToken", "gee_token", "token", "gRecaptchaResponse", "solution", "value", "data");
  const lot = pega("lotNumber", "lot_number");
  const out = pega("captchaOutput", "captcha_output");
  const pass = pega("passToken", "pass_token");
  const gen = pega("genTime", "gen_time");

  if (!token && !lot) return null;
  return {
    hToken: token,
    geeToken: token,
    lotNumber: lot,
    captchaOutput: out,
    passToken: pass,
    genTime: gen,
  };
}

async function provedorCustom(cfg, dominio, tenantId, usuario, captchaId) {
  const url = String(cfg.customApiUrl || "")
    .replace(/\{domain\}/g, encodeURIComponent(dominio))
    .replace(/\{tenantId\}/g, encodeURIComponent(String(tenantId)))
    .replace(/\{username\}/g, encodeURIComponent(usuario))
    .replace(/\{captchaId\}/g, encodeURIComponent(captchaId));
  if (!url) return null;

  const r = await axios.get(url, { timeout: 120000, validateStatus: () => true });
  if (r.status !== 200) return null;
  const dados = r.data;
  if (typeof dados === "string") {
    const txt = dados.trim();
    if (!txt) return null;
    try {
      return normalizar(JSON.parse(txt));
    } catch {
      return normalizar(txt);
    }
  }
  return normalizar(dados);
}

async function capsolver(cfg, dominio, captchaId) {
  const criar = await axios.post("https://api.capsolver.com/createTask", {
    clientKey: cfg.apiKey,
    task: { type: "HCaptchaTaskProxyLess", websiteURL: `https://${dominio}`, websiteKey: captchaId },
  }, { timeout: 30000, validateStatus: () => true });

  const id = criar.data?.taskId;
  if (!id) return null;

  for (let i = 0; i < 40; i++) {
    await sleep(3000);
    const r = await axios.post("https://api.capsolver.com/getTaskResult", {
      clientKey: cfg.apiKey, taskId: id,
    }, { timeout: 30000, validateStatus: () => true });
    if (r.data?.status === "ready") {
      const sol = r.data.solution || {};
      return normalizar({ hToken: sol.gRecaptchaResponse, captchaOutput: sol.captchaOutput, lotNumber: sol.lotNumber, passToken: sol.passToken, genTime: sol.genTime });
    }
    if (r.data?.status === "failed") return null;
  }
  return null;
}

async function doisCaptcha(cfg, dominio, captchaId) {
  const criar = await axios.post("https://2captcha.com/in.php", new URLSearchParams({
    key: cfg.apiKey, method: "hcaptcha", sitekey: captchaId, pageurl: `https://${dominio}`, json: "1",
  }).toString(), { timeout: 30000, validateStatus: () => true, headers: { "content-type": "application/x-www-form-urlencoded" } });

  const id = criar.data?.request;
  if (!id) return null;

  for (let i = 0; i < 40; i++) {
    await sleep(5000);
    const r = await axios.get(`https://2captcha.com/res.php?key=${encodeURIComponent(cfg.apiKey)}&action=get&id=${encodeURIComponent(id)}&json=1`, { timeout: 30000, validateStatus: () => true });
    if (r.data?.status === 1 && r.data.request) return normalizar(r.data.request);
  }
  return null;
}

async function antiCaptcha(cfg, dominio, captchaId) {
  const criar = await axios.post("https://api.anti-captcha.com/createTask", {
    clientKey: cfg.apiKey,
    task: { type: "HCaptchaTaskProxyless", websiteURL: `https://${dominio}`, websiteKey: captchaId },
  }, { timeout: 30000, validateStatus: () => true });

  const id = criar.data?.taskId;
  if (!id) return null;

  for (let i = 0; i < 40; i++) {
    await sleep(3000);
    const r = await axios.post("https://api.anti-captcha.com/getTaskResult", {
      clientKey: cfg.apiKey, taskId: id,
    }, { timeout: 30000, validateStatus: () => true });
    if (r.data?.status === "ready") {
      const sol = r.data.solution || {};
      return normalizar({ hToken: sol.gRecaptchaResponse, captchaOutput: sol.captchaOutput, lotNumber: sol.lotNumber, passToken: sol.passToken, genTime: sol.genTime });
    }
  }
  return null;
}

export async function solveCaptcha(dominio, tenantId, usuario, captchaId, extra = {}) {
  const cfg = loadCaptchaConfig();
  if (cfg.provider === "disabled") return null;
  if (!captchaId) return null;

  try {
    if (ehSitekeyTurnstile(captchaId)) {
      const t = await obterTokensTurnstile({
        dominio,
        tenantId,
        deviceId: extra.deviceId,
        sitekeyBody: captchaId,
        sitekeyHeader: extra.sitekeyHeader,
        action: extra.action,
        actionBody: extra.actionBody,
      });
      if (!t) return null;
      return { hToken: t.body || null, xToken: t.header || null };
    }

    if (cfg.provider === "custom") return await provedorCustom(cfg, dominio, tenantId, usuario, captchaId);
    if (!cfg.apiKey) return null;
    if (cfg.provider === "capsolver") return await capsolver(cfg, dominio, captchaId);
    if (cfg.provider === "2captcha") return await doisCaptcha(cfg, dominio, captchaId);
    if (cfg.provider === "anticaptcha") return await antiCaptcha(cfg, dominio, captchaId);
  } catch {}
  return null;
}