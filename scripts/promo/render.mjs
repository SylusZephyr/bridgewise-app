// Renders the BridgeWise promo frame by frame (no dropped frames): motion
// graphics from promo.html, real app footage laid in at full size by ffmpeg,
// the voice-over, and a music bed ducked under the voice.
//   node scripts/promo/render.mjs                         -> walkthrough/bridgewise-promo.mp4
//   MUSIC_FILE=track.mp3 node scripts/promo/render.mjs    (use your own licensed track)
import { chromium } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { rmSync, mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const DIR = path.resolve('scripts/promo');
const OUT = path.join(DIR, 'out');
const FPS = 30;
const ORDER = ['hook', 'pain', 'logo', 'agent', 'card', 'proposal', 'approve', 'sent', 'features', 'secure', 'end'];
const MIN = { logo: 2.6, card: 6.2, proposal: 5.8, approve: 4.6, sent: 5.8, end: 6.4, pain: 5.4 };
const CLIPS = { card: 'clip-card_ok.webm', proposal: 'clip-assistant_card.webm', sent: 'clip-sent.webm' };
const dur = (f) => Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f]).toString());

let at = 0.2;
const schedule = ORDER.map((id) => { const d = Math.max(MIN[id] ?? 0, dur(path.join(OUT, `${id}.wav`)) + 0.7); const s = { id, at, dur: d }; at += d; return s; });
const total = at + 0.6;
const frames = Math.ceil(total * FPS);
console.log(`promo ${total.toFixed(1)}s, ${frames} frames`);

const FR = path.join(OUT, 'frames');
rmSync(FR, { recursive: true, force: true }); mkdirSync(FR, { recursive: true });
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
await page.goto(pathToFileURL(path.join(DIR, 'promo.html')).href);
await page.evaluate(([s, t]) => window.setup(s, t), [schedule, total]);
for (let i = 0; i < frames; i++) {
  await page.evaluate((t) => window.seek(t), i / FPS);
  await page.screenshot({ path: path.join(FR, `${String(i).padStart(5, '0')}.jpg`), type: 'jpeg', quality: 92 });
  if (i % 300 === 0) console.log(`frame ${i}/${frames}`);
}
await browser.close();

/* Video: frames, with each app clip overlaid in its frame (1200x750 at 120,150). */
const inputs = ['-framerate', String(FPS), '-i', path.join(FR, '%05d.jpg')];
const vf = [];
let last = '0:v', idx = 1;
for (const s of schedule) {
  if (!CLIPS[s.id]) continue;
  inputs.push('-i', path.join(OUT, CLIPS[s.id]));
  const start = s.at + 0.3, end = s.at + s.dur + 0.2;
  vf.push(`[${idx}:v]scale=1200:750,tpad=stop_mode=clone:stop_duration=12,format=yuva420p,fade=t=in:st=0:d=0.35:alpha=1,setpts=PTS-STARTPTS+${start.toFixed(2)}/TB[c${idx}]`);
  vf.push(`[${last}][c${idx}]overlay=120:150:enable='between(t,${start.toFixed(2)},${end.toFixed(2)})':eof_action=pass[o${idx}]`);
  last = `o${idx}`; idx++;
}
vf.push(`[${last}]fade=t=in:d=0.4,fade=t=out:st=${(total - 0.8).toFixed(2)}:d=0.8,format=yuv420p[vout]`);

/* Audio: music (yours, or a synthesized driving track) ducked under the voice. */
const musicIdx = idx;
if (process.env.MUSIC_FILE && existsSync(process.env.MUSIC_FILE)) inputs.push('-stream_loop', '-1', '-i', process.env.MUSIC_FILE);
else {
  // Am - F - C - G at 120 bpm: pad chords, a pulsing bass, kick on every beat,
  // snare on 2 and 4 and 16th hats once the hook has landed.
  const root = '(110*eq(floor(mod(t,8)/2),0)+87.31*eq(floor(mod(t,8)/2),1)+130.81*eq(floor(mod(t,8)/2),2)+98*eq(floor(mod(t,8)/2),3))';
  const music = [
    `0.03*(sin(2*PI*${root}*2*t)+0.6*sin(2*PI*${root}*2.378*t)+0.5*sin(2*PI*${root}*3*t))`,
    `0.13*sin(2*PI*${root}*t)*(0.55+0.45*exp(-mod(t,0.25)*9))*gte(t,7.5)`,
    `0.55*sin(2*PI*(44+85*exp(-mod(t,0.5)*32))*mod(t,0.5))*exp(-mod(t,0.5)*7)*gte(t,7.5)`,
    `0.17*(random(0)*2-1)*exp(-mod(t+0.5,1)*16)*gte(t,13)`,
    `0.045*(random(1)*2-1)*exp(-mod(t,0.25)*55)*gte(t,13)`,
  ].join('+');
  inputs.push('-f', 'lavfi', '-t', total.toFixed(2), '-i', `aevalsrc='${music}':s=48000`);
}
const af = [`[${musicIdx}:a]atrim=0:${total.toFixed(2)},highpass=f=30,volume=0.7,afade=t=in:d=0.8,afade=t=out:st=${(total - 2.5).toFixed(2)}:d=2.5[m]`];
let vi = musicIdx + 1;
const vo = [];
for (const s of schedule) {
  inputs.push('-i', path.join(OUT, `${s.id}.wav`));
  const ms = Math.round((s.at + 0.25) * 1000);
  af.push(`[${vi}:a]adelay=${ms}|${ms},aformat=channel_layouts=stereo,volume=2.0[v${vi}]`);
  vo.push(`[v${vi}]`); vi++;
}
af.push(`${vo.join('')}amix=inputs=${vo.length}:normalize=0,acompressor=threshold=0.2:ratio=3:makeup=1.5,asplit=2[vs][vm]`);
af.push(`[m][vs]sidechaincompress=threshold=0.03:ratio=8:attack=15:release=350[duck]`);
af.push(`[duck][vm]amix=inputs=2:normalize=0,alimiter=limit=0.96[aout]`);

const mp4 = path.resolve('walkthrough/bridgewise-promo.mp4');
execFileSync('ffmpeg', ['-y', '-loglevel', 'error', ...inputs, '-filter_complex', [...vf, ...af].join(';'),
  '-map', '[vout]', '-map', '[aout]', '-t', total.toFixed(2), '-r', String(FPS),
  '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', mp4]);
console.log('wrote', mp4);
