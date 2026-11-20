import { useRef, useState } from 'react';
import { UAT } from '../lib/uat';

/**
 * ระบบงานทวนสอบ GCC (repo MktwNi/gcc-case-demo): the live system, its accounts invited by GCC, its data in
 * GCC's own database; and its test copy, sample data kept in the browser only, nothing sent anywhere.
 */
export const VVB_APP = 'https://mktwni.github.io/gcc-case-demo/app/';
export const VVB_DEMO = 'https://mktwni.github.io/gcc-case-demo/';

/**
 * งานทวนสอบ inside this site (owner, Nov 2569: "รวมมาเป็นงานเดียวกันเลย ไม่ต้องแยกลิงค์อะไรแล้ว", step 1 of
 * the merge): the verification system opens in this page, for the accounts with mp.view (Sidebar pageOk).
 * It still signs in with its own account, once on each browser (it keeps the session). The UAT copy opens
 * the system's test copy, so trying the site never touches the system's real cases.
 * Both are on mktwni.github.io, the same origin as this site.
 */
export function Vvb() {
  const box = useRef<HTMLDivElement>(null);
  const [loaded, setLoaded] = useState(false);
  const src = UAT ? VVB_DEMO : VVB_APP;
  const full = () => {
    const el = box.current;
    if (el && el.requestFullscreen) el.requestFullscreen().catch(() => undefined);
  };
  return (
    <div className="vvb">
      <header className="vvb-head">
        <div className="vvb-t">
          <h1 id="page-title">งานทวนสอบ</h1>
          <p>{UAT ? 'ระบบงาน VVB GCC ชุดทดลอง ใช้ข้อมูลสมมุติ สิ่งที่กรอกเก็บไว้ในเบราว์เซอร์นี้เท่านั้น' : 'ระบบงาน VVB GCC · เข้าสู่ระบบด้วยบัญชีที่ GCC เชิญ ครั้งแรกครั้งเดียวในแต่ละเครื่อง'}</p>
        </div>
        <button type="button" className="btn" onClick={full}>เต็มหน้าจอ</button>
      </header>
      <div className="vvb-box" ref={box}>
        {!loaded && <p className="vvb-wait">กำลังเปิดระบบงานทวนสอบ</p>}
        <iframe title="ระบบงานทวนสอบ GCC" src={src} onLoad={() => setLoaded(true)} allow="fullscreen; clipboard-write" />
      </div>
    </div>
  );
}
