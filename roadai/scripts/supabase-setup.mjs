/* RoadAI · Driver Radar — tự cài kho Supabase (chạy 1 lần).
   Làm 3 việc: tạo bảng butl_sync → lấy khoá service_role → nạp 2 biến lên Vercel.

   Cách chạy (trong thư mục roadai):
     SB_PAT=sbp_xxxxxxxx node scripts/supabase-setup.mjs
   SB_PAT lấy ở: https://supabase.com/dashboard/account/tokens → Generate new token

   Không có PAT thì làm tay cũng được:
     1) Supabase → SQL Editor → dán supabase/schema.sql → Run
     2) Supabase → Settings → API → copy khoá service_role
     3) npx vercel env add SUPABASE_SERVICE_ROLE production   (dán khoá vào)
*/
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

const PAT = (process.env.SB_PAT || '').trim();
const REF = (process.env.SB_REF || 'nxvcsotzybjxykadbxbr').trim();   // project Supabase anh đang dùng
const SB_URL = 'https://' + REF + '.supabase.co';
const base = 'https://api.supabase.com/v1/projects/' + REF;
const H = { Authorization: 'Bearer ' + PAT, 'Content-Type': 'application/json' };

if (!PAT) { console.error('THIẾU SB_PAT. Xem hướng dẫn ở đầu file này.'); process.exit(1); }

const sql = readFileSync(new URL('../supabase/schema.sql', import.meta.url), 'utf8');

console.log('1/3 · Tạo bảng butl_sync…');
const q = await fetch(base + '/database/query', { method: 'POST', headers: H, body: JSON.stringify({ query: sql }) });
const qt = await q.text();
if (!q.ok) { console.error('   ✗ lỗi ' + q.status + ': ' + qt.slice(0, 300)); process.exit(1); }
console.log('   ✓ xong');

console.log('2/3 · Lấy khoá service_role…');
const k = await fetch(base + '/api-keys?reveal=true', { headers: H });
if (!k.ok) { console.error('   ✗ lỗi ' + k.status + ': ' + (await k.text()).slice(0, 200)); process.exit(1); }
const keys = await k.json();
const sr = Array.isArray(keys) ? keys.find(x => x.name === 'service_role') : null;
if (!sr || !sr.api_key) { console.error('   ✗ không thấy khoá service_role'); process.exit(1); }
console.log('   ✓ lấy được (đuôi …' + sr.api_key.slice(-6) + ')');

console.log('3/3 · Nạp biến lên Vercel (project roadai-vn)…');
for (const [name, val] of [['SUPABASE_URL', SB_URL], ['SUPABASE_SERVICE_ROLE', sr.api_key]]) {
  try { execSync('npx --yes vercel@latest env rm ' + name + ' production --yes', { stdio: 'ignore' }); } catch (e) {}
  execSync('npx --yes vercel@latest env add ' + name + ' production', { input: val + '\n', stdio: ['pipe', 'ignore', 'inherit'] });
  console.log('   ✓ ' + name);
}
console.log('\nXONG. Giờ chạy: npx vercel --prod --yes');
