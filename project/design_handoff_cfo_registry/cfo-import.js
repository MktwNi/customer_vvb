(function(){
const KEYS={n:['ลำดับ'],cert:['เลขที่ใบรับรอง'],act:['ชื่อกิจกรรม/ประเภทธุรกิจ','ชื่อกิจกรรม'],org:['ชื่อองค์กร'],branch:['สาขา/รหัสสาขา','สาขา'],prov:['จังหวัด'],addr:['ที่อยู่'],
tambon:['ตำบล/แขวง (จากที่อยู่)','ตำบล/แขวง'],amphoe:['อำเภอ/เขต (จากที่อยู่)','อำเภอ/เขต'],provAddr:['จังหวัด (จากที่อยู่)'],zip:['รหัสไปรษณีย์'],ind:['อุตสาหกรรม'],size:['ขนาดอุตสาหกรรม'],
apBE:['วันที่อนุมัติ (พ.ศ. ตามเว็บ)','วันที่อนุมัติ (พ.ศ.)'],exBE:['วันที่หมดอายุ (พ.ศ. ตามเว็บ)','วันที่หมดอายุ (พ.ศ.)'],ap:['วันที่อนุมัติ (ค.ศ.)'],ex:['วันที่หมดอายุ (ค.ศ.)'],
s1:['ประเภทที่ 1 (%)'],s2:['ประเภทที่ 2 (%)'],s3:['ประเภทที่ 3 (%)'],top:['ประเภทที่มีสัดส่วนสูงสุด'],fy:['ปีงบประมาณ (FY)','ปีงบประมาณ'],note:['ข้อสังเกตข้อมูล'],id:['รหัสรายการในเว็บ'],extra:['ข้อความเพิ่มเติมในการ์ด'],
phone:['เบอร์โทรศัพท์','เบอร์โทร'],email:['Email','อีเมล'],csrc:['แหล่งที่มาของข้อมูลติดต่อ'],curl:['URL แหล่งที่มา'],cnote:['สถานะการค้นหา / หมายเหตุ']};
const TEMPLATE_HEADERS=['ลำดับ','เลขที่ใบรับรอง','ชื่อกิจกรรม/ประเภทธุรกิจ','ชื่อองค์กร','สาขา/รหัสสาขา','จังหวัด','ที่อยู่','รหัสไปรษณีย์','อุตสาหกรรม','ขนาดอุตสาหกรรม','วันที่อนุมัติ (พ.ศ. ตามเว็บ)','วันที่หมดอายุ (พ.ศ. ตามเว็บ)','ประเภทที่ 1 (%)','ประเภทที่ 2 (%)','ประเภทที่ 3 (%)','รหัสรายการในเว็บ','เบอร์โทรศัพท์','Email','แหล่งที่มาของข้อมูลติดต่อ','URL แหล่งที่มา','สถานะการค้นหา / หมายเหตุ'];
const norm=s=>String(s||'').replace(/\s+/g,'').toLowerCase();
const pad=n=>String(n).padStart(2,'0');

async function unzip(buf){
  const u8=new Uint8Array(buf),dv=new DataView(buf);let e=u8.length-22;
  while(e>=0&&dv.getUint32(e,true)!==0x06054b50)e--;if(e<0)throw new Error('ไฟล์ไม่ใช่ .xlsx ที่ถูกต้อง');
  const n=dv.getUint16(e+10,true);let off=dv.getUint32(e+16,true);const files={};
  for(let i=0;i<n;i++){const m=dv.getUint16(off+10,true),cs=dv.getUint32(off+20,true),fl=dv.getUint16(off+28,true),el=dv.getUint16(off+30,true),cl=dv.getUint16(off+32,true),lo=dv.getUint32(off+42,true);
    files[new TextDecoder().decode(u8.slice(off+46,off+46+fl))]={m,cs,lo};off+=46+fl+el+cl}
  return async name=>{const f=files[name];if(!f)return null;const lfl=dv.getUint16(f.lo+26,true),lel=dv.getUint16(f.lo+28,true);const d=u8.slice(f.lo+30+lfl+lel,f.lo+30+lfl+lel+f.cs);
    if(f.m===0)return new TextDecoder().decode(d);return await new Response(new Blob([d]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).text()};
}
const colIdx=ref=>{const L=ref.replace(/\d+/g,'');let n=0;for(const ch of L)n=n*26+ch.charCodeAt(0)-64;return n-1};

async function readXlsx(buf){
  const get=await unzip(buf);const P=new DOMParser();const X=s=>P.parseFromString(s,'text/xml');
  const wb=X(await get('xl/workbook.xml'));const rels=X(await get('xl/_rels/workbook.xml.rels'));
  const relMap={};[...rels.getElementsByTagName('Relationship')].forEach(r=>relMap[r.getAttribute('Id')]=r.getAttribute('Target'));
  const sheets=[...wb.getElementsByTagName('sheet')].map(s=>{let t=relMap[s.getAttribute('r:id')]||'';t=t.replace(/^\/?xl\//,'');return {name:s.getAttribute('name'),path:'xl/'+t}});
  const ssx=await get('xl/sharedStrings.xml');const ss=ssx?[...X(ssx).getElementsByTagName('si')].map(si=>[...si.getElementsByTagName('t')].map(t=>t.textContent).join('')):[];
  const readSheet=async path=>{const x=await get(path);if(!x)return [];const d=X(x);
    const all=[];[...d.getElementsByTagName('row')].forEach((r,ri)=>{const out=[];let k=0;[...r.getElementsByTagName('c')].forEach(c=>{const ref=c.getAttribute('r');const i=ref?colIdx(ref):k;k=i+1;const t=c.getAttribute('t');const v=c.getElementsByTagName('v')[0];
      let val=t==='inlineStr'?[...c.getElementsByTagName('t')].map(x=>x.textContent).join(''):(v?v.textContent:'');if(t==='s')val=ss[+val]||'';out[i]=val});all[(+r.getAttribute('r')||ri+1)-1]=out});return all};
  return {sheets,readSheet};
}
function parseCsv(text){
  const rows=[];let row=[],cur='',q=false;text=text.replace(/^\ufeff/,'');
  for(let i=0;i<text.length;i++){const ch=text[i];
    if(q){if(ch==='"'){if(text[i+1]==='"'){cur+='"';i++}else q=false}else cur+=ch}
    else if(ch==='"')q=true;else if(ch===','){row.push(cur);cur=''}else if(ch==='\n'||ch==='\r'){if(ch==='\r'&&text[i+1]==='\n')i++;row.push(cur);rows.push(row);row=[];cur=''}else cur+=ch}
  if(cur||row.length){row.push(cur);rows.push(row)}
  return rows;
}
function mapHeader(hdr){
  const H=hdr.map(norm),map={};
  for(const [k,al] of Object.entries(KEYS)){for(const a of al){const i=H.indexOf(norm(a));if(i>=0){map[k]=i;break}}}
  return map;
}
const serialISO=v=>{const d=new Date(Date.UTC(1899,11,30)+(+v)*864e5);return d.toISOString().slice(0,10)};
function toISO(v){v=String(v||'').trim();if(!v)return '';
  if(/^\d+(\.\d+)?$/.test(v)&&+v>1000&&+v<80000)return serialISO(v);
  let m=/^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(v);if(m){let y=+m[1];if(y>2400)y-=543;return `${y}-${pad(m[2])}-${pad(m[3])}`}
  m=/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(v);if(m){let y=+m[3];if(y>2400)y-=543;return `${y}-${pad(m[2])}-${pad(m[1])}`}
  return '';}
const isoBE=iso=>{if(!iso)return '';const [y,m,d]=iso.split('-');return `${d}/${m}/${+y+543}`};

function rowsToObjects(rows){
  let hi=rows.findIndex(r=>r&&r.some(c=>norm(c)===norm('ชื่อองค์กร')));if(hi<0)throw new Error('ไม่พบหัวคอลัมน์ "ชื่อองค์กร" ในไฟล์');
  const map=mapHeader(rows[hi]);const objs=[];
  for(const r of rows.slice(hi+1)){if(!r)continue;const o={};for(const [k,i] of Object.entries(map))o[k]=String(r[i]==null?'':r[i]).trim();if(!o.org)continue;objs.push(o)}
  return {objs,map};
}
function cleanObjects(objs){
  const sv=[];objs.forEach(o=>['s1','s2','s3'].forEach(k=>{if(o[k]!==''&&!isNaN(+o[k]))sv.push(+o[k])}));
  const frac=sv.length&&sv.filter(v=>v<=1.0001).length/sv.length>0.9;
  return objs.map((o,i)=>{const r={...o};
    const apx=toISO(r.ap)||toISO(r.apBE),exx=toISO(r.ex)||toISO(r.exBE);r.ap=apx;r.ex=exx;
    if(!/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(r.apBE||''))r.apBE=isoBE(apx);if(!/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(r.exBE||''))r.exBE=isoBE(exx);
    ['s1','s2','s3'].forEach(k=>{r[k]=r[k]===''||isNaN(+r[k])?null:Math.round(+r[k]*(frac?100:1)*100)/100});
    if(r.s1===0&&r.s2===0&&r.s3===0)r.s1=r.s2=r.s3=null;
    if(!r.top&&r.s1!=null){const a=[r.s1,r.s2||0,r.s3||0];r.top='ประเภทที่ '+(a.indexOf(Math.max(...a))+1)}
    if(!r.fy){const m=/FY(\d\d)/i.exec(r.cert||'');r.fy=m?'FY'+m[1]:''}
    if(!r.id)r.id='X'+Date.now().toString(36)+'-'+i;
    if(!r.provAddr&&r.addr){const m=/(\S+)\s+\d{5}\s*$/.exec(r.addr);if(m)r.provAddr=m[1]}
    if(!r.zip&&r.addr){const m=/(\d{5})\s*$/.exec(r.addr);if(m)r.zip=m[1]}
    return r});
}
async function parseFile(file){
  const name=file.name||'';let objs,sheetName='',asOf='';
  if(/\.csv$/i.test(name)){const text=await file.text();objs=rowsToObjects(parseCsv(text)).objs;sheetName='CSV'}
  else{const {sheets,readSheet}=await readXlsx(await file.arrayBuffer());
    const order=[...sheets].sort((a,b)=>(b.name==='ข้อมูล CFO')-(a.name==='ข้อมูล CFO')||(/ต้นฉบับ/.test(a.name)?1:0)-(/ต้นฉบับ/.test(b.name)?1:0));
    let err=null;
    for(const s of order){const rows=await readSheet(s.path);try{const res=rowsToObjects(rows);if(res.objs.length&&('id' in res.map||'cert' in res.map)){objs=res.objs;sheetName=s.name;break}}catch(e){err=e}}
    if(!objs)throw err||new Error('ไม่พบชีตที่มีข้อมูลรายชื่อองค์กร');
    const sum=sheets.find(s=>s.name==='สรุป');if(sum){const rows=await readSheet(sum.path);const b3=rows[2]&&rows[2][1];const d=b3?toISO(b3):'';if(d&&+d.slice(0,4)>2000)asOf=d}
  }
  return {objs:cleanObjects(objs),sheetName,asOf};
}
function datasetToObjects(ds,contacts){
  const D=ds.dicts;contacts=contacts||{};
  return ds.rows.map(a=>{const [n,cert,act,org,branch,provI,addr,tambon,amphoe,provAddr,zip,indI,sizeI,apBE,exBE,ap,ex,s1,s2,s3,topI,stI,fyI,note,id,extra]=a;
    const c=contacts[id]||[];return {n,cert,act,org,branch,prov:D.prov[provI]||'',addr,tambon,amphoe,provAddr,zip,ind:D.ind[indI]||'',size:D.size[sizeI]||'',apBE,exBE,ap,ex,s1,s2,s3,top:D.top[topI]||'',fy:D.fy[fyI]||'',note,id:String(id),extra,phone:c[0]||'',email:c[1]||'',csrc:c[2]||'',curl:c[3]||'',cnote:c[4]||''}});
}
function objectsToDataset(objs,asOf,source){
  const dicts={ind:[],size:[],prov:[],status:['อยู่ในอายุ','หมดอายุ','ไม่ระบุวันหมดอายุ'],fy:[],top:[]};
  const di=(k,v)=>{v=v||'';let i=dicts[k].indexOf(v);if(i<0){dicts[k].push(v);i=dicts[k].length-1}return i};
  const sorted=[...objs].sort((a,b)=>(b.ap?1:0)-(a.ap?1:0)||(b.ap||'').localeCompare(a.ap||''));
  const contacts={};
  const rows=sorted.map((o,i)=>{if(o.phone||o.email||o.csrc||o.curl||o.cnote)contacts[o.id]=[o.phone||'',o.email||'',o.csrc||'',o.curl||'',o.cnote||''];
    return [i+1,o.cert||'',o.act||'',o.org,o.branch||'',di('prov',o.prov),o.addr||'',o.tambon||'',o.amphoe||'',o.provAddr||'',o.zip||'',di('ind',o.ind),di('size',o.size),o.apBE||'',o.exBE||'',o.ap||'',o.ex||'',o.s1,o.s2,o.s3,di('top',o.top),0,di('fy',o.fy),o.note||'',String(o.id),o.extra||'']});
  return {data:{asOf:asOf||new Date().toISOString().slice(0,10),source:source||'',dicts,rows},contacts};
}
function templateCsv(){return '\ufeff'+TEMPLATE_HEADERS.join(',')+'\n'}
const DB='cfo-registry',ST='kv';
function db(){return new Promise((res,rej)=>{const r=indexedDB.open(DB,1);r.onupgradeneeded=()=>r.result.createObjectStore(ST);r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error)})}
const idb={
  async get(k){const d=await db();return new Promise(res=>{const t=d.transaction(ST).objectStore(ST).get(k);t.onsuccess=()=>res(t.result);t.onerror=()=>res(undefined)})},
  async set(k,v){const d=await db();return new Promise((res,rej)=>{const tx=d.transaction(ST,'readwrite');tx.objectStore(ST).put(v,k);tx.oncomplete=()=>res();tx.onerror=()=>rej(tx.error)})},
  async del(k){const d=await db();return new Promise(res=>{const tx=d.transaction(ST,'readwrite');tx.objectStore(ST).delete(k);tx.oncomplete=()=>res();tx.onerror=()=>res()})}
};
function download(name,text,type){const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([text],{type:type||'application/json'}));a.download=name;document.body.appendChild(a);a.click();a.remove()}
window.CFOImport={parseFile,datasetToObjects,objectsToDataset,templateCsv,idb,download,isoBE};
})();
