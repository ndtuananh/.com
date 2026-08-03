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
export function addCommit(ledger, prediction, nowISO, minDate = null) {
  if (!prediction || !prediction.provinces.length) return { ledger, added: false };
  if (minDate && prediction.forDate < minDate) {
    return { ledger, added: false, refused: `kỳ ${prediction.forDate} đã qua giờ quay — không ghi sổ` };
  }
  if (ledger.commits.some((c) => c.forDate === prediction.forDate)) return { ledger, added: false };
  ledger.commits.unshift({
    forDate: prediction.forDate,
    madeAt: nowISO,
    items: prediction.provinces.map((p) => ({
      slug: p.slug, province: p.province,
      lo: p.lo.picks, loArm: p.lo.arm, loArmName: p.lo.armName,
      de: p.de.picks, deArm: p.de.arm, deArmName: p.de.armName,
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
      const loMatch = it.lo.filter((n) => lo2.has(n));
      const deMatch = it.de.filter((n) => n === p.de);
      rows.push({
        slug: it.slug, province: it.province,
        lo: it.lo, loArmName: it.loArmName, loMatch, loHit: loMatch.length > 0,
        de: it.de, deArmName: it.deArmName, deMatch, deHit: deMatch.length > 0,
        actualDe: p.de, distinct: new Set(p.lo2).size,
      });
    }
    if (!rows.length) continue;
    c.graded = {
      at: nowISO, rows,
      loHits: rows.filter((r) => r.loHit).length,
      deHits: rows.filter((r) => r.deHit).length,
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
  let loH = 0, loExp = 0, loVar = 0, deH = 0, deExp = 0, deVar = 0;
  for (const r of rows) {
    const pl = randomHitProb(r.distinct, r.lo.length);
    const pd = r.de.length / 100;
    loH += r.loHit ? 1 : 0; loExp += pl; loVar += pl * (1 - pl);
    deH += r.deHit ? 1 : 0; deExp += pd; deVar += pd * (1 - pd);
  }
  const n = rows.length;
  return {
    total: n, days: new Set(rows.map((r) => r.date)).size,
    lo: { hits: loH, rate: loH / n, expRate: loExp / n, z: loVar > 0 ? (loH - loExp) / Math.sqrt(loVar) : 0, k: rows[0].lo.length },
    de: { hits: deH, rate: deH / n, expRate: deExp / n, z: deVar > 0 ? (deH - deExp) / Math.sqrt(deVar) : 0, k: rows[0].de.length },
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
  const m = new Map();
  for (const r of rows) {
    let s = m.get(r.slug);
    if (!s) {
      s = {
        slug: r.slug, province: r.province, n: 0,
        loHits: 0, loExp: 0, loVar: 0, loNums: 0,
        deHits: 0, deExp: 0, deVar: 0, deNums: 0,
        loStreak: [], deStreak: [], lastDate: null,
      };
      m.set(r.slug, s);
    }
    const pl = randomHitProb(r.distinct, r.lo.length);
    const pd = r.de.length / 100;
    s.n++;
    s.loHits += r.loHit ? 1 : 0; s.loExp += pl; s.loVar += pl * (1 - pl); s.loNums = r.lo.length;
    s.deHits += r.deHit ? 1 : 0; s.deExp += pd; s.deVar += pd * (1 - pd); s.deNums = r.de.length;
    if (s.loStreak.length < 12) { s.loStreak.push(r.loHit ? 1 : 0); s.deStreak.push(r.deHit ? 1 : 0); }
    if (!s.lastDate || r.date > s.lastDate) s.lastDate = r.date;
  }
  const fin = (h, e, v, n) => ({
    hits: h, rate: n ? h / n : 0, expRate: n ? e / n : 0,
    edge: n ? h / n - e / n : 0, z: v > 0 ? (h - e) / Math.sqrt(v) : 0,
  });
  return [...m.values()]
    .map((s) => ({
      slug: s.slug, province: s.province, n: s.n, lastDate: s.lastDate,
      lo: { ...fin(s.loHits, s.loExp, s.loVar, s.n), k: s.loNums, streak: s.loStreak },
      de: { ...fin(s.deHits, s.deExp, s.deVar, s.n), k: s.deNums, streak: s.deStreak },
    }))
    .sort((a, b) => b.n - a.n || (a.province < b.province ? -1 : 1));
}

// Cam kết đang chờ kết quả (đã ghi, chưa chấm) — để hiện "máy đã đoán, đang chờ đối chiếu".
export const pendingCommits = (ledger) => ledger.commits.filter((c) => !c.graded);
