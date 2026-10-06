# Prompt สำหรับวางใน Claude Code

```
อ่าน README.md ในโฟลเดอร์นี้ให้ครบก่อน แล้วเปิด "CFO Registry.dc.html" และ cfo-import.js เพื่อดู logic จริง

สร้างเว็บแอป CFO Registry ด้วย Next.js (App Router, TypeScript) + Supabase ให้หน้าตาและพฤติกรรมตรงกับต้นแบบ โดย:
1. สร้าง migration SQL ตาม schema ใน README (certificates, contacts, watchlist, audit_log, profiles) พร้อม RLS ตามตารางสิทธิ์ viewer/editor/admin และ trigger audit_log
2. เขียน seed script อ่าน data/cfo.json + data/contacts.json เข้า Supabase
3. ระบบล็อกอิน Supabase Auth (magic link) จำกัดโดเมนอีเมล @<โดเมนองค์กร> และหน้า admin จัดการ role
4. ทำหน้า ค้นหาทะเบียน / ภาพรวม / รายการติดตาม / อัปเดตข้อมูล / วิธีใช้ & หมายเหตุ และ drawer รายละเอียด ตาม README
   - filter, facet counts, status ตามวันที่อ้างอิง และ cross-filter ของภาพรวม ให้คำนวณฝั่ง server (SQL/RPC)
   - เก็บตัวกรองใน URL query
   - watchlist เก็บต่อผู้ใช้ในฐานข้อมูล
   - import xlsx/csv ฝั่ง server (SheetJS) มี preview ก่อน apply, merge = editor, replace = admin, ทำใน transaction
   - แก้ข้อมูลติดต่อได้จาก drawer (editor+) และบันทึก audit
5. ใช้ฟอนต์ Kanit และ design tokens ใน README
ทำทีละขั้น เริ่มจาก schema + seed + auth แล้วค่อยทำ UI
```

## สิ่งที่ต้องเตรียม
- บัญชี Supabase (สร้างโปรเจกต์ใหม่ แล้วนำ URL + anon key + service role key ใส่ `.env.local`)
- โดเมนอีเมลขององค์กรที่อนุญาตให้ล็อกอิน
- รายชื่อผู้ใช้ที่จะเป็น editor / admin
- ที่ deploy (แนะนำ Vercel เชื่อม GitHub)
