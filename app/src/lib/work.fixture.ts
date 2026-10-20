/**
 * The investigation's tracker (owner: one quotation for 10 companies), shared by the work-count tests
 * (work.test.ts) and the screens' parity test (workUi.test.ts): 5 ordinary closed jobs (3 YES, 2 NO), คงธนา's own
 * open job, and one joint quotation of 10 companies (QT-2569-099 style, 1,000,000 paid by มจพ), closed unless
 * asked. Test data only (imported by tests, never by the app).
 */
import { emptySales, filterDeals, jointOf, newDeal, type Deal, type JointMember, type SalesState } from './sales';

export const T = '2026-10-12';
export const PAYER = 'มหาวิทยาลัยเทคโนโลยีพระจอมเกล้าพระนครเหนือ';
export const M = (at: string): JointMember => ({ share: null, pct: null, at, by: 'หมิว' });
export const MEMBERS: [string, string, string, number | null][] = [
  ['m1', 'บริษัท บางกอกสตีล เวิร์คส์ จำกัด', 'หมิว', null],
  ['m2', 'บริษัท อุดร ไบโอแมส จำกัด', 'คุณบี', null],
  ['m3', 'บริษัท ไทยเท็กซ์ไทล์ อินดัสตรี จำกัด', 'ปลา', null],
  ['m4', 'บริษัท สยามฟู้ดส์ แปรรูป จำกัด', 'มกร', null],
  ['m5', 'บริษัท คงธนา เซอร์วิส จำกัด', 'มกร', 11],
  ['m6', 'บริษัท ซันฟีด จำกัด', 'หมิว', 24],
  ['m7', 'บริษัท ทอสเท็มไทย จำกัด', 'หมิว', 45],
  ['m8', 'บริษัท นิธิฟู้ดส์ จำกัด', 'หมิว', 57],
  ['m9', 'บริษัท ดั๊บเบิ้ล เอ (1991) จำกัด', 'หมิว', 38],
  ['m10', 'บริษัท ซีพีแรม จำกัด', 'หมิว', 30],
];
export const IDS = MEMBERS.map((x) => x[0]);
/**
 * `members`: each company's result ('' none); `closed`: the joint quotation closed (header and companies);
 * `payer`: the payer's result.
 */
export function world(o: { members?: ('YES' | 'NO' | '')[]; closed?: boolean; payer?: 'YES' | 'NO' | '' } = {}): SalesState {
  const s = emptySales();
  const add = (id: string, p: Partial<Deal>) => (s.deals[id] = newDeal({ id, year: '2569', section: 'Event Exhibition', ...p, client: p.client || id }, 'หมิว', '2026-09-01T03:00:00.000Z'));
  const res = (id: string, r: string, d = '2026-10-01') => r && (s.steps[`${id}/CLOSED DEAL`] = { d, n: r });
  // the ordinary jobs closed this year: 3 won, 2 lost
  ([
    ['c1', 'บริษัท อมตะ คอร์ปอเรชัน จำกัด', 'ปลา', 'YES', 240000, '2026-08-20'],
    ['c2', 'บริษัท พฤกษา โฮลดิ้ง จำกัด', 'คุณเอ', 'YES', 180000, '2026-10-06'],
    ['c3', 'บริษัท สหพัฒน์ จำกัด', 'คุณบี', 'NO', 60000, '2026-09-16'],
    ['c4', 'บริษัท ดับบลิวเอชเอ จำกัด', 'หมิว', 'YES', 95000, '2026-04-30'],
    ['c5', 'บริษัท บ้านปู จำกัด', 'คุณเอ', 'NO', 150000, '2026-10-08'],
  ] as const).forEach(([id, client, resp, r, fc, day], i) => {
    add(id, { client, resp, forecast: fc, actual: r === 'YES' ? fc : null, jobStatus: 'closed', closedDate: day, section: 'Retention', order: i });
    res(id, r);
  });
  // คงธนา's own job of the year (open, with its money): the same company as its row in the joint quotation
  add('o1', { client: 'บริษัท คงธนา เซอร์วิส จำกัด', gid: 11, resp: 'มกร', forecast: 250000, section: 'อื่นๆ', order: 9 });
  // the joint quotation: the payer's row (the header) and its 10 companies
  add('h', { client: PAYER, resp: 'หมิว', forecast: 1000000, actual: 1000000, order: 1 });
  s.jqt = { h: { title: 'CFP 10 บริษัท (มจพ)', at: '2026-10-01T03:00:00.000Z', by: 'หมิว' } };
  s.jqm = {};
  MEMBERS.forEach(([id, client, resp, gid], i) => {
    add(id, { client, resp, gid, order: 20 + i });
    s.jqm![`h/${id}`] = M(`2026-10-01T03:00:${String(i).padStart(2, '0')}.000Z`);
    res(id, o.members?.[i] || '', '2026-10-12');
  });
  res('h', o.payer ?? 'YES', '2026-10-05');
  if (o.closed !== false) [...IDS, 'h'].forEach((id) => (s.deals[id] = { ...s.deals[id], jobStatus: 'closed', closedDate: T }));
  return s;
}
export const yes10 = () => world({ members: IDS.map(() => 'YES') });
export const b82 = () => world({ members: IDS.map((_, i) => (i === 2 || i === 3 ? 'NO' : 'YES')) });
export const none = () => world({});
export const closed = (s: SalesState, F: Record<string, unknown> = {}) => filterDeals(s, { year: '2569', job: 'closed', ...F }, T);
/** The joint quotation of the fixture. */
export const grp = (s: SalesState) => {
  const g = jointOf(s, { id: 'h' });
  if (!g) throw new Error('no joint quotation');
  return g;
};
