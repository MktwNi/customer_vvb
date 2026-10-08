import { useEffect, useId, useRef, useState, type FormEvent, type InputHTMLAttributes, type KeyboardEvent as ReactKeyboardEvent, type ReactNode, type RefObject } from 'react';
import { useApp, useEngineVersion } from '../state';
import type { GccEngine } from '../lib/engine';
import { ROLE_TH, USER_RE, initials, normUser, passwordChecks } from '../lib/auth';
import { TeamSyncError, deploymentId, errText, type Role } from '../lib/teamSync';
import { PREF, prefs } from '../lib/storage';
import { CONFIG } from '../lib/constants';
import { fmtN, isoTh, localDay, pad } from '../lib/format';
import { Icon, type IconName } from './icons';
import { Modal } from '../tabs/Sales';
import mark from '../assets/gcc-mark.png';

/**
 * Team accounts (Code.gs v3): the screens in front of the app (sign in, first-admin setup, set your
 * password, account disabled), the "session expired" sign-in over the app, and the account dialogs
 * (change password, sign out). The engine does the work; these only collect what it needs.
 */

// ------------------------------------------------------------------ small shared pieces

/** The letter in a person's round badge: a leading "คุณ" is skipped (but not in names such as
 *  "คุณากร"), and so is a Thai vowel written before the first consonant. */
export function nameLetter(name: string) {
  const base = name.replace(/^\s*คุณ(?=\s|[ก-ฮเแโใไ])\s*/, '') || name;
  const ch = Array.from(base).find((c) => /[ก-ฮA-Za-z0-9]/.test(c));
  return ch ? ch.toUpperCase() : initials(name);
}
/** 14:05 (local time) */
export const hhmm = (t: number) => {
  const d = new Date(t);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

export function RoleChip({ role, className = '' }: { role: Role; className?: string }) {
  return <span className={`acct-role acct-${role} ${className}`.trim()}>{ROLE_TH[role]}</span>;
}

/** What went wrong signing in, in Thai; `until` (ms) = locked out until then. */
export function authError(err: unknown): { msg: string; until?: number; code?: string } {
  const name = (err as Error)?.name;
  const code = err instanceof TeamSyncError ? err.code : '';
  if (name === 'TimeoutError' || name === 'AbortError' || code === 'busy') return { msg: 'เซิร์ฟเวอร์ของทีมไม่ตอบกลับ ลองอีกครั้งในอีกสักครู่', code };
  if (err instanceof TeamSyncError && code === 'locked') {
    const until = Date.now() + (Number(err.extra.retryIn) || 900) * 1000;
    return { msg: `ใส่รหัสผ่านผิดหลายครั้ง ลองใหม่ได้เวลา ${hhmm(until)} น. หรือให้ผู้ดูแลระบบปลดล็อก`, until, code };
  }
  if (err instanceof TeamSyncError) return { msg: err.message, code };
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return { msg: 'ออฟไลน์ — ต่ออินเทอร์เน็ตแล้วลองอีกครั้ง', code: 'offline' };
  if (err instanceof TypeError) return { msg: errText(err, 'connect') };
  return { msg: (err as Error)?.message || String(err) };
}

/** Signing in while this browser's data is still loading would race the load: wait for it first. */
function whenReady(e: GccEngine, ms = 60000) {
  if (e.ready) return Promise.resolve();
  return new Promise<void>((res) => {
    const done = () => {
      clearTimeout(t);
      un();
      res();
    };
    const t = setTimeout(done, ms);
    const un = e.subscribe(() => {
      if (e.ready) done();
    });
  });
}

/** False once the component is gone (a sign-in that succeeds replaces the screen it was typed on). */
function useAlive() {
  const r = useRef(true);
  useEffect(() => {
    r.current = true;
    return () => {
      r.current = false;
    };
  }, []);
  return r;
}

const fmtCode = (s: string) => {
  const d = s.replace(/\D/g, '').slice(0, 8);
  return d.length > 4 ? d.slice(0, 4) + '-' + d.slice(4) : d;
};

function Spinner() {
  return <span className="auth-spin" aria-hidden="true" />;
}

function Msg({ kind, children, id }: { kind: 'err' | 'ok' | 'info' | 'warn'; children: ReactNode; id?: string }) {
  const icon: IconName = kind === 'ok' ? 'check' : kind === 'info' ? 'info' : 'alert';
  return (
    <div id={id} className={'auth-msg ' + kind} role={kind === 'err' ? 'alert' : kind === 'ok' ? 'status' : undefined}>
      <Icon name={icon} size={18} />
      <span>{children}</span>
    </div>
  );
}

type FieldProps = { label: string; value: string; onChange: (v: string) => void; hint?: ReactNode; err?: string; inputRef?: RefObject<HTMLInputElement | null> } & Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'>;
function TextField({ label, value, onChange, hint, err, inputRef, ...rest }: FieldProps) {
  const id = useId();
  return (
    <div className="auth-field">
      <label htmlFor={id}>{label}</label>
      <input id={id} ref={inputRef} className="auth-input" value={value} onChange={(ev) => onChange(ev.target.value)} aria-invalid={err ? true : undefined} aria-describedby={hint || err ? id + '-d' : undefined} {...rest} />
      {(err || hint) && <span id={id + '-d'} className={err ? 'auth-field-err' : 'auth-hint'}>{err || hint}</span>}
    </div>
  );
}

/** A password field with a show/hide button; `hints` also warns about Caps Lock and a Thai keyboard. */
function PwField({ label, value, onChange, autoComplete, hints, inputRef, autoFocus, describedBy }: { label: string; value: string; onChange: (v: string) => void; autoComplete: string; hints?: boolean; inputRef?: RefObject<HTMLInputElement | null>; autoFocus?: boolean; describedBy?: string }) {
  const id = useId();
  const [show, setShow] = useState(false);
  const [caps, setCaps] = useState(false);
  const thai = !!hints && /[฀-๿]/.test(value);
  const key = (ev: ReactKeyboardEvent<HTMLInputElement>) => {
    if (hints && typeof ev.getModifierState === 'function') setCaps(ev.getModifierState('CapsLock'));
  };
  return (
    <div className="auth-field">
      <label htmlFor={id}>{label}</label>
      <div className="auth-pw">
        <input
          id={id}
          ref={inputRef}
          className="auth-input"
          type={show ? 'text' : 'password'}
          value={value}
          onChange={(ev) => onChange(ev.target.value)}
          onKeyDown={key}
          onKeyUp={key}
          onBlur={() => setCaps(false)}
          autoComplete={autoComplete}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          autoFocus={autoFocus}
          aria-describedby={[hints ? id + '-h' : '', describedBy || ''].filter(Boolean).join(' ') || undefined}
        />
        <button type="button" className="auth-eye" onClick={() => setShow(!show)} aria-label={show ? 'ซ่อนรหัสผ่าน' : 'แสดงรหัสผ่าน'} title={show ? 'ซ่อนรหัสผ่าน' : 'แสดงรหัสผ่าน'}>
          <Icon name={show ? 'eyeOff' : 'eye'} size={20} />
        </button>
      </div>
      {hints && (
        <span id={id + '-h'} className="auth-hints" aria-live="polite">
          {caps && <span className="auth-kb"><Icon name="alert" size={15} />Caps Lock เปิดอยู่</span>}
          {thai && <span className="auth-kb"><Icon name="alert" size={15} />แป้นพิมพ์เป็นภาษาไทยอยู่หรือเปล่า?</span>}
        </span>
      )}
    </div>
  );
}

/** The live checklist under a new password. */
function Checklist({ pw, confirm, u, name }: { pw: string; confirm: string; u: string; name: string }) {
  const c = passwordChecks(pw, u, name, confirm);
  const rows: [boolean, string][] = [
    [c.len, 'อย่างน้อย 8 ตัวอักษร'],
    [c.notGuessable, 'ไม่ใช่ชื่อผู้ใช้หรือรหัสที่เดาง่าย'],
    [c.match, 'ทั้งสองช่องตรงกัน'],
  ];
  return (
    <ul className="auth-checks" aria-label="เงื่อนไขรหัสผ่านใหม่">
      {rows.map(([ok, t]) => (
        <li key={t} className={ok ? 'ok' : undefined}>
          <span className="auth-tick" aria-hidden="true">{ok && <Icon name="check" size={12} />}</span>
          {t}
          <span className="sr-only">{ok ? ' (ผ่าน)' : ' (ยังไม่ผ่าน)'}</span>
        </li>
      ))}
    </ul>
  );
}
const pwOk = (pw: string, confirm: string, u: string, name: string) => {
  const c = passwordChecks(pw, u, name, confirm);
  return c.len && c.notGuessable && c.match;
};

function SubmitBtn({ busy, disabled, children, busyText }: { busy: boolean; disabled?: boolean; children: ReactNode; busyText: string }) {
  return (
    <button type="submit" className="auth-btn" disabled={busy || disabled} aria-disabled={busy || disabled || undefined}>
      {busy && <Spinner />}
      {busy ? busyText : children}
    </button>
  );
}

/** Edits made on this browser that haven't reached the team yet (the shared queue, and this
 *  account's own), for the line under the sign-in button. */
function useUnsent(url: string, u: string) {
  const { engine: e } = useApp();
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!url) return;
    let live = true;
    const keys = ['teamPending:' + url, ...(USER_RE.test(u) ? ['teamPending:' + url + '#' + u] : [])];
    Promise.all(keys.map((k) => e.store.get<unknown[]>(k).catch(() => null))).then((a) => {
      if (live) setN(a.reduce((s, x) => s + (Array.isArray(x) ? x.length : 0), 0));
    });
    return () => {
      live = false;
    };
  }, [e, url, u]);
  return n;
}

// ------------------------------------------------------------------ full-screen sign-in

/** In front of the app while signed out, setting up the first admin, setting a password or disabled.
 *  `invited`: the team was opened from an invite link (a member, rarely the lead). */
export function AuthScreen({ invited }: { invited?: boolean }) {
  const { engine: e } = useApp();
  useEngineVersion();
  const url = e.authUrl || e.teamCfg?.url || e.session?.url || '';
  const mode = e.auth;
  return (
    <div className="auth">
      <div className="auth-card">
        <BrandPanel url={url} />
        <main className="auth-main" key={mode}>
          {mode === 'login' && <LoginForm url={url} />}
          {mode === 'setup' && <SetupForm askLead={!!invited} />}
          {mode === 'change' && <ChangeForm />}
          {mode === 'disabled' && <Disabled />}
          {(mode === 'login' || mode === 'setup') && <AuthFooter />}
        </main>
      </div>
    </div>
  );
}

const POINTS: [IconName, string][] = [
  ['notes', 'ข้อมูลทีมเก็บใน Google Sheet ของบริษัท'],
  ['user', 'บันทึกชื่อผู้ทำทุกการเปลี่ยนแปลง'],
  ['shield', 'สิทธิ์แยกตามบทบาท: ผู้ดูแลระบบ · พนักงานขาย · ดูอย่างเดียว'],
];
function BrandPanel({ url }: { url: string }) {
  return (
    <section className="auth-brand" aria-label="Global Carbon · ฐานข้อมูลลูกค้า GCC">
      <div className="auth-logo">
        <img src={mark} alt="" width={46} height={46} />
        <span>
          <b>Global Carbon</b>
          <small>ฐานข้อมูลลูกค้า GCC</small>
        </span>
      </div>
      <div className="auth-pitch">
        <p className="auth-headline">ติดตามลูกค้าและงานขายของทีม ในที่เดียว</p>
        <ul className="auth-points">
          {POINTS.map(([ic, t]) => (
            <li key={t}>
              <span className="auth-pt" aria-hidden="true"><Icon name={ic} size={16} /></span>
              {t}
            </li>
          ))}
        </ul>
      </div>
      {url && (
        <span className="auth-team" title={url}>
          <Icon name="link" size={15} />
          ทีม …{deploymentId(url)}
        </span>
      )}
    </section>
  );
}

function LoginForm({ url }: { url: string }) {
  const { engine: e } = useApp();
  const alive = useAlive();
  const last = e.lastUser;
  const [notMe, setNotMe] = useState(false);
  const known = !!last && !notMe;
  const [u, setU] = useState('');
  const [pw, setPw] = useState('');
  const [rm, setRm] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<ReturnType<typeof authError> | null>(null);
  const [view, setView] = useState<'login' | 'recover'>('login');
  const [forgot, setForgot] = useState(false);
  const [, rerender] = useState(0);
  const uRef = useRef<HTMLInputElement>(null);
  const pwRef = useRef<HTMLInputElement>(null);
  const user = known ? last!.u : normUser(u);
  const unsent = useUnsent(url, user);
  const locked = !!err?.until && err.until > Date.now();
  // the sign-in button comes back when the lock ends
  useEffect(() => {
    if (!err?.until) return;
    const t = setTimeout(() => rerender((x) => x + 1), Math.max(0, err.until - Date.now()) + 250);
    return () => clearTimeout(t);
  }, [err]);

  if (view === 'recover') return <RecoverForm onBack={() => setView('login')} />;

  const submit = async (ev: FormEvent) => {
    ev.preventDefault();
    if (busy || locked) return;
    if (!user || !pw) {
      setErr({ msg: 'ใส่ชื่อผู้ใช้และรหัสผ่าน' });
      (user ? pwRef : uRef).current?.focus();
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      await whenReady(e);
      await e.teamLogin(user, pw, rm);
    } catch (x) {
      if (!alive.current) return;
      const r = authError(x);
      setErr(r);
      if (r.code === 'bad_login' || r.code === 'locked') setPw('');
      setBusy(false);
      pwRef.current?.focus();
    }
  };

  return (
    <>
      <header className="auth-head">
        <h1 className="auth-h">เข้าสู่ระบบ</h1>
        <p className="auth-sub">ใช้ชื่อผู้ใช้และรหัสผ่านที่ผู้ดูแลระบบของทีมให้ไว้</p>
      </header>
      {e.authMsg && <Msg kind="info">{e.authMsg}</Msg>}
      <form className="auth-form" onSubmit={submit} noValidate aria-busy={busy || undefined}>
        {known ? (
          <div className="auth-who">
            <span className="auth-ava" aria-hidden="true">{nameLetter(last!.name)}</span>
            <span className="auth-who-t">
              <b>ยินดีต้อนรับกลับ, {last!.name}</b>
              <small>@{last!.u}</small>
            </span>
            <button
              type="button"
              className="auth-link"
              onClick={() => {
                setNotMe(true);
                setErr(null);
                requestAnimationFrame(() => uRef.current?.focus());
              }}
            >
              ไม่ใช่คุณ?
            </button>
            <input type="text" name="username" autoComplete="username" value={last!.u} readOnly hidden />
          </div>
        ) : (
          <TextField
            label="ชื่อผู้ใช้"
            name="username"
            value={u}
            onChange={setU}
            inputRef={uRef}
            autoComplete="username"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            placeholder="เช่น makorn"
            autoFocus={!last}
          />
        )}
        <PwField label="รหัสผ่าน" value={pw} onChange={setPw} autoComplete="current-password" hints inputRef={pwRef} autoFocus={known} />
        <div className="auth-rm">
          <label className="auth-check">
            <input type="checkbox" checked={rm} onChange={(ev) => setRm(ev.target.checked)} aria-describedby="auth-rm-help" />
            <span>จดจำฉันในเครื่องนี้ (30 วัน)</span>
          </label>
          <span id="auth-rm-help" className="auth-hint">เครื่องที่ใช้ร่วมกัน ไม่ต้องเลือก — ระบบจะออกจากระบบเองใน 12 ชั่วโมง</span>
        </div>
        {err && <Msg kind="err">{err.msg}</Msg>}
        <SubmitBtn busy={busy} disabled={locked} busyText="กำลังตรวจสอบ…">
          {locked ? <Icon name="lock" size={18} /> : null}
          เข้าสู่ระบบ
        </SubmitBtn>
        {unsent > 0 && <p className="auth-note">มี {fmtN(unsent)} รายการที่แก้ไว้ในเครื่องนี้ยังไม่ถึงทีม จะส่งให้หลังเข้าสู่ระบบ</p>}
      </form>
      <div className="auth-forgot">
        <button type="button" className="auth-link" aria-expanded={forgot} aria-controls="auth-forgot" onClick={() => setForgot(!forgot)}>
          ลืมรหัสผ่าน?
        </button>
        {forgot && (
          <div id="auth-forgot" className="auth-forgot-box">
            <span>ติดต่อผู้ดูแลระบบของทีมให้ตั้งรหัสผ่านชั่วคราวให้</span>
            <button type="button" className="auth-link" onClick={() => setView('recover')}>
              เป็นผู้ดูแลระบบและลืมรหัสผ่าน?
            </button>
          </div>
        )}
      </div>
    </>
  );
}

/** An admin who forgot the password: a recovery code printed by setup() in Apps Script. */
function RecoverForm({ onBack }: { onBack: () => void }) {
  const { engine: e } = useApp();
  const alive = useAlive();
  const [code, setCode] = useState('');
  const [u, setU] = useState('');
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const submit = async (ev: FormEvent) => {
    ev.preventDefault();
    if (busy) return;
    const user = normUser(u);
    if (code.replace(/\D/g, '').length !== 8) return setErr('ใส่รหัสกู้คืน 8 หลักจาก Execution log');
    if (!USER_RE.test(user)) return setErr('ชื่อผู้ใช้ใช้ได้เฉพาะภาษาอังกฤษตัวเล็ก ตัวเลข . _ - ยาว 3–32 ตัว');
    if (!pwOk(pw, pw2, user, '')) return setErr('รหัสผ่านใหม่ยังไม่ตรงตามเงื่อนไขด้านล่าง');
    setBusy(true);
    setErr('');
    try {
      await whenReady(e);
      await e.teamRecover(code.replace(/\D/g, ''), user, pw, true);
    } catch (x) {
      if (!alive.current) return;
      setErr(authError(x).msg);
      setBusy(false);
    }
  };
  return (
    <>
      <button type="button" className="auth-back" onClick={onBack}>
        <Icon name="collapse" size={18} />
        เข้าสู่ระบบ
      </button>
      <header className="auth-head">
        <h1 className="auth-h">เป็นผู้ดูแลระบบและลืมรหัสผ่าน?</h1>
      </header>
      <ol className="auth-steps">
        <li>เปิด Google Sheet ของทีม → ส่วนขยาย → Apps Script</li>
        <li>เลือกฟังก์ชัน setup แล้วกด Run</li>
        <li>คัดลอกรหัสกู้คืนจาก Execution log (ใช้ได้ 24 ชั่วโมง)</li>
      </ol>
      <form className="auth-form" onSubmit={submit} noValidate aria-busy={busy || undefined}>
        <TextField label="รหัสกู้คืน" value={code} onChange={(v) => setCode(fmtCode(v))} inputMode="numeric" autoComplete="one-time-code" placeholder="1234-5678" className="auth-input auth-code" autoFocus />
        <TextField label="ชื่อผู้ใช้ผู้ดูแล" value={u} onChange={setU} autoComplete="username" autoCapitalize="none" autoCorrect="off" spellCheck={false} />
        <PwField label="รหัสผ่านใหม่" value={pw} onChange={setPw} autoComplete="new-password" hints />
        <PwField label="ยืนยันรหัสผ่านใหม่" value={pw2} onChange={setPw2} autoComplete="new-password" />
        <Checklist pw={pw} confirm={pw2} u={normUser(u)} name="" />
        {err && <Msg kind="err">{err}</Msg>}
        <SubmitBtn busy={busy} busyText="กำลังตรวจสอบ…">ตั้งรหัสผ่านใหม่และเข้าสู่ระบบ</SubmitBtn>
      </form>
    </>
  );
}

const OTHER = '\u0000other';
/** The lead turns accounts on: a one-time code from setup() makes the first admin. */
function SetupForm({ askLead }: { askLead: boolean }) {
  const { engine: e, ui, set } = useApp();
  useEngineVersion();
  const alive = useAlive();
  const [lead, setLead] = useState(!askLead);
  const me0 = prefs.getRaw(PREF.me).trim();
  const legacy = e.ready ? e.legacyNames() : [];
  const names = [...new Set([me0, ...legacy.map((x) => x.name)].filter(Boolean))];
  const cos = new Map(legacy.map((x) => [x.name, x.cos]));
  const [sel, setSel] = useState(me0);
  const [other, setOther] = useState('');
  const [code, setCode] = useState('');
  const [u, setU] = useState('');
  const [uTouched, setUTouched] = useState(false);
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const typed = !names.length || sel === OTHER;
  const name = (typed ? other : sel).trim().replace(/\s+/g, ' ');
  const user = normUser(u);
  const uErr = uTouched && u && !USER_RE.test(user) ? 'ใช้ได้เฉพาะภาษาอังกฤษตัวเล็ก ตัวเลข . _ - ยาว 3–32 ตัว' : '';

  if (!lead)
    return (
      <>
        <header className="auth-head">
          <span className="auth-state-ic" aria-hidden="true"><Icon name="shield" size={26} /></span>
          <h1 className="auth-h">ทีมนี้ยังไม่ได้เปิดใช้บัญชีผู้ใช้</h1>
          <p className="auth-sub">รอหัวหน้าทีมตั้งค่า แล้วเปิดลิงก์เชิญอีกครั้ง</p>
        </header>
        <button type="button" className="auth-btn ghost" onClick={() => setLead(true)}>
          ฉันคือหัวหน้าทีม
        </button>
      </>
    );

  const submit = async (ev: FormEvent) => {
    ev.preventDefault();
    if (busy) return;
    if (code.replace(/\D/g, '').length !== 8) return setErr('ใส่รหัสตั้งค่า 8 หลักจาก Execution log');
    if (!name) return setErr('เลือกหรือพิมพ์ชื่อที่แสดง');
    if (!USER_RE.test(user)) {
      setUTouched(true);
      return setErr('ชื่อผู้ใช้ใช้ได้เฉพาะภาษาอังกฤษตัวเล็ก ตัวเลข . _ - ยาว 3–32 ตัว');
    }
    if (!pwOk(pw, pw2, user, name)) return setErr('รหัสผ่านยังไม่ตรงตามเงื่อนไขด้านล่าง');
    setBusy(true);
    setErr('');
    const prev = ui.tab;
    set({ tab: 'users' }); // where the new admin lands (to create everyone's account)
    try {
      await whenReady(e);
      await e.teamClaim(code.replace(/\D/g, ''), user, name, pw);
    } catch (x) {
      set({ tab: prev });
      if (!alive.current) return;
      setErr(authError(x).msg);
      setBusy(false);
    }
  };

  return (
    <>
      <header className="auth-head">
        <h1 className="auth-h">เปิดใช้บัญชีผู้ใช้ (หัวหน้าทีม)</h1>
      </header>
      <ol className="auth-steps">
        <li>เปิด Google Sheet ของทีม</li>
        <li>ส่วนขยาย → Apps Script</li>
        <li>เลือกฟังก์ชัน setup → กด Run</li>
        <li>คัดลอก <b>รหัสตั้งค่าผู้ดูแลระบบ</b> จาก Execution log</li>
      </ol>
      <form className="auth-form" onSubmit={submit} noValidate aria-busy={busy || undefined}>
        <TextField label="รหัสตั้งค่า" value={code} onChange={(v) => setCode(fmtCode(v))} inputMode="numeric" autoComplete="one-time-code" placeholder="1234-5678" className="auth-input auth-code" autoFocus />
        <div className="auth-field">
          <label htmlFor="setup-name">ชื่อที่แสดง</label>
          {names.length > 0 && (
            <select id="setup-name" className="auth-input auth-select" value={sel} onChange={(ev) => setSel(ev.target.value)} aria-describedby="setup-name-h">
              {!sel && <option value="">เลือกชื่อของคุณ</option>}
              {names.map((n) => (
                <option key={n} value={n}>{n}{cos.get(n) ? ` · ${fmtN(cos.get(n)!)} บริษัท` : ''}</option>
              ))}
              <option value={OTHER}>ชื่ออื่น…</option>
            </select>
          )}
          {typed && (
            <input
              id={names.length ? 'setup-name-other' : 'setup-name'}
              className="auth-input"
              value={other}
              onChange={(ev) => setOther(ev.target.value)}
              maxLength={40}
              aria-label={names.length ? 'ชื่ออื่น' : undefined}
              aria-describedby="setup-name-h"
              autoFocus={sel === OTHER}
            />
          )}
          <span id="setup-name-h" className="auth-hint">ต้องตรงกับชื่อที่ใช้ในข้อมูลเดิม เพื่อให้ประวัติและงานที่ดูแลตามมาด้วย</span>
        </div>
        <TextField
          label="ชื่อผู้ใช้"
          value={u}
          onChange={setU}
          onBlur={() => setUTouched(true)}
          autoComplete="username"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          placeholder="เช่น makorn"
          hint="ภาษาอังกฤษตัวเล็ก ตัวเลข . _ - ยาว 3–32 ตัว"
          err={uErr}
        />
        <PwField label="รหัสผ่าน" value={pw} onChange={setPw} autoComplete="new-password" hints />
        <PwField label="ยืนยันรหัสผ่าน" value={pw2} onChange={setPw2} autoComplete="new-password" />
        <Checklist pw={pw} confirm={pw2} u={user} name={name} />
        <Msg kind="warn">เมื่อเปิดแล้ว รหัสทีมเดิมจะใช้ไม่ได้ ทุกคนต้องเข้าสู่ระบบด้วยบัญชีของตัวเอง — สร้างบัญชีให้ทุกคนต่อทันที</Msg>
        {err && <Msg kind="err">{err}</Msg>}
        <SubmitBtn busy={busy} busyText="กำลังสร้างบัญชี…">สร้างบัญชีผู้ดูแลและเข้าสู่ระบบ</SubmitBtn>
      </form>
    </>
  );
}

/** Signed in with a temporary password: set your own before starting. */
function ChangeForm() {
  const { engine: e } = useApp();
  const alive = useAlive();
  const s = e.session;
  const name = s?.name || '', u = s?.u || '';
  // the temporary password typed at sign-in is still known in this tab: only the new one is asked
  const [needOld] = useState(() => !e.knowsTempPassword);
  const [old, setOld] = useState('');
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const submit = async (ev: FormEvent) => {
    ev.preventDefault();
    if (busy) return;
    if (needOld && !old) return setErr('ใส่รหัสผ่านชั่วคราวที่ได้จากผู้ดูแลระบบ');
    if (needOld && old === pw) return setErr('รหัสผ่านใหม่ต้องไม่เหมือนรหัสเดิม');
    if (!pwOk(pw, pw2, u, name)) return setErr('รหัสผ่านใหม่ยังไม่ตรงตามเงื่อนไขด้านล่าง');
    setBusy(true);
    setErr('');
    try {
      await whenReady(e);
      await e.teamChangePassword(needOld ? old : '', pw);
    } catch (x) {
      if (!alive.current) return;
      const r = authError(x);
      setErr(r.code === 'wrong_password' && needOld ? 'รหัสผ่านชั่วคราวไม่ถูกต้อง' : r.msg);
      setBusy(false);
    }
  };
  return (
    <>
      <header className="auth-head">
        <span className="auth-state-ic" aria-hidden="true"><Icon name="key" size={26} /></span>
        <h1 className="auth-h">ตั้งรหัสผ่านของคุณ</h1>
        <p className="auth-sub">{name} · รหัสผ่านชั่วคราวใช้ได้ครั้งเดียว ตั้งรหัสผ่านใหม่ก่อนเริ่มใช้งาน</p>
      </header>
      <form className="auth-form" onSubmit={submit} noValidate aria-busy={busy || undefined}>
        <input type="text" name="username" autoComplete="username" value={u} readOnly hidden />
        {needOld && <PwField label="รหัสผ่านชั่วคราว" value={old} onChange={setOld} autoComplete="current-password" hints autoFocus />}
        <PwField label="รหัสผ่านใหม่" value={pw} onChange={setPw} autoComplete="new-password" hints autoFocus={!needOld} />
        <PwField label="ยืนยันรหัสผ่านใหม่" value={pw2} onChange={setPw2} autoComplete="new-password" />
        <Checklist pw={pw} confirm={pw2} u={u} name={name} />
        {err && <Msg kind="err">{err}</Msg>}
        <SubmitBtn busy={busy} busyText="กำลังบันทึก…">บันทึกและเริ่มใช้งาน</SubmitBtn>
      </form>
      <div className="auth-foot">
        <button type="button" className="auth-link" onClick={() => e.teamLogout()}>
          ออกจากระบบ
        </button>
      </div>
    </>
  );
}

function Disabled() {
  const { engine: e } = useApp();
  const [busy, setBusy] = useState(false);
  return (
    <>
      <header className="auth-head">
        <span className="auth-state-ic bad" aria-hidden="true"><Icon name="lock" size={26} /></span>
        <h1 className="auth-h">บัญชีนี้ถูกปิดการใช้งาน</h1>
        <p className="auth-sub">ติดต่อผู้ดูแลระบบของทีม</p>
      </header>
      {e.session && (
        <div className="auth-who">
          <span className="auth-ava" aria-hidden="true">{nameLetter(e.session.name)}</span>
          <span className="auth-who-t">
            <b>{e.session.name}</b>
            <small>@{e.session.u}</small>
          </span>
        </div>
      )}
      <button
        type="button"
        className="auth-btn"
        disabled={busy}
        onClick={() => {
          setBusy(true);
          e.teamLogout().finally(() => setBusy(false));
        }}
      >
        {busy && <Spinner />}
        ออกจากระบบ
      </button>
    </>
  );
}

/** Leave the sign-in screen: back to the team still connected (team code), or to this browser only. */
function AuthFooter() {
  const { engine: e } = useApp();
  const [ask, setAsk] = useState(false);
  const yes = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (ask) yes.current?.focus();
  }, [ask]);
  const back = !!e.teamCfg;
  return (
    <div className="auth-foot">
      {ask ? (
        <div className="auth-confirm" role="group" aria-labelledby="auth-leave-q">
          <p id="auth-leave-q">ยกเลิกการเชื่อมต่อทีมนี้? ข้อมูลที่เคยซิงก์ยังอยู่ในเบราว์เซอร์นี้ รายการที่ยังไม่ส่งจะเก็บไว้ส่งเมื่อเข้าสู่ระบบครั้งหน้า</p>
          <div>
            <button ref={yes} type="button" className="auth-btn sm" onClick={() => e.teamCancelAuth()}>
              ยกเลิกการเชื่อมต่อ
            </button>
            <button type="button" className="auth-btn sm ghost" onClick={() => setAsk(false)}>
              ไม่ยกเลิก
            </button>
          </div>
        </div>
      ) : (
        <>
          <button type="button" className="auth-link" onClick={() => (back ? e.teamCancelAuth() : setAsk(true))}>
            {back ? 'กลับไปที่แอป' : 'ใช้งานแบบไม่เชื่อมทีม (ข้อมูลอยู่ในเครื่องนี้)'}
          </button>
          <a className="auth-link" href={CONFIG.teamGuideUrl} target="_blank" rel="noopener noreferrer">
            วิธีใช้งาน
          </a>
        </>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ over the app

/** The session ended (expired, signed out elsewhere): sign in again as the same account. Edits keep
 *  queuing meanwhile; the dialog can be put aside (the team chip in the top bar brings it back). */
export function ReLogin({ onClose }: { onClose: () => void }) {
  const { engine: e } = useApp();
  useEngineVersion();
  const alive = useAlive();
  const s = e.session;
  const n = e.teamPendingN;
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<ReturnType<typeof authError> | null>(null);
  const [, rerender] = useState(0);
  const pwRef = useRef<HTMLInputElement>(null);
  const locked = !!err?.until && err.until > Date.now();
  useEffect(() => {
    if (!err?.until) return;
    const t = setTimeout(() => rerender((x) => x + 1), Math.max(0, err.until - Date.now()) + 250);
    return () => clearTimeout(t);
  }, [err]);
  if (!s) return null;
  const submit = async (ev: FormEvent) => {
    ev.preventDefault();
    if (busy || locked) return;
    if (!pw) {
      setErr({ msg: 'ใส่รหัสผ่าน' });
      pwRef.current?.focus();
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      await e.teamLogin(s.u, pw, s.rm);
    } catch (x) {
      if (!alive.current) return;
      const r = authError(x);
      setErr(r);
      if (r.code === 'bad_login' || r.code === 'locked') setPw('');
      setBusy(false);
      pwRef.current?.focus();
    }
  };
  return (
    <Modal title="หมดเวลาการเข้าระบบ" onClose={onClose} width={440}>
      <form className="auth-form dlg" onSubmit={submit} noValidate aria-busy={busy || undefined}>
        <p className="auth-sub">{n > 0 ? `งานที่แก้ไว้ ${fmtN(n)} รายการยังอยู่ในเครื่อง จะส่งหลังเข้าสู่ระบบ` : 'หมดเวลาการเข้าระบบ กรุณาเข้าสู่ระบบอีกครั้ง'}</p>
        <div className="auth-field">
          <label htmlFor="relogin-u">ชื่อผู้ใช้</label>
          <div className="auth-ro">
            <span className="auth-ava sm" aria-hidden="true">{nameLetter(s.name)}</span>
            <input id="relogin-u" className="auth-ro-in" name="username" autoComplete="username" value={s.u} readOnly aria-describedby="relogin-name" />
            <span id="relogin-name" className="auth-ro-name">{s.name}</span>
          </div>
        </div>
        <PwField label="รหัสผ่าน" value={pw} onChange={setPw} autoComplete="current-password" hints inputRef={pwRef} autoFocus />
        {err && <Msg kind="err">{err.msg}</Msg>}
        <SubmitBtn busy={busy} disabled={locked} busyText="กำลังตรวจสอบ…">เข้าสู่ระบบ</SubmitBtn>
        <button type="button" className="auth-link center" onClick={() => e.teamLogout()}>
          ใช้บัญชีอื่น
        </button>
      </form>
    </Modal>
  );
}

/** เปลี่ยนรหัสผ่าน from the account menu. */
export function ChangePasswordDialog({ onClose }: { onClose: () => void }) {
  const { engine: e } = useApp();
  const alive = useAlive();
  const s = e.session;
  const [old, setOld] = useState('');
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [done, setDone] = useState(false);
  const doneRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (done) doneRef.current?.focus();
  }, [done]);
  const name = s?.name || '', u = s?.u || '';
  const submit = async (ev: FormEvent) => {
    ev.preventDefault();
    if (busy) return;
    if (!old) return setErr('ใส่รหัสผ่านปัจจุบัน');
    if (old === pw) return setErr('รหัสผ่านใหม่ต้องไม่เหมือนรหัสเดิม');
    if (!pwOk(pw, pw2, u, name)) return setErr('รหัสผ่านใหม่ยังไม่ตรงตามเงื่อนไขด้านล่าง');
    setBusy(true);
    setErr('');
    try {
      await e.teamChangePassword(old, pw);
      if (alive.current) setDone(true);
    } catch (x) {
      if (alive.current) setErr(authError(x).msg);
    } finally {
      if (alive.current) setBusy(false);
    }
  };
  return (
    <Modal title="เปลี่ยนรหัสผ่าน" onClose={onClose} width={460}>
      {done ? (
        <div className="auth-form dlg">
          <Msg kind="ok">เปลี่ยนรหัสผ่านแล้ว</Msg>
          <button ref={doneRef} type="button" className="auth-btn" onClick={onClose}>
            เสร็จ
          </button>
        </div>
      ) : (
        <form className="auth-form dlg" onSubmit={submit} noValidate aria-busy={busy || undefined}>
          <input type="text" name="username" autoComplete="username" value={u} readOnly hidden />
          <PwField label="รหัสผ่านปัจจุบัน" value={old} onChange={setOld} autoComplete="current-password" hints />
          <PwField label="รหัสผ่านใหม่" value={pw} onChange={setPw} autoComplete="new-password" hints />
          <PwField label="ยืนยันรหัสผ่านใหม่" value={pw2} onChange={setPw2} autoComplete="new-password" />
          <Checklist pw={pw} confirm={pw2} u={u} name={name} />
          <p className="auth-note"><Icon name="alert" size={15} /> เครื่องอื่นที่เข้าสู่ระบบไว้จะถูกออกจากระบบ</p>
          {err && <Msg kind="err">{err}</Msg>}
          <div className="auth-row">
            <SubmitBtn busy={busy} busyText="กำลังบันทึก…">เปลี่ยนรหัสผ่าน</SubmitBtn>
            <button type="button" className="auth-btn ghost" onClick={onClose}>
              ยกเลิก
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}

/** ออกจากระบบ: say what hasn't reached the team; optionally wipe this browser's copy of the team
 *  data (shared computer) and sign out the account's other browsers. */
export function LogoutDialog({ onClose }: { onClose: () => void }) {
  const { engine: e } = useApp();
  useEngineVersion();
  const s = e.session;
  const n = e.teamPendingN;
  const [sending, setSending] = useState(false);
  const [wipe, setWipe] = useState(() => !s?.rm);
  const [drop, setDrop] = useState(false);
  const [all, setAll] = useState(false);
  const [busy, setBusy] = useState(false);
  const started = useRef(false);
  // send what is queued while the person decides
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    if (!e.teamPendingN || e.auth || (typeof navigator !== 'undefined' && navigator.onLine === false)) return;
    setSending(true);
    e.teamSyncNow()
      .catch(() => {})
      .finally(() => setSending(false));
  }, [e]);
  const go = async () => {
    setBusy(true);
    try {
      await e.teamLogout({ all, wipe, dropUnsent: wipe && drop });
    } finally {
      onClose();
    }
  };
  return (
    <Modal title="ออกจากระบบ" onClose={busy ? () => {} : onClose} width={480} focus="dialog">
      <div className="auth-form dlg">
        {n === 0 ? (
          <Msg kind="ok">ข้อมูลที่คุณแก้ถึงทีมครบแล้ว</Msg>
        ) : sending ? (
          <div className="auth-msg info" role="status">
            <Spinner />
            <span>กำลังส่ง {fmtN(n)} รายการที่ค้าง…</span>
          </div>
        ) : (
          <Msg kind="warn">ยังมี {fmtN(n)} รายการที่ส่งไม่ได้ (ออฟไลน์) จะเก็บไว้ในเครื่องนี้และส่งเมื่อคุณเข้าสู่ระบบครั้งหน้า</Msg>
        )}
        <div className="auth-opts">
          <label className="auth-check">
            <input type="checkbox" checked={wipe} onChange={(ev) => setWipe(ev.target.checked)} />
            <span>ลบข้อมูลทีมที่เก็บไว้ในเครื่องนี้ (แนะนำสำหรับคอมพิวเตอร์ที่ใช้ร่วมกัน)</span>
          </label>
          {wipe && n > 0 && (
            <label className="auth-check sub">
              <input type="checkbox" checked={drop} onChange={(ev) => setDrop(ev.target.checked)} />
              <span>ลบรายการที่ยังไม่ได้ส่งด้วย (จะหายถาวร)</span>
            </label>
          )}
          <label className="auth-check">
            <input type="checkbox" checked={all} onChange={(ev) => setAll(ev.target.checked)} />
            <span>ออกจากระบบทุกเครื่องของฉันด้วย</span>
          </label>
        </div>
        <div className="auth-row">
          <button type="button" className="auth-btn danger" onClick={go} disabled={busy}>
            {busy && <Spinner />}
            {busy ? 'กำลังออกจากระบบ…' : 'ออกจากระบบ'}
          </button>
          <button type="button" className="auth-btn ghost" onClick={onClose} disabled={busy}>
            ยกเลิก
          </button>
        </div>
      </div>
    </Modal>
  );
}

/** The signed-in account in one line (used on the update page): "เข้าสู่ระบบในชื่อ … · role". */
export function SignedInAs({ name, role }: { name: string; role: Role }) {
  return (
    <span className="acct-line">
      <span className="acct-ava sm" aria-hidden="true">{nameLetter(name)}</span>
      <span>
        เข้าสู่ระบบในชื่อ <b>{name}</b> · {ROLE_TH[role]}
      </span>
    </span>
  );
}

/** "จดจำในเครื่องนี้ถึง …" / "ออกจากระบบอัตโนมัติเวลา … น." for the account menu. */
export function sessionLine(s: { rm: boolean; exp: number }) {
  if (!s.exp) return '';
  return s.rm ? `จดจำในเครื่องนี้ถึง ${isoTh(localDay(new Date(s.exp).toISOString()))}` : `ออกจากระบบอัตโนมัติเวลา ${hhmm(s.exp)} น.`;
}
