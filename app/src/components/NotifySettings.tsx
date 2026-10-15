import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { useApp, useEngineVersion } from '../state';
import { DIGEST_TIMES, type MyNotify, type Scope } from '../lib/notify';
import { TeamSyncError, errText } from '../lib/teamSync';
import { EMAIL_RE } from '../tabs/users/shared';
import { Modal } from './Dialog';
import { Select } from './Select';
import { Check } from './Pop';
import { Notice, Segmented } from './ui';

const SCOPES: { v: Scope; label: string }[] = [
  { v: 'mine', label: 'งานที่ฉันรับผิดชอบ' },
  { v: 'team', label: 'ทั้งทีม' },
];

/** One switch of "ส่งอะไรให้ฉันทางอีเมล": a checkbox with its words, and a control beside it (the time). */
function Row({ on, dis, title, sub, onChange, ctl }: { on: boolean; dis?: boolean; title: string; sub: string; onChange: (v: boolean) => void; ctl?: ReactNode }) {
  const id = useId();
  return (
    <div className={'ns-row' + (on ? ' on' : ' off') + (dis ? ' dis' : '')}>
      <label className="ns-l">
        <input type="checkbox" className="sr-only" checked={on} disabled={dis} onChange={(ev) => onChange(ev.target.checked)} aria-describedby={id} />
        <Check on={on} />
        <span className="ns-t">{title}</span>
        <span className="ns-s" id={id}>{sub}</span>
      </label>
      {ctl && <span className="ns-c">{ctl}</span>}
    </div>
  );
}

/**
 * การแจ้งเตือนของฉัน (package notify, screen 05): the address the e-mails go to (confirmed with a 6-digit
 * code the script mails it), which e-mails to get (new quotations to check — checkers only; results of my
 * quotations; the morning digest at a chosen time; a reminder 1 hour before a timed appointment) and whose
 * instalments and appointments (mine or the whole team, also the bell's). Saved to the team script
 * (notify_me, online only: these are the account's own settings, not team records). Before the script
 * has notifications only the bell's scope can be set, in this browser.
 */
export function NotifySettings({ onClose }: { onClose: () => void }) {
  const { engine: e } = useApp();
  useEngineVersion();
  const cur = e.myNotify();
  const [em, setEm] = useState(cur.em);
  const [on, setOn] = useState<MyNotify['on']>(cur.on);
  const [t, setT] = useState(cur.t);
  const [sc, setSc] = useState<Scope>(e.bellScope());
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');
  // a script without notifications (it does not know notify_me, and says no `notify`)
  const [old, setOld] = useState(!e.notifyLive && !e.myNotifyLive);
  const [offline, setOffline] = useState(typeof navigator !== 'undefined' && navigator.onLine === false);
  const touched = useRef(false);
  const tid = useId();
  const touch = () => {
    touched.current = true;
    setErr('');
  };
  // what the script has now (another device may have changed it)
  useEffect(() => {
    if (old || offline) return;
    let live = true;
    e.notifyMe().then(
      (nf) => {
        if (!live || touched.current) return;
        setEm(nf.em);
        setOn(nf.on);
        setT(nf.t);
        setSc(nf.sc);
      },
      (x) => {
        if (!live) return;
        if (x instanceof TeamSyncError && x.code === 'unknown_action') setOld(true);
        else if (x instanceof TypeError) setOffline(true);
      },
    );
    return () => {
      live = false;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const mailCap = e.can('notify.mail');
  const checker = e.can('qt.check');
  const live = !!e.notifyLive?.on;
  const mail = em.trim();
  const isNew = mail !== cur.em;
  const now = e.myNotify(); // after a save or a confirmation
  const pendingCode = !!now.em && !now.ok && mail === now.em;

  const run = async (k: string, f: () => Promise<void>) => {
    setBusy(k);
    setErr('');
    setMsg('');
    try {
      await f();
    } catch (x) {
      setErr(errText(x, 'connect'));
    } finally {
      setBusy('');
    }
  };
  const save = () => {
    if (old) {
      e.setBellScope(sc);
      return onClose();
    }
    if (mail && !EMAIL_RE.test(mail)) return setErr('อีเมลไม่ถูกต้อง');
    run('save', async () => {
      await e.saveNotifyMe({ on, t, sc, ...(isNew && mailCap ? { em: mail } : {}) });
      // a new address waits for its code here; otherwise done
      if (isNew && mailCap && mail) setMsg(`ส่งรหัส 6 หลักไปที่ ${mail} แล้ว ใส่รหัสในช่อง “รหัส 6 หลักจากอีเมล” ใต้อีเมลด้านบน เพื่อเริ่มรับอีเมล`);
      else onClose();
    });
  };
  const verify = () => run('code', async () => {
    await e.verifyEmail(code);
    setCode('');
    setMsg('ยืนยันอีเมลแล้ว ระบบจะเริ่มส่งการแจ้งเตือนไปที่อีเมลนี้');
  });
  const resend = () => run('resend', async () => {
    await e.saveNotifyMe({ on, t, sc, em: mail });
    setMsg(`ส่งรหัสใหม่ไปที่ ${mail} แล้ว`);
  });
  const test = () => run('test', async () => {
    await e.notifyTest();
    setMsg(`ส่งอีเมลทดสอบไปที่ ${now.em} แล้ว ถ้าไม่เห็นใน 5 นาที ดูในโฟลเดอร์สแปม`);
  });
  const set1 = (k: keyof MyNotify['on']) => (v: boolean) => {
    touch();
    setOn((o) => ({ ...o, [k]: v }));
  };
  const dis = old || !mailCap;

  return (
    <Modal title="การแจ้งเตือนของฉัน" onClose={busy ? () => {} : onClose} width={620}>
      <div className="ns">
        {old && <p className="ns-old">อีเมลแจ้งเตือนใช้ได้หลังผู้ดูแลระบบอัปเดตสคริปต์ของทีม ตอนนี้ตั้งได้เฉพาะว่ากระดิ่งในเว็บแสดงงานของใคร (เก็บไว้ในเบราว์เซอร์นี้)</p>}
        {!old && offline && <Notice kind="warn" role="status">ต้องออนไลน์เพื่อดูและบันทึกการแจ้งเตือน เพราะเป็นการตั้งค่าของบัญชี ไม่ใช่ข้อมูลทีม</Notice>}
        {!old && (
          <div className="ns-sec">
            <label className="ns-h" htmlFor={tid + 'm'}>อีเมลที่รับแจ้งเตือน</label>
            {mailCap ? (
              <>
                <div className="ns-mail">
                  <input
                    id={tid + 'm'}
                    className="fld"
                    type="email"
                    value={em}
                    autoComplete="email"
                    placeholder="name@example.com"
                    onChange={(ev) => (touch(), setEm(ev.target.value))}
                    disabled={offline}
                  />
                  {!isNew && now.em && (now.ok ? (
                    <span className="ns-ok"><i aria-hidden="true" />ยืนยันแล้ว</span>
                  ) : (
                    <span className="ns-ok wait"><i aria-hidden="true" />รอยืนยันอีเมล</span>
                  ))}
                </div>
                {pendingCode && !isNew ? (
                  <div className="ns-code">
                    <label htmlFor={tid + 'c'}>รหัส 6 หลักจากอีเมล</label>
                    <input id={tid + 'c'} className="fld" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(ev) => setCode(ev.target.value.replace(/\D/g, ''))} />
                    <button type="button" className="btn sm" disabled={code.length !== 6 || !!busy} onClick={verify}>ยืนยัน</button>
                    <button type="button" className="lnk" disabled={!!busy} onClick={resend}>ส่งรหัสใหม่</button>
                  </div>
                ) : null}
                <span className="ns-meta">เปลี่ยนอีเมลแล้ว ระบบจะส่งรหัส 6 หลักไปที่อีเมลใหม่ ใส่รหัสนั้นที่นี่ก่อนจึงเริ่มส่ง · ไม่ส่งอีเมลถึงลูกค้าเด็ดขาด</span>
              </>
            ) : (
              <span className="ns-meta">บทบาทนี้ไม่รับอีเมล กระดิ่งในเว็บยังแจ้งเตือนตามปกติ</span>
            )}
          </div>
        )}
        {!old && (
          <div className="ns-sec">
            <span className="ns-h">ส่งอะไรให้ฉันทางอีเมล</span>
            <div className="ns-rows">
              {checker && <Row on={on.qt} dis={dis} title="ใบเสนอราคาใหม่รอตรวจ" sub="ส่งภายใน 10 นาที เมื่อมีคนแนบหรือแก้ใบเสนอราคา · เฉพาะผู้ตรวจ" onChange={set1('qt')} />}
              <Row on={on.res} dis={dis} title="ผลตรวจใบเสนอราคาที่ฉันแนบ" sub="ตรวจแล้ว หรือ ส่งกลับแก้ไข" onChange={set1('res')} />
              <Row
                on={on.dg}
                dis={dis}
                title="สรุปวันนี้: งวดเงินและนัดหมาย"
                sub="อีเมลเดียวต่อวัน วันจันทร์–ศุกร์ · วันไหนไม่มีเรื่องจะไม่ส่ง"
                onChange={set1('dg')}
                ctl={<Select label="เวลาส่งสรุป" variant="tool" search={false} value={t} disabled={dis || !on.dg} onChange={(v) => (touch(), setT(v))} options={DIGEST_TIMES.map((x) => ({ v: x, label: x }))} />}
              />
              <Row on={on.pre} dis={dis} title="เตือนอีกครั้งก่อนนัด 1 ชั่วโมง" sub="เฉพาะนัดที่ระบุเวลา" onChange={set1('pre')} />
            </div>
          </div>
        )}
        <div className="ns-sec">
          <span className="ns-h" id={tid + 's'}>งวดเงินและนัดหมายของใคร</span>
          <Segmented label="งวดเงินและนัดหมายของใคร" value={sc} options={SCOPES} onChange={(v) => (touch(), setSc(v))} />
          <span className="ns-meta">ใช้กับ{old ? '' : 'อีเมลสรุปและ'}กระดิ่งในเว็บ · งานที่ฉันรับผิดชอบ คือบริษัทที่ช่องผู้รับผิดชอบเป็นชื่อฉัน</span>
        </div>
        {msg && <Notice kind="ok" role="status">{msg}</Notice>}
        {err && <Notice kind="error" role="alert">{err}</Notice>}
        <div className="ns-foot">
          {!old && live && mailCap && now.em && now.ok && (
            <button type="button" className="lnk" disabled={!!busy || offline} onClick={test}>ส่งอีเมลทดสอบ</button>
          )}
          <span className="sp" />
          <button type="button" className="quiet" onClick={onClose} disabled={!!busy}>ยกเลิก</button>
          <button type="button" className="btn pri" onClick={save} disabled={!!busy || (!old && offline)}>
            {busy === 'save' && <span className="auth-spin" aria-hidden="true" />}
            บันทึก
          </button>
        </div>
      </div>
    </Modal>
  );
}
