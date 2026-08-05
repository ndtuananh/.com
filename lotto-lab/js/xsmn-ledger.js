// ============================================================================
// js/xsmn-ledger.js — CHẤM SỔ CAM KẾT TRƯỚC.
//
// Vòng đời một bản ghi:
//   1. Ngày D−1: não ra số cho ngày D (ngày CHƯA CÓ KẾT QUẢ) → ghi vào kho, đóng dấu
//      thời gian. Ghi luôn số của TỪNG nhánh, không chỉ nhánh được chọn.
//   2. Ngày D, ~16h35: kết quả về, được gộp vào kho lịch sử.
//   3. Lần chạy kế: thấy bản ghi ngày D chưa chấm mà đã có kết quả ⇒ chấm, đóng băng.
//
// Bản ghi đã chấm KHÔNG BAO GIỜ được chấm lại hay ghi đè. Sổ này là thứ duy nhất trong
// app chứng minh được máy đoán đúng/sai thật sự — mọi con số khác đều là tự chấm bài.
// ============================================================================

// ~1 năm cam kết. Sổ này là nguồn DUY NHẤT của "tỉ lệ chính xác" hiện trên trang chủ,
// nên nó phải đủ dài để mỗi đài tích được vài chục kỳ — mỗi đài chỉ quay 1 lần/tuần,
// giữ 40 ngày thì mỗi đài chỉ có ~6 kỳ, không đủ để nói bất cứ điều gì.
const MAX_COMMITS = 380;

// Ghi cam kết cho `forDate` nếu chưa có. Không bao giờ đè lên bản đã tồn tại — đè là
// mất sạch ý nghĩa "cam kết trước".
//
// `minDate` (ngày sớm nhất còn được phép cam kết, xem committableFrom trong xsmn-sync)
// là CHỐT AN TOÀN CUỐI. Hàm này là cánh cửa duy nhất để một dòng đi vào sổ, nên phép
// kiểm "kỳ này đã quay chưa" phải nằm ở đây chứ không phải ở nơi gọi: chỉ cần một chỗ
// gọi quên kiểm là cả sổ mất giá trị chứng minh, mà lại không có dấu hiệu gì để nhận ra.
// Cùng hình dạng = cùng bộ đài, và mỗi đường ra đúng bấy nhiêu số. So hình dạng chứ
// KHÔNG so giá trị: số cụ thể được phép khác (não học thêm mỗi ngày), nhưng khác thì
// vẫn giữ bản cũ — đó mới là ý nghĩa của "đã khoá".
function sameShape(commit, prediction) {
  if (commit.items.length !== prediction.provinces.length) return false;
  const by = new Map(commit.items.map((it) => [it.slug, it]));
  return prediction.provinces.every((p) => {
    const it = by.get(p.slug);
    if (!it) return false;
    return ['dau', 'de', 'lo'].every((tk) => (it[tk] || []).length === ((p[tk] && p[tk].picks) || []).length);
  });
}

export function addCommit(ledger, prediction, nowISO, minDate = null) {
  if (!prediction || !prediction.provinces.length) return { ledger, added: false };
  if (minDate && prediction.forDate < minDate) {
    return { ledger, added: false, refused: `kỳ ${prediction.forDate} đã qua giờ quay — không ghi sổ` };
  }
  const old = ledger.commits.find((c) => c.forDate === prediction.forDate);
  if (old) {
    // ĐÃ CHẤM thì bất khả xâm phạm — đây là ranh giới không được phép bước qua.
    if (old.graded) return { ledger, added: false };
    // CHƯA CHẤM và ĐÚNG HÌNH DẠNG hiện tại thì giữ nguyên, để dấu thời gian không trôi.
    if (sameShape(old, prediction)) return { ledger, added: false };
    // CHƯA CHẤM nhưng SAI HÌNH DẠNG ⇒ bản ghi do một phiên bản máy cũ tạo ra (ví dụ hôm
    // qua còn ra dàn 6 số, hôm nay đổi sang 1 số chốt). Kỳ này chưa quay nên phát lại
    // không giấu được gì của ai; giữ lại mới là hại: người dùng nhìn thấy một định dạng
    // không còn tồn tại, và sổ sẽ chấm một thứ khác với thứ đang hiện trên màn hình.
    ledger.commits = ledger.commits.filter((c) => c.forDate !== prediction.forDate);
  }
  ledger.commits.unshift({
    forDate: prediction.forDate,
    madeAt: nowISO,
    items: prediction.provinces.map((p) => ({
      slug: p.slug, province: p.province,
      lo: p.lo.picks, loArm: p.lo.arm, loArmName: p.lo.armName,
      de: p.de.picks, deArm: p.de.arm, deArmName: p.de.armName,
      dau: p.dau ? p.dau.picks : [], dauArm: p.dau ? p.dau.arm : null, dauArmName: p.dau ? p.dau.armName : null,
    })),
    graded: null,
  });
  ledger.commits.sort((a, b) => (a.forDate < b.forDate ? 1 : -1));
  ledger.commits = ledger.commits.slice(0, MAX_COMMITS);
  return { ledger, added: true };
}

// Chấm mọi cam kết đã có kết quả mà chưa chấm.
export function gradeCommits(ledger, days, nowISO) {
  const byDate = new Map(days.map((d) => [d.date, d]));
  let gradedNow = 0;
  for (const c of ledger.commits) {
    if (c.graded) continue;
    const day = byDate.get(c.forDate);
    if (!day) continue;
    const provs = new Map(day.provinces.map((p) => [p.slug || p.province, p]));
    const rows = [];
    for (const it of c.items) {
      const p = provs.get(it.slug);
      if (!p) continue;                       // đài không mở thưởng / nguồn thiếu → bỏ qua
      const lo2 = new Set(p.lo2);
      // ĐẦU = 2 số giải Tám = lo2[0]. Cam kết cũ (trước 04/08/2026) không có đường ĐẦU;
      // những dòng đó để `dau` rỗng và KHÔNG được tính vào mẫu — nhét đại số 0 vào sẽ
      // pha loãng tỉ lệ của đường ĐẦU bằng những kỳ nó chưa từng dự báo.
      const actualDau = p.lo2 && p.lo2.length ? p.lo2[0] : null;
      const loMatch = it.lo.filter((n) => lo2.has(n));
      const deMatch = it.de.filter((n) => n === p.de);
      const dauList = it.dau || [];
      const dauMatch = actualDau == null ? [] : dauList.filter((n) => n === actualDau);
      rows.push({
        slug: it.slug, province: it.province,
        lo: it.lo, loArmName: it.loArmName, loMatch, loHit: loMatch.length > 0,
        de: it.de, deArmName: it.deArmName, deMatch, deHit: deMatch.length > 0,
        dau: dauList, dauArmName: it.dauArmName, dauMatch,
        dauHit: dauList.length ? dauMatch.length > 0 : null,
        actualDe: p.de, actualDau, distinct: new Set(p.lo2).size,
      });
    }
    if (!rows.length) continue;
    c.graded = {
      at: nowISO, rows,
      loHits: rows.filter((r) => r.loHit).length,
      deHits: rows.filter((r) => r.deHit).length,
      dauHits: rows.filter((r) => r.dauHit).length,
      dauTotal: rows.filter((r) => r.dauHit !== null).length,
      total: rows.length,
    };
    gradedNow++;
  }
  return { ledger, gradedNow };
}

// Tổng kết sổ: chỉ đếm bản ghi ĐÃ CHẤM. Mốc ngẫu nhiên tính chính xác theo đúng số
// lượng số đã cam kết và số giá trị lô phân biệt của chính kỳ đó — không ước lượng.
export function ledgerSummary(ledger, randomHitProb) {
  const rows = [];
  for (const c of ledger.commits) if (c.graded) for (const r of c.graded.rows) rows.push({ ...r, date: c.forDate, madeAt: c.madeAt });
  if (!rows.length) return { total: 0, rows: [] };

  // Mỗi đường một BỘ ĐẾM RIÊNG với cỡ mẫu riêng. Đường ĐẦU mới có từ 04/08/2026 nên nó
  // ít kỳ hơn hai đường kia; chia chung một mẫu tổng sẽ báo tỉ lệ ĐẦU thấp giả tạo vì
  // mẫu số tính cả những kỳ nó chưa ra đời.
  const acc = () => ({ h: 0, exp: 0, va: 0, n: 0, k: 0 });
  const A = { lo: acc(), de: acc(), dau: acc() };
  const bump = (a, hit, p, k) => { a.n++; a.h += hit ? 1 : 0; a.exp += p; a.va += p * (1 - p); a.k = k; };
  for (const r of rows) {
    if (r.lo.length) bump(A.lo, r.loHit, randomHitProb(r.distinct, r.lo.length), r.lo.length);
    if (r.de.length) bump(A.de, r.deHit, r.de.length / 100, r.de.length);
    if (r.dau && r.dau.length) bump(A.dau, r.dauHit, r.dau.length / 100, r.dau.length);
  }
  const fin = (a) => ({
    hits: a.h, total: a.n, rate: a.n ? a.h / a.n : 0, expRate: a.n ? a.exp / a.n : 0,
    edge: a.n ? a.h / a.n - a.exp / a.n : 0, z: a.va > 0 ? (a.h - a.exp) / Math.sqrt(a.va) : 0, k: a.k,
  });
  return {
    total: rows.length, days: new Set(rows.map((r) => r.date)).size,
    lo: fin(A.lo), de: fin(A.de), dau: fin(A.dau),
    byProvince: provinceScore(rows, randomHitProb),
    rows: rows.slice(0, 60),
  };
}

// TỈ LỆ CHÍNH XÁC THEO TỪNG ĐÀI, tính CHỈ trên số đã cam kết trước khi quay.
//
// Đây là con số thật nhất trong cả app: khác với thành tích walk-forward (máy tự chấm
// bài mình trên quá khứ), mỗi dòng ở đây là một dàn số đã nằm trong kho, có dấu thời
// gian, trước khi kết quả tồn tại. Không sửa được, nên không tô hồng được.
//
// Đi kèm mỗi tỉ lệ luôn là `exp` (mốc bốc mù tính đúng cho từng kỳ của chính đài đó)
// và `n` (cỡ mẫu). Thiếu một trong hai thì con số vô nghĩa.
export function provinceScore(rows, randomHitProb) {
  const blank = () => ({ h: 0, exp: 0, va: 0, n: 0, k: 0, streak: [] });
  const m = new Map();
  for (const r of rows) {
    let s = m.get(r.slug);
    if (!s) { s = { slug: r.slug, province: r.province, n: 0, lastDate: null, lo: blank(), de: blank(), dau: blank() }; m.set(r.slug, s); }
    s.n++;
    if (!s.lastDate || r.date > s.lastDate) s.lastDate = r.date;
    const bump = (a, hit, p, k) => {
      a.n++; a.h += hit ? 1 : 0; a.exp += p; a.va += p * (1 - p); a.k = k;
      if (a.streak.length < 12) a.streak.push(hit ? 1 : 0);
    };
    if (r.lo.length) bump(s.lo, r.loHit, randomHitProb(r.distinct, r.lo.length), r.lo.length);
    if (r.de.length) bump(s.de, r.deHit, r.de.length / 100, r.de.length);
    if (r.dau && r.dau.length) bump(s.dau, r.dauHit, r.dau.length / 100, r.dau.length);
  }
  const fin = (a) => ({
    hits: a.h, n: a.n, k: a.k, streak: a.streak,
    rate: a.n ? a.h / a.n : 0, expRate: a.n ? a.exp / a.n : 0,
    edge: a.n ? a.h / a.n - a.exp / a.n : 0, z: a.va > 0 ? (a.h - a.exp) / Math.sqrt(a.va) : 0,
  });
  return [...m.values()]
    .map((s) => ({
      slug: s.slug, province: s.province, n: s.n, lastDate: s.lastDate,
      lo: fin(s.lo), de: fin(s.de), dau: fin(s.dau),
    }))
    .sort((a, b) => b.n - a.n || (a.province < b.province ? -1 : 1));
}

// Cam kết đang chờ kết quả (đã ghi, chưa chấm) — để hiện "máy đã đoán, đang chờ đối chiếu".
export const pendingCommits = (ledger) => ledger.commits.filter((c) => !c.graded);
