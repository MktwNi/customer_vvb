// Dev-only: renders realistic sample quotations / invoices / receipts (Thai and English) with
// Chromium into a folder, plus expected.json with the amounts each one states:
//   text PDFs (page.pdf), an image-only "scanned" PDF, a clean PNG and a blurred, rotated JPEG.
// Usage: node dev/make-doc-samples.cjs <out-dir>     (run-doc-harness.cjs calls it when needed)
const fs = require('node:fs');
const path = require('node:path');
const { loadPlaywright } = require('./pw.cjs');

const money = (n) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');

const SELLER = {
  name: 'บริษัท โกลบอล คาร์บอน คอร์ปอเรชั่น จำกัด (สำนักงานใหญ่)',
  nameEn: 'GLOBAL CARBON CORPORATION CO., LTD.',
  addr: '99/9 หมู่ 3 ถนนพหลโยธิน ตำบลคลองหนึ่ง อำเภอคลองหลวง จังหวัดปทุมธานี 12120',
  contact: 'โทร 02-123-4567  แฟกซ์ 02-123-4568  เลขประจำตัวผู้เสียภาษี 0105561234567',
};

const CSS = `
  @page { size: A4; margin: 14mm 14mm; }
  * { box-sizing: border-box; }
  body { font-family: Loma, sans-serif; font-size: 12.5px; color: #111; margin: 0; }
  .page { width: 182mm; }
  .head { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #1f4e79; padding-bottom: 8px; }
  .seller b { font-size: 15px; } .seller div { margin-top: 2px; }
  .title { text-align: right; } .title h1 { margin: 0; font-size: 20px; color: #1f4e79; } .title h2 { margin: 0; font-size: 14px; color: #1f4e79; }
  .meta { display: flex; justify-content: space-between; margin: 10px 0; gap: 12px; }
  .box { border: 1px solid #999; border-radius: 4px; padding: 6px 8px; }
  .cust { flex: 1; } .docinfo { width: 62mm; }
  .docinfo td { padding: 1px 4px; }
  table.items { width: 100%; border-collapse: collapse; margin-top: 6px; }
  table.items th { background: #1f4e79; color: #fff; padding: 5px 4px; font-weight: normal; }
  table.items td { border-bottom: 1px solid #ddd; padding: 5px 4px; vertical-align: top; }
  .r { text-align: right; white-space: nowrap; } .c { text-align: center; }
  .bottom { display: flex; justify-content: space-between; margin-top: 10px; gap: 12px; }
  .words { flex: 1; align-self: flex-start; background: #eef3f8; }
  table.sum { width: 82mm; border-collapse: collapse; }
  table.sum td { padding: 3px 6px; } table.sum tr.g td { border-top: 1px solid #333; border-bottom: 3px double #333; font-weight: bold; }
  .notes { margin-top: 12px; font-size: 11.5px; }
  .sign { display: flex; justify-content: space-around; margin-top: 36px; text-align: center; font-size: 11.5px; }
  .en { color: #555; font-size: 11px; }
`;

/** One document page; `sum` rows are [label, amount, grand?]. */
function docHtml(d) {
  const items = d.items.map((it, i) => `<tr><td class="c">${i + 1}</td><td>${esc(it[0])}</td><td class="c">${it[1]}</td><td class="c">${esc(it[2])}</td><td class="r">${money(it[3])}</td><td class="r">${money(it[1] * it[3])}</td></tr>`).join('');
  const sum = d.sum.map(([l, v, g]) => `<tr class="${g ? 'g' : ''}"><td>${l}</td><td class="r">${money(v)}</td></tr>`).join('');
  const info = d.info.map(([l, v]) => `<tr><td>${l}</td><td>${esc(v)}</td></tr>`).join('');
  const H = d.en
    ? ['No.', 'Description', 'Qty', 'Unit', 'Unit Price', 'Amount']
    : ['ลำดับ', 'รายการ', 'จำนวน', 'หน่วย', 'ราคาต่อหน่วย', 'จำนวนเงิน'];
  return `<!doctype html><html lang="th"><head><meta charset="utf-8"><style>${CSS}${d.css || ''}</style></head><body><div class="page">
  <div class="head"><div class="seller"><b>${d.en ? SELLER.nameEn : SELLER.name}</b>${d.en ? '' : `<div class="en">${SELLER.nameEn}</div>`}<div>${SELLER.addr}</div><div>${SELLER.contact}</div></div>
  <div class="title"><h1>${d.title}</h1>${d.title2 ? `<h2>${d.title2}</h2>` : ''}</div></div>
  <div class="meta"><div class="box cust">${d.customer}</div><div class="box docinfo"><table>${info}</table></div></div>
  <table class="items"><thead><tr>${H.map((h) => `<th>${h}</th>`).join('')}</tr></thead><tbody>${items}</tbody></table>
  <div class="bottom"><div class="box words">${d.words || ''}</div><table class="sum">${sum}</table></div>
  <div class="notes">${d.notes || ''}</div>
  <div class="sign"><div>....................................<br>${d.en ? 'Customer' : 'ผู้รับเอกสาร'}</div><div>....................................<br>${d.en ? 'Authorized Signature' : 'ผู้มีอำนาจลงนาม'}</div></div>
  </div></body></html>`;
}

const sumOf = (items) => items.reduce((s, it) => s + it[1] * it[3], 0);

function samples() {
  const qtItems = [['บริการทวนสอบคาร์บอนฟุตพริ้นท์องค์กร (CFO) ปีฐาน 2568', 1, 'งาน', 85000], ['ค่าเดินทางและที่พักผู้ทวนสอบ (ตรวจประเมิน ณ สถานประกอบการ)', 2, 'ครั้ง', 7500]];
  const many = Array.from({ length: 32 }, (_, i) => [`ตรวจวัดและเก็บข้อมูลกิจกรรมปล่อยก๊าซเรือนกระจก จุดที่ ${i + 1} (อาคาร ${String.fromCharCode(65 + (i % 6))})`, 1 + (i % 3), 'จุด', 2500 + 250 * (i % 5)]);
  const manySub = sumOf(many);
  const invItems = [['งวดที่ 2 ค่าบริการทวนสอบ CFO ปี 2568 (ส่วนที่เหลือ 50%)', 1, 'งาน', 50000]];
  const enItems = [['GHG inventory verification (ISO 14064-3), FY2025', 1, 'job', 110000], ['Site visit – Rayong plant', 1, 'trip', 10000]];
  const rcItems = [['ค่าอบรมหลักสูตรการจัดทำคาร์บอนฟุตพริ้นท์ผลิตภัณฑ์ (CFP)', 2, 'ท่าน', 6000]];
  const scItems = [['ค่าที่ปรึกษาจัดทำรายงานก๊าซเรือนกระจก งวดที่ 1', 1, 'งาน', 30000]];
  const phItems = [['ค่าที่ปรึกษาขึ้นทะเบียนโครงการ T-VER (ระยะที่ 1)', 1, 'งาน', 60000]];
  return [
    {
      file: 'qt-cfo-thai.pdf', type: 'pdf',
      html: docHtml({
        title: 'ใบเสนอราคา', title2: 'QUOTATION',
        customer: 'ลูกค้า: บริษัท ไทยสตีล อินดัสตรี จำกัด<br>ที่อยู่: 88 ถนนบางนา-ตราด แขวงบางนา เขตบางนา กรุงเทพฯ 10260<br>เรียน: คุณสมชาย ใจดี (ผู้จัดการฝ่ายสิ่งแวดล้อม)',
        info: [['เลขที่', 'QT2569-0012'], ['วันที่', '6 ต.ค. 2569'], ['ยืนราคา', '30 วัน'], ['ผู้เสนอราคา', 'คุณวิภา']],
        items: qtItems, sum: [['รวมเป็นเงิน', 100000], ['ภาษีมูลค่าเพิ่ม 7%', 7000], ['จำนวนเงินรวมทั้งสิ้น', 107000, true]],
        words: '(หนึ่งแสนเจ็ดพันบาทถ้วน)',
        notes: 'เงื่อนไขการชำระเงิน: งวดที่ 1 มัดจำ 50% เป็นเงิน 53,500.00 บาท เมื่อยืนยันการสั่งซื้อ · งวดที่ 2 ส่วนที่เหลือ 53,500.00 บาท เมื่อส่งมอบรายงาน',
      }),
      expect: { kind: 'quotation', docNo: 'QT2569-0012', docDate: '2026-10-06', total: 107000, subtotal: 100000, vat: 7000, party: 'บริษัท ไทยสตีล อินดัสตรี จำกัด' },
    },
    {
      file: 'inv-taxinv-wht.pdf', type: 'pdf',
      html: docHtml({
        title: 'ใบแจ้งหนี้ / ใบกำกับภาษี', title2: 'INVOICE / TAX INVOICE',
        customer: 'ลูกค้า / Customer: บริษัท สยามฟู้ด จำกัด (สำนักงานใหญ่)<br>เลขประจำตัวผู้เสียภาษี 0105556012345<br>1 ซอยสุขุมวิท 21 แขวงคลองเตยเหนือ เขตวัฒนา กรุงเทพฯ 10110',
        info: [['เลขที่ / No.', 'IV6910-0021'], ['วันที่ / Date', '15/10/2569'], ['ครบกำหนด', '14/11/2569'], ['อ้างอิง', 'QT2569-0012']],
        items: invItems,
        sum: [['รวมเป็นเงิน / Sub Total', 50000], ['ภาษีมูลค่าเพิ่ม 7% / VAT', 3500], ['จำนวนเงินรวมทั้งสิ้น / Grand Total', 53500, true], ['หักภาษี ณ ที่จ่าย 3% / Withholding Tax', 1500], ['ยอดชำระสุทธิ / Net Payable', 52000, true]],
        words: '(ห้าหมื่นสามพันห้าร้อยบาทถ้วน)',
        notes: 'โปรดชำระเงินโดยโอนเข้าบัญชี ธนาคารกสิกรไทย สาขารังสิต เลขที่บัญชี 123-4-56789-0 ชื่อบัญชี บริษัท โกลบอล คาร์บอน คอร์ปอเรชั่น จำกัด',
      }),
      expect: { kind: 'invoice', docNo: 'IV6910-0021', docDate: '2026-10-15', total: 53500, subtotal: 50000, vat: 3500, wht: 1500, netPay: 52000 },
    },
    {
      file: 'inv-english.pdf', type: 'pdf',
      html: docHtml({
        en: true, title: 'INVOICE',
        customer: 'Bill To: Siam Cement Trading Co., Ltd.<br>1 Siam Cement Road, Bangsue, Bangkok 10800<br>Tax ID: 0105536001234',
        info: [['Invoice No.', 'INV-2026-0045'], ['Date', '6 October 2026'], ['Due Date', '5 November 2026'], ['Terms', '30 days']],
        items: enItems, sum: [['Subtotal', 120000], ['Discount', 5000], ['Net Amount', 115000], ['VAT 7%', 8050], ['Total Amount Due', 123050, true]],
        words: 'One hundred twenty-three thousand fifty baht only',
        notes: 'Payment by bank transfer to Kasikornbank, account 123-4-56789-0.',
      }),
      expect: { kind: 'invoice', docNo: 'INV-2026-0045', docDate: '2026-10-06', total: 123050, subtotal: 115000, vat: 8050 },
    },
    {
      file: 'qt-2pages.pdf', type: 'pdf',
      html: docHtml({
        title: 'ใบเสนอราคา', title2: 'QUOTATION',
        customer: 'ลูกค้า: บริษัท เอเชีย พลาสติก จำกัด (มหาชน)<br>นิคมอุตสาหกรรมอมตะซิตี้ ชลบุรี 20000',
        info: [['เลขที่', 'QT2569-0031'], ['วันที่', '01/10/2569'], ['ยืนราคา', '45 วัน']],
        items: many, sum: [['รวมเป็นเงิน', manySub], ['ส่วนลดพิเศษ', 5000], ['ยอดหลังหักส่วนลด', manySub - 5000], ['ภาษีมูลค่าเพิ่ม 7%', Math.round((manySub - 5000) * 7) / 100], ['รวมทั้งสิ้น', Math.round((manySub - 5000) * 107) / 100, true]],
        notes: 'ราคานี้รวมค่าเดินทางในเขตจังหวัดชลบุรีแล้ว',
      }),
      expect: { kind: 'quotation', docNo: 'QT2569-0031', docDate: '2026-10-01', total: Math.round((manySub - 5000) * 107) / 100, subtotal: manySub - 5000, vat: Math.round((manySub - 5000) * 7) / 100 },
    },
    {
      file: 'scan-receipt-taxinv.pdf', type: 'scan',
      html: docHtml({
        title: 'ใบเสร็จรับเงิน / ใบกำกับภาษี', title2: 'RECEIPT / TAX INVOICE',
        customer: 'ได้รับเงินจาก: บริษัท ไทยออยล์ จำกัด (มหาชน)<br>555/1 ถนนวิภาวดีรังสิต แขวงจตุจักร เขตจตุจักร กรุงเทพฯ 10900',
        info: [['เลขที่', 'RC2569/0102'], ['วันที่', '20 ตุลาคม 2569']],
        items: scItems, sum: [['รวมเป็นเงิน', 30000], ['ภาษีมูลค่าเพิ่ม 7%', 2100], ['จำนวนเงินรวมทั้งสิ้น', 32100, true]],
        words: '(สามหมื่นสองพันหนึ่งร้อยบาทถ้วน)',
        notes: 'ชำระโดย: โอนเงิน ธนาคารไทยพาณิชย์ วันที่ 20/10/2569',
      }),
      expect: { kind: 'receipt', docNo: 'RC2569/0102', docDate: '2026-10-20', total: 32100, subtotal: 30000, vat: 2100 },
    },
    {
      file: 'img-receipt-clean.png', type: 'png',
      html: docHtml({
        title: 'ใบเสร็จรับเงิน', title2: 'RECEIPT',
        customer: 'ได้รับเงินจาก: บริษัท ชลบุรี ฟาร์ม จำกัด<br>99 หมู่ 5 ตำบลบ้านบึง อำเภอบ้านบึง จังหวัดชลบุรี 20170',
        info: [['เลขที่', 'RC2569/0103'], ['วันที่', '21/10/2569']],
        items: rcItems, sum: [['รวมเป็นเงิน', 12000], ['ภาษีมูลค่าเพิ่ม 7%', 840], ['จำนวนเงินรวมทั้งสิ้น', 12840, true]],
        words: '(หนึ่งหมื่นสองพันแปดร้อยสี่สิบบาทถ้วน)',
      }),
      expect: { kind: 'receipt', docNo: 'RC2569/0103', docDate: '2026-10-21', total: 12840, subtotal: 12000, vat: 840 },
    },
    {
      file: 'img-quotation-photo.jpg', type: 'photo',
      html: docHtml({
        title: 'ใบเสนอราคา', title2: 'QUOTATION',
        customer: 'ลูกค้า: บริษัท กรีนเอนเนอร์จี จำกัด<br>เรียน: ฝ่ายจัดซื้อ',
        info: [['เลขที่', 'QT2569-0020'], ['วันที่', '9 ต.ค. 2569']],
        items: phItems, sum: [['รวมเป็นเงิน', 60000], ['ภาษีมูลค่าเพิ่ม 7%', 4200], ['จำนวนเงินรวมทั้งสิ้น', 64200, true]],
        words: '(หกหมื่นสี่พันสองร้อยบาทถ้วน)',
      }),
      expect: { kind: 'quotation', docNo: 'QT2569-0020', docDate: '2026-10-09', total: 64200, subtotal: 60000, vat: 4200 },
    },
  ];
}

async function makeSamples(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const { chromium } = loadPlaywright();
  const browser = await chromium.launch();
  try {
    const expected = {};
    for (const s of samples()) {
      const out = path.join(dir, s.file);
      expected[s.file] = { type: s.type, ...s.expect };
      if (s.type === 'pdf') {
        const page = await browser.newPage();
        await page.setContent(s.html, { waitUntil: 'load' });
        await page.pdf({ path: out, format: 'A4', printBackground: true, margin: { top: '14mm', bottom: '14mm', left: '14mm', right: '14mm' } });
        await page.close();
        continue;
      }
      // raster versions: render the page at ~200 dpi first
      const page = await browser.newPage({ viewport: { width: 794, height: 1123 }, deviceScaleFactor: 2.2 });
      await page.setContent(s.html.replace('<body>', '<body style="padding:40px 44px;background:#fff">'), { waitUntil: 'load' });
      const png = await page.screenshot({ fullPage: true, type: 'png' });
      await page.close();
      if (s.type === 'png') {
        fs.writeFileSync(out, png);
        continue;
      }
      const img = `data:image/png;base64,${png.toString('base64')}`;
      if (s.type === 'scan') {
        // greyish paper, slightly skewed and soft, speckled — then printed into a PDF as an image only
        const p = await browser.newPage();
        await p.setContent(`<!doctype html><html><head><style>@page{size:A4;margin:0}html,body{margin:0;background:#fff}
          .s{width:210mm;height:297mm;overflow:hidden;background:#f3f1ea;position:relative}
          .s img{width:100%;transform:rotate(0.7deg) translate(4px,6px);filter:grayscale(1) contrast(1.15) blur(0.5px)}
          canvas{position:absolute;inset:0;width:100%;height:100%;mix-blend-mode:multiply}</style></head>
          <body><div class="s"><img src="${img}"><canvas id="n" width="1240" height="1754"></canvas></div>
          <script>const c=document.getElementById('n').getContext('2d');let r=7;const rnd=()=>(r=(r*16807)%2147483647)/2147483647;
          for(let i=0;i<9000;i++){c.fillStyle='rgba(60,60,60,'+(0.15+rnd()*0.4)+')';c.fillRect(rnd()*1240,rnd()*1754,1+rnd()*1.5,1+rnd()*1.5)}</script></body></html>`, { waitUntil: 'load' });
        await p.pdf({ path: out, width: '210mm', height: '297mm', printBackground: true });
        await p.close();
        continue;
      }
      // a phone photo: on a desk, rotated ~2°, slightly out of focus, JPEG
      const p = await browser.newPage({ viewport: { width: 1300, height: 1750 }, deviceScaleFactor: 1 });
      await p.setContent(`<!doctype html><html><body style="margin:0;background:radial-gradient(circle at 30% 20%,#8a7f70,#5d5449)">
        <img src="${img}" style="position:absolute;left:90px;top:70px;width:1100px;transform:rotate(-2deg);filter:blur(0.9px) brightness(0.96);box-shadow:0 8px 30px rgba(0,0,0,.45)"></body></html>`, { waitUntil: 'load' });
      fs.writeFileSync(out, await p.screenshot({ type: 'jpeg', quality: 72 }));
      await p.close();
    }
    fs.writeFileSync(path.join(dir, 'expected.json'), JSON.stringify(expected, null, 2));
    return expected;
  } finally {
    await browser.close();
  }
}

module.exports = { makeSamples };
if (require.main === module) {
  const dir = process.argv[2];
  if (!dir) {
    console.error('usage: node dev/make-doc-samples.cjs <out-dir>');
    process.exit(1);
  }
  makeSamples(path.resolve(dir)).then((e) => console.log(`made ${Object.keys(e).length} samples in ${dir}`), (e) => {
    console.error(e);
    process.exit(1);
  });
}
