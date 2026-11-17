import path from "path";
import axios from "axios";
import { ROOT } from "./src/paths.js";
import { loadCasas } from "./src/storage.js";
import { loadProxies } from "./src/proxy.js";
import { startTlsProxy } from "./src/tls.js";

const casas = loadCasas();
loadProxies(path.join(ROOT, "proxy.txt"));
await startTlsProxy();

for (const [nome, casa] of Object.entries(casas)) {
  const headers = {
    ...(casa.headers || {}),
    origin: `https://${casa.domain}`,
    referer: `https://${casa.domain}/`,
    "x-request-source": "web_client",
    "x-trace-id": "SONDA",
    "sec-fetch-site": "cross-site",
    "sec-fetch-mode": "cors",
    "sec-fetch-dest": "empty",
  };
  try {
    const r = await axios.post("http://127.0.0.1:3334/post", {
      url: `https://${casa.apiHost}${casa.loginPath}`,
      headers,
      body: casa.bodyTemplate,
    }, { timeout: 25000, validateStatus: () => true });
    const txt = String(r.data?.text ?? "");
    const titulo = (txt.match(/<title[^>]*>([^<]{0,100})/i) || [])[1] || "";
    const turnstile = /turnstile|cf-chl|challenge-platform|just a moment/i.test(txt);
    const json = txt.trim().startsWith("{");
    const estado = turnstile
      ? "TURNSTILE (gasta token)"
      : json
        ? "livre (JSON, sem custo)"
        : `outro: ${titulo.trim().slice(0, 40)}`;
    console.log(`${nome.padEnd(8)} ${estado}`);
  } catch (e) {
    console.log(`${nome.padEnd(8)} FALHA ${e.message.slice(0, 60)}`);
  }
  await new Promise((r) => setTimeout(r, 1200));
}

process.exit(0);