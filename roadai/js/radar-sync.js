/* ══════════════════════════════════════════════════════════════════════════════
   RoadAI · Driver Radar — TẦNG ĐỒNG BỘ (SYNC ENGINE).

   MỘT CƠ SỞ DỮ LIỆU · MỘT NGUỒN SỰ THẬT · MỌI MÁY CÓ QUYỀN ĐỀU THẤY.

   Đây là NƠI DUY NHẤT trong app nói chuyện với /api/pickups. Giao diện không được
   gọi thẳng; engine cũng không. Ai muốn đẩy dữ liệu lên thì gọi SYNC.dirty().

   ┌──────────────────────── MÔ HÌNH ────────────────────────┐
   │  CENTRAL DATABASE (Supabase · public.butl_sync)         │  ← nguồn sự thật
   │        ▲ ghi đúng MỘT dòng của máy mình  │ đọc bản GỘP  │
   │  ┌─────┴──────┐  ┌────────────┐  ┌───────┴────┐         │
   │  │  MÁY A     │  │  MÁY B     │  │  MÁY C     │         │
   │  └────────────┘  └────────────┘  └────────────┘         │
   └─────────────────────────────────────────────────────────┘
   Mỗi máy giữ ĐÚNG MỘT DÒNG (khoá chính code+device) → 2 máy ghi cùng lúc không đè
   nhau. Máy chủ GỘP các dòng khi đọc, và chính máy chủ (không phải máy con) quyết
   định gộp trùng, xoá, thắng/thua. Máy con chỉ gửi phần đóng góp của riêng nó.

   PHÂN LOẠI DỮ LIỆU (§22) — nhớ cho kỹ, lưu nhầm tầng là sai cả hệ thống:
     GLOBAL  quán/điểm nóng dùng chung ......... /api/spots , /api/quanh  (ai cũng như ai)
     USER    điểm tự nạp · cuốc thật · điểm ẩn . bảng butl_sync theo MÃ TÀI XẾ  ← file này
     DEVICE  trọng số mô hình · cache khu · UI . localStorage máy đó
     ADMIN   chẩn đoán, MÃ BẢN, log ............ chỉ hiện trong màn Chẩn đoán

   BẢO MẬT (§33): trình duyệt KHÔNG cầm khoá Supabase. Mọi thứ đi qua /api/pickups
   chạy trên máy chủ với service_role. Bảng bật RLS và cố tình KHÔNG có policy nào →
   khoá anon (nếu lỡ lộ) cũng không đọc/ghi được dòng nào. App chưa có Supabase Auth,
   nên mở quyền đọc cho anon đồng nghĩa mọi người đọc được dữ liệu của mọi tài xế —
   vì vậy KHÔNG bật Supabase Realtime phía trình duyệt. Xem "VÌ SAO KHÔNG WEBSOCKET".

   VÌ SAO KHÔNG WEBSOCKET MÀ VẪN GỌI LÀ REALTIME:
     · Máy nào ghi gì là ĐẨY LÊN NGAY (không đợi chu kỳ).
     · Các máy còn lại hỏi một câu CỰC RẺ mỗi 12 giây: "dữ liệu có đổi không?"
       (/api/pickups?probe=1 — chỉ đọc cột updated_at, không gộp, không trả nội dung).
       Đổi thì mới kéo bản đầy đủ về.
     · Bật lại màn hình / có mạng lại → hỏi ngay lập tức.
     ⇒ Tài xế KHÔNG phải bấm "đồng bộ", không phải mở lại app, không phải đăng xuất.
       Độ trễ tối đa 12 giây, đúng tinh thần §21, mà không phải mở quyền đọc cơ sở
       dữ liệu cho cả thiên hạ.
   ══════════════════════════════════════════════════════════════════════════════ */
'use strict';

const SYNC = (() => {
  const APP_VER = 'radar-2026.08.12';
  const PROBE_MS = 12000;          // hỏi "có gì mới không" — rẻ, chỉ đọc mốc thời gian
  const FULL_MS = 5 * 60 * 1000;   // kéo bản đầy đủ định kỳ, phòng khi probe lỗi âm thầm
  const PUSH_DEBOUNCE = 900;       // bấm liên tiếp 5 nút thì gộp thành 1 lần gửi
  const BACKOFF = [2000, 4000, 8000, 15000, 30000, 60000];

  const S = RADAR.store, U = RADAR.util, G = RADAR.G;
  const ls = S.ls, lsSet = S.lsSet, rid = S.rid;

  /* ---- DANH TÍNH ----
     MÃ TÀI XẾ = tài khoản (nhiều máy cùng mã = cùng kho dữ liệu).
     MÃ MÁY    = chỉ để quản lý thiết bị, TUYỆT ĐỐI không dùng làm khoá dữ liệu
                 nghiệp vụ (§34) — dữ liệu thuộc về tài xế, không thuộc về cái điện thoại. */
  const CODE_LS = 'roadai_butl_code', DEV_LS = 'roadai_butl_dev';
  const CODE_ABC = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';   // bỏ O/0/I/1 cho khỏi đọc nhầm qua Zalo
  const newCode = () => { let s = ''; for (let i = 0; i < 8; i++) s += CODE_ABC[Math.floor(Math.random() * CODE_ABC.length)]; return s; };
  let CODE = ''; try { CODE = (localStorage.getItem(CODE_LS) || '').toUpperCase(); } catch (e) {}
  if (!/^[A-Z0-9]{6,16}$/.test(CODE)) { CODE = newCode(); try { localStorage.setItem(CODE_LS, CODE); } catch (e) {} }
  let DEV = ''; try { DEV = localStorage.getItem(DEV_LS) || ''; } catch (e) {}
  if (!/^[a-z0-9]{6,24}$/.test(DEV)) { DEV = rid(12); try { localStorage.setItem(DEV_LS, DEV); } catch (e) {} }

  /* ---- HÀNG ĐỢI OFFLINE (§26) ----
     Đường truyền là "gửi TOÀN BỘ phần đóng góp của máy này", nên bản thân nó đã
     idempotent: gửi lại 3 lần cũng ra đúng một kết quả. Hàng đợi ở đây để (a) sống
     sót qua việc tắt app, (b) nói thật với tài xế còn bao nhiêu việc chưa lên được. */
  const Q_LS = 'roadai_butl_queue_v1';
  let QUEUE = (() => { const a = ls(Q_LS, []); return Array.isArray(a) ? a.slice(-200) : []; })();
  const saveQueue = () => lsSet(Q_LS, QUEUE);
  function enqueue(kind, ref) {
    QUEUE.push({ id: 'q' + rid(8), kind, ref: ref || '', ts: Date.now() });
    if (QUEUE.length > 200) QUEUE = QUEUE.slice(-200);
    saveQueue();
  }

  /* ---- CUỐC ĐÃ LÊN TỚI MÁY CHỦ ----
     Cuốc là sự kiện BẤT BIẾN, nên chỉ cần gửi phần CHƯA gửi (delta) → gói qua 4G
     nhẹ hẳn (vài trăm byte thay vì cả trăm KB mỗi lần bấm ✅).
     Máy chủ gộp theo id nên gửi trùng cũng vô hại — đó là ý nghĩa của idempotency key.
     Phòng trường hợp máy chủ mất dòng của máy này: so số cuốc máy chủ báo còn giữ với
     số mình đang có; thiếu là lần sau gửi lại TOÀN BỘ. */
  const SENT_LS = 'roadai_butl_trips_sent_v1';
  let SENT = new Set(ls(SENT_LS, []) || []);
  let FORCE_FULL = SENT.size === 0;
  function markSent(ids) {
    for (const id of ids) SENT.add(id);
    if (SENT.size > 2000) SENT = new Set([...SENT].slice(-2000));
    lsSet(SENT_LS, [...SENT]);
  }

  /* ---- TRẠNG THÁI ---- */
  const st = {
    state: 'idle',        // idle | syncing | offline
    at: 0, rev: null, tag: null, devices: 0, err: null,
    tripsReady: null,     // máy chủ đã có chỗ chứa cuốc chưa (xem migration trong supabase/schema.sql)
    pulls: 0, pushes: 0, fails: 0, conflicts: 0, lastMs: 0,
  };
  let busy = false, pushTimer = null, wantPush = false, failStreak = 0, lastFull = 0, reseeded = false;

  const online = () => (typeof navigator === 'undefined' || navigator.onLine !== false);
  function setState(s, err) {
    st.state = s; st.err = err || null;
    if (window.UI && UI.syncBadge) UI.syncBadge(status());
  }
  function status() {
    return {
      state: st.state,
      dot: st.state === 'syncing' ? '🟡' : st.state === 'offline' ? '🔴' : '🟢',
      vi: st.state === 'syncing' ? 'Đang đồng bộ' : st.state === 'offline' ? 'Mất kết nối' : 'Đã đồng bộ',
      pending: QUEUE.length, at: st.at, rev: st.rev, devices: st.devices, err: st.err,
      code: CODE, dev: DEV, ver: APP_VER, tripsReady: st.tripsReady,
      pulls: st.pulls, pushes: st.pushes, fails: st.fails, conflicts: st.conflicts, lastMs: st.lastMs,
    };
  }

  /* ---- GỌI MÁY CHỦ ---- */
  async function call(opts) {
    const ctl = new AbortController(); const to = setTimeout(() => ctl.abort(), opts.ms || 15000);
    try {
      const r = await fetch(opts.url, Object.assign({ cache: 'no-store', signal: ctl.signal }, opts.init || {}));
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return await r.json();
    } finally { clearTimeout(to); }
  }
  const deviceMeta = () => ({
    id: DEV, app: APP_VER,
    platform: (typeof navigator !== 'undefined' && navigator.platform) ? String(navigator.platform).slice(0, 24) : '',
    seen: Date.now(),
  });

  /* ---- ÁP BẢN ĐÃ GỘP TỪ MÁY CHỦ VÀO KHO ----
     Máy chủ là cấp trên: nó bảo điểm nào bị gộp vào điểm nào, điểm nào đã xoá,
     thì máy con sửa kho RIÊNG của mình cho khớp — không cãi, không tự ghi đè ngược. */
  function applyMerged(j) {
    if (!j || !j.ok) return false;
    const MY = RADAR.picks.my();
    let changed = 0;
    for (const t of (j.tomb || [])) {
      const own = MY.find(p => p.id === t.id); if (!own) continue;
      st.conflicts++;
      if (t.into) {
        const tgt = MY.find(p => p.id === t.into);
        if (tgt) { tgt.n += own.n; tgt.win += own.win; own.del = 1; own.n = 0; own.win = 0; }
        else own.id = t.into;
      } else own.del = 1;
      changed++;
    }
    if (changed) S.saveMyPicks();

    const before = sig();
    /* CHỐT AN TOÀN — KHÔNG BAO GIỜ GHI ĐÈ DỮ LIỆU THẬT BẰNG BẢN TRỐNG (§26).
       Máy chủ chưa có dòng nào (tài xế mới, hoặc vừa đổi mã, hoặc dòng bị mất) mà máy
       này đang có điểm/cuốc thật → GIỮ NGUYÊN bản của máy và đẩy lên, chứ không xoá.
       Không có chốt này thì lần mở app đầu tiên là mất sạch dữ liệu đã tích. */
    const srvTrong = !(j.picks || []).length && !(j.hidden || []).length && !(j.trips || []).length;
    const coCuaMinh = RADAR.picks.live(MY).length || RADAR.trips.mine().length || S.hiddenSet().size;
    if (srvTrong && coCuaMinh) {
      S.rebuildPicksAll();
      FORCE_FULL = true;
      st.rev = j.rev || null; st.devices = j.devices || 1; st.at = Date.now();
      // đẩy lại ĐÚNG MỘT LẦN. Không có chốt này thì máy chủ cứ trả rỗng là app
      // gọi lại mỗi 400ms mãi mãi — nóng máy và ngốn 4G của tài xế.
      if (!reseeded) { reseeded = true; setTimeout(push, 400); }
      RADAR.paint();
      return true;
    }
    reseeded = false;

    S.setPicksAll((j.picks || []).map(p => ({ ...p })));
    // điểm ẩn: máy chủ đã xử last-write-wins theo mốc thời gian, máy con chỉ việc theo
    for (const h of (j.hidden || [])) S.hiddenAdd(h);
    const srv = new Set(j.hidden || []);
    for (const k of [...S.hiddenSet()]) if (!srv.has(k)) S.hiddenDel(k);
    S.saveHidden();
    // cuốc thật của các máy KHÁC → nuôi chung một bộ não (§31 học toàn cục)
    if (Array.isArray(j.trips)) { RADAR.trips.addNet(j.trips, DEV); st.tripsReady = true; }
    else if (j.tripsReady === false) st.tripsReady = false;

    st.rev = j.rev || null; st.devices = j.devices || 1; st.at = Date.now();
    if (sig() !== before) { S.buildSpots(); G.lastBestId = null; RADAR.recompute(); }
    else RADAR.paint();
    return true;
  }
  // vân tay của thứ ẢNH HƯỞNG tới màn hình — đổi thì mới dựng lại bản đồ (đỡ giật)
  function sig() {
    const p = RADAR.picks.all().map(x => x.id + ':' + x.n + ':' + x.win + ':' + x.name + ':' + x.lat + ',' + x.lng).join('|');
    return p + '#' + RADAR.trips.all().length + '#' + S.hiddenSet().size;
  }

  /* ---- ĐẨY LÊN (gửi TOÀN BỘ phần đóng góp của máy này) ---- */
  async function push() {
    if (busy) { wantPush = true; return false; }
    if (!online()) { setState('offline', 'không có mạng'); return false; }
    busy = true; setState('syncing');
    const t0 = Date.now();
    const mark = Date.now();
    const mine = RADAR.trips.mine();
    const full = FORCE_FULL;
    const guiTrips = full ? mine.slice(0, 900) : mine.filter(t => !SENT.has(t.id));
    try {
      const j = await call({
        url: '/api/pickups?code=' + CODE,
        init: {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            deviceId: DEV, device: deviceMeta(),
            picks: RADAR.picks.my(),
            hidden: RADAR.hidden.log(),
            trips: guiTrips, tripsFull: full,
          }),
        },
      });
      if (!j.ok) { st.fails++; setState('idle', j.reason || 'máy chủ từ chối'); return false; }
      st.pushes++; st.tag = j.tag || st.tag; st.lastMs = Date.now() - t0;
      markSent(guiTrips.map(t => t.id));
      FORCE_FULL = j.tripsReady === false ? false
        : (j.mineTrips != null && j.mineTrips < Math.min(900, mine.length));
      applyMerged(j);
      // máy chủ đã nhận → mọi việc xếp hàng TRƯỚC lúc gửi coi như xong
      QUEUE = QUEUE.filter(q => q.ts > mark); saveQueue();
      failStreak = 0; setState('idle');
      return true;
    } catch (e) {
      st.fails++; failStreak++;
      setState(online() ? 'offline' : 'offline', String((e && e.message) || e).slice(0, 60));
      retryLater();
      return false;
    } finally {
      busy = false;
      if (wantPush) { wantPush = false; setTimeout(push, 300); }
    }
  }

  /* ---- KÉO VỀ ---- */
  async function pull() {
    if (busy) return false;
    if (!online()) { setState('offline', 'không có mạng'); return false; }
    busy = true; setState('syncing');
    const t0 = Date.now();
    try {
      const j = await call({ url: '/api/pickups?code=' + CODE });
      if (!j.ok) { st.fails++; setState('idle', j.reason || 'máy chủ từ chối'); return false; }
      st.pulls++; st.tag = j.tag || st.tag; st.lastMs = Date.now() - t0; lastFull = Date.now();
      applyMerged(j);
      failStreak = 0; setState('idle');
      return true;
    } catch (e) {
      st.fails++; failStreak++;
      setState('offline', String((e && e.message) || e).slice(0, 60));
      retryLater();
      return false;
    } finally { busy = false; }
  }

  /* ---- HỎI RẺ: "có gì mới không?" ----
     Chỉ đọc mốc thời gian các dòng, không gộp, không trả nội dung. Vài trăm byte. */
  async function probe() {
    if (busy || !online() || document.visibilityState !== 'visible') return false;
    try {
      const j = await call({ url: '/api/pickups?code=' + CODE + '&probe=1', ms: 8000 });
      if (!j || !j.ok) return false;
      failStreak = 0;
      if (st.state === 'offline') setState('idle');
      if (j.tag && j.tag !== st.tag) { st.tag = j.tag; await pull(); return true; }
      st.at = Date.now();
      return false;
    } catch (e) { failStreak++; setState('offline', 'mất kết nối'); return false; }
  }

  let retryT = null;
  function retryLater() {
    if (retryT) return;
    const ms = BACKOFF[Math.min(failStreak, BACKOFF.length - 1)];
    retryT = setTimeout(() => { retryT = null; if (QUEUE.length) push(); else pull(); }, ms);
  }

  /* ---- CỬA CHO PHẦN CÒN LẠI CỦA APP ----
     Ghi xong cái gì thì gọi dirty('trip') / dirty('pick') / dirty('hide') là xong. */
  function dirty(kind, ref) {
    enqueue(kind || 'op', ref);
    if (window.UI && UI.syncBadge) UI.syncBadge(status());
    clearTimeout(pushTimer);
    pushTimer = setTimeout(push, PUSH_DEBOUNCE);
  }

  /* ---- GHÉP MÁY (§34: một tài khoản, nhiều thiết bị) ---- */
  async function pair(code) {
    const c = String(code || '').trim().toUpperCase();
    if (!/^[A-Z0-9]{6,16}$/.test(c)) return { ok: false, why: 'Mã gồm 6–16 chữ/số.' };
    if (c === CODE) return { ok: false, why: 'Đây đang là mã của máy này.' };
    CODE = c; try { localStorage.setItem(CODE_LS, c); } catch (e) {}
    // mã mới = dòng khác trong kho → phải gửi lại TOÀN BỘ cuốc, không thì máy chủ thiếu
    SENT = new Set(); lsSet(SENT_LS, []); FORCE_FULL = true; st.tag = null;
    const ok = await push();
    return { ok, n: RADAR.picks.live(RADAR.picks.all()).length, trips: RADAR.trips.all().length };
  }
  function newIdentity() {
    CODE = newCode(); try { localStorage.setItem(CODE_LS, CODE); } catch (e) {}
    SENT = new Set(); lsSet(SENT_LS, []); FORCE_FULL = true; st.tag = null;
    return CODE;
  }

  /* ---- KHỞI ĐỘNG ----
     ĐẨY TRƯỚC, KÉO SAU — và bắt buộc phải theo thứ tự này.
     push() vốn trả luôn bản đã gộp nên vẫn là một vòng đi–về. Nếu kéo trước thì máy
     mới toanh sẽ nhận bản rỗng của máy chủ và xoá sạch dữ liệu chưa kịp đẩy lên. */
  function boot() {
    push();
    if (QUEUE.length) setTimeout(push, 1500);  // còn việc tồn từ lần offline → đẩy nốt
    setInterval(() => {
      if (document.visibilityState !== 'visible' || !online()) return;
      if (Date.now() - lastFull > FULL_MS) pull(); else probe();
    }, PROBE_MS);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') probe(); });
    window.addEventListener('online', () => { setState('idle'); if (QUEUE.length) push(); else pull(); });
    window.addEventListener('offline', () => setState('offline', 'không có mạng'));
    setState(online() ? 'idle' : 'offline');
  }

  return { boot, push, pull, probe, dirty, pair, newIdentity, status, get code() { return CODE; }, get dev() { return DEV; } };
})();
if (typeof window !== 'undefined') window.SYNC = SYNC;
