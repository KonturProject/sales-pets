// Рендер трейлера в MP4: node tools/trailer/render.mjs
//   --stills=1,12.5,30  — только стоп-кадры на эти секунды и лист work/trailer/sheet.jpg (для проверки).
// Кадры снимает Chrome (playwright-core) через window.seek(t) из trailer.html, звук делает music.py,
// склеивает ffmpeg из pip-пакета imageio-ffmpeg (или FFMPEG=путь). Результат: work/trailer/trailer.mp4.
import { execFileSync, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';
import { chromium } from 'playwright-core';

const ROOT = resolve(import.meta.dirname, '../..');
const OUT = join(ROOT, 'work/trailer');
const stillsArg = process.argv.find((a) => a.startsWith('--stills='));
const browserPath = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].find((p) => p && existsSync(p));
if (!browserPath) throw new Error('Не найден Chrome/Edge: задайте CHROME_PATH');
const ffmpeg = process.env.FFMPEG ?? execFileSync('python', ['-c', 'import imageio_ffmpeg as f; print(f.get_ffmpeg_exe())']).toString().trim();

const TYPES = { '.html': 'text/html; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.js': 'text/javascript' };
const server = createServer(async (req, res) => {
  const file = normalize(join(ROOT, decodeURIComponent(new URL(req.url, 'http://x').pathname)));
  if (!file.startsWith(ROOT)) return res.writeHead(403).end();
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' }).end(body);
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
await mkdir(OUT, { recursive: true });

const browser = await chromium.launch({ executablePath: browserPath });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
const errors = [];
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(`http://127.0.0.1:${server.address().port}/tools/trailer/trailer.html?render=1`);
await page.waitForFunction(() => window.TRAILER?.ready === true, null, { timeout: 30000 });
const info = await page.evaluate(() => ({ duration: TRAILER.duration, fps: TRAILER.fps, sfx: TRAILER.sfx, font: TRAILER.font }));
console.log(`трейлер: ${info.duration} с, ${info.fps} к/с, звуков ${info.sfx.length}`);
if (!info.font || errors.length) {
  await browser.close();
  server.close();
  throw new Error(`страница загрузилась не целиком (шрифт Nunito: ${info.font ? 'есть' : 'нет'}; нет сети?):\n${errors.join('\n')}`);
}
const shot = async (t) => {
  await page.evaluate((x) => window.seek(x), t);
  return page.screenshot({ type: 'jpeg', quality: 92 });
};

try {
  if (stillsArg) {
    const times = stillsArg.slice('--stills='.length).split(',').map(Number);
    const dir = join(OUT, 'stills');
    await rm(dir, { recursive: true, force: true });
    await mkdir(dir, { recursive: true });
    for (const [i, t] of times.entries()) await writeFile(join(dir, `${String(i).padStart(3, '0')}.jpg`), await shot(t));
    const cols = Math.min(4, times.length);
    const rows = Math.ceil(times.length / cols);
    execFileSync(ffmpeg, ['-y', '-loglevel', 'error', '-i', join(dir, '%03d.jpg'), '-vf', `scale=480:-1,tile=${cols}x${rows}:padding=6:color=white`, '-frames:v', '1', join(OUT, 'sheet.jpg')]);
    console.log(`стоп-кадры: ${times.join(', ')} → work/trailer/sheet.jpg`);
  } else {
    const cues = join(OUT, 'cues.json');
    const wav = join(OUT, 'audio.wav');
    const mp4 = join(OUT, 'trailer.mp4');
    await writeFile(cues, JSON.stringify({ duration: info.duration, sfx: info.sfx }));
    execFileSync('python', [join(ROOT, 'tools/trailer/music.py'), cues, wav], { stdio: 'inherit' });
    const ff = spawn(ffmpeg, [
      '-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(info.fps), '-c:v', 'mjpeg', '-i', '-',
      '-i', wav, '-vf', 'scale=in_range=pc:out_range=tv:out_color_matrix=bt709,format=yuv420p',
      '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv',
      '-c:v', 'libx264', '-preset', 'medium', '-crf', '18',
      '-c:a', 'aac', '-b:a', '192k', '-shortest', '-movflags', '+faststart', mp4,
    ], { stdio: ['pipe', 'inherit', 'inherit'] });
    const done = new Promise((ok, fail) => ff.on('close', (c) => (c === 0 ? ok() : fail(new Error(`ffmpeg: код ${c}`)))));
    const frames = Math.round(info.duration * info.fps);
    for (let i = 0; i < frames; i++) {
      if (!ff.stdin.write(await shot(i / info.fps))) await new Promise((r) => ff.stdin.once('drain', r));
      if (i % (info.fps * 10) === 0) console.log(`кадр ${i} из ${frames}`);
    }
    ff.stdin.end();
    await done;
    console.log(`готово: work/trailer/trailer.mp4`);
  }
} finally {
  await browser.close();
  server.close();
}
if (errors.length) {
  console.error(`ошибки страницы:\n${errors.join('\n')}`);
  process.exitCode = 1;
}
