import type { TeamDir } from '../../lib/engine';

/**
 * ผู้ใช้และสิทธิ์ › การแจ้งเตือน (package notify). A placeholder in this release: the section says what it
 * will hold and that it needs the team script's update; the notification settings replace it.
 */
export function NotifyAdmin({ dir }: { dir: TeamDir | null }) {
  return (
    <section className="us-card us-honest" aria-labelledby="rl-nf-h">
      <h3 id="rl-nf-h" className="us-h">การแจ้งเตือนทางอีเมล</h3>
      <ul>
        <li>ส่งอีเมลเมื่อมีใบเสนอราคาใหม่รอตรวจ และสรุปงวดเงินกับนัดหมายทุกเช้าวันทำการ</li>
        <li>ผู้รับคือบัญชีที่มีสิทธิ์ “รับอีเมลแจ้งเตือน” และยืนยันอีเมลแล้ว{dir?.v4 ? '' : ' (ใส่อีเมลของแต่ละคนได้หลังอัปเดตสคริปต์ของทีม)'}</li>
        <li>ตั้งค่าส่วนนี้ได้เมื่อเปิดใช้การแจ้งเตือน ซึ่งต้องอัปเดตสคริปต์ของทีม (Code.gs) และให้สิทธิ์ส่งอีเมล 1 ครั้ง</li>
      </ul>
    </section>
  );
}
