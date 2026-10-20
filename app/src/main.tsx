import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { AppProvider } from './state';
import { GccEngine } from './lib/engine';
import './index.css';
// the filter row, popovers and dropdowns (components/Pop, Select, FilterBar, DateFilter)
import './filters.css';
// money by year: the Cashflow tab, the table's lens, the Dashboard's การรับเงิน and quarter card
import './cashflow.css';
// the quotation card, its versions and the revision dialog (components/QtCard, DocAttach)
import './quotes.css';
// per-customer colours on แผนติดต่อ (lib/custColor.ts)
import './custcolor.css';
// ติดตาม: บริษัทที่ติดตาม on top (tabs/TrackFollow), the registry's lists below in quiet cards
import './track.css';
// configurable roles and permission requests: the Users page's sections, the request dialog, สิทธิ์ของฉัน
import './roles.css';
// notifications and the quotation check: the bell, the check sheet, การแจ้งเตือนของฉัน and the admin section
import './notify.css';
// joint quotations: the table's band and member rows, the panel, the dialogs, the phone card (components/JointQt)
import './joint.css';
// the five steps: a step's contacts inside it (the panel, the table's rows, the phone card)
import './steps.css';
// units, % contribution and commission: the Dashboard's commission card and unit split, the deal panel's
// สัดส่วนรายได้, the units dialog (lib/contrib.ts)
import './units.css';
// the month check for accounting: the month card and year table under the Cashflow chart, the deal panel's chip
import './paycheck.css';
// job expenses where a job is worked on: the deal panel's ค่าใช้จ่ายของงาน, its dialog, the phone card's row
import './expense.css';
// job expenses in the money views: Cashflow's money out, the out side of the month check, the Dashboard's card
import './expense-money.css';
// many search results at once: the boxes, เลือกทั้งหมด and the bar over the list (components/BulkBar)
import './bulk.css';

const engine = new GccEngine();
// started before the first render: a sign-in gate (or the home team's check) is there from the first
// frame, with no app shell behind it
engine.load();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppProvider engine={engine}>
      <App />
    </AppProvider>
  </StrictMode>,
);
