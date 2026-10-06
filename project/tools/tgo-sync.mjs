// ซิงก์ข้อมูล CFO จากเว็บไซต์ TGO + ตรวจสถานะหมดอายุ (รันบนเซิร์ฟเวอร์/ตั้งเวลา)
// ใช้: npm i playwright && npx playwright install chromium && node tools/tgo-sync.mjs
// ตัวแปร: FULL=1 (ไล่ทุกหน้า), MAX_PAGES=50, SOON_DAYS=90, DETAILS=1 (เปิดหน้ารายละเอียดรายการใหม่), WEBHOOK_URL (แจ้งเตือน LINE/Slack/Teams)
import { chromium } from 'playwright';
import fs from 'node:fs/promises';

const URL = 'https://thaicarbonlabel.tgo.or.th/index.php?lang=TH&mod=YjNKbllXNXBlbUYwYVc5dVgyRndjSEp2ZG1Gcw';
const DATA = 'data/cfo.json', REPORT = 'data/expiry-report.json', LOG = 'data/sync-log.json';
const FULL = !!process.env.FULL, MAX_PAGES = +process.env.MAX_PAGES || (FULL ? 1000 : 30);
const SOON = +process.env.SOON_DAYS || 90, DETAILS = !!process.env.DETAILS;
const STOP_AFTER_KNOWN_PAGES = 2;

const pad = n => String(n).padStart(2, '0');
const todayISO = () => { const d = new Date(Date.now() + 7 * 36e5); return d.toISOString().slice(0, 10); }; // เวลาไทย
const be2iso = s => { const m = /(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(s || ''); if (!m) return ''; let y = +m[3]; if (y > 2400) y -= 543; return `${y}-${pad(m[2])}-${pad(m[1])}`; };
const key = (cert, org) => String(cert || '').replace(/\s+/g, '').toUpperCase() + '|' + String(org || '').replace(/\s+/g, '').toLowerCase();
const orgKey = org => String(org || '').replace(/\((สำนักงานใหญ่|สาขา[^)]*|\d{5}[^)]*)\)/g, '').replace(/บริษัท|จำกัด|\(มหาชน\)|มหาชน|\s+/g, '').toLowerCase();

// ตัวอ่านการ์ดในหน้า (รันในเบราว์เซอร์) — ตรรกะเดียวกับ tgo-sync.js
function parseCards() {
  const out = [];
  document.querySelectorAll('h4').forEach(h => {
    const cert = h.textContent.replace(/\s+/g, ' ').trim(); if (!/^TGO\s*CFO/i.test(cert)) return;
    let card = h; while (card.parentElement && card.parentElement !== document.body && [...card.parentElement.querySelectorAll('h4')].filter(x => /TGO\s*CFO/i.test(x.textContent)).length === 1) card = card.parentElement;
    const T = []; const w = document.createTreeWalker(card, NodeFilter.SHOW_TEXT); let n; while ((n = w.nextNode())) { const t = n.textContent.replace(/\s+/g, ' ').trim(); if (t) T.push(t); }
    const full = T.join(' '); const h3 = card.querySelector('h3'); const act = h3 ? h3.textContent.replace(/\s+/g, ' ').trim() : '';
    const line = T.slice(T.indexOf(act) + 1).find(t => t.includes(',') && !/วันที่/.test(t)) || '';
    const ci = line.lastIndexOf(','); const org = (ci > 0 ? line.slice(0, ci) : line).trim(); const prov = ci > 0 ? line.slice(ci + 1).trim() : '';
    const bm = /\(([^()]*)\)\s*$/.exec(org);
    const apBE = (/วันที่อนุมัติ\s*(\d{1,2}\/\d{1,2}\/\d{4})/.exec(full) || [])[1] || '';
    const exBE = (/วันที่หมดอายุ\s*(\d{1,2}\/\d{1,2}\/\d{4})/.exec(full) || [])[1] || '';
    const av = /(?:data-[\w-]*id|data-key|onclick)\s*=\s*("[^"]*"|'[^']*')/i.exec(card.outerHTML); const idm = av && /(\d{3,7})/.exec(av[1]);
    if (org) out.push({ cert, act, org, branch: bm ? bm[1] : '', prov, apBE, exBE, id: idm ? idm[1] : '' });
  });
  return out;
}

async function nextPage(page, firstCert) {
  const sel = ['.pagination li.active + li a', 'ul.pagination a[aria-label="Next"]', 'a[title="ถัดไป"]', 'a:has-text("›")', 'a:has-text("»")'];
  for (const s of sel) {
    const a = page.locator(s).first();
    if (await a.count() && await a.isVisible()) {
      await a.click();
      try { await page.waitForFunction(fc => { const h = [...document.querySelectorAll('h4')].find(x => /TGO\s*CFO/i.test(x.textContent)); return h && h.textContent.trim() !== fc; }, firstCert, { timeout: 15000 }); return true; } catch { return false; }
    }
  }
  return false;
}

async function main() {
  const ds = JSON.parse(await fs.readFile(DATA, 'utf8'));
  const D = ds.dicts; const di = (k, v) => { v = v || ''; let i = D[k].indexOf(v); if (i < 0) { D[k].push(v); i = D[k].length - 1; } return i; };
  const byId = new Map(ds.rows.map(r => [String(r[24]), r])), byKey = new Map(ds.rows.map(r => [key(r[1], r[3]), r]));
  const find = it => (it.id && byId.get(it.id)) || byKey.get(key(it.cert, it.org));

  const browser = await chromium.launch();
  const page = await browser.newPage({ userAgent: 'Mozilla/5.0 CFO-Registry-Sync' });
  await page.goto(URL, { waitUntil: 'networkidle', timeout: 60000 });
  const totalTxt = await page.evaluate(() => (/ทั้งหมด\s*([\d,]+)\s*รายการ/.exec(document.body.textContent) || [])[1] || '');
  const items = []; const seen = new Set(); let knownStreak = 0, pages = 0;
  for (let p = 1; p <= MAX_PAGES; p++) {
    const cards = await page.evaluate(parseCards); pages = p;
    const fresh = cards.filter(c => !seen.has(key(c.cert, c.org))); fresh.forEach(c => { seen.add(key(c.cert, c.org)); items.push(c); });
    if (!fresh.length) break;
    knownStreak = fresh.every(find) ? knownStreak + 1 : 0;
    if (!FULL && knownStreak >= STOP_AFTER_KNOWN_PAGES) break;
    if (!(await nextPage(page, cards[0] && cards[0].cert))) break;
    console.log(`page ${p}: ${cards.length} cards`);
  }

  const added = [], changed = [];
  for (const it of items) {
    const ap = be2iso(it.apBE), ex = be2iso(it.exBE); const prev = find(it);
    if (!prev) {
      let extra = {};
      if (DETAILS) extra = await details(page, it).catch(() => ({}));
      const fy = (/FY(\d\d)/i.exec(it.cert) || [])[1];
      const id = it.id || ('T' + it.cert.replace(/\W/g, '') + '-' + Math.abs([...it.org].reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 0)).toString(36));
      const row = [0, it.cert, it.act, it.org, it.branch, di('prov', it.prov), extra.addr || '', '', '', it.prov, extra.zip || '', di('ind', extra.ind || ''), di('size', ''), it.apBE, it.exBE, ap, ex, extra.s1 ?? null, extra.s2 ?? null, extra.s3 ?? null, di('top', ''), 0, di('fy', fy ? 'FY' + fy : ''), 'ดึงจากเว็บไซต์ TGO อัตโนมัติ', id, ''];
      ds.rows.push(row); byId.set(id, row); byKey.set(key(it.cert, it.org), row); added.push({ id, org: it.org, cert: it.cert, ex });
    } else {
      const diff = {};
      if (it.act && it.act !== prev[2]) { diff.act = [prev[2], it.act]; prev[2] = it.act; }
      if (ap && ap !== prev[15]) { diff.ap = [prev[15], ap]; prev[15] = ap; prev[13] = it.apBE; }
      if (ex && ex !== prev[16]) { diff.ex = [prev[16], ex]; prev[16] = ex; prev[14] = it.exBE; }
      if (Object.keys(diff).length) changed.push({ id: String(prev[24]), org: prev[3], cert: prev[1], diff });
    }
  }
  await browser.close();

  // สถานะหมดอายุ ณ วันนี้ (ระดับใบรับรอง + ระดับองค์กร)
  const today = todayISO(), t = Date.parse(today);
  ds.rows.sort((a, b) => (b[15] || '').localeCompare(a[15] || '')).forEach((r, i) => { r[0] = i + 1; r[21] = !r[16] ? 2 : Date.parse(r[16]) >= t ? 0 : 1; });
  const groups = {}; ds.rows.forEach(r => { (groups[orgKey(r[3])] ||= []).push(r); });
  const orgs = Object.values(groups).map(g => { const b = g.filter(r => r[16]).sort((a, c) => c[16].localeCompare(a[16]))[0]; const days = b ? Math.round((Date.parse(b[16]) - t) / 864e5) : null;
    return { org: (b || g[0])[3], id: String((b || g[0])[24]), cert: (b || g[0])[1], ex: b ? b[16] : '', days, st: days == null ? 'unknown' : days < 0 ? 'expired' : days <= SOON ? 'soon' : 'active' }; });
  let prevRep = null; try { prevRep = JSON.parse(await fs.readFile(REPORT, 'utf8')); } catch {}
  const prevSt = new Map((prevRep?.orgs || []).map(o => [o.org, o]));
  const events = [];
  for (const o of orgs) { const p = prevSt.get(o.org); if (!p || p.st === o.st) continue;
    if (o.st === 'expired') events.push({ t: 'expired', ...o }); else if (o.st === 'soon' && p.st === 'active') events.push({ t: 'soon', ...o }); else if ((o.st === 'active' || o.st === 'soon') && p.st === 'expired') events.push({ t: 'renewed', ...o }); }
  const counts = orgs.reduce((m, o) => (m[o.st] = (m[o.st] || 0) + 1, m), {});
  const report = { asOf: today, generatedAt: new Date().toISOString(), soonDays: SOON, counts, events,
    soonList: orgs.filter(o => o.st === 'soon').sort((a, b) => a.days - b.days), orgs: orgs.map(({ org, id, cert, ex, st }) => ({ org, id, cert, ex, st })) };

  ds.asOf = today; ds.source = URL;
  await fs.writeFile(DATA, JSON.stringify(ds));
  await fs.writeFile(REPORT, JSON.stringify(report));
  let log = []; try { log = JSON.parse(await fs.readFile(LOG, 'utf8')); } catch {}
  log.unshift({ at: report.generatedAt, totalOnTGO: +String(totalTxt).replace(/,/g, '') || null, scanned: items.length, pages, added: added.length, changed: changed.length, events: events.length });
  await fs.writeFile(LOG, JSON.stringify(log.slice(0, 365), null, 1));

  const summary = `CFO Registry ${today}: TGO ${totalTxt || '?'} รายการ · ตรวจ ${items.length} (${pages} หน้า) · เพิ่มใหม่ ${added.length} · เปลี่ยนแปลง ${changed.length} · หมดอายุใหม่ ${events.filter(e => e.t === 'expired').length} · ใกล้หมดอายุใหม่ ${events.filter(e => e.t === 'soon').length} · ต่ออายุ ${events.filter(e => e.t === 'renewed').length}`;
  console.log(summary);
  if (process.env.WEBHOOK_URL && (added.length || changed.length || events.length))
    await fetch(process.env.WEBHOOK_URL, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: summary }) }).catch(e => console.warn('webhook', e.message));
}

// หน้ารายละเอียด: ต้องปรับ selector ให้ตรงกับป๊อปอัปจริงของเว็บ TGO
async function details(page, it) {
  const card = page.locator('h4', { hasText: it.cert }).first(); if (!(await card.count())) return {};
  await card.locator('xpath=ancestor::*[.//h3][1]').locator('a').last().click();
  await page.waitForTimeout(1500);
  const txt = await page.evaluate(() => (document.querySelector('.modal.show, .modal.in, .fancybox-content, [role=dialog]') || document.body).innerText);
  await page.keyboard.press('Escape').catch(() => {});
  const pct = l => { const m = new RegExp(l + '[^\\d]*([\\d.]+)\\s*%').exec(txt); return m ? +m[1] : null; };
  const addr = (/ที่อยู่\s*[:：]?\s*(.+)/.exec(txt) || [])[1] || '';
  return { addr: addr.trim(), zip: (/(\d{5})\s*$/m.exec(addr) || [])[1] || '', ind: ((/อุตสาหกรรม\s*[:：]?\s*(.+)/.exec(txt) || [])[1] || '').trim(), s1: pct('ประเภทที่ 1'), s2: pct('ประเภทที่ 2'), s3: pct('ประเภทที่ 3') };
}

main().catch(e => { console.error(e); process.exit(1); });
