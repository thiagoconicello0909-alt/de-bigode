import fs from "fs";
import path from "path";
import axios from "axios";
import { ROOT } from "./paths.js";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ARQ = path.join(ROOT, "db", "captcha.json");

function cfg() {
  try {
    return JSON.parse(fs.readFileSync(ARQ, "utf-8"));
  } catch {
    return {};
  }
}

export function ehSitekeyTurnstile(id) {
  return /^0x4[A-Za-z0-9_-]{10,}/.test(String(id || "").trim());
}

async function viaCapsolver(apiKey, site, chave, action, cdata) {
  const criar = await axios.post("https://api.capsolver.com/createTask", {
    clientKey: apiKey,
    task: {
      type: "AntiTurnstileTaskProxyLess",
      websiteURL: site,
      websiteKey: chave,
      metadata: { ...(action ? { action } : {}), ...(cdata ? { cdata } : {}) },
    },
  }, { timeout: 30000, validateStatus: () => true });

  if (criar.data?.errorId) {
    console.error(`  [capsolver] ${criar.data.errorCode || ""} ${criar.data.errorDescription || ""}`);
    return null;
  }
  const id = criar.data?.taskId;
  if (!id) return null;

  for (let i = 0; i < 30; i++) {
    await sleep(2000);
    const r = await axios.post("https://api.capsolver.com/getTaskResult", {
      clientKey: apiKey, taskId: id,
    }, { timeout: 30000, validateStatus: () => true });
    if (r.data?.errorId) {
      console.error(`  [capsolver] ${r.data.errorCode || ""} ${r.data.errorDescription || ""}`);
      return null;
    }
    if (r.data?.status === "ready") return r.data.solution?.token || null;
  }
  return null;
}

async function viaAntiCaptcha(apiKey, site, chave, action, cdata) {
  const criar = await axios.post("https://api.anti-captcha.com/createTask", {
    clientKey: apiKey,
    task: {
      type: "AntiTurnstileTaskProxyless",
      websiteURL: site,
      websiteKey: chave,
      metadata: { ...(action ? { action } : {}), ...(cdata ? { cdata } : {}) },
    },
  }, { timeout: 30000, validateStatus: () => true });

  if (criar.data?.errorId) return null;
  const id = criar.data?.taskId;
  if (!id) return null;

  for (let i = 0; i < 30; i++) {
    await sleep(2000);
    const r = await axios.post("https://api.anti-captcha.com/getTaskResult", {
      clientKey: apiKey, taskId: id,
    }, { timeout: 30000, validateStatus: () => true });
    if (r.data?.errorId) return null;
    if (r.data?.status === "ready") return r.data.solution?.token || null;
  }
  return null;
}

async function via2captcha(apiKey, site, chave, action, cdata) {
  const corpo = new URLSearchParams({
    key: apiKey, method: "turnstile", sitekey: chave, pageurl: site, json: "1",
    ...(action ? { action } : {}),
    ...(cdata ? { data: cdata } : {}),
  }).toString();

  const criar = await axios.post("https://2captcha.com/in.php", corpo, {
    timeout: 30000, validateStatus: () => true,
    headers: { "content-type": "application/x-www-form-urlencoded" },
  });
  const id = criar.data?.request;
  if (!id) return null;

  for (let i = 0; i < 30; i++) {
    await sleep(5000);
    const r = await axios.get(`https://2captcha.com/res.php?key=${encodeURIComponent(apiKey)}&action=get&id=${encodeURIComponent(id)}&json=1`, { timeout: 30000, validateStatus: () => true });
    if (r.data?.status === 1 && r.data.request) return r.data.request;
    if (r.data?.request && r.data.request !== "CAPCHA_NOT_READY") return null;
  }
  return null;
}

async function resolver(c, site, chave, action, cdata) {
  try {
    if (c.provider === "capsolver") return await viaCapsolver(c.apiKey, site, chave, action, cdata);
    if (c.provider === "anticaptcha") return await viaAntiCaptcha(c.apiKey, site, chave, action, cdata);
    if (c.provider === "2captcha") return await via2captcha(c.apiKey, site, chave, action, cdata);
  } catch (e) {
    console.error(`  [turnstile] ${e.message}`);
  }
  return null;
}

/**
 * Resolve os dois tokens exigidos pelo auth.login:
 * header (X-Token, sitekey api_protection) e body (hToken, sitekey do widget).
 */
export async function obterTokensTurnstile({ dominio, tenantId, deviceId, sitekeyBody, sitekeyHeader, action, actionBody }) {
  const c = cfg();
  if (c.provider === "disabled" || !c.provider) return null;
  if (!c.apiKey) {
    console.error("  [turnstile] sem apiKey no db/captcha.json");
    return null;
  }

  const site = `https://${dominio}/`;
  const cdata = tenantId ? `${tenantId}=${deviceId || ""}` : "";

  const [body, header] = await Promise.all([
    sitekeyBody ? resolver(c, site, sitekeyBody, actionBody || "login", cdata) : null,
    sitekeyHeader ? resolver(c, site, sitekeyHeader, action || "api_protection", cdata) : null,
  ]);

  if (!body && !header) return null;
  return { body, header };
}