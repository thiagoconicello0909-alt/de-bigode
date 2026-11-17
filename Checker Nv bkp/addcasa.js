import fs from "fs";
import path from "path";
import { ROOT } from "./src/paths.js";

const ARQ = path.join(ROOT, "db", "casas.json");
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/157.0.0.0 Safari/537.36 Edg/157.0.0.0";
const CHUA = '"Not-A.Brand";v="99", "Microsoft Edge";v="157", "Chromium";v="157"';

function casa(dominio, apiHost, tenantId, deviceId, versao, user, pass) {
  return {
    domain: dominio,
    apiHost,
    tenantId,
    loginPath: "/api/frontend/trpc/auth.login",
    tokenPath: "/api/frontend/trpc/auth.token",
    deviceId,
    clientVersion: versao,
    deviceType: "DesktopOS",
    captchaId: "0x4AAAAAAAiHEkDee-yqSdMj",
    browserLogin: true,
    browserPages: 2,
    channelId: 0,
    turnstile: {
      sitekeyBody: "0x4AAAAAAAiHEkDee-yqSdMj",
      sitekeyHeader: "0x4AAAAAAB0oRY23FyZnllMo",
      action: "api_protection",
      actionBody: "login",
    },
    headers: {
      accept: "*/*",
      "accept-language": "pt-BR,pt;q=0.9,en;q=0.8,en-GB;q=0.7,en-US;q=0.6",
      "client-language": "pt-BR",
      "content-type": "application/json",
      "sec-ch-ua": CHUA,
      "sec-ch-ua-mobile": "?0",
      "sec-ch-ua-platform": '"Windows"',
      tenantid: tenantId,
      "user-agent": UA,
      "x-client-version": versao,
      "x-device-type": "DesktopOS",
    },
    authScheme: "Bearer",
    bodyTemplate: JSON.stringify({
      json: {
        username: user,
        password: pass,
        hToken: null,
        lastLoginDevice: deviceId,
        loginDeviceModel: "web Windows NT 10.0 windows Windows NT 10.0; Win64; x64",
        appType: "DesktopOS",
        channelId: 0,
      },
      meta: { values: { hToken: ["undefined"] } },
    }),
    passMode: "plain",
    lang: "pt",
    rotativa: true,
    perfilProcs: ["user.assets", "vip.info"],
  };
}

const novas = {
  w78: casa("w78777.com", "api2.ycyd123.com", "1610468", "4b818150-e138-4fd4-82fb-ed550cd39d61", "v242", "51999373230", "Nando3315"),
  "3539": casa("3539a.com", "api.ycyd123.com", "3606032", "b390bcc6-7132-4af3-92e2-284c08f7bdc6", "v240", "51980480962", "cachima31"),
  "28g": casa("28g88yy.com", "api.ycyd123.com", "9412481", "eaf47d84-583e-49e3-bccf-a191ab195ec4", "v240", "45991055353", "Conicello09_"),
};

let atuais = {};
try {
  atuais = JSON.parse(fs.readFileSync(ARQ, "utf-8"));
} catch (e) {
  console.log(`  casas.json invalido: ${e.message}`);
  console.log("  consertando a partir das casas ja conhecidas nao da — cole o conteudo que o script te mostra");
  process.exit(1);
}

const backup = `${ARQ}.bak`;
fs.writeFileSync(backup, JSON.stringify(atuais, null, 2), "utf-8");

for (const [k, v] of Object.entries(novas)) atuais[k] = v;

const texto = JSON.stringify(atuais, null, 2);
JSON.parse(texto);
fs.writeFileSync(ARQ, texto, "utf-8");

console.log(`  backup: ${backup}`);
console.log(`  casas agora: ${Object.keys(atuais).join(" ")}`);
console.log(`  adicionadas: ${Object.keys(novas).join(" ")}`);