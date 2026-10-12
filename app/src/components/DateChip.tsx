import { useRef, type KeyboardEvent } from 'react';
import { addDays, isoTh, todayISO } from '../lib/format';

/**
 * A date as Thai text on a button ("8 ต.ค. 2569", design §7.10): one tab stop with its own focus ring.
 * A click (Enter / Space) opens the browser's calendar of a hidden date input; ↑ / ↓ move it a day.
 * `text` replaces the label (e.g. "วันนี้ 8 ต.ค. 2569"); `label` names it for screen readers.
 */
export function DateChip({ value, onChange, label, text, className = '', id, empty = 'ใส่วันที่' }: { value: string; onChange: (iso: string) => void; label: string; text?: string; className?: string; id?: string; empty?: string }) {
  const inp = useRef<HTMLInputElement>(null);
  const open = () => {
    const el = inp.current;
    if (!el) return;
    try {
      el.showPicker();
    } catch {
      // an older browser without showPicker: its own field takes the keys
      el.focus();
      el.click();
    }
  };
  const key = (ev: KeyboardEvent) => {
    if (ev.key !== 'ArrowUp' && ev.key !== 'ArrowDown') return;
    ev.preventDefault();
    onChange(addDays(value || todayISO(), ev.key === 'ArrowUp' ? 1 : -1));
  };
  const shown = text ?? (value ? isoTh(value) : empty);
  return (
    <span className={'sl-dc ' + className}>
      <button type="button" id={id} className={'sl-datechip hv' + (value ? '' : ' empty')} onClick={open} onKeyDown={key} aria-label={`${label} ${value ? isoTh(value) : 'ยังไม่ระบุ'} — เปลี่ยน`} title="เลือกวันที่ · ลูกศรขึ้นลงเลื่อนทีละวัน">
        {shown}
      </button>
      <input ref={inp} type="date" tabIndex={-1} aria-hidden="true" className="sl-dc-in" value={value} onChange={(ev) => ev.target.value && onChange(ev.target.value)} />
    </span>
  );
}
