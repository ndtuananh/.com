// ============================================================================
// js/xsmn-supabase.js — ĐẨY DỮ LIỆU LÊN SUPABASE (kho bền thứ hai, truy vấn được).
//
// Vì sao cần, khi đã có Vercel Blob?
//   • Blob là một file JSON: muốn hỏi "đài Tây Ninh 90 ngày qua đề trúng bao nhiêu lần"
//     thì phải tải cả kho về rồi tự lọc. Supabase là Postgres thật — hỏi bằng SQL.
//   • Blob không có khoá ghi. Hai lượt chạy trùng giờ có thể đè mất bản ghi của nhau.
//     Supabase upsert theo khoá chính nên không bao giờ mất dòng.
//   • Kho ở hai nơi ⇒ mất một nơi vẫn còn nơi kia.
//
// NGUYÊN TẮC: module này TUYỆT ĐỐI không được làm hỏng lượt chạy. Không có biến môi
// trường thì im lặng bỏ qua; gọi lỗi thì nuốt lỗi và báo lại trong payload để nhìn thấy
// được — nhưng không bao giờ ném ra ngoài. Trang web phải sống kể cả khi Supabase chết.
//
// Dùng REST (PostgREST) bằng fetch trần — không thêm phụ thuộc nào vào package.json.
// Bảng + chỉ mục xem trong supabase/schema.sql.
// ============================================================================

const URL_ENV = ['SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_URL'];
const KEY_ENV = ['SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_SERVICE_KEY', 'SUPABASE_KEY'];

const pick = (names) => { for (const n of names) { const v = process.env[n]; if (v) return v.trim(); } return null; };

export function supabaseConfig() {
  const url = pick(URL_ENV), key = pick(KEY_ENV);
  if (!url || !key) return null;
  return { url: url.replace(/\/+$/, ''), key };
}

export const supabaseEnabled = () => !!supabaseConfig();

// Một lần gọi upsert. `onConflict` phải trùng khoá chính/unique của bảng, nếu không
// PostgREST sẽ chèn trùng thay vì cập nhật.
async function upsert(cfg, table, rows, onConflict, timeoutMs = 12000) {
  if (!rows.length) return { ok: true, count: 0 };
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(`${cfg.url}/rest/v1/${table}?on_conflict=${encodeURIComponent(onConflict)}`, {
      method: 'POST',
      signal: ctrl.signal,
      headers: {
        apikey: cfg.key,
        Authorization: `Bearer ${cfg.key}`,
        'Content-Type': 'application/json',
        // merge-duplicates = UPSERT. return=minimal để khỏi tải ngược cả nghìn dòng về.
        Prefer: 'resolution=merge-duplicates,return=minimal',
      },
      body: JSON.stringify(rows),
    });
    if (!r.ok) {
      const detail = (await r.text().catch(() => '')).slice(0, 300);
      return { ok: false, count: 0, error: `${table} ${r.status}: ${detail}` };
    }
    return { ok: true, count: rows.length };
  } catch (e) {
    return { ok: false, count: 0, error: `${table}: ${String(e && e.message || e)}` };
  } finally { clearTimeout(t); }
}

// Chia lô để không đẩy một body khổng lồ (Supabase từ chối payload quá lớn, và một lô
// hỏng thì mất trắng cả lượt). Dừng ngay khi hết giờ — phần đã đẩy vẫn nằm trên đó.
async function upsertChunked(cfg, table, rows, onConflict, { chunk = 250, deadline } = {}) {
  let sent = 0; const errors = [];
  for (let i = 0; i < rows.length; i += chunk) {
    if (deadline && Date.now() > deadline) { errors.push(`${table}: hết giờ sau ${sent} dòng`); break; }
    const r = await upsert(cfg, table, rows.slice(i, i + chunk), onConflict);
    if (r.ok) sent += r.count; else { errors.push(r.error); break; }
  }
  return { sent, errors };
}

// ---------------------------------------------------------------------------
// Chuẩn hoá dữ liệu sang dạng bảng
// ---------------------------------------------------------------------------

// Kết quả thô: mỗi (ngày, đài) một dòng. Tách theo đài chứ không nhét cả ngày vào một
// ô jsonb — để còn `where slug = 'tay-ninh'` được mà không phải bung JSON ra.
function dayRows(days) {
  const out = [];
  for (const d of days) {
    if (!d || !d.date || !Array.isArray(d.provinces)) continue;
    for (const p of d.provinces) {
      const slug = p.slug || p.province;
      if (!slug) continue;
      out.push({
        draw_date: d.date,
        slug,
        province: p.province || slug,
        code: p.code || '',
        de: String(p.de ?? '').padStart(2, '0'),
        lo2: p.lo2 || [],
      });
    }
  }
  return out;
}

// Sổ cam kết: mỗi (ngày dự báo, đài) một dòng, kèm kết quả chấm nếu đã có.
function commitRows(ledger) {
  const out = [];
  for (const c of ledger.commits || []) {
    const graded = c.graded ? new Map(c.graded.rows.map((r) => [r.slug, r])) : null;
    for (const it of c.items || []) {
      const g = graded ? graded.get(it.slug) : null;
      // `?? null` KHÔNG thừa ở đây. JSON.stringify XOÁ HẲN key có giá trị undefined, nên
      // một dòng cũ thiếu `actualDau` sẽ được gửi đi với ít key hơn dòng mới — và
      // PostgREST từ chối cả lô với "PGRST102 All object keys must match". Cả lô cam kết
      // mất trắng chỉ vì một dòng cũ thiếu một trường. Ép null để mọi dòng cùng bộ key.
      const n = (v) => (v === undefined ? null : v);
      out.push({
        for_date: c.forDate,
        slug: it.slug,
        province: it.province,
        made_at: c.madeAt,
        dau_picks: it.dau || [], dau_arm: n(it.dauArm), dau_arm_name: n(it.dauArmName),
        de_picks: it.de || [], de_arm: n(it.deArm), de_arm_name: n(it.deArmName),
        lo_picks: it.lo || [], lo_arm: n(it.loArm), lo_arm_name: n(it.loArmName),
        graded_at: c.graded ? c.graded.at : null,
        actual_dau: g ? n(g.actualDau) : null,
        actual_de: g ? n(g.actualDe) : null,
        dau_hit: g ? n(g.dauHit) : null,
        de_hit: g ? n(g.deHit) : null,
        lo_hit: g ? n(g.loHit) : null,
        lo_match: g ? n(g.loMatch) : null,
        distinct_lo: g ? n(g.distinct) : null,
      });
    }
  }
  return out;
}

// Cột của đường ĐẦU chỉ có sau khi chạy supabase/migration-dau.sql. Nếu chưa chạy,
// PostgREST trả lỗi "column ... does not exist" và cả lô cam kết bị mất.
//
// Không chấp nhận được: một tính năng phụ (đẩy kho thứ hai) làm hỏng việc chính (lưu sổ).
// Nên khi gặp đúng lỗi thiếu cột, bỏ các trường ĐẦU rồi đẩy lại — dữ liệu cũ vẫn lên
// đủ, chỉ thiếu phần ĐẦU cho tới khi anh chạy migration. Báo rõ trong payload để nhìn
// thấy được, chứ không im lặng.
const DAU_COLS = ['dau_picks', 'dau_arm', 'dau_arm_name', 'actual_dau', 'dau_hit'];
const isMissingColumn = (msg) => /column .* does not exist|Could not find the .* column|PGRST204/i.test(msg || '');
const stripDau = (rows) => rows.map((r) => { const o = { ...r }; for (const k of DAU_COLS) delete o[k]; return o; });

// Ảnh chụp tỉ lệ chính xác theo từng đài, đóng dấu theo ngày. Giữ lịch sử ảnh chụp để
// sau này vẽ được "tỉ lệ của đài này thay đổi thế nào qua các tháng" — thứ mà chỉ nhìn
// con số hôm nay thì không bao giờ thấy.
function accuracyRows(byProvince, snapshotDate) {
  const out = [];
  for (const p of byProvince || []) {
    for (const track of ['dau', 'de', 'lo']) {
      const t = p[track];
      if (!t || !t.n) continue;     // đường chưa có kỳ nào ⇒ không ghi dòng rỗng
      out.push({
        snapshot_date: snapshotDate,
        slug: p.slug,
        province: p.province,
        track,
        n: t.n,                      // cỡ mẫu CỦA ĐƯỜNG ĐÓ, không phải tổng của đài
        k: t.k,
        hits: t.hits,
        rate: Number(t.rate.toFixed(6)),
        exp_rate: Number(t.expRate.toFixed(6)),
        edge: Number(t.edge.toFixed(6)),
        z: Number(t.z.toFixed(4)),
      });
    }
  }
  return out;
}

// Ngày CŨ NHẤT đã có trên Supabase — mốc nước để seed lùi cho có tiến độ thật.
//
// Không có mốc này thì "đẩy hết" là cái bẫy: lượt nào cũng bắt đầu từ ngày mới nhất, hết
// giờ ở đúng chỗ cũ, và phần đuôi kho không bao giờ lên tới nơi dù gọi bao nhiêu lần.
// Có mốc thì mỗi lượt gặm thêm một khúc về quá khứ, gọi vài lần là xong.
async function oldestDate(cfg) {
  try {
    const r = await fetch(`${cfg.url}/rest/v1/xsmn_days?select=draw_date&order=draw_date.asc&limit=1`, {
      headers: { apikey: cfg.key, Authorization: `Bearer ${cfg.key}` },
    });
    if (!r.ok) return null;
    const j = await r.json();
    return Array.isArray(j) && j.length ? j[0].draw_date : null;
  } catch (_) { return null; }
}

// ---------------------------------------------------------------------------
// API CHÍNH — gọi một phát, không bao giờ ném lỗi.
// ---------------------------------------------------------------------------
export async function pushToSupabase({ days, ledger, byProvince, snapshotDate, recentDays = 400, deadline } = {}) {
  const cfg = supabaseConfig();
  if (!cfg) return { enabled: false, reason: 'chưa đặt SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY' };

  const errors = [];
  const res = { enabled: true, days: 0, commits: 0, accuracy: 0 };
  try {
    // Lượt thường chỉ đẩy phần ĐẦU kho (mới → cũ): đẩy lại toàn bộ ~1.900 ngày mỗi ngày
    // là ~5.900 dòng upsert cho một thay đổi duy nhất — tốn giờ hàm mà không thêm dữ liệu.
    //
    // Nhưng cắt cửa sổ như vậy thì phần ĐUÔI kho không bao giờ lên được, vì lượt nào cũng
    // đẩy đúng khúc đầu ấy. Nên phải có `full` để seed một lần cho hết, gọi bằng ?full=1.
    // Hết giờ giữa chừng cũng không sao: upsert idempotent, gọi lại là đi tiếp.
    if (days && days.length) {
      let slice;
      if (recentDays === 'all') {
        // Seed lùi: chỉ lấy khúc CŨ HƠN ngày cũ nhất đã có trên Supabase. Bảng trống thì
        // lấy từ đầu. Sau mỗi lượt, mốc nước lùi thêm — gọi lại là đi tiếp, không giẫm lại.
        const mark = await oldestDate(cfg);
        slice = mark ? days.filter((d) => d.date < mark) : days;
        res.seedFrom = mark; res.seedRemaining = slice.length;
      } else {
        slice = days.slice(0, recentDays);
      }
      const r = await upsertChunked(cfg, 'xsmn_days', dayRows(slice), 'draw_date,slug', { deadline });
      res.days = r.sent; errors.push(...r.errors);
    }
    if (ledger) {
      const rows = commitRows(ledger);
      let r = await upsertChunked(cfg, 'xsmn_commits', rows, 'for_date,slug', { deadline });
      if (!r.sent && r.errors.some(isMissingColumn)) {
        res.dauColumns = 'thiếu — chạy supabase/migration-dau.sql';
        r = await upsertChunked(cfg, 'xsmn_commits', stripDau(rows), 'for_date,slug', { deadline });
      }
      res.commits = r.sent; errors.push(...r.errors);
    }
    if (byProvince && byProvince.length) {
      const r = await upsertChunked(cfg, 'xsmn_accuracy', accuracyRows(byProvince, snapshotDate), 'snapshot_date,slug,track', { deadline });
      res.accuracy = r.sent; errors.push(...r.errors);
    }
  } catch (e) {
    errors.push(String(e && e.message || e));
  }
  if (errors.length) { res.ok = false; res.errors = errors.slice(0, 4); console.error('[xsmn-supabase]', errors[0]); }
  else res.ok = true;
  return res;
}
