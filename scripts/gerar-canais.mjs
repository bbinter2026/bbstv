// Gera canais-mundo.json: só canais cujo stream responde de verdade e (idealmente) aceita pedidos do seu site.
// Uso: node scripts/gerar-canais.mjs        (Node 18 ou superior)
// Variáveis opcionais:
//   SITE_ORIGIN  endereço do seu site (ex.: https://meusite.com). Se definido, aceita streams que permitem esse endereço ou "*".
//   KEEP         países mantidos mesmo que a verificação falhe (por bloqueio regional). Predefinição: MZ,AO,CV,ST,GW
//   MAX_URLS     máximo de links verificados por canal (predef. 3)
//   CONC         pedidos em simultâneo (predef. 60)
//   API_BASE     origem dos dados (predef. https://iptv-org.github.io/api/)
import { writeFileSync } from "node:fs";

const API = process.env.API_BASE || "https://iptv-org.github.io/api/";
const ORIGIN = process.env.SITE_ORIGIN || "";
const KEEP = new Set((process.env.KEEP || "MZ,AO,CV,ST,GW").split(",").map(s => s.trim().toUpperCase()).filter(Boolean));
const MAX_URLS = +process.env.MAX_URLS || 3, CONC = +process.env.CONC || 60, TIMEOUT = 8000;
const OUT = process.env.OUT || "canais-mundo.json";

const HTTPS = process.env.ALLOW_HTTP ? /^https?:\/\//i : /^https:\/\//i;   // ALLOW_HTTP só para testes locais
const isStream = u => /\.(m3u8|mp4|webm|ogg)(\?|$)/i.test(u || "");
const qr = q => { const n = parseInt(q) || 0; return n ? Math.abs(n - 720) : 500; };
const get = async f => { const r = await fetch(API + f + ".json"); if (!r.ok) throw new Error(f + " " + r.status); return r.json(); };

async function check(url) {
  try {
    const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), TIMEOUT);
    const res = await fetch(url, { signal: ctl.signal, redirect: "follow", headers: { ...(ORIGIN ? { Origin: ORIGIN } : {}), "User-Agent": "Mozilla/5.0" } });
    try {
      if (res.status !== 200) return false;
      const acao = res.headers.get("access-control-allow-origin");
      if (!(acao === "*" || (ORIGIN && acao === ORIGIN))) return false;      // o browser recusaria este stream
      if (/\.m3u8(\?|$)/i.test(url)) {
        const reader = res.body.getReader(); let txt = "", n = 0;
        while (n < 4096) { const { done, value } = await reader.read(); if (done) break; txt += new TextDecoder().decode(value); n += value.length; if (txt.includes("#EXTINF") || txt.includes("#EXT-X-STREAM-INF")) break; }
        reader.cancel().catch(() => {});
        return txt.includes("#EXTM3U");
      }
      return /^(video|audio)\//i.test(res.headers.get("content-type") || "");
    } finally { clearTimeout(t); try { await res.body?.cancel(); } catch {} }
  } catch { return false; }
}

async function pool(items, fn, n) {
  let i = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) { const k = i++; await fn(items[k], k); } }));
}

const [channels, streams, logos, blocklist] = await Promise.all(["channels", "streams", "logos", "blocklist"].map(get));
const info = new Map(channels.map(c => [c.id, c])), bad = new Set(blocklist.map(x => x.channel)), logo = new Map();
for (const l of logos) if (l.channel && !logo.has(l.channel)) logo.set(l.channel, l.url);
const dn = new Intl.DisplayNames(["pt"], { type: "region" });

const by = new Map();
for (const x of streams) {
  const c = info.get(x.channel);
  if (!c || bad.has(c.id) || c.is_nsfw || c.closed || x.referrer || x.user_agent || !HTTPS.test(x.url || "") || !isStream(x.url)) continue;
  let o = by.get(c.id);
  if (!o) { let pais = "Internacional"; try { pais = dn.of(c.country) || pais; } catch {} o = { c, pais, urls: [] }; by.set(c.id, o); }
  o.urls.push({ u: x.url, r: qr(x.quality) });
}
const list = [...by.values()];
for (const o of list) { o.urls.sort((a, b) => a.r - b.r); o.urls = [...new Set(o.urls.map(a => a.u))]; }
console.log("Canais candidatos:", list.length);

let done = 0;
await pool(list, async o => {
  const ok = [];
  for (const u of o.urls.slice(0, MAX_URLS)) { if (await check(u)) ok.push(u); }
  o.ok = ok;
  if (++done % 500 === 0) console.log(done + "/" + list.length);
}, CONC);

const out = [];
for (const o of list) {
  const keep = KEEP.has(String(o.c.country).toUpperCase());
  const urls = o.ok.length ? o.ok : (keep ? o.urls.slice(0, MAX_URLS) : []);
  if (!urls.length) continue;
  out.push([o.c.id, o.c.name, o.pais, (o.c.categories || []).join(" "), logo.get(o.c.id) || "", urls]);
}
out.sort((a, b) => a[1].localeCompare(b[1]));
writeFileSync(OUT, JSON.stringify({ t: Date.now(), n: out.length, c: out }));
console.log("Escrito", OUT, "com", out.length, "canais (verificados:", list.filter(o => o.ok.length).length + ")");
