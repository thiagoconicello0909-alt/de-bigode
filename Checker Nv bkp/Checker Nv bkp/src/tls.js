import fs from "fs";
import path from "path";
import { spawn } from "child_process";
import axios from "axios";
import { getNextProxy } from "./proxy.js";
import { ROOT } from "./paths.js";

const TLS_PORT = 3334;
const TLS_URL = `http://127.0.0.1:${TLS_PORT}`;
let _tlsProc = null;

export async function startTlsProxy() {
  const proxyFile = path.join(ROOT, "tlsproxy.py");
  if (!fs.existsSync(proxyFile)) {
    console.error("❌ tlsproxy.py não encontrado em", proxyFile);
    process.exit(1);
  }

  try {
    const r = await axios.get(`${TLS_URL}/health`, { timeout: 1500 });
    if (r.data?.status === "ok") {
      console.log("✅ TLSProxy já em execução");
      return;
    }
  } catch {}

  console.log("🚀 Iniciando TLSProxy...");
  _tlsProc = spawn("python", [proxyFile, String(TLS_PORT)], {
    stdio: ["ignore", "pipe", "pipe"],
    detached: false,
  });
  _tlsProc.stdout.on("data", (d) => {
    if (global.debug) process.stdout.write("[proxy] " + d);
  });
  _tlsProc.stderr.on("data", (d) => {
    if (global.debug) process.stderr.write("[proxy] " + d);
  });

  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, 500));
    try {
      const r = await axios.get(`${TLS_URL}/health`, { timeout: 1000 });
      if (r.data?.status === "ok") {
        console.log("✅ TLSProxy pronto\n");
        return;
      }
    } catch {}
  }
  console.error("❌ TLSProxy não subiu em 10s. Verifique se tls_client está instalado: pip install tls-client");
  process.exit(1);
}

// escreve direto no stderr (o run.js silencia o console durante a execução)
function reportar(tag, err) {
  try {
    const txt = err && err.stack ? err.stack : String(err);
    process.stderr.write(`\n  [${tag}] ${txt.split("\n").slice(0, 4).join("\n  ")}\n`);
  } catch {}
}

process.on("exit", () => { try { _tlsProc?.kill(); } catch {} });

// não mata mais o processo: só reporta
process.on("uncaughtException", (err) => reportar("uncaughtException", err));
process.on("unhandledRejection", (err) => reportar("unhandledRejection", err));

export async function tlsPost(url, headers, body) {
  const stringHeaders = Object.fromEntries(
    Object.entries(headers).map(([k, v]) => [k, String(v)]),
  );
  const proxyUrl = getNextProxy();
  let r;
  try {
    r = await axios.post(
      `${TLS_URL}/post`,
      {
        url,
        headers: stringHeaders,
        body: typeof body === "string" ? body : JSON.stringify(body),
        ...(proxyUrl ? { proxy: proxyUrl } : {}),
      },
      { timeout: 25000, validateStatus: () => true },
    );
  } catch (e) {
    throw new Error(`TLSProxy offline: ${e.message}`);
  }
  if (r.data?.error) throw new Error(`TLSProxy: ${r.data.error}`);
  if (r.status !== 200) throw new Error(`TLSProxy status ${r.status}: ${JSON.stringify(r.data)}`);
  return r.data?.text ?? null;
}