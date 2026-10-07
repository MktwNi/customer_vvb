import type { CfoStatus, FeedKey, StageKey, TaskType } from './types';

/** UI defaults (the design's "Tweaks" panel). */
export const CONFIG = {
  pageSize: 50,
  density: 'comfortable' as 'comfortable' | 'compact',
  soonWindow: 90,
  /** Setup guide for the shared team sheet (team-sync/README.md). */
  teamGuideUrl: 'https://github.com/MktwNi/customer_vvb/blob/main/team-sync/README.md',
};

/** Source bit order: TGO=1, GI=2, กรอ.=4, SET=8 → [label, bg, fg] */
export const SRCC: [string, string, string][] = [
  ['TGO', '#1A3FE0', '#fff'],
  ['GI', '#BFF3EE', '#0B6E66'],
  ['กรอ.', '#E6ECFD', '#1A2FB0'],
  ['SET', '#0E1F7A', '#fff'],
  ['เพิ่มเอง', '#FFF4DC', '#6B4100'], // customers added by hand (not in the registry files)
];
export const SRC_SUB = ['ใบรับรอง CFO', 'อุตสาหกรรมสีเขียว', 'โรงงานใหม่ 2567–2569', 'บริษัทจดทะเบียน'];

export const TGT = [
  'CFO ใกล้หมดอายุ',
  'CFO หมดอายุไม่เกิน 12 เดือน',
  'CFO หมดอายุเกิน 12 เดือน',
  'CFO อยู่ในอายุ',
  'ยังไม่มี CFO · บริษัทจดทะเบียน SET/mai',
  'ยังไม่มี CFO · GI ระดับ 3–5',
  'ยังไม่มี CFO · โรงงานใหม่ ลงทุน ≥ 5 ล้านบาท',
  'ยังไม่มี CFO · GI ระดับ 2',
  'อื่นๆ',
];
export const GDESC = [
  'ใบล่าสุดยังไม่หมดอายุ แต่จะหมดภายในช่วงที่ตั้งไว้ ถึงรอบทวนสอบปีถัดไป',
  'ไม่มีใบที่ยังใช้ได้ ใบล่าสุดหมดอายุไม่เกิน 365 วัน เคยทำแล้ว ยังไม่ต่อ',
  'ใบล่าสุดหมดอายุเกิน 365 วัน หรือไม่ระบุวันหมดอายุ',
  'มีใบที่ยังใช้ได้และเหลือมากกว่าช่วงที่ตั้งไว้',
  'บริษัทจดทะเบียน SET/mai ที่ยังไม่เคยมี CFO',
  'ได้ GI ระดับ 3–5 ที่ยังใช้ได้ แต่ยังไม่มี CFO',
  'โรงงานเริ่มประกอบกิจการตั้งแต่ ม.ค. 2567 เงินลงทุนรวม ≥ 5 ล้านบาท',
  'ได้ GI ระดับ 2 ที่ยังใช้ได้ แต่ยังไม่มี CFO',
  'ไม่เข้าเงื่อนไขข้อ 1–8 (ส่วนใหญ่เป็น GI ระดับ 1)',
];
/** Target-group colours: [badgeBg, badgeFg, bar] */
export const GCOL: [string, string, string][] = [
  ['#1A3FE0', '#fff', '#1A3FE0'], ['#2A63FF', '#fff', '#2A63FF'], ['#7C93FF', '#0A1A86', '#7C93FF'],
  ['#34D1C4', '#0B4E48', '#34D1C4'], ['#0E1F7A', '#fff', '#0E1F7A'], ['#1FB5C9', '#0A1A86', '#1FB5C9'],
  ['#4E9BFF', '#0A1A86', '#4E9BFF'], ['#B9C8FF', '#0A1A86', '#B9C8FF'], ['#E3E7F1', '#475069', '#C9D1E6'],
];
export const tgtName = (i: number, W: number) =>
  i === 0 ? `CFO ใกล้หมดอายุ (≤ ${W} วัน)` : i === 3 ? `CFO อยู่ในอายุ (> ${W} วัน)` : TGT[i];

export const GI_COL: Record<number, [string, string]> = {
  5: ['#0B6E66', '#fff'], 4: ['#1FB5C9', '#fff'], 3: ['#BFF3EE', '#0B6E66'], 2: ['#E6ECFD', '#1A2FB0'], 1: ['#EEF1F8', '#475069'],
};

/** Sales stages: [key, label, bg, fg] */
export const STG: [StageKey, string, string, string][] = [
  ['none', 'ยังไม่ติดต่อ', '#EEF1F8', '#475069'],
  ['contacted', 'ติดต่อแล้ว', '#E6ECFD', '#1A2FB0'],
  ['interested', 'สนใจ', '#DDF5F1', '#0B6E66'],
  ['proposal', 'ส่งใบเสนอราคา', '#FDECC8', '#9A5A00'],
  ['won', 'ได้งาน', '#0B6E66', '#fff'],
  ['lost', 'ไม่สนใจ', '#F2E3E0', '#8A2B12'],
];
/** Appointment types: [key, label, colour] */
export const TT: [TaskType, string, string][] = [
  ['call', 'โทร', '#1A3FE0'],
  ['email', 'อีเมล', '#1FB5C9'],
  ['meet', 'นัดพบ', '#E8A23B'],
  ['follow', 'ติดตามผล', '#7C93FF'],
];
/** Contact-log entry types: [label, colour] */
export const LOG_TYPES: Record<string, [string, string]> = {
  call: ['โทร', '#1A3FE0'], email: ['อีเมล', '#1FB5C9'], meet: ['นัดพบ', '#C27A12'], follow: ['ติดตามผล', '#5B6FE0'],
  note: ['โน้ต', '#5E6680'], stage: ['สถานะการขาย', '#0B6E66'], owner: ['ผู้รับผิดชอบ', '#0E1F7A'],
};
export const LOG_RESULTS = ['ติดต่อได้', 'ไม่รับสาย', 'ขอข้อมูลเพิ่ม', 'นัดคุยต่อ', 'ส่งใบเสนอราคาแล้ว', 'ไม่สนใจ'];

/** Tracking feeds: [key, label, dot colour, description] */
export const FEEDS: [FeedKey, string, string, string][] = [
  ['watch', 'รายการติดตามของฉัน', '#E8A23B', 'บริษัทที่กดดาวไว้'],
  ['cfoSoon', 'CFO ใกล้หมดอายุ', '#1A3FE0', 'ใบล่าสุดจะหมดอายุภายในช่วงที่ตั้งไว้'],
  ['cfoExp', 'CFO หมดอายุแล้วยังไม่ต่อ', '#7C93FF', 'ไม่มีใบที่ยังใช้ได้ เรียงจากที่เพิ่งหมด'],
  ['giSoon', 'GI ใกล้หมดอายุ', '#1FB5C9', 'ระดับ 2–5 ที่จะหมดอายุภายใน 90 วัน'],
  ['giDown', 'GI ถูกลดระดับ / หมดอายุ', '#0B6E66', 'เคยได้ระดับสูงกว่าระดับที่ยังใช้ได้ตอนนี้'],
  ['newFac', 'โรงงานใหม่ กรอ.', '#4E9BFF', 'เริ่มประกอบกิจการใน 6 เดือนล่าสุดของข้อมูล'],
  ['setNew', 'บริษัทที่เพิ่งเข้า SET', '#0E1F7A', 'ชื่อย่อที่ไม่เคยมีในข้อมูลชุดก่อน (180 วันล่าสุด)'],
  ['noContact', 'ข้อมูลติดต่อยังไม่ครบ', '#A8B0C8', 'กลุ่มเป้าหมาย 1–8 ที่ยังไม่มีเบอร์โทร'],
];

/** CFO status: [label, text colour] */
export const CST: Record<CfoStatus, [string, string]> = {
  active: ['อยู่ในอายุ', '#0E8A9A'],
  soon: ['ใกล้หมดอายุ', '#B26A00'],
  expired: ['หมดอายุ', '#475069'],
  unknown: ['ไม่ระบุวันหมดอายุ', '#475069'],
  none: ['ยังไม่มี CFO', '#6B7390'],
};
/** Certificate status pill: [bg, fg] */
export const PILL: Record<Exclude<CfoStatus, 'none'>, [string, string]> = {
  active: ['#DDF5F1', '#0B6E66'], soon: ['#FDECC8', '#9A5A00'], expired: ['#EEF1F8', '#475069'], unknown: ['#EEF1F8', '#475069'],
};

/** Monitor event types: [label, bg, fg] */
export const EV_LBL: Record<string, [string, string, string]> = {
  cfoSoon: ['CFO ใกล้หมดอายุ', '#FDECC8', '#9A5A00'],
  cfoExpired: ['CFO หมดอายุ', '#EEF1F8', '#475069'],
  cfoRenewed: ['CFO ต่ออายุแล้ว', '#DDF5F1', '#0B6E66'],
  giDown: ['GI หมดอายุ/ลดระดับ', '#E6ECFD', '#1A2FB0'],
  giUp: ['GI ระดับสูงขึ้น', '#DDF5F1', '#0B6E66'],
};

export const tagsOf = (mask: number) => SRCC.filter((_, i) => mask & (1 << i)).map(([t, bg, fg]) => ({ t, bg, fg }));
export const stageOf = (v: string | undefined) => STG.find((x) => x[0] === (v || 'none')) || STG[0];
