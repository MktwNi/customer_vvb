# ฐานข้อมูลลูกค้า GCC (GCC Registry)

เว็บสำหรับทีมขายใช้ติดตามลูกค้า CFO / GI / โรงงานใหม่ (กรอ.) / บริษัทจดทะเบียน (SET) ในที่เดียว
สร้างจากแบบที่ออกแบบใน Claude Design

**เว็บ:** https://mktwni.github.io/customer_vvb/

> ⚠️ เว็บนี้เป็นสาธารณะ ใครมีลิงก์ก็เปิดดูข้อมูลบริษัท เบอร์โทร และอีเมลในเว็บได้

## โครงสร้าง

| โฟลเดอร์ | คืออะไร |
| --- | --- |
| `app/` | ตัวเว็บ (React + Vite + TypeScript) — ดูวิธีรันและโครงสร้างโค้ดใน [`app/README.md`](app/README.md) |
| `project/data/` | ไฟล์ข้อมูลที่เว็บใช้ (`gcc.json`, `gcc-certs.json`, `gcc-detail/`, `rounds.json`, …) |
| `project/*.dc.html`, `project/*.js` | ไฟล์ต้นแบบจาก Claude Design (ใช้อ้างอิงหน้าตาและการทำงาน) |
| `.github/workflows/deploy-pages.yml` | build และขึ้นเว็บบน GitHub Pages อัตโนมัติทุกครั้งที่ push เข้า `main` |

ไฟล์ Excel ต้นฉบับ (`project/uploads/`) และบันทึกการคุยออกแบบ (`chats/`) ไม่ได้เก็บไว้ใน repo นี้

## รันบนเครื่อง

```bash
cd app
npm install
npm run dev     # http://localhost:5173
npm test
```

## อัปเดตข้อมูลบนเว็บ

แก้หรือแทนที่ไฟล์ใน `project/data/` แล้ว push เข้า `main` — ระบบจะ build และขึ้นเว็บใหม่ให้เอง
(การอัปโหลด Excel ในแท็บ "อัปเดตข้อมูล" บนเว็บ จะเก็บไว้ในเบราว์เซอร์เครื่องนั้นเท่านั้น)
