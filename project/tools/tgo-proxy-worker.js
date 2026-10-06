// Cloudflare Worker: proxy เฉพาะหน้า TGO สำหรับปุ่ม "ดึงข้อมูลจาก TGO"
// Deploy แล้วใส่ URL ในช่อง Proxy เช่น https://tgo-proxy.<you>.workers.dev/?url={u}
export default {
  async fetch(req) {
    const u = new URL(req.url).searchParams.get('url') || '';
    if (!u.startsWith('https://thaicarbonlabel.tgo.or.th/')) return new Response('forbidden', { status: 403 });
    const r = await fetch(u, { headers: { 'User-Agent': 'Mozilla/5.0 CFO-Registry-Sync' }, cf: { cacheTtl: 600 } });
    return new Response(await r.text(), { status: r.status, headers: { 'content-type': 'text/html; charset=utf-8', 'access-control-allow-origin': '*' } });
  }
};
