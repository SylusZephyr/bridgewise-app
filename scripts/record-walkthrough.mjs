/**
 * Records a narrated, captioned walkthrough of BridgeWise, from creating an
 * account to every main feature. Real rails only: the card top-up goes through
 * Stripe (test mode) and the payment to a recipient through Alipay's transfer API
 * (sandbox).
 *
 *   powershell -ExecutionPolicy Bypass -File scripts/walkthrough-voice.ps1   # voice-over (once)
 *   node scripts/record-walkthrough.mjs                                      # local app on :3000
 *   BASE_URL=https://bridgewise-azure.vercel.app node scripts/record-walkthrough.mjs
 *
 * Output: walkthrough/bridgewise-walkthrough.mp4 with the voice mixed in at the
 * moment each caption appears (needs ffmpeg on PATH).
 */
import { chromium } from '@playwright/test';
import { mkdirSync, readdirSync, rmSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const BASE = process.env.BASE_URL ?? 'http://localhost:3000';
const PAYEE = process.env.ALIPAY_SANDBOX_PAYEE ?? 'pybnum6156@sandbox.com';
const PAYEE_NAME = process.env.ALIPAY_SANDBOX_PAYEE_NAME ?? 'pybnum6156';
const OUT = path.resolve('walkthrough');
const VOICE = path.join(OUT, 'voice');
const NARRATION = JSON.parse(readFileSync(path.resolve('scripts/walkthrough-narration.json'), 'utf8'));
const DUR = existsSync(path.join(OUT, 'durations.json')) ? JSON.parse(readFileSync(path.join(OUT, 'durations.json'), 'utf8')) : {};
const EMAIL = `ayesha.${Date.now()}@example.com`;
const PASSWORD = 'Lahore2026study';

mkdirSync(OUT, { recursive: true });
for (const f of readdirSync(OUT)) if (/\.(webm|mp4|png)$/.test(f) || f === 'raw') rmSync(path.join(OUT, f), { recursive: true, force: true });
mkdirSync(path.join(OUT, 'raw'), { recursive: true });

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  recordVideo: { dir: path.join(OUT, 'raw'), size: { width: 1440, height: 900 } },
  locale: 'en-US',
  colorScheme: 'light',
});

/** Overlay furniture the page keeps across navigations: caption bar, cursor, zoom styles. */
await context.addInitScript(() => {
  const install = () => {
    if (document.getElementById('__wt_style')) return;
    const st = document.createElement('style');
    st.id = '__wt_style';
    st.textContent = `
      #__wt{position:fixed;left:50%;bottom:30px;transform:translate(-50%,20px);opacity:0;z-index:2147483646;max-width:1100px;
        background:rgba(14,26,51,.94);color:#fff;font:600 23px/1.35 system-ui,'Segoe UI',sans-serif;padding:16px 28px;border-radius:16px;
        box-shadow:0 14px 44px rgba(0,0,0,.35);pointer-events:none;text-align:center;transition:opacity .45s ease,transform .45s ease}
      #__wt.on{opacity:1;transform:translate(-50%,0)}
      #__wt small{display:block;font-weight:400;font-size:18px;opacity:.82;margin-top:4px}
      #__cur{position:fixed;left:720px;top:450px;width:22px;height:22px;margin:-11px 0 0 -11px;border-radius:50%;z-index:2147483647;pointer-events:none;
        background:rgba(11,92,255,.28);border:2px solid #0b5cff;box-shadow:0 2px 10px rgba(11,92,255,.45);transition:left .55s cubic-bezier(.3,.7,.2,1),top .55s cubic-bezier(.3,.7,.2,1)}
      #__cur.tap{animation:__tap .45s ease}
      @keyframes __tap{0%{box-shadow:0 0 0 0 rgba(11,92,255,.55)}100%{box-shadow:0 0 0 26px rgba(11,92,255,0)}}
      .__zoomable{transition:transform .9s cubic-bezier(.3,.7,.2,1)!important}
      #__card{position:fixed;inset:0;z-index:2147483645;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:18px;
        background:radial-gradient(120% 90% at 30% 20%,#2f6bff 0%,#16285a 45%,#0e1a33 100%);color:#fff;font-family:system-ui,'Segoe UI',sans-serif;
        opacity:0;transition:opacity .8s ease;pointer-events:none}
      #__card.on{opacity:1}
      #__card .mark{width:84px;height:84px;border-radius:22px;background:linear-gradient(135deg,#5b8cff,#7c4dff);display:grid;place-items:center;font:800 34px system-ui}
      #__card h1{font:800 76px/1 system-ui,'Segoe UI',sans-serif;letter-spacing:-2px;margin:0}
      #__card p{font:400 28px/1.3 system-ui;opacity:.85;margin:0}
      #__card .url{margin-top:10px;font:600 22px system-ui;padding:10px 18px;border-radius:999px;background:rgba(255,255,255,.12)}`;
    document.documentElement.appendChild(st);
    const cap = document.createElement('div'); cap.id = '__wt'; document.documentElement.appendChild(cap);
    const cur = document.createElement('div'); cur.id = '__cur'; document.documentElement.appendChild(cur);
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install); else install();
});

const page = await context.newPage();
const t0 = Date.now(); // the video starts with the page
page.setDefaultTimeout(45_000);
const pause = (ms) => page.waitForTimeout(ms);
const cues = [];
let speakingUntil = 0;

/** Waits for the line being spoken to finish, then shows the next caption and starts its line. */
async function say(id) {
  const n = NARRATION[id];
  if (!n) throw new Error(`no narration for ${id}`);
  const wait = speakingUntil - Date.now();
  if (wait > 0) await pause(wait);
  await page.evaluate(([t, l]) => {
    const el = document.getElementById('__wt');
    if (!el) return;
    el.classList.remove('on');
    el.innerHTML = `${t}${l ? `<small>${l}</small>` : ''}`;
    requestAnimationFrame(() => el.classList.add('on'));
  }, [n.title, n.line]);
  const at = Date.now() - t0;
  cues.push({ id, at });
  let len = (DUR[id] ?? 3) * 1000;
  if (n.sayZh && DUR[`${id}-zh`]) { cues.push({ id: `${id}-zh`, at: at + len + 300 }); len += 300 + DUR[`${id}-zh`] * 1000; }
  speakingUntil = Date.now() + len + 450;
}
const finishLine = async () => { const w = speakingUntil - Date.now(); if (w > 0) await pause(w); };

/** Glides the cursor to an element and pulses it, then clicks. */
async function tap(locator, opts = {}) {
  await locator.scrollIntoViewIfNeeded().catch(() => {});
  const box = await locator.boundingBox();
  if (box) {
    await page.evaluate(([x, y]) => { const c = document.getElementById('__cur'); if (c) { c.style.left = `${x}px`; c.style.top = `${y}px`; } }, [box.x + box.width / 2, box.y + box.height / 2]);
    await pause(600);
    await page.evaluate(() => { const c = document.getElementById('__cur'); if (c) { c.classList.remove('tap'); void c.offsetWidth; c.classList.add('tap'); } });
  }
  await locator.click(opts);
  await pause(250);
}
const type = async (locator, text) => { await tap(locator); await locator.pressSequentially(text, { delay: 22 }); };

/** Camera: zooms the app (not the caption or cursor) towards an element, and back. */
async function zoom(locator, scale = 1.35) {
  const box = await locator.boundingBox().catch(() => null);
  if (!box) return;
  await page.evaluate(([x, y, s]) => {
    const root = document.querySelector('.shell, .auth');
    if (!root) return;
    root.classList.add('__zoomable');
    root.style.transformOrigin = `${x}px ${y}px`;
    root.style.transform = `scale(${s})`;
  }, [box.x + box.width / 2, box.y + box.height / 2, scale]);
  await pause(950);
}
async function unzoom() {
  await page.evaluate(() => { const r = document.querySelector('.shell, .auth'); if (r) r.style.transform = 'none'; });
  await pause(900);
}

/** Full-screen title card for the intro and the close. */
async function card(on, title = 'BridgeWise', sub = '', url = '') {
  await page.evaluate(([o, t, s, u]) => {
    let c = document.getElementById('__card');
    if (!c) { c = document.createElement('div'); c.id = '__card'; document.documentElement.appendChild(c); }
    c.innerHTML = `<div class="mark" style="background:none"><svg width="84" height="84" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#3b7bff"/><stop offset="1" stop-color="#7c4dff"/></linearGradient></defs><rect width="64" height="64" rx="16" fill="url(#g)"/><path d="M12 41 Q32 9 52 41" fill="none" stroke="#fff" stroke-width="4.5" stroke-linecap="round"/><path d="M22 29.5V41M32 25V41M42 29.5V41" stroke="#fff" stroke-width="2.6" stroke-linecap="round" opacity=".85"/><path d="M8 41H56" stroke="#fff" stroke-width="4.5" stroke-linecap="round"/><circle cx="12" cy="49" r="4.2" fill="#ffd166"/><circle cx="52" cy="49" r="4.2" fill="#5ef0c9"/></svg></div><h1>${t}</h1>${s ? `<p>${s}</p>` : ''}${u ? `<div class="url">${u}</div>` : ''}`;
    requestAnimationFrame(() => c.classList.toggle('on', o));
  }, [on, title, sub, url]);
  await pause(900);
}
const nav = async (label) => { await tap(page.getByRole('navigation', { name: 'Main' }).first().getByRole('button', { name: label })); await pause(900); };

try {
  /* Intro */
  await page.goto(BASE);
  await page.getByRole('heading', { name: 'Your money, across borders, handled.' }).waitFor();
  await card(true, 'BridgeWise', 'The money account for international students', 'bridgewise-azure.vercel.app');
  await say('intro');
  await finishLine();
  await card(false);

  /* 1. Create an account */
  await say('signup');
  await type(page.getByLabel('Your first name'), 'Ayesha');
  await type(page.getByLabel('Email'), EMAIL);
  await type(page.getByLabel('Password'), PASSWORD);
  await tap(page.getByLabel('Home country')); await page.getByLabel('Home country').selectOption('PKR');
  await tap(page.getByLabel('Country of study')); await page.getByLabel('Country of study').selectOption('CNY');
  await finishLine();
  await tap(page.getByRole('button', { name: 'Create my account' }));
  await page.getByRole('heading', { name: /, Ayesha$/ }).waitFor();
  await say('home');
  await zoom(page.locator('.balance-hero').first(), 1.25);
  await finishLine();
  await unzoom();

  /* 2. Add money by card through Stripe */
  await say('addmoney');
  await tap(page.getByRole('button', { name: 'Add money' }).first());
  await pause(800);
  await tap(page.getByRole('dialog').getByRole('button', { name: 'Bank card' }));
  await finishLine();
  await say('card');
  await type(page.getByRole('dialog').getByLabel(/Amount/), '800.00');
  await tap(page.getByRole('dialog').getByRole('button', { name: 'Continue to card' }));
  const stripeFrame = page.locator('iframe[title="Secure payment input frame"]').first();
  const stripe = page.frameLocator('iframe[title="Secure payment input frame"]').first();
  await stripe.getByPlaceholder('1234 1234 1234 1234').waitFor();
  await tap(stripeFrame);
  await stripe.getByPlaceholder('1234 1234 1234 1234').pressSequentially('4242424242424242', { delay: 40 });
  await stripe.getByPlaceholder('MM / YY').pressSequentially('1230', { delay: 60 });
  await stripe.getByPlaceholder('CVC').pressSequentially('123', { delay: 60 });
  const zip = stripe.getByLabel(/ZIP|Postal/i);
  if (await zip.count()) await zip.first().pressSequentially('10001', { delay: 40 });
  await finishLine();
  await tap(page.getByRole('button', { name: /^Pay 800\.00 CNY$/ }));
  await page.getByRole('dialog').waitFor({ state: 'detached' });
  await say('card_ok');
  await zoom(page.locator('.balance-hero').first(), 1.3);
  await finishLine();
  await unzoom();

  /* The Alipay rail */
  await say('alipay');
  await tap(page.getByRole('button', { name: 'Add money' }).first());
  await tap(page.getByRole('dialog').getByRole('button', { name: 'Alipay 支付宝', exact: true }));
  await type(page.getByRole('dialog').getByLabel('Amount (CNY)'), '88.00');
  // Alipay's sandbox gateway sometimes answers with a 404 page: retry, as a student would.
  for (let attempt = 0; attempt < 4; attempt++) {
    if (attempt) {
      await page.goto(BASE); await page.getByRole('heading', { name: /, Ayesha$/ }).waitFor();
      await page.getByRole('button', { name: 'Add money' }).first().click();
      await page.getByRole('dialog').getByRole('button', { name: 'Alipay 支付宝', exact: true }).click();
      await page.getByRole('dialog').getByLabel('Amount (CNY)').fill('88.00');
    }
    await tap(page.getByRole('dialog').getByRole('button', { name: 'Pay with Alipay 支付宝' }));
    await page.waitForURL(/alipaydev\.com/);
    await page.waitForLoadState('domcontentloaded');
    if (!/404 Not Found/.test(await page.locator('body').innerText().catch(() => ''))) break;
  }
  await pause(1200);
  await finishLine();
  await pause(1500);
  await page.goto(BASE);
  await page.getByRole('heading', { name: /, Ayesha$/ }).waitFor();

  /* 3. Link Alipay */
  await nav('Cards & accounts');
  await say('link');
  await tap(page.getByRole('button', { name: 'Alipay', exact: true }));
  await type(page.getByLabel(/Alipay account/), PAYEE);
  await type(page.getByLabel(/Real name on the account/), PAYEE_NAME);
  await finishLine();
  await tap(page.getByRole('button', { name: /^Link$/ }));
  await pause(1200);
  await say('link_ok');
  await zoom(page.locator('.source').first(), 1.4);
  await finishLine();
  await unzoom();

  /* 4. Convert */
  await nav('Wallet');
  await say('convert');
  await tap(page.locator('#cf')); await page.locator('#cf').selectOption('CNY');
  await tap(page.locator('#ct')); await page.locator('#ct').selectOption('PKR');
  await type(page.locator('#ca'), '100.00');
  await tap(page.getByRole('button', { name: 'Get quote' }));
  await page.getByText('Our fee').first().waitFor();
  await zoom(page.locator('.approval').first(), 1.35);
  await finishLine();
  await say('approve');
  await finishLine();
  await unzoom();
  await tap(page.getByRole('button', { name: 'Approve' }).first());
  await pause(1500);

  /* 5. Pay a friend for real through Alipay */
  await nav('Send');
  await say('send');
  await tap(page.getByRole('button', { name: 'New recipient' }));
  await type(page.getByLabel('Name', { exact: true }), 'Li Na');
  await type(page.getByLabel('Their Alipay account'), PAYEE);
  await type(page.getByLabel('Real name on that Alipay'), PAYEE_NAME);
  await tap(page.getByRole('button', { name: 'Save recipient' }));
  await pause(1000);
  await type(page.getByLabel(/They receive/), '25.00');
  await tap(page.getByRole('button', { name: 'Get quote' }).first());
  await page.getByText('Send 25.00 CNY to Li Na').waitFor();
  await finishLine();
  await say('password');
  await zoom(page.locator('.approval').first(), 1.3);
  await unzoom();
  await type(page.getByLabel('Your password, to send real money').first(), PASSWORD);
  await finishLine();
  await tap(page.getByRole('button', { name: 'Approve' }).first());
  await page.getByText('Sent 25.00 CNY to Li Na.').waitFor({ timeout: 60_000 });
  await say('sent');
  await zoom(page.getByText('Sent 25.00 CNY to Li Na.'), 1.5);
  await finishLine();
  await unzoom();

  /* 6. The assistant reads a tuition invoice */
  await say('assistant');
  const box = page.getByPlaceholder('Ask anything, or paste an invoice…');
  await tap(box);
  await box.fill('Tsinghua University - Student Finance\nINVOICE\nStudent ID: 2026080123\nDescription: Tuition fee, Spring term 2027\nAmount due: CNY 300.00\nPayment due by 15 December 2026\nPay to: Tsinghua University');
  await pause(900);
  await box.press('Enter');
  const aside = page.getByRole('complementary', { name: 'BridgeWise assistant' });
  const approveBill = aside.getByRole('button', { name: 'Approve' }).first();
  await approveBill.waitFor({ timeout: 60_000 });
  await finishLine();
  await say('assistant_card');
  await zoom(aside.locator('.approval').first(), 1.3);
  await finishLine();
  await unzoom();
  await tap(approveBill);
  await pause(1200);
  await say('setaside');
  await zoom(aside.locator('.approval').first(), 1.3);
  await finishLine();
  await unzoom();

  /* 7. Bills */
  await nav('Bills');
  await say('bills');
  await tap(page.getByRole('button', { name: 'Mark as paid' }).first());
  await finishLine();

  /* 8. Statement */
  await nav('Activity');
  await say('activity');
  await zoom(page.locator('.tx').first(), 1.3);
  await finishLine();
  await unzoom();

  /* 9. Budget and expenses */
  await nav('Home');
  await say('budget');
  await tap(page.getByRole('button', { name: 'Log expense' }).first());
  const sheet = page.getByRole('dialog');
  await type(sheet.getByLabel('Where'), 'Campus canteen');
  await type(sheet.getByLabel('Amount'), '36.00');
  await sheet.getByLabel('Pocket').selectOption('CNY');
  await tap(sheet.getByRole('button', { name: 'Log expense' }));
  await pause(800);
  await nav('Budget');
  await finishLine();

  /* 10. Credit */
  await nav('Credit');
  await say('credit');
  await pause(2500);
  await zoom(page.locator('main .card').first(), 1.25);
  await finishLine();
  await unzoom();

  /* 11. Markets */
  await nav('Markets');
  await say('markets');
  await pause(1500);
  await finishLine();

  /* 12. 中文 */
  await say('zh');
  await tap(page.getByRole('button', { name: '切换到中文' }));
  await page.waitForLoadState('domcontentloaded');
  await finishLine();
  await tap(page.getByRole('button', { name: 'Switch to English' }));
  await page.waitForLoadState('domcontentloaded');
  await pause(800);

  /* Close */
  await card(true, 'BridgeWise', 'Real rails · An assistant that never moves money without you', 'bridgewise-azure.vercel.app');
  await say('outro');
  await finishLine();
  await pause(1200);
} catch (e) {
  console.error('walkthrough stopped:', e.message.split('\n')[0]);
  await page.screenshot({ path: path.join(OUT, 'stopped-here.png') }).catch(() => {});
  process.exitCode = 1;
} finally {
  await context.close();
  await browser.close();
}

/* Mix: each voice clip placed at the moment its caption appeared. */
writeFileSync(path.join(OUT, 'cues.json'), JSON.stringify(cues, null, 2));
const raw = readdirSync(path.join(OUT, 'raw')).find((f) => f.endsWith('.webm'));
if (!raw) throw new Error('no video recorded');
const inputs = ['-i', path.join(OUT, 'raw', raw)];
const filters = [];
let n = 0;
for (const c of cues) {
  const wav = path.join(VOICE, `${c.id}.wav`);
  if (!existsSync(wav)) continue;
  n++;
  inputs.push('-i', wav);
  filters.push(`[${n}:a]adelay=${c.at}|${c.at},aformat=channel_layouts=stereo[a${n}]`);
}
// Music bed under the voice: soft pad, a gentle pulse, ducked whenever someone speaks.
const total = (Date.now() - t0) / 1000;
const bed = `aevalsrc='0.045*(sin(2*PI*110*t)+0.8*sin(2*PI*138.59*t)+0.7*sin(2*PI*164.81*t))*(0.65+0.35*sin(2*PI*t/8))+0.18*sin(2*PI*(48+60*exp(-mod(t,0.5)*28))*mod(t,0.5))*exp(-mod(t,0.5)*10)':s=48000`;
inputs.push('-f', 'lavfi', '-t', total.toFixed(2), '-i', bed);
const bi = n + 1;
const mix = n ? `${filters.join(';')};${Array.from({ length: n }, (_, i) => `[a${i + 1}]`).join('')}amix=inputs=${n}:normalize=0,volume=1.6,aresample=48000,asplit=2[vs][vm];[${bi}:a]lowpass=f=4800,volume=0.45,afade=t=in:d=2,afade=t=out:st=${(total - 3).toFixed(2)}:d=3[bed];[bed][vs]sidechaincompress=threshold=0.04:ratio=6:attack=20:release=500[duck];[duck][vm]amix=inputs=2:normalize=0,alimiter=limit=0.95[aout]` : '';
const mp4 = path.join(OUT, 'bridgewise-walkthrough.mp4');
execFileSync('ffmpeg', ['-y', '-loglevel', 'error', ...inputs,
  ...(n ? ['-filter_complex', `${mix};[0:v]fade=t=in:st=0:d=0.8,format=yuv420p[vout]`, '-map', '[vout]', '-map', '[aout]'] : ['-vf', 'format=yuv420p']),
  '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '21', '-c:a', 'aac', '-b:a', '160k', '-t', total.toFixed(2), '-movflags', '+faststart', mp4]);
console.log('wrote', mp4, `(${n} voice lines)`);
