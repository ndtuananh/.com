// ============================================================================
// api/xsmn.js — Collector + kho dữ liệu + BỘ NÃO TỰ HỌC cho Xổ số Miền Nam.
//
// Mỗi lần chạy (cache-miss):
//   1. Lấy kết quả mới nhất từ minhngoc → gộp vào kho Blob.
//   2. (?sync=1) Crawl LÙI để kho dày dần — não càng nhiều dữ liệu càng đo chắc tay.
//   3. CHẤM sổ cam kết: mọi ngày đã ghi số từ trước mà nay đã có kết quả → đối chiếu.
//   4. Chạy não walk-forward trên toàn kho (2 đường: LÔ và ĐỀ).
//   5. GHI cam kết cho ngày kế tiếp (ngày chưa có kết quả) — trước khi quay số.
//   6. Lưu kho + sổ + đẩy Supabase, trả về toàn bộ số liệu đã đo.
//
// GIỜ CRON (vercel.json là JSON thuần, không nhét chú thích vào được):
//   "20 10 * * *" = 10h20 UTC = 17h20 giờ VN. Đài Miền Nam quay ~16h15, kết quả lên
//   nguồn ~16h35 — nên chạy vào 17h20 thì MỘT lượt cron làm xong cả ba việc: chấm sổ
//   cam kết của hôm nay, đẩy lên Supabase, và khoá số cho kỳ NGÀY MAI. Đặt cron trước
//   giờ quay thì phải đợi tới hôm sau mới chấm được, sổ luôn trễ một ngày.
//   /api/notify chạy 15h30 UTC = 22h30 giờ VN, tức là SAU lượt này, nên email in đúng
//   bộ số web đã khoá chứ không sinh ra bộ mới.
// ============================================================================
import { fetchXSMN, xsmnStats } from '../js/minhngoc.js';
import { loadHistory, saveHistory, mergeHistory, addDays, loadLedger, saveLedger } from '../js/xsmn-store.js';
import { brainAnalyze, brainPredict, armStatsFor, randomHitProb, BRAIN_MAX_DAYS, HISTORY_TARGET } from '../js/xsmn-brain.js';
import { addCommit, gradeCommits, ledgerSummary, pendingCommits } from '../js/xsmn-ledger.js';
import { syncForward, syncBackward, checkpoint, freshness, todayICT, committableFrom } from '../js/xsmn-sync.js';
import { pushToSupabase, supabaseEnabled } from '../js/xsmn-supabase.js';

let cache = { at: 0, payload: null };
let lastAutoHeal = 0;             // chống nhiều người cùng ghé làm server crawl chồng lên nhau
const TTL_MS = 5 * 60 * 1000;
const HEAL_COOLDOWN_MS = 60 * 1000;
const FWD_BUDGET_MS = 26000;      // đi tới: việc gấp, ưu tiên giờ
const BACK_BUDGET_MS = 38000;     // đi lùi: dùng phần giờ còn thừa
const HEAL_BUDGET_MS = 9000;      // lượt ghé thường: chỉ vá đủ để không hiện số cũ

// Thay bộ số vừa sinh bằng bộ ĐÃ ĐÓNG DẤU trong sổ cho đúng ngày đó (nếu có).
//
// Tỉ lệ đi kèm phải là thành tích của ĐÚNG NHÁNH ĐÃ KHOÁ, tra lại theo cả đài — số thì
// cố định từ hôm qua, còn thành tích của nhánh thì cập nhật theo dữ liệu mới; hai thứ
// đó khác nhau. Lấy nhầm sang thành tích của nhánh não đang thích HÔM NAY là dán một
// tỉ lệ không liên quan lên một dàn số do nhánh khác sinh ra.
function lockToCommit(ledger, prediction, brain) {
  const c = ledger.commits.find((x) => x.forDate === prediction.forDate);
  if (!c) return prediction;
  const byslug = new Map(c.items.map((it) => [it.slug, it]));
  return {
    ...prediction, lockedAt: c.madeAt,
    provinces: prediction.provinces.map((p) => {
      const it = byslug.get(p.slug);
      if (!it) return p;
      const put = (tk, picks, arm, armName) => {
        const s = armStatsFor(brain, tk, arm, p.slug);
        return { ...p[tk], ...(s || {}), picks, arm, armName: (s && s.armName) || armName };
      };
      return { ...p, lo: put('lo', it.lo, it.loArm, it.loArmName), de: put('de', it.de, it.deArm, it.deArmName) };
    }),
  };
}

export default async function handler(req, res) {
  const q = req.query || {};
  const { warm, sync } = q;
  // Lượt sync phải chạy thật, không được ăn bộ nhớ đệm — nếu không thì "gọi lại để đi
  // tiếp" chỉ là gọi lại để nhận đúng bản cũ.
  if (cache.payload && !warm && !sync && Date.now() - cache.at < TTL_MS) {
    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=86400');
    res.setHeader('X-Cache', 'HIT');
    res.status(200).json(cache.payload);
    return;
  }

  const startedAt = Date.now();
  try {
    const fresh = await fetchXSMN(); // 7 ngày mới nhất, đầy đủ giải, để hiển thị
    if (!fresh.length && !cache.payload) throw new Error('Không lấy được kết quả XSMN từ nguồn');

    // ---- Kho lịch sử: nạp tịnh tiến, lưu theo chặng ----
    const { token, days: stored } = await loadHistory();
    let { merged, added } = mergeHistory(stored, fresh);
    let forwardAdded = 0, backfilled = 0, fwdDone = true, backExhausted = false;
    const save = async (m) => { if (token) await saveHistory(token, m); };
    const ck = checkpoint(save, 7);   // cứ 7 ngày mới thì ghi kho một lần

    if (token && merged.length) {
      // ĐI TỚI trước — bắt kịp hôm nay là việc gấp nhất. Chạy cả ở lượt ghé thường
      // (ngân sách nhỏ) nên kho tự vá kể cả khi cron trục trặc; không ai phải chờ cron.
      const fr = freshness(merged);
      const canHeal = Date.now() - lastAutoHeal > HEAL_COOLDOWN_MS;
      if (sync || (fr.stale && canHeal)) {
        lastAutoHeal = Date.now();
        const f = await syncForward(merged, {
          deadline: startedAt + (sync ? FWD_BUDGET_MS : HEAL_BUDGET_MS),
          maxSteps: sync ? 24 : 3,
          onProgress: ck,
        });
        merged = f.merged; forwardAdded = f.added; fwdDone = f.done;
      }
      // ĐI LÙI sau, bằng phần giờ còn thừa — nhưng CHỈ tới khi kho đủ dày cho cửa sổ
      // của não. Đào sâu hơn nữa là crawl dữ liệu không ai đọc: tốn hạn mức máy chủ,
      // tốn thời gian người dùng chờ, mà tỉ lệ dự báo không nhích lên một điểm nào.
      if (merged.length >= HISTORY_TARGET) {
        backExhausted = true;
      } else if (sync && Date.now() - startedAt < BACK_BUDGET_MS) {
        const b = await syncBackward(merged, { deadline: startedAt + BACK_BUDGET_MS, maxSteps: 40, onProgress: ck });
        merged = b.merged; backfilled = b.added;
        backExhausted = b.exhausted || merged.length >= HISTORY_TARGET;
      }
    }
    const persisted = token ? await saveHistory(token, merged) : false;
    const fresh2 = freshness(merged);

    const history = merged.length ? merged : fresh;
    const forBrain = history.slice(0, BRAIN_MAX_DAYS);
    const nowISO = new Date().toISOString();

    // ---- Sổ cam kết: CHẤM trước, GHI sau ----
    let ledger = token ? await loadLedger(token) : { v: 4, commits: [] };
    const g = gradeCommits(ledger, history, nowISO); ledger = g.ledger;

    // ---- Não ----
    const brain = brainAnalyze(forBrain);

    // KỲ ĐƯỢC DỰ BÁO PHẢI LÀ MỘT KỲ CHƯA QUAY.
    //
    // "Ngày kế tiếp của kho" KHÔNG đủ an toàn: kho chậm 2 ngày thì ngày đó lại nằm trong
    // quá khứ, mà bộ não đã học chính ngày đó — dự báo hoá ra chép đáp án, và sổ đối
    // chiếu sẽ ghi một cú trúng chắc chắn không ai kiếm lại được ngoài đời. Lấy mốc muộn
    // hơn giữa hai cái: ngày sau ngày mới nhất trong kho, và ngày sớm nhất còn được phép
    // cam kết theo giờ quay thật.
    const safeFrom = committableFrom();
    const afterStore = addDays(history[0].date, 1);
    const nextDate = afterStore > safeFrom ? afterStore : safeFrom;
    let prediction = brainPredict(brain, nextDate);
    const c = addCommit(ledger, prediction, nowISO, safeFrom); ledger = c.ledger;

    // SỐ ĐÃ KHOÁ THÌ HIỆN ĐÚNG SỐ ĐÃ KHOÁ.
    // Não học thêm mỗi ngày nên nếu cứ hiện bản mới nhất, con số anh nhìn để mua sẽ
    // KHÁC con số được đem đi chấm điểm trong sổ — sổ hoá ra đo một thứ người dùng
    // chưa từng thấy. Một ngày chỉ có một bộ số, là bộ đã đóng dấu thời gian đầu tiên.
    prediction = lockToCommit(ledger, prediction, brain);

    // CHỈ cron mới được GHI sổ xuống kho. Kho Blob không có khoá ghi: nếu mỗi lượt
    // người dùng ghé cũng ghi đè thì hai lượt trùng nhau sẽ đè mất bản ghi ĐÃ CHẤM của
    // nhau. Lượt thường vẫn chấm và hiện đầy đủ trong bộ nhớ, chỉ không lưu.
    // Chỉ CRON (?warm=1) mới ghi sổ. Kho Blob không có khoá ghi; nếu mọi lượt ghé đều
    // ghi đè thì hai lượt trùng giờ sẽ đè mất bản ĐÃ CHẤM của nhau. Lượt thường vẫn
    // chấm và hiện đầy đủ trong bộ nhớ, chỉ không lưu — lần cron sau lưu lại y hệt.
    const ledgerSaved = token && warm ? await saveLedger(token, ledger) : false;

    const summary = ledgerSummary(ledger, randomHitProb);

    // GẮN TỈ LỆ ĐÃ ĐO VÀO ĐÚNG TẤM THẺ CỦA NÓ.
    //
    // Mỗi đài mang theo hai loại tỉ lệ, cố ý không trộn:
    //   • `track`  — đo trên sổ cam kết: dàn số này, đài này, đã ghi trước khi quay.
    //                Mẫu mỏng nhưng là bằng chứng thật, không sửa được.
    //   • `lo/de.provRate` — đo walk-forward trên toàn kho: mẫu dày gấp nhiều lần nhưng
    //                là máy tự chấm bài mình trên quá khứ.
    // Gộp hai cái thành một con số "cho gọn" là đúng kiểu làm đẹp số liệu — cùng một
    // chữ "tỉ lệ" mà một nửa đến từ bằng chứng, một nửa đến từ tự chấm.
    const provScore = new Map((summary.byProvince || []).map((x) => [x.slug, x]));
    if (prediction && prediction.provinces) {
      prediction = {
        ...prediction,
        provinces: prediction.provinces.map((p) => ({ ...p, track: provScore.get(p.slug) || null })),
      };
    }

    // ---- Kho thứ hai: Supabase (chỉ ở lượt cron/sync — lượt ghé thường không ghi) ----
    let supabase = { enabled: supabaseEnabled(), skipped: true };
    if ((warm || sync) && supabase.enabled) {
      supabase = await pushToSupabase({
        days: history, ledger, byProvince: summary.byProvince,
        snapshotDate: todayICT(), deadline: startedAt + 52000,
      });
    }

    const stats = xsmnStats(history);
    const strip = (t) => ({
      label: t.label, sub: t.sub, headK: t.headK, ks: t.ks, show: t.show,
      arms: t.arms, bandit: t.bandit, bestBase: t.bestBase, avgBaseRate: t.avgBaseRate,
      learnGain: t.learnGain, weights: t.weights, curve: t.curve, holdout: t.holdout,
      evidence: t.evidence, passStat: t.passStat, passHold: t.passHold,
      strongest: t.strongest, verdict: t.verdict,
    });

    const payload = {
      region: 'mien-nam',
      label: 'Xổ số Kiến thiết Miền Nam',
      source: 'minhngoc.net.vn',
      collectedAt: nowISO,
      latestDate: fresh[0] ? fresh[0].date : history[0].date,
      days: fresh,
      db: {
        persisted, totalDays: merged.length,
        oldest: merged.length ? merged[merged.length - 1].date : null,
        newest: merged.length ? merged[0].date : null,
        addedThisRun: added, forwardThisRun: forwardAdded, backfilledThisRun: backfilled,
        brainDays: forBrain.length,
      },
      // `more` = còn việc dở dang. Trang web thấy cờ này sẽ tự gọi lại để đi tiếp, nên
      // kho bò dần tới đích qua nhiều lượt thay vì gãy giữa chừng vì hết giờ hàm.
      sync: {
        today: fresh2.today, newest: fresh2.newest, daysBehind: fresh2.daysBehind, stale: fresh2.stale,
        forwardDone: fwdDone, backExhausted, historyTarget: HISTORY_TARGET,
        more: !fwdDone || (!!sync && !backExhausted),
      },
      stats,
      brain: { version: brain.version, gradedDraws: brain.gradedDraws, lo: strip(brain.lo), de: strip(brain.de) },
      prediction,
      ledger: {
        saved: ledgerSaved, gradedNow: g.gradedNow, committedNow: c.added,
        pending: pendingCommits(ledger).map((x) => ({ forDate: x.forDate, madeAt: x.madeAt, items: x.items })),
        summary,
      },
      supabase,
    };
    cache = { at: Date.now(), payload };
    // Lượt ĐỌC thường vẫn để CDN giữ 5 phút: mọi máy cùng thấy một bản chụp, số không
    // lệch nhau giữa các thiết bị. Nhưng lượt SYNC là lệnh GHI — để CDN cache nó thì
    // gọi lại 10 lần vẫn nhận đúng bản cũ, kho đứng yên mà nhìn như đang chạy.
    res.setHeader('Cache-Control', warm || sync ? 'no-store' : 's-maxage=300, stale-while-revalidate=86400');
    res.setHeader('X-Cache', 'MISS');
    res.status(200).json(payload);
  } catch (e) {
    if (cache.payload) { res.setHeader('X-Cache', 'STALE'); res.status(200).json(cache.payload); return; }
    res.status(502).json({ error: 'Thu thập XSMN thất bại', detail: String(e.message || e) });
  }
}
