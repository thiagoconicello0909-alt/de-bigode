import axios from "axios";
import { buildHeaders } from "./trpc.js";

const TLS = "http://127.0.0.1:3334";

export async function fetchPerfilHtml(casa, auth) {
  try {
    const h = { ...buildHeaders(casa, auth), accept: "text/html,application/xhtml+xml" };
    delete h["content-type"];
    const r = await axios.post(`${TLS}/get`, {
      url: `https://${casa.domain}/main/perfil`,
      headers: h, body: "",
    }, { timeout: 25000, validateStatus: () => true });
    const html = String(r.data?.text ?? "");
    if (html.length < 400) return { ok: false };

    const saldo = html.match(/(\d{1,3}(?:\.\d{3})*,\d{2})\s*R\$/);
    const vip = html.match(/\bV\s?(\d{1,2})\b/);
    const vipWord = html.match(/VIP\s?(\d{1,2})/i);
    if (!saldo && !vip && !vipWord) return { ok: false };

    return {
      ok: true,
      data: {
        balance: saldo ? Number(saldo[1].replace(/\./g, "").replace(",", ".")) : null,
        vip: vip ? Number(vip[1]) : vipWord ? Number(vipWord[1]) : null,
      },
    };
  } catch {
    return { ok: false };
  }
}