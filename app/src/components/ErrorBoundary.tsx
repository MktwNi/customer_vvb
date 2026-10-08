import { Component, type ReactNode } from 'react';

/** If one screen fails to draw (e.g. a malformed record), show a message on that screen instead of a
 *  blank page; the rest of the app keeps working and the person can go elsewhere or reload. */
export class ErrorBoundary extends Component<{ children: ReactNode; resetKey: string }, { error: Error | null; key: string }> {
  state = { error: null as Error | null, key: this.props.resetKey };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  static getDerivedStateFromProps(p: { resetKey: string }, s: { error: Error | null; key: string }) {
    return p.resetKey !== s.key ? { error: null, key: p.resetKey } : null; // a new screen starts clean
  }
  componentDidCatch(error: Error) {
    console.error('screen failed', error);
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div role="alert" style={{ background: '#FBE3DC', color: '#8A2B12', borderRadius: 16, padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: 10, fontSize: 14 }}>
        <b style={{ fontWeight: 500 }}>หน้านี้แสดงผลไม่ได้</b>
        <span style={{ lineHeight: 1.6 }}>มีข้อมูลบางรายการที่อ่านไม่ได้ ข้อมูลอื่นยังอยู่ครบ ลองโหลดหน้าใหม่ หรือไปเมนูอื่นก่อน ถ้ายังเป็นอยู่ แจ้งผู้ดูแลพร้อมข้อความนี้: {String(this.state.error.message || this.state.error).slice(0, 200)}</span>
        <button onClick={() => location.reload()} className="btn sm" style={{ alignSelf: 'flex-start', borderColor: '#8A2B12', color: '#8A2B12', '--hv': '#FDF0EB' }}>โหลดหน้าใหม่</button>
      </div>
    );
  }
}
