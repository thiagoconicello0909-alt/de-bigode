import { post, normalize, deepFind, extractAuth } from './trpc.js';

const TOKEN_KEYS = ['token', 'accessToken', 'access_token', 'jwt', 'newJwt'];

function inject(node, u, p) {
  for (const k of Object.keys(node)) {
    const v = node[k];
    if (v && typeof v === 'object') { inject(v, u, p); continue; }
    const l = k.toLowerCase();
    if (['username', 'login', 'loginname', 'account'].includes(l)) node[k] = u;
    else if (['password', 'pass', 'pwd', 'userpass'].includes(l)) node[k] = p;
  }
}

export async function trocarToken(casa, token) {
  try {
    const t = normalize(await post(casa, casa.tokenPath, { json: {} }, { token }));
    if (!t.ok) return { tag: null, authTag: null, tokenData: null, userId: null, erro: t.msg || ('auth.token code=' + t.code) };
    const { tag, authTag, tokenData, userId } = extractAuth(t);
    if (!authTag) return { tag, authTag: null, tokenData, userId, erro: 'auth.token sem authTag' };
    return { tag, authTag, tokenData, userId };
  } catch (e) {
    return { tag: null, authTag: null, tokenData: null, userId: null, erro: e.message };
  }
}

export async function autenticar(casa, username, password) {
  const base = casa.bodyTemplate || JSON.stringify({ json: {} });
  const body = JSON.parse(base);
  inject(body, username, password);

  const norm = normalize(await post(casa, casa.loginPath, body));
  const token = deepFind(norm.data || {}, TOKEN_KEYS);
  if (!token) return { ok: false, error: norm.msg || ('login sem token (code=' + norm.code + ')') };

  const sess = await trocarToken(casa, token);
  if (!sess.authTag) return { ok: false, error: sess.erro || 'sessao nao aberta', token };
  return { ok: true, token, tag: sess.tag, authTag: sess.authTag, tokenData: sess.tokenData, userId: sess.userId };
}

export async function renovar(casa, auth) {
  const atual = typeof auth === 'string' ? { token: auth } : auth;
  const sess = await trocarToken(casa, atual.token);
  if (!sess.authTag) return atual;
  return { ...atual, tag: sess.tag, authTag: sess.authTag, tokenData: sess.tokenData };
}

export const loginComRefresh = autenticar;
