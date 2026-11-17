import path from "path";
import axios from "axios";
import { ROOT } from "./src/paths.js";
import { loadCasas } from "./src/storage.js";
import { loadProxies, getNextProxy } from "./src/proxy.js";
import { startTlsProxy } from "./src/tls.js";
import { post, normalize, buildHeaders, deepFind, withRouter } from "./src/trpc.js";

const [nome, cred] = process.argv.slice(2);
const casa = loadCasas()[nome];
const idx = cred.indexOf(":");
const user = cred.slice(0, idx), pass = cred.slice(idx + 1);

function inject(node, u, p) {
  for (const k of Object.keys(node)) {
    const v = node[k];
    if (v && typeof v === "object") { inject(v, u, p); continue; }
    const l = k.toLowerCase();
    if (["username", "login", "loginname", "account"].includes(l)) node[k] = u;
    else if (["password", "pass", "pwd", "userpass"].includes(l)) node[k] = p;
  }
}

loadProxies(path.join(ROOT, "proxy.txt"));
await startTlsProxy();

const body = JSON.parse(casa.bodyTemplate);
inject(body, user, pass);
const loginRaw = await post(casa, casa.loginPath, body);
const token = deepFind(normalize(loginRaw).data || {}, ["token", "accessToken", "access_token", "jwt", "newJwt"]);
console.log("\n=== LOGIN ===\n" + loginRaw.slice(0, 250));
if (!token) { console.log("SEM TOKEN"); process.exit(0); }
console.log("token:", token.slice(0, 30) + "...");

const tokenRaw = await post(casa, casa.tokenPath, { json: {} }, { token });
console.log("\n=== auth.token ===\n" + tokenRaw.slice(0, 350));

const d = normalize(tokenRaw).data || {};
const authTag = typeof d.authTag === "string" ? d.authTag : null;
const tokenData = typeof d.tokenData === "string" ? d.tokenData : null;
console.log("\nauthTag:", authTag ? authTag.slice(0, 60) + "..." : "NENHUM");
console.log("tokenData:", tokenData ? tokenData.slice(0, 40) + "..." : "NENHUM");

const TLS = "http://127.0.0.1:3334";

async function tentar(rotulo, headers, alvo, metodo = "POST") {
  try {
    const proxy = getNextProxy();
    const r = await axios.post(`${TLS}/${metodo === "GET" ? "get" : "post"}`, {
      url: `https://${casa.apiHost}${alvo}`,
      headers,
      body: metodo === "GET" ? "" : JSON.stringify({ json: {} }),
      ...(proxy ? { proxy } : {}),
    }, { timeout: 20000, validateStatus: () => true });
    const out = String(r.data?.text ?? r.data?.error ?? "").replace(/\s+/g, " ").slice(0, 170);
    console.log(`  ${rotulo.padEnd(20)} [${metodo}] → ${out}`);
  } catch (e) { console.log(`  ${rotulo} → ${e.message}`); }
}

for (const alvo of [withRouter(casa, "member.info"), withRouter(casa, "wallet.balance")]) {
  console.log(`\n=== ${alvo} ===`);
  const base = buildHeaders(casa);
  if (authTag) {
    await tentar("authTag Bearer", { ...base, authorization: `Bearer ${authTag}` }, alvo);
    await tentar("authTag raw", { ...base, authorization: authTag }, alvo);
    await tentar("authTag x-auth-tag", { ...base, "x-auth-tag": authTag }, alvo);
    await tentar("authTag cookie", { ...base, cookie: `authTag=${authTag}` }, alvo);
    await tentar("authTag Bearer", { ...base, authorization: `Bearer ${authTag}` }, alvo, "GET");
  }
  if (tokenData) {
    await tentar("tokenData Bearer", { ...base, authorization: `Bearer ${tokenData}` }, alvo);
    await tentar("tokenData raw", { ...base, authorization: tokenData }, alvo);
  }
  await tentar("token temporário", { ...base, authorization: `Bearer ${token}` }, alvo);
}
process.exit(0);