import { useEffect, useRef, type ReactNode } from 'react';
import { commitFocus, isTopDialog, useDialog } from './useDialog';
import { Icon } from './icons';

/**
 * A dialog (design §7.11): white, radius 20, title 18/500, × in a grey circle; the primary action at the
 * bottom right, "ยกเลิก" quiet. Same behaviour as the Sales Tracker's own Modal (tabs/Sales.tsx), which
 * can become a re-export of this one.
 */
export function Modal({ title, children, onClose, width = 520, focus }: { title: string; children: ReactNode; onClose: () => void; width?: number; focus?: 'field' | 'dialog' }) {
  const ref = useRef<HTMLDivElement>(null);
  useDialog(ref, { focus });
  // Escape closes this dialog only (not the panel underneath)
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const kd = (ev: KeyboardEvent) => {
      if (ev.key !== 'Escape' || !isTopDialog(ref.current)) return;
      ev.stopPropagation();
      commitFocus();
      closeRef.current();
    };
    document.addEventListener('keydown', kd, true);
    return () => document.removeEventListener('keydown', kd, true);
  }, []);
  return (
    <>
      <div className="dlg-back" onClick={onClose} />
      <div ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-label={title} className="dlg" style={{ width: `min(${width}px,94vw)` }}>
        <div className="dlg-head">
          <span className="dlg-t">{title}</span>
          <button type="button" onClick={onClose} aria-label="ปิด" className="dlg-x">
            <Icon name="close" size={18} />
          </button>
        </div>
        {children}
      </div>
    </>
  );
}

/** The right-hand end of a dialog: "ยกเลิก" quiet, then the primary. */
export function DialogActions({ children }: { children: ReactNode }) {
  return <div className="dlg-act">{children}</div>;
}
