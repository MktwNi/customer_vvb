# Handoff: CFO Registry (ทะเบียนองค์กรที่ได้รับการรับรองคาร์บอนฟุตพริ้นท์ขององค์กร)

## Overview
เว็บไซต์ภายในสำหรับค้นหา ตรวจสอบสถานะ ติดตามวันหมดอายุ และติดต่อองค์กรที่ได้รับการรับรอง CFO จากเว็บไซต์ฉลากคาร์บอน อบก. (4,367 รายการ ณ 5 ต.ค. 2569) ปัจจุบันเป็นต้นแบบแบบ static: ข้อมูลอยู่ในไฟล์ JSON และการแก้ไขเก็บใน IndexedDB ของเบราว์เซอร์ เป้าหมายของงานนี้คือทำเป็นเว็บจริงที่มี **ฐานข้อมูลกลาง + ระบบล็อกอิน + สิทธิ์การเข้าถึงข้อมูล**

## About the Design Files
ไฟล์ในชุดนี้เป็น **ต้นแบบดีไซน์ที่สร้างด้วย HTML** แสดงหน้าตาและพฤติกรรมที่ต้องการ ไม่ใช่โค้ด production ให้นำไปสร้างใหม่ในสภาพแวดล้อมของโปรเจกต์ (แนะนำ Next.js + TypeScript + Supabase ถ้ายังไม่มีโปรเจกต์) โดยใช้ pattern และไลบรารีของโปรเจกต์นั้น
- `CFO Registry.dc.html` เป็น "Design Component": markup อยู่ใน `<x-dc>` และ logic อยู่ใน `class Component` ใน `<script data-dc-script>` รันด้วย `support.js` (React runtime ของเครื่องมือออกแบบ) เปิดผ่าน local server ได้ เช่น `npx serve .`
- logic ทั้งหมด (filter, facet, status, overview, import) อ่านได้ใน class นั้นและใน `cfo-import.js`

## Fidelity
**High-fidelity.** สี ตัวอักษร ระยะ และการโต้ตอบเป็นค่าสุดท้าย ให้สร้างใหม่ให้ตรงตามต้นแบบ

---

## เป้าหมายหลักของงานนี้: การเข้าถึงข้อมูล

### 1. ฐานข้อมูล (แนะนำ Supabase / Postgres)
```sql
create table certificates (
  id            text primary key,          -- รหัสรายการในเว็บ อบก. (คีย์จับคู่ตอน import)
  seq           int,                       -- ลำดับในไฟล์
  cert_no       text,                      -- เลขที่ใบรับรอง (ซ้ำได้ ไม่ใช่ unique)
  activity      text,
  org_name      text not null,
  org_key       text,                      -- ชื่อ normalize สำหรับรวมประวัติองค์กร (ดู normalizeOrg ด้านล่าง)
  branch        text,
  province      text,                      -- จังหวัดจากการ์ดในเว็บ
  address       text, tambon text, amphoe text, province_addr text, zipcode text,
  industry      text, size text,
  approved_be   text, expires_be text,     -- dd/mm/yyyy พ.ศ. ตามเว็บ
  approved_on   date, expires_on date,     -- ค.ศ.
  scope1_pct numeric, scope2_pct numeric, scope3_pct numeric,  -- 0–100, null = ไม่มีข้อมูล
  top_scope     text,
  fy            text,                      -- FY26 จากเลขที่ใบรับรอง
  data_note     text, card_extra text,
  source        text default 'tgo',        -- 'tgo' | 'manual'
  updated_at    timestamptz default now(),
  updated_by    uuid references auth.users
);
create index on certificates (org_key);
create index on certificates (expires_on);
-- full-text / trigram สำหรับค้นหา
create extension if not exists pg_trgm;
create index on certificates using gin ((org_name||' '||coalesce(cert_no,'')||' '||coalesce(activity,'')||' '||coalesce(address,'')) gin_trgm_ops);

create table contacts (
  certificate_id text primary key references certificates(id) on delete cascade,
  phone text, email text, source text, source_url text, search_note text,
  updated_at timestamptz default now(), updated_by uuid references auth.users
);

create table watchlist (            -- แทน localStorage 'cfo-watch'
  user_id uuid references auth.users, certificate_id text references certificates(id),
  created_at timestamptz default now(), primary key (user_id, certificate_id)
);

create table audit_log (            -- ทุกการแก้ไข/import
  id bigserial primary key, user_id uuid, action text, table_name text,
  record_id text, before jsonb, after jsonb, created_at timestamptz default now()
);

create table profiles (
  id uuid primary key references auth.users, full_name text,
  role text not null default 'viewer' check (role in ('viewer','editor','admin'))
);
```
**สถานะไม่ต้องเก็บในฐานข้อมูล** ให้คำนวณจาก `expires_on` เทียบกับวันที่อ้างอิงที่ผู้ใช้เลือก (ดู Status logic)

### 2. สิทธิ์ (Row Level Security)
| บทบาท | ดูทะเบียน | ดูเบอร์/อีเมล | แก้ข้อมูลติดต่อ | เพิ่มรายการ / import | จัดการผู้ใช้ |
|---|---|---|---|---|---|
| viewer | ✓ | ✓ (ปรับเป็น ✗ ได้ถ้าต้องการ) | ✗ | ✗ | ✗ |
| editor | ✓ | ✓ | ✓ | ✓ (merge) | ✗ |
| admin | ✓ | ✓ | ✓ | ✓ (merge + replace + revert) | ✓ |
- เปิด RLS ทุกตาราง; `select` ต้องล็อกอิน; `insert/update` ต้องมี role editor ขึ้นไป; `watchlist` ให้เห็นเฉพาะของตัวเอง (`user_id = auth.uid()`)
- ล็อกอินด้วย Supabase Auth (email magic link หรือ Google Workspace) และจำกัดโดเมนอีเมลขององค์กร
- เขียน trigger บันทึก `audit_log` ทุก update/insert ของ `certificates` และ `contacts`

### 3. API / Server actions
- `GET /api/certificates?q&industry&province&size&fy&top&status&soonDays&ref&contact&expMonth&noted&renew&scopeless&sort&page` คืนรายการ + facet counts + KPI (คำนวณใน SQL หรือ RPC)
- `GET /api/certificates/:id` รายละเอียด + contacts + ประวัติองค์กร (`org_key` เดียวกัน)
- `GET /api/overview?...filters&ref&soonDays` ข้อมูลกราฟ (cross-filter: แต่ละกราฟไม่ใช้ filter ของมิติตัวเอง)
- `PUT /api/contacts/:id` (editor+)
- `POST /api/certificates` เพิ่มทีละรายการ (editor+), `source='manual'`, id = `M` + random
- `POST /api/import` รับ .xlsx/.csv → parse ฝั่ง server (ใช้ logic เดียวกับ `cfo-import.js`, แนะนำ SheetJS) → คืน preview (รายการใหม่/ตรงกับเดิม/มีข้อมูลติดต่อ) → `POST /api/import/:jobId/apply?mode=merge|replace` (replace = admin เท่านั้น) ทำใน transaction
- `GET /api/export.csv?...filters` (UTF-8 BOM, หัวคอลัมน์ภาษาไทยตามต้นแบบ)

### 4. ย้ายข้อมูลเริ่มต้น
- `data/cfo.json` = `{asOf, source, dicts:{ind,size,prov,status,fy,top}, rows:[[...26 ฟิลด์]]}` ลำดับฟิลด์ใน rows:
  `seq, cert_no, activity, org_name, branch, provI, address, tambon, amphoe, province_addr, zipcode, indI, sizeI, approved_be, expires_be, approved_on, expires_on, s1, s2, s3, topI, statusI(ไม่ใช้), fyI, data_note, id, card_extra` (ฟิลด์ที่ลงท้าย I เป็น index ใน dicts)
- `data/contacts.json` = `{ [id]: [phone, email, source, source_url, search_note] }`
- เขียน seed script อ่านสองไฟล์นี้ หรืออ่าน xlsx ต้นฉบับ `uploads/TGO_CFO_list_2569-10-05_contacts.xlsx` (ชีต "ข้อมูล CFO" คอลัมน์ A–AF)

---

## Screens / Views
แท็บ 5 หน้า (pill nav ในส่วนหัว): ค้นหาทะเบียน · ภาพรวม · รายการติดตาม · อัปเดตข้อมูล · วิธีใช้ & หมายเหตุ  และ drawer รายละเอียด (ภาพประกอบอยู่ใน `guide/`)

### ส่วนหัว (ทุกหน้า)
- แถบบนสุด `#0a241c` สูง ~34px: ข้อความแหล่งข้อมูล + "ข้อมูล ณ {date} · {count} รายการ"
- Header `#0d2f25` padding 30/28/22, วงกลมเส้นตกแต่ง `rgba(197,236,106,.14)` มุมขวาบน
- ป้าย "CFO REGISTRY" pill lime `oklch(0.89 0.16 128)` ตัวอักษร `#16300a` 12px/600 letter-spacing .14em
- H1 Kanit 34px/600 line-height 1.25 บรรทัด 2 สี lime
- กล่อง "วันที่อ้างอิงสถานะ": `rgba(255,255,255,.06)` border `rgba(255,255,255,.14)` radius 18; date input + select ช่วงใกล้หมด (30/60/90/180) + ปุ่มลัด วันนี้/วันที่ดึงข้อมูล/+3/+6 เดือน/+1 ปี (active = พื้น lime)
- Nav: กล่อง `rgba(0,0,0,.18)` radius 999 padding 5; ปุ่ม 38px; active พื้นขาว ตัวอักษร `#0d2f25`; badge จำนวนรายการติดตาม

### 1. ค้นหาทะเบียน
- KPI: flex wrap — การ์ด hero (flex 1 1 340px, `#0d2f25`, ตัวเลข 44px lime, แถบ stacked อยู่ในอายุ/ใกล้หมด) + grid 3×2 การ์ดขาว (ทั้งหมด, ใกล้หมดอายุ, หมดอายุ, ไม่ระบุ, มีข้อมูลติดต่อแล้ว, มีข้อสังเกต) radius 18 border 2px (active `#1b5745`) — กดเพื่อกรอง
- การ์ดค้นหา radius 20: ช่องค้นหา 52px radius 14 พื้น `#f7f8f4` + kbd "/" ; "ลองค้นหา" chips; grid 4×2 = 7 select ตัวกรอง (แสดงจำนวนแบบ facet) + select เรียงลำดับ; chips toggle; ปุ่มส่งออก CSV `#0d2f25`
- ตาราง: min-width 1200, columns `140px minmax(280px,1fr) 100px 140px 130px 120px 120px 36px` gap 14; หัวตาราง `#f5f6f2`; แถว hover `#f7f9f3`; ไฮไลต์คำค้น `oklch(0.93 0.13 128)`; ป้าย "☎ ติดต่อได้", "N ใบ"; status pill; ปุ่ม ☆ วงกลม 34px; pagination 25/หน้า

### 2. ภาพรวม (cross-filter dashboard)
- แถบตัวกรอง sticky (chips × ลบได้, ล้างทั้งหมด, "ดูรายชื่อ N รายการในตาราง →")
- การ์ดเข้มเต็มกว้าง: กราฟ 12 เดือนจากวันที่อ้างอิง (lime / amber เมื่อมีรายการในช่วงใกล้หมด), กดเดือน = filter expMonth
- columns:2 (masonry) การ์ด: ใกล้หมดอายุที่สุด 7 รายการ, อนุมัติใหม่ใน 30 วัน, สัดส่วนเฉลี่ย + สถานะ (กดได้), อุตสาหกรรม (bar total/active), จังหวัด top 12, ปีงบประมาณ FY17–30
- กดแท่ง = toggle filter มิตินั้น; ค่าอื่นจางลง (`#a9bfb4` / `#e6ebe5`) ค่าที่เลือก `#1b5745` + `#b7d08f`, ตัวหนา

### 3. รายการติดตาม
- grid auto-fill minmax(360px) การ์ด radius 18 แถบสถานะบน 4px เรียงตามวันหมดอายุ; empty state มีปุ่มไปดูใกล้หมดอายุ
- **ในเวอร์ชันจริง: เก็บในตาราง `watchlist` ต่อผู้ใช้**

### 4. อัปเดตข้อมูล (editor+)
- การ์ดเข้มสถานะข้อมูลปัจจุบัน + ดาวน์โหลด/ย้อนกลับ
- วิธี 1 อัปโหลด (dropzone dashed `#b9c9a6` พื้น `#f7fbf1`) → preview 4 กล่อง → merge / replace
- วิธี 2 ฟอร์มเพิ่มทีละรายการ grid 2 คอลัมน์ + รายการที่เพิ่มเอง (ลบได้)
- วิธี 3 คำอธิบายการแก้ข้อมูลติดต่อจาก drawer
- **ในเวอร์ชันจริง: ตัดข้อความ "บันทึกในเบราว์เซอร์นี้" และปุ่มดาวน์โหลด JSON ออก แทนด้วยประวัติการ import จาก audit_log**

### 5. วิธีใช้ & หมายเหตุ
- คู่มือ 9 หัวข้อ (ข้อความ + ภาพใน `guide/`) และรายการหมายเหตุที่มาของข้อมูล (ข้อความ verbatim อยู่ในค่าคงที่ `NOTES`)

### Drawer รายละเอียด
- fixed ขวา inset 12px กว้าง min(560px) radius 22; header เข้ม (เลขที่ + ปุ่มคัดลอก, ชื่อ 21px, สถานะ, ติดตาม)
- การ์ดข้อมูลติดต่อ (border `#d9e6c8` พื้น `#f7fbf1`): ปุ่มโทร `tel:` (9 หลัก / 10 หลักถ้าขึ้นต้น 06/08/09), อีเมล `mailto:` + subject, คัดลอก, ฟอร์มแก้ไข, ปุ่มค้นหา Google เมื่อไม่มีข้อมูล, แหล่งที่มา/URL
- อายุใบรับรอง (progress), สัดส่วน 3 ประเภท, ประวัติใบรับรององค์กร (กดสลับ), ตารางฟิลด์, กล่องข้อสังเกต amber
- Esc / คลิกพื้นหลัง = ปิด

## Interactions & Behavior
- **Status logic** (ทุกหน้า, ขึ้นกับ `ref` และ `win`): ไม่มี expires_on → ไม่ระบุ; `expires_on >= ref` → อยู่ในอายุ; อยู่ในอายุและ `days <= win` → ใกล้หมดอายุ; อื่นๆ → หมดอายุ. `days = round((expires_on - ref)/1 วัน)`
- **Facet counts**: จำนวนในแต่ละตัวเลือกนับจากรายการที่ผ่านตัวกรองอื่นทั้งหมด ยกเว้นมิติของตัวเอง; ซ่อนตัวเลือกที่เป็น 0 (ยกเว้นตัวที่เลือกอยู่)
- **ค้นหา**: แยกคำด้วยช่องว่าง ทุกคำต้องพบ (AND) ใน cert/activity/org/address/zip/province/industry/phone/email (case-insensitive)
- **normalizeOrg**: `org.replace(/\((สำนักงานใหญ่|สาขา[^)]*|\d{5}[^)]*)\)/g,'').replace(/บริษัท|จำกัด|\(มหาชน\)|มหาชน|[\s.,()]/g,'').toLowerCase()`
- **ยังไม่ต่ออายุ**: ใบล่าสุด (expires_on มากสุด) ของ org_key หมดอายุแล้ว และไม่มีใบใดใน org_key ที่อยู่ในอายุ
- **Import**: จับคอลัมน์จากชื่อหัว (alias ใน `KEYS` ของ `cfo-import.js`), หาแถวหัวที่มี "ชื่อองค์กร", ถ้า ≥90% ของค่า scope ≤ 1 ให้คูณ 100, วันที่รับได้ทั้ง serial Excel, dd/mm/yyyy (พ.ศ./ค.ศ.), yyyy-mm-dd; merge = อัปเดตเฉพาะฟิลด์ที่ไม่ว่าง
- คีย์ลัด: `/` โฟกัสช่องค้นหา, `Esc` ปิด drawer
- Loading: "กำลังโหลดข้อมูลทะเบียน…"; empty states มีในตาราง รายการติดตาม และการ์ดภาพรวม; error ตอน import แสดงกล่อง `#fbe3dc`

## State Management
`ref, win, q, ind, prov, size, fy, status('',0,'soon',1,2), top, ct('',any,phone,email,both,notfound,pending), noted, soon, renew, scopeless, expM('YYYY-MM'), sort(default|old|exp|name), page, sel, editC, tab` — แนะนำเก็บตัวกรองใน URL query string เพื่อแชร์ลิงก์ได้

## Design Tokens
- Font: **Kanit** 300/400/500/600/700 (Google Fonts) ทั้งเว็บ
- พื้นหลัง `#eef0eb`, การ์ด `#fff`, เส้น `#e1e4dc` / `#eef0ea`, input border `#d3d8cd`
- เขียวเข้ม `#0d2f25` / `#0a241c` / `#1b5745`; lime `oklch(0.89 0.16 128)`; amber `oklch(0.8 0.14 75)`
- Text `#0f1a16`, `#3a3f39`, `#5c605a`, `#7a7e77`
- Status pills: อยู่ในอายุ `#e2f2d0`/`#2f6a12`, ใกล้หมด `#fdecc8`/`#9a5a00`, หมดอายุ `#ebece8`/`#5c605a`, ไม่ระบุ `#f2f1ec`/`#8b8d86`
- Scope: 1 `oklch(0.68 0.14 40)`, 2 `oklch(0.68 0.14 250)`, 3 `oklch(0.68 0.14 150)`
- Radius: 999 (pill), 22 drawer, 20 section, 18 card, 14 search/inner, 10–12 input
- Shadow: drawer `0 20px 60px rgba(0,0,0,.25)`

## Assets
ไม่มีไอคอน/ภาพในตัว UI (ใช้ตัวอักษร ☎ ★ ☆ @ ×) ภาพหน้าจอคู่มืออยู่ใน `guide/g1…g9.png` (ถ่ายจากต้นแบบ ควรถ่ายใหม่หลังทำเวอร์ชันจริง)

## Files
- `CFO Registry.dc.html` — ต้นแบบหลัก (template + logic)
- `support.js` — runtime สำหรับเปิดต้นแบบ
- `cfo-import.js` — parser xlsx/csv, แปลงชุดข้อมูล, IndexedDB helper
- `data/cfo.json`, `data/contacts.json` — ข้อมูลเริ่มต้น
- `guide/` — ภาพประกอบคู่มือ
- `CLAUDE_CODE_PROMPT.md` — prompt สำหรับเริ่มงานใน Claude Code
