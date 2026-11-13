// Renders the app icons and the social preview card with headless Chrome, so they use the
// game's own fonts and art. Run after `npm run build`:  node tools/brand/render.mjs
import { chromium } from '@playwright/test';
import { readFileSync } from 'node:fs';

const font = (pkg, file) => `data:font/woff2;base64,${readFileSync(`node_modules/@fontsource-variable/${pkg}/files/${file}`).toString('base64')}`;
const fredoka = font('fredoka', 'fredoka-latin-wght-normal.woff2');
const nunito = font('nunito', 'nunito-latin-wght-normal.woff2');
const img = (path) => `data:image/webp;base64,${readFileSync(path).toString('base64')}`;
const HEART = 'M12 21s-7.5-4.6-9.6-9.2C.9 8.4 3 4.5 6.8 4.5c2.1 0 3.6 1.2 5.2 3 1.6-1.8 3.1-3 5.2-3 3.8 0 5.9 3.9 4.4 7.3C19.5 16.4 12 21 12 21z';
const base = `@font-face{font-family:F;src:url(${fredoka})} @font-face{font-family:N;src:url(${nunito})} *{margin:0;box-sizing:border-box} body{width:100vw;height:100vh;overflow:hidden}`;

const icon = (maskable) => `<style>${base}
  body{display:grid;place-items:center;background:${maskable ? 'linear-gradient(135deg,#ff7eb6,#b69cff)' : 'transparent'}}
  .tile{width:${maskable ? '100%' : '88%'};height:${maskable ? '100%' : '88%'};border-radius:${maskable ? '0' : '22%'};display:grid;place-items:center;
    background:linear-gradient(135deg,#ff7eb6,#b69cff);box-shadow:inset 0 6vh 0 rgba(255,255,255,.25)}
  svg{width:${maskable ? '48%' : '58%'};filter:drop-shadow(0 2vh 0 rgba(58,29,74,.25))}
</style><div class="tile"><svg viewBox="0 0 24 24"><path fill="#fff" d="${HEART}"/></svg></div>`;

const og = `<style>${base}
  body{background:url(${img('public/art/bgs/finale_sky.webp')}) center/cover;font-family:N;color:#3a1d4a}
  .wash{position:absolute;inset:0;background:linear-gradient(90deg,rgba(255,240,247,.97) 0 42%,rgba(255,240,247,.55) 56%,transparent 70%)}
  .cast{position:absolute;right:-10px;bottom:-40px;height:640px;display:flex;align-items:flex-end}
  .cast img{height:100%;margin-left:-150px;filter:drop-shadow(0 12px 18px rgba(58,29,74,.3))}
  .cast img:nth-child(2){height:108%}
  .copy{position:absolute;left:60px;top:70px;width:560px}
  h1{font:700 104px/0.88 F;color:#d63384;-webkit-text-stroke:5px #fff;paint-order:stroke fill;text-shadow:0 7px 0 #b69cff,0 16px 26px rgba(58,29,74,.3)}
  p.ln{margin-top:28px;padding:14px 22px;border-radius:20px;background:#fffafd;border:3px solid #b69cff;font:800 23px/1.3 N;transform:rotate(-1.5deg);box-shadow:inset 0 2px 0 #fff,0 8px 18px -6px rgba(58,29,74,.4)}
  p.tag{margin-top:26px;font:600 30px F;color:#c42a72}
</style>
<div class="cast"><img src="${img('public/art/sprites/logs_happy.webp')}"><img src="${img('public/art/sprites/traces_happy.webp')}"><img src="${img('public/art/sprites/metrics_blush.webp')}"></div><div class="wash"></div>
<div class="copy"><h1>High<br>Cardinality</h1>
<p class="ln">I Acked a Page at 3 A.M. and Woke Up in an Observability Stack Where the Three Pillars Want to Date Me</p>
<p class="tag">A dating sim where ClickHouse decides who loves you.</p></div>`;

const b = await chromium.launch();
const shot = async (html, w, h, path, opts = {}) => {
  const p = await b.newPage({ viewport: { width: w, height: h } });
  await p.setContent(html);
  await p.evaluate(() => document.fonts.ready);
  await p.screenshot({ path, omitBackground: true, ...opts });
  await p.close();
  console.log('wrote', path);
};
await shot(icon(false), 512, 512, 'public/icons/icon-512.png');
await shot(icon(false), 192, 192, 'public/icons/icon-192.png');
await shot(icon(true), 512, 512, 'public/icons/maskable-512.png');
await shot(icon(true), 180, 180, 'public/icons/apple-touch-icon.png');
await shot(og, 1200, 630, 'public/og.jpg', { type: 'jpeg', quality: 86, omitBackground: false });
await b.close();
