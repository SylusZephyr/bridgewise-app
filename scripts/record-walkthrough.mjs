/**
 * Records an operating walkthrough of BridgeWise, from creating an account to
 * every main feature, with on-screen captions. Real rails only: the card
 * top-up goes through Stripe (test mode) and the payment to a recipient goes
 * through Alipay's transfer API (sandbox).
 *
 *   node scripts/record-walkthrough.mjs                       # local app on :3000
 *   BASE_URL=https://bridgewise-azure.vercel.app node scripts/record-walkthrough.mjs
 *
 * Output: walkthrough/bridgewise-walkthrough.webm (and .mp4 when ffmpeg is on PATH).
 * Needs the Alipay sandbox buyer account (ALIPAY_SANDBOX_PAYEE / _NAME) for the
 * payment scenes; defaults to the project's sandbox buyer.
 */
import { chromium } from '@playwright/test';
import { mkdirSync, renameSync, readdirSync, rmSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import path from 'node:path';

const BASE = process.env.BASE_URL ?? 'http://localhost:3000';
const PAYEE = process.env.ALIPAY_SANDBOX_PAYEE ?? 'pybnum6156@sandbox.com';
const PAYEE_NAME = process.env.ALIPAY_SANDBOX_PAYEE_NAME ?? 'pybnum6156';
const OUT = path.resolve('walkthrough');
const EMAIL = `ayesha.${Date.now()}@example.com`;
const PASSWORD = 'Lahore2026study';

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  recordVideo: { dir: OUT, size: { width: 1440, height: 900 } },
  locale: 'en-US',
  colorScheme: 'light',
});
const page = await context.newPage();
page.setDefaultTimeout(30_000);
const pause = (ms) => page.waitForTimeout(ms);

/** A caption bar over the page, so the video explains itself. */
async function caption(title, line = '') {
  await page.evaluate(([t, l]) => {
    let el = document.getElementById('__wt');
    if (!el) {
      el = document.createElement('div');
      el.id = '__wt';
      el.style.cssText = 'position:fixed;left:50%;bottom:28px;transform:translateX(-50%);z-index:2147483647;max-width:1100px;' +
        'background:rgba(14,26,51,.92);color:#fff;font:600 22px/1.35 system-ui,sans-serif;padding:16px 26px;border-radius:14px;' +
        'box-shadow:0 10px 40px rgba(0,0,0,.35);pointer-events:none;text-align:center';
      document.body.appendChild(el);
    }
    el.innerHTML = `<div>${t}</div>${l ? `<div style="font-weight:400;font-size:18px;opacity:.85;margin-top:4px">${l}</div>` : ''}`;
  }, [title, line]);
}
const nav = async (label) => { await page.getByRole('navigation', { name: 'Main' }).first().getByRole('button', { name: label }).click(); await pause(1200); };
const typeSlow = async (locator, text) => { await locator.click(); await locator.pressSequentially(text, { delay: 45 }); };

try {
  /* 1. Create an account */
  await page.goto(BASE);
  await page.getByRole('heading', { name: 'Your money, across borders, handled.' }).waitFor();
  await caption('BridgeWise', 'One account for every currency an international student lives in, run by an AI assistant');
  await pause(3500);
  await caption('Step 1 · Create an account', 'Email and password; the password is stored as a salted scrypt hash');
  await typeSlow(page.getByLabel('Email'), EMAIL);
  await typeSlow(page.getByLabel('Password'), PASSWORD);
  await typeSlow(page.getByLabel('Your first name'), 'Ayesha');
  await page.getByRole('button', { name: 'From Pakistan, studying in China' }).click();
  await caption('Step 1 · Create an account', 'A student from Pakistan studying in China: money from home in PKR, life in CNY');
  await pause(2000);
  await page.getByRole('button', { name: 'Create my account' }).click();
  await page.getByRole('heading', { name: /, Ayesha$/ }).waitFor();
  await caption('Home', 'The wallet starts empty: money only enters through a real payment rail');
  await pause(3500);

  /* 2. Add money with a card through Stripe */
  await caption('Step 2 · Add money', 'Two rails: Alipay’s own cashier, or a bank card through Stripe');
  await page.getByRole('button', { name: 'Add money' }).first().click();
  await pause(2000);
  await page.getByRole('dialog').getByRole('button', { name: 'Bank card' }).click();
  await typeSlow(page.getByRole('dialog').getByLabel(/Amount/), '800.00');
  await page.getByRole('dialog').getByRole('button', { name: 'Continue to card' }).click();
  await caption('Step 2 · Pay by card', 'The card field is Stripe’s own: the card number never reaches BridgeWise');
  const stripe = page.frameLocator('iframe[title="Secure payment input frame"]').first();
  await stripe.getByPlaceholder('1234 1234 1234 1234').waitFor({ timeout: 45_000 });
  await stripe.getByPlaceholder('1234 1234 1234 1234').pressSequentially('4242424242424242', { delay: 40 });
  await stripe.getByPlaceholder('MM / YY').pressSequentially('1230', { delay: 60 });
  await stripe.getByPlaceholder('CVC').pressSequentially('123', { delay: 60 });
  const zip = stripe.getByLabel(/ZIP|Postal/i);
  if (await zip.count()) await zip.first().pressSequentially('10001', { delay: 40 });
  await pause(1200);
  await page.getByRole('button', { name: /^Pay 800\.00 CNY$/ }).click();
  await caption('Step 2 · Confirmed by Stripe', 'BridgeWise credits the CNY pocket only after asking Stripe whether the payment succeeded');
  await page.getByRole('dialog').waitFor({ state: 'detached', timeout: 45_000 });
  await pause(3500);

  /* Alipay cashier, shown */
  await caption('The Alipay rail', 'Alipay top-ups open Alipay’s official cashier; the wallet is credited after Alipay confirms');
  await page.getByRole('button', { name: 'Add money' }).first().click();
  await page.getByRole('dialog').getByRole('button', { name: 'Alipay 支付宝', exact: true }).click();
  await typeSlow(page.getByRole('dialog').getByLabel('Amount (CNY)'), '88.00');
  await page.getByRole('dialog').getByRole('button', { name: 'Pay with Alipay 支付宝' }).click();
  await page.waitForURL(/alipaydev\.com/, { timeout: 45_000 });
  await pause(800);
  await caption('Alipay’s own cashier (sandbox)', 'The student pays on Alipay’s page, by QR code or with their Alipay login');
  await pause(5000);
  await page.goto(BASE);
  await page.getByRole('heading', { name: /, Ayesha$/ }).waitFor();

  /* 3. Link Alipay */
  await nav('Cards & accounts');
  await caption('Step 3 · Link accounts', 'Bank cards, Alipay, WeChat Pay and Chinese banks such as CCB, ICBC and BOC');
  await pause(2500);
  await page.getByRole('button', { name: 'Alipay', exact: true }).click();
  await typeSlow(page.getByLabel(/Alipay account/), PAYEE);
  await typeSlow(page.getByLabel(/Real name on the account/), PAYEE_NAME);
  await page.getByRole('button', { name: /^Link$/ }).click();
  await caption('Step 3 · Alipay linked', 'Money can now be moved out to this Alipay account for real');
  await pause(3500);

  /* 4. Convert */
  await nav('Wallet');
  await caption('Step 4 · Convert between pockets', 'Live ECB rate, with BridgeWise’s 0.30% fee shown before you approve');
  await page.locator('#cf').selectOption('CNY');
  await page.locator('#ct').selectOption('PKR');
  await typeSlow(page.locator('#ca'), '100.00');
  await page.getByRole('button', { name: 'Get quote' }).click();
  await page.getByText('Our fee').first().waitFor();
  await pause(3500);
  await caption('Step 4 · Nothing moves until you approve', 'Each card carries a fingerprint of its exact terms');
  await page.getByRole('button', { name: 'Approve' }).first().click();
  await pause(3500);

  /* 5. Send money for real through Alipay */
  await nav('Send');
  await caption('Step 5 · Pay someone in China', 'Recipients are Alipay accounts; only the student can add them');
  await page.getByRole('button', { name: 'New recipient' }).click();
  await typeSlow(page.getByLabel('Name', { exact: true }), 'Li Na');
  await typeSlow(page.getByLabel('Their Alipay account'), PAYEE);
  await typeSlow(page.getByLabel('Real name on that Alipay'), PAYEE_NAME);
  await page.getByRole('button', { name: 'Save recipient' }).click();
  await pause(1500);
  await typeSlow(page.getByLabel(/They receive/), '25.00');
  await page.getByRole('button', { name: 'Get quote' }).first().click();
  await page.getByText('Send 25.00 CNY to Li Na').waitFor();
  await caption('Step 5 · Real money needs your password', 'A session alone can’t send money: the password is checked on the server');
  await pause(2500);
  await typeSlow(page.getByLabel('Your password, to send real money').first(), PASSWORD);
  await page.getByRole('button', { name: 'Approve' }).first().click();
  await page.getByText('Sent 25.00 CNY to Li Na.').waitFor({ timeout: 45_000 });
  await caption('Step 5 · Paid through Alipay', 'Alipay’s transfer API paid Li Na’s account; the statement keeps Alipay’s order number');
  await pause(4000);

  /* 6. The assistant reads a tuition invoice */
  await caption('Step 6 · The AI assistant', 'Paste a tuition invoice: it reads it, checks the money and prepares the payment');
  const box = page.getByPlaceholder('Ask anything, or paste an invoice…');
  await box.click();
  await box.fill('Tsinghua University - Student Finance\nINVOICE\nStudent ID: 2026080123\nDescription: Tuition fee, Spring term 2027\nAmount due: CNY 300.00\nPayment due by 15 December 2026\nPay to: Tsinghua University');
  await pause(1500);
  await box.press('Enter');
  const approveBill = page.getByRole('complementary', { name: 'BridgeWise assistant' }).getByRole('button', { name: 'Approve' }).first();
  await approveBill.waitFor({ timeout: 60_000 });
  await caption('Step 6 · A card, not an action', 'The assistant can read and propose; only the student executes');
  await pause(4000);
  await approveBill.click();
  await caption('Step 6 · Set aside', 'No rail reaches the university, so the exact amount is ring-fenced until the student pays its portal');
  await pause(4000);

  /* 7. Bills */
  await nav('Bills');
  await caption('Step 7 · Bills', 'Set-aside money can’t be spent; mark the bill paid once the portal confirms');
  await pause(2500);
  await page.getByRole('button', { name: 'Mark as paid' }).first().click();
  await pause(3000);

  /* 8. Activity */
  await nav('Activity');
  await caption('Step 8 · Statement', 'Every movement with the balance after it, in plain words');
  await pause(4500);

  /* 9. Budget and expenses */
  await nav('Budget');
  await caption('Step 9 · Budget', 'Log spending paid elsewhere, set monthly budgets, see how long the money lasts');
  await page.getByRole('button', { name: 'Log expense' }).first().click().catch(async () => {
    await nav('Home'); await page.getByRole('button', { name: 'Log expense' }).first().click();
  });
  const sheet = page.getByRole('dialog');
  await typeSlow(sheet.getByLabel('Where'), 'Campus canteen');
  await typeSlow(sheet.getByLabel('Amount'), '36.00');
  await sheet.getByLabel('Pocket').selectOption('CNY');
  await sheet.getByRole('button', { name: 'Log expense' }).click();
  await pause(2500);
  await nav('Budget');
  await pause(3500);

  /* 10. Credit */
  await nav('Credit');
  await caption('Step 10 · Build credit in China', '征信 (PBOC), 芝麻信用 and 微信支付分: a plan, never a fake score');
  await pause(5000);

  /* 11. Markets */
  await nav('Markets');
  await caption('Step 11 · Markets', '30 days of European Central Bank rates for the student’s currencies, with rate alerts');
  await pause(6000);

  /* 12. 中文 */
  await caption('Step 12 · 中文', 'The whole interface in Simplified Chinese');
  await page.getByRole('button', { name: '切换到中文' }).click();
  await page.waitForLoadState('domcontentloaded');
  await pause(1500);
  await caption('BridgeWise · 中文界面', '整个界面支持简体中文');
  await pause(4500);
  await page.getByRole('button', { name: 'Switch to English' }).click();
  await page.waitForLoadState('domcontentloaded');
  await pause(1000);
  await caption('BridgeWise', 'Real rails, an assistant that never moves money without you, built for students across borders');
  await pause(4500);
} catch (e) {
  console.error('walkthrough stopped:', e.message.split('\n')[0]);
  await page.screenshot({ path: path.join(OUT, 'stopped-here.png') });
  process.exitCode = 1;
} finally {
  await context.close();
  await browser.close();
}

const webm = readdirSync(OUT).find((f) => f.endsWith('.webm'));
if (webm) {
  const final = path.join(OUT, 'bridgewise-walkthrough.webm');
  renameSync(path.join(OUT, webm), final);
  try {
    execSync(`ffmpeg -y -loglevel error -i "${final}" -c:v libx264 -preset veryfast -crf 23 -pix_fmt yuv420p -movflags +faststart "${path.join(OUT, 'bridgewise-walkthrough.mp4')}"`);
    console.log('wrote', path.join(OUT, 'bridgewise-walkthrough.mp4'));
  } catch { console.log('wrote', final, '(install ffmpeg for an .mp4)'); }
}
if (existsSync(path.join(OUT, 'stopped-here.png'))) console.log('see walkthrough/stopped-here.png');
