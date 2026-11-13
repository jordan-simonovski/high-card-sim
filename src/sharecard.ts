// The ending's share card: who you ended up with, and what the tables say about how you played.
// statLines() is pure (tested); drawCard() paints a 1200x630 PNG on a canvas.

export interface ShareStats {
  moments: number;
  queries: number;
  median_ms: number;
  slowest_ms: number;
  slowest_choice: string;
  resolved: number;
  resolve_s: number;
  logs_lines: number;
  metrics_sum: number;
  traces_kept: number;
}

const secs = (ms: number) => `${(ms / 1000).toFixed(ms < 9950 ? 1 : 0)} s`;
function span(s: number) {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h ? `${h}h ${m}m` : m ? `${m}m ${s % 60}s` : `${s}s`;
}
const clip = (t: string, n: number) => (t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t);

/** The card's stat lines, most telling first. Values arrive from chDB as numbers or numeric strings. */
export function statLines(raw: Record<string, unknown>): string[] {
  const n = (k: keyof ShareStats) => Number(raw[k] ?? 0) || 0;
  const out: string[] = [];
  if (n('resolved')) out.push(`Sev-1 resolved in ${span(n('resolve_s'))}`);
  if (n('moments')) out.push(`Traces kept ${n('traces_kept')} of ${n('moments')} moments (${((100 * n('traces_kept')) / n('moments')).toFixed(1)}%)`);
  out.push(`Logs wrote down ${n('logs_lines')} lines. Metrics kept one number: ${n('metrics_sum') > 0 ? '+' : ''}${n('metrics_sum')}`);
  const choice = String(raw.slowest_choice ?? '').replace(/^["“]|["”]$/g, '');
  if (n('slowest_ms') && choice) out.push(`Slowest decision: ${secs(n('slowest_ms'))}, over “${clip(choice, 44)}”`);
  out.push(`${n('queries')} queries run. Median decision: ${secs(n('median_ms'))}`);
  return out;
}

export interface CardArt {
  /** A full illustration; otherwise sprites are drawn over the background. */
  cg?: string;
  bg: string;
  sprites: string[];
}

async function image(src: string): Promise<HTMLImageElement | undefined> {
  const img = new Image();
  img.src = src;
  try {
    await img.decode();
    return img;
  } catch {
    return undefined; // the card still draws without its art
  }
}

function cover(ctx: CanvasRenderingContext2D, img: HTMLImageElement, x: number, y: number, w: number, h: number) {
  const k = Math.max(w / img.naturalWidth, h / img.naturalHeight);
  const sw = w / k;
  const sh = h / k;
  ctx.drawImage(img, (img.naturalWidth - sw) / 2, (img.naturalHeight - sh) / 2, sw, sh, x, y, w, h);
}

function wrap(ctx: CanvasRenderingContext2D, text: string, max: number): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(' ')) {
    const next = line ? `${line} ${word}` : word;
    if (line && ctx.measureText(next).width > max) {
      lines.push(line);
      line = word;
    } else line = next;
  }
  return line ? [...lines, line] : lines;
}

export async function drawCard(o: { title: string; name: string; art: CardArt; lines: string[]; colors: string[]; site: string }): Promise<Blob> {
  const W = 1200;
  const H = 630;
  const split = 500; // art on the left, words on the right
  const canvas = Object.assign(document.createElement('canvas'), { width: W, height: H });
  const ctx = canvas.getContext('2d')!;
  await Promise.all([document.fonts.load('700 60px "Fredoka Variable"'), document.fonts.load('700 26px "Nunito Variable"')]).catch(() => {});

  const ground = ctx.createLinearGradient(0, 0, W, H);
  ground.addColorStop(0, '#fff0f7');
  ground.addColorStop(1, '#ece4ff');
  ctx.fillStyle = ground;
  ctx.fillRect(0, 0, W, H);

  const [main, ...sprites] = await Promise.all([image(o.art.cg ?? o.art.bg), ...(o.art.cg ? [] : o.art.sprites).map(image)]);
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(28, 28, split - 28, H - 56, 28);
  ctx.clip();
  ctx.fillStyle = '#d9ccff';
  ctx.fillRect(28, 28, split - 28, H - 56);
  if (main) cover(ctx, main, 28, 28, split - 28, H - 56);
  const each = (split - 28) / Math.max(1, sprites.length);
  sprites.forEach((sp, i) => {
    if (!sp) return;
    const h = H - 70;
    const w = (h * sp.naturalWidth) / sp.naturalHeight;
    ctx.drawImage(sp, 28 + each * i + (each - w) / 2, H - 28 - h, w, h);
  });
  ctx.restore();

  const x = split + 36;
  const max = W - x - 40;
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = '#6b5478';
  ctx.font = '700 20px "Nunito Variable", sans-serif';
  ctx.fillText('HIGH CARDINALITY', x, 76);

  let size = 62;
  let title: string[];
  do {
    ctx.font = `700 ${size}px "Fredoka Variable", sans-serif`;
    title = wrap(ctx, o.title, max);
    size -= 6;
  } while (title.length > 2 && size > 32);
  let y = 76 + 24;
  ctx.lineJoin = 'round';
  for (const line of title) {
    y += size + 10;
    ctx.strokeStyle = 'white';
    ctx.lineWidth = 8;
    ctx.strokeText(line, x, y);
    ctx.fillStyle = '#d63384';
    ctx.fillText(line, x, y);
  }
  ctx.fillStyle = '#3a1d4a';
  ctx.font = '600 24px "Nunito Variable", sans-serif';
  y += 44;
  ctx.fillText(clip(`${o.name}’s ending`, 40), x, y);

  y += 22;
  ctx.font = '700 23px "Nunito Variable", sans-serif';
  o.lines.forEach((text, i) => {
    const rows = wrap(ctx, text, max - 30);
    y += 16;
    ctx.fillStyle = o.colors[i % o.colors.length];
    ctx.beginPath();
    ctx.arc(x + 8, y + 20, 8, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#3a1d4a';
    for (const row of rows) {
      y += 28;
      ctx.fillText(row, x + 30, y);
    }
  });

  ctx.fillStyle = '#8f74e8';
  ctx.font = '700 24px "Nunito Variable", sans-serif';
  ctx.fillText(o.site, x, H - 44);

  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('no card'))), 'image/png'));
}
