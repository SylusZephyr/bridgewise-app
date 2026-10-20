// Renders the BridgeWise promo: motion-graphics scenes timed to the voice-over,
// a synthesized music bed, and app footage from the walkthrough recording.
// Run from the repo root: node scripts/promo/render.mjs  ->  walkthrough/bridgewise-promo.mp4
import { chromium } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { readdirSync, rmSync, mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const DIR = path.resolve('scripts/promo');
const OUT = path.join(DIR, 'out');
const ORDER = ['hook', 'pain', 'logo', 'agent', 'approve', 'rails', 'features', 'secure', 'end'];
const MIN = { logo: 3.2, approve: 7.5, end: 6.5 };
const dur = (id) => Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', path.join(OUT, `${id}.wav`)]).toString());

let at = 0.4;
const schedule = ORDER.map((id) => { const d = Math.max(MIN[id] ?? 0, dur(id) + 1.0); const s = { id, at, dur: d, voiceAt: at + 0.35 }; at += d; return s; });
const total = at + 0.8;
console.log(`promo length ${total.toFixed(1)}s`);

const raw = path.join(OUT, 'raw');
rmSync(raw, { recursive: true, force: true }); mkdirSync(raw, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, recordVideo: { dir: raw, size: { width: 1920, height: 1080 } } });
const page = await ctx.newPage();
const t0 = Date.now();
await page.goto(pathToFileURL(path.join(DIR, 'promo.html')).href);
const lead = (Date.now() - t0) / 1000; // time before the timeline starts, cut later
await page.evaluate((s) => window.play(s), schedule);
await page.waitForTimeout(total * 1000);
await ctx.close(); await browser.close();

const video = path.join(raw, readdirSync(raw).find((f) => f.endsWith('.webm')));
// Music bed: a soft pad with a slow swell, a pulse on the beat (120 bpm) and a light hat.
const music = `0.05*(sin(2*PI*110*t)+0.8*sin(2*PI*138.59*t)+0.7*sin(2*PI*164.81*t))*(0.65+0.35*sin(2*PI*t/8))`
  + `+0.32*sin(2*PI*(48+70*exp(-mod(t,0.5)*28))*mod(t,0.5))*exp(-mod(t,0.5)*9)*gte(t,4.6)`
  + `+0.025*(random(0)*2-1)*exp(-mod(t+0.25,0.5)*55)*gte(t,13)`;
const inputs = ['-ss', lead.toFixed(2), '-i', video, '-f', 'lavfi', '-t', total.toFixed(2), '-i', `aevalsrc='${music}':s=48000`];
const filters = [`[1:a]lowpass=f=5200,volume=0.55,afade=t=in:d=1.5,afade=t=out:st=${(total - 2.5).toFixed(2)}:d=2.5[m]`];
schedule.forEach((s, i) => { inputs.push('-i', path.join(OUT, `${s.id}.wav`)); const ms = Math.round(s.voiceAt * 1000); filters.push(`[${i + 2}:a]adelay=${ms}|${ms},volume=1.7[v${i}]`); });
filters.push(`${schedule.map((_, i) => `[v${i}]`).join('')}amix=inputs=${schedule.length}:normalize=0,asplit=2[vs][vm]`);
filters.push(`[m][vs]sidechaincompress=threshold=0.04:ratio=6:attack=20:release=400[duck]`);
filters.push(`[duck][vm]amix=inputs=2:normalize=0,alimiter=limit=0.95[aout]`);
filters.push(`[0:v]fade=t=in:d=0.6,fade=t=out:st=${(total - 1).toFixed(2)}:d=1,format=yuv420p[vout]`);
const mp4 = path.resolve('walkthrough/bridgewise-promo.mp4');
execFileSync('ffmpeg', ['-y', '-loglevel', 'error', ...inputs, '-filter_complex', filters.join(';'), '-map', '[vout]', '-map', '[aout]',
  '-t', total.toFixed(2), '-c:v', 'libx264', '-preset', 'medium', '-crf', '19', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', mp4]);
console.log('wrote', mp4);
