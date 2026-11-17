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
if (!token) { console.log("SEM TOKEN\n" + loginRaw.slice(0, 300)); process.exit(0); }

const tokenRaw = await post(casa, casa.tokenPath, { json: {} }, { token });
const d = normalize(tokenRaw).data || {};
const authTag = typeof d.authTag === "string" ? d.authTag : null;
const tokenData = typeof d.tokenData === "string" ? d.tokenData : null;
const uid = d.userId ?? null;
console.log("userId:", uid, "| authTag:", authTag ? "ok" : "NENHUM", "| tokenData:", tokenData ? "ok" : "NENHUM");
if (!authTag) process.exit(0);

const TLS = "http://127.0.0.1:3334";
const auth = { token, authTag, tokenData };

async function tentar(alvo, headers, bodyObj, metodo = "POST") {
  try {
    const proxy = getNextProxy();
    const r = await axios.post(`${TLS}/${metodo === "GET" ? "get" : "post"}`, {
      url: `https://${casa.apiHost}${alvo}`,
      headers,
      body: metodo === "GET" ? "" : JSON.stringify(bodyObj),
      ...(proxy ? { proxy } : {}),
    }, { timeout: 20000, validateStatus: () => true });
    const st = r.data?.status ?? "?";
    const out = String(r.data?.text ?? r.data?.error ?? "").replace(/\s+/g, " ").slice(0, 300);
    const cookie = r.data?.headers?.["set-cookie"];
    console.log(`  [${st}] ${metodo} ${alvo} body=${JSON.stringify(bodyObj)} → ${out}`);
    if (cookie) console.log(`        set-cookie: ${String(cookie).slice(0, 200)}`);
  } catch (e) { console.log(`  [ERR] ${alvo} → ${e.message}`); }
}

const alvos = [
  "member.info", "member.detail", "member.profile", "member.get", "member.index",
  "wallet.balance", "wallet.info", "wallet.detail", "wallet.get", "member.wallet",
  "finance.balance", "member.account", "member.base.info",
];

console.log("\n--- POST Bearer authTag ---");
for (const proc of alvos) {
  const alvo = withRouter(casa, proc);
  const base = buildHeaders(casa, auth);
  await tentar(alvo, base, { json: {} });
  if (uid) await tentar(alvo, base, { json: { userId: uid } });
  await tentar(alvo, base, { json: { type: 1 } });
}

console.log("\n--- combos de cookie (tokenData) ---");
for (const proc of ["member.info", "wallet.balance"]) {
  const alvo = withRouter(casa, proc);
  const base = buildHeaders(casa, auth);
  if (tokenData) {
    await tentar(alvo, { ...base, cookie: `token=${tokenData}` }, { json: {} });
    await tentar(alvo, { ...base, cookie: `tokenData=${tokenData}` }, { json: {} });
    await tentar(alvo, { ...base, cookie: `authTag=${authTag}; token=${tokenData}` }, { json: {} });
  }
  await tentar(alvo, base, null, "GET");
}
process.exit(0);