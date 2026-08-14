/* ══════════════════════════════════════════════════════════════════════════════
   RoadAI · Driver Radar — TẦNG GIAO DIỆN.

   TRIẾT LÝ: "AI làm việc phức tạp ở phía sau — tài xế chỉ nhìn thấy quyết định cần làm."

   Màn hình chính trả lời đúng 4 câu, không hơn:
     ① Tôi đang ở đâu?            → bản đồ + chấm xanh
     ② Có nên nhận khách không?   → thanh trạng thái 🟢/🟡/🔴
     ③ Khu nào đáng đứng?         → chấm % trên bản đồ + thẻ dưới cùng
     ④ Khi nào dễ có cuốc?        → 82% · trong 30 phút

   File này ĐỌC DUY NHẤT một vật: RADAR.decision() — xem PHẦN 7 của js/positioning.js.
   Nó KHÔNG được biết OSM, Overture, Digital Twin, theta, feature, rev, sync là gì.
   Mấy thứ đó vẫn chạy đủ ở dưới, chỉ là không leo lên màn hình của bác tài.

   BA TẦNG THÔNG TIN (progressive disclosure §12):
     TẦNG 1 · TÀI XẾ   "82% · Nên đi Bình Tân"           ← màn chính, luôn thấy
     TẦNG 2 · CHI TIẾT bấm "Vì sao?" / "Xem chi tiết"     ← lý do, thống kê thật
     TẦNG 3 · KỸ THUẬT ⚙️ → Chẩn đoán hệ thống            ← OSM, MÃ BẢN, đồng bộ, log
   ══════════════════════════════════════════════════════════════════════════════ */
'use strict';

const UI = (() => {
  const $ = s => document.querySelector(s);
  const $$ = s => [...document.querySelectorAll(s)];
  const U = RADAR.util, K = RADAR.K, G = RADAR.G, A = RADAR.act;
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  /* ── MÀU THEO TRẠNG THÁI (§11: màu chỉ để biểu thị trạng thái, không trang trí) ── */
  const TONE = {
    HOT:  { c: '#f97316', ico: '🔥', bar: '🟢', barTxt: 'ĐANG CÓ KHÁCH' },
    OK:   { c: '#eab308', ico: '🟡', bar: '🟡', barTxt: 'CHỜ KHÁCH' },
    LOW:  { c: '#94a3b8', ico: '🔴', bar: '🔴', barTxt: 'ÍT CẦU' },
    REST: { c: '#64748b', ico: '🌙', bar: '⏰', barTxt: 'CHƯA TỚI GIỜ' },
    OFF:  { c: '#64748b', ico: '⏸️', bar: '⏸️', barTxt: 'ĐANG NGHỈ' },
  };
  const toneOf = d => TONE[d && d.status] || TONE.LOW;
  // nhãn ngắn cho 4 loại ngày — cắt K.DAY_VI theo dấu cách ra 2 chữ "Ngày" trùng nhau
  const DAY_SHORT = { weekday: 'Thường', weekend: 'Cuối tuần', payday: 'Ngày lương', holiday: 'Lễ/Tết' };
  /* "14:32 hôm nay" dễ đọc hơn "12/08/2026 14:32:07" khi đang cầm lái.
     Quá 1 ngày mới hiện ngày tháng. */
  function lucNao(ms) {
    if (!ms) return 'chưa nạp';
    const d = new Date(ms), n = new Date(), gio = d.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
    const cach = Math.floor((n - d) / 60000);
    if (cach < 1) return 'vừa xong';
    if (cach < 60) return cach + ' phút trước';
    if (d.toDateString() === n.toDateString()) return gio + ' hôm nay';
    return d.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' }) + ' ' + gio;
  }
  // lần nạp gần nhất = khu mới nhất trong sổ, hoặc lần làm mới danh sách dùng chung
  const napAt = () => Math.max(
    (RADAR.vung.live()[0] ? Math.max(...RADAR.vung.live().map(z => z.ts || 0)) : 0),
    (G.dataStatus && (G.dataStatus.napAt || G.dataStatus.checkedAt)) || 0);

  /* ═════════════ THÔNG BÁO NGẮN ═════════════ */
  let toastT;
  function toast(msg, ms) {
    const t = $('#toast'); if (!t) return;
    t.textContent = msg; t.hidden = false;
    clearTimeout(toastT); toastT = setTimeout(() => t.hidden = true, ms || 2600);
  }

  /* ═════════════ BẢN ĐỒ ═════════════ */
  const OSM = {
    dark: { url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', sub: 'abcd' },
    light: { url: 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', sub: 'abcd' },
  };
  let map, baseLayer, meMarker, ringLayer, pinLayer, lineLayer;
  let lastSig = '';
  let vuaThem = null, vuaThemT = null;   // điểm vừa lưu — nhấp nháy 12 giây cho tài xế thấy
  /* Lưu xong phải CHỈ TẬN NƠI: bay tới, làm chấm nổi hẳn lên, và mở luôn thẻ chi
     tiết. Không có bước này thì chấm mới lẫn giữa mấy chục chấm khác, tài xế bấm
     LƯU xong nhìn màn hình không thấy gì và tưởng app nuốt mất dữ liệu. */
  function chiTanNoi(pid) {
    vuaThem = pid;
    clearTimeout(vuaThemT);
    vuaThemT = setTimeout(() => { vuaThem = null; lastSig = ''; drawPins(G.metrics); }, 12000);
    const sp = RADAR.spots().find(s => s.pid === pid);
    if (!sp) return;
    lastSig = '';
    if (map) map.setView([sp.lat, sp.lng], Math.max(16, map.getZoom()));
    drawPins(G.metrics);
    const r = RADAR.findR(sp.id);
    if (r) setTimeout(() => openSpot(r), 260);
  }

  function initMap() {
    map = L.map('map', { zoomControl: false, attributionControl: false, tap: false })
      .setView([G.you.lat, G.you.lng], 14);
    setBase(G.base);
    ringLayer = L.layerGroup().addTo(map);   // vùng phủ sóng + quầng nhiệt (nền)
    lineLayer = L.layerGroup().addTo(map);   // đường tới điểm + cung đường
    pinLayer = L.layerGroup().addTo(map);    // chấm điểm (trên cùng)
    // Kéo/thu phóng xong mới vẽ lại chấm — vẽ trong lúc kéo là giật máy yếu.
    map.on('moveend zoomend', () => drawPins(G.metrics));
  }
  function setBase(b) {
    G.base = b; try { localStorage.setItem('roadai_butl_base', b); } catch (e) {}
    if (baseLayer) map.removeLayer(baseLayer);
    const st = OSM[b] || OSM.dark;
    baseLayer = L.tileLayer(st.url, { maxZoom: 20, subdomains: st.sub }).addTo(map);
    document.body.classList.toggle('light-base', b === 'light');
  }
  function moveMe(pt) {
    if (!meMarker) {
      const icon = L.divIcon({ className: '', html: '<div class="me-dot"></div>', iconSize: [22, 22], iconAnchor: [11, 11] });
      meMarker = L.marker([pt.lat, pt.lng], { icon, zIndexOffset: 1200, draggable: true }).addTo(map);
      // Kéo tay cái chấm = tài xế tự chỉ chỗ đứng (dùng khi GPS hỏng). KHÔNG phải GPS thật.
      meMarker.on('dragend', e => {
        const p = e.target.getLatLng();
        A.setYou(p.lat, p.lng, false); G.youFromGps = false; G.lastBestId = null;
        RADAR.recompute();
      });
    } else meMarker.setLatLng([pt.lat, pt.lng]);
  }
  function centerMap(fly) {
    if (!map) return;
    map.setView([G.you.lat, G.you.lng], Math.max(14, map.getZoom()), { animate: !!fly });
  }

  /* ── CHỌN THỨ ĐÁNG VẼ ──
     Bản đồ KHÔNG phải chỗ đổ hết dữ liệu. Chỉ vẽ điểm CÓ GIÁ TRỊ DỰ BÁO:
       · ngoài giờ lái hộ → chỉ điểm đón thật (chỗ đã nổ cuốc)
       · trong giờ       → 30 chỗ mạnh nhất đang mở trong 5km + mọi điểm đón thật
     Quán đang đóng / ngoài 5km: không vẽ (bật lại trong Chẩn đoán nếu cần soi). */
  function drawable(m) {
    if (!m) return [];
    const hop = r => r.dist <= K.COVER_R;
    if (G.hienHet) return m.raw.slice(0, 400);
    if (m.offHours) return m.raw.filter(r => hop(r) && (r.sp.source === 'butl' || r.sp.source === 'mine'));
    const manh = m.byHot.filter(r => r.open && hop(r)).slice(0, 30);
    const don = m.raw.filter(r => hop(r) && (r.sp.source === 'butl' || r.sp.source === 'mine'));
    const seen = new Set();
    return [...manh, ...don, ...(m.best ? [m.best] : [])].filter(r => !seen.has(r.sp.id) && seen.add(r.sp.id));
  }
  /* GOM CỤM (§3) — chấm nào nằm trong cùng ô 58 pixel thì gộp thành một bong bóng
     "N điểm · 82%". Không gom thì zoom xa là một rừng chấm chồng nhau, tài xế
     không đọc ra cái gì. Điểm ⭐ và điểm đón THẬT không bao giờ bị gộp. */
  function clusterize(list, cell) {
    const box = new Map(), solo = [];
    for (const r of list) {
      if (r.isBest || r.sp.source === 'butl' || r.sp.source === 'mine') { solo.push(r); continue; }
      const p = map.latLngToLayerPoint([r.sp.lat, r.sp.lng]);
      const k = Math.floor(p.x / cell) + ',' + Math.floor(p.y / cell);
      const g = box.get(k); if (g) g.push(r); else box.set(k, [r]);
    }
    const out = [];
    for (const g of box.values()) {
      if (g.length === 1) { out.push({ solo: g[0] }); continue; }
      g.sort((a, b) => b.p - a.p);
      const lat = g.reduce((s, r) => s + r.sp.lat, 0) / g.length;
      const lng = g.reduce((s, r) => s + r.sp.lng, 0) / g.length;
      out.push({ group: g, lat, lng, top: g[0] });
    }
    for (const r of solo) out.push({ solo: r });
    return out;
  }
  const pinTone = r => r.p >= 0.5 ? TONE.HOT : r.p >= 0.35 ? TONE.OK : TONE.LOW;

  function drawPins(m) {
    if (!map || !pinLayer) return;
    const list = drawable(m);
    const b = map.getBounds().pad(0.25);
    // LAZY: chỉ dựng chấm nằm trong khung đang nhìn (+25% viền) — ngoài viewport thì thôi
    const view = list.filter(r => b.contains([r.sp.lat, r.sp.lng]));
    const sig = map.getZoom() + '|' + Math.round(b.getWest() * 1e3) + ',' + Math.round(b.getSouth() * 1e3) +
      '|' + view.map(r => r.sp.id + r.tier + (r.isBest ? '*' : '')).join(',');
    if (sig === lastSig) return;      // không có gì đổi → không đụng vào DOM
    lastSig = sig;
    pinLayer.clearLayers();
    for (const c of clusterize(view, 58)) {
      if (c.group) {
        const t = pinTone(c.top);
        const icon = L.divIcon({ className: '', iconSize: [46, 46], iconAnchor: [23, 23],
          html: `<div class="pin pin-grp" style="--c:${t.c}"><b>${Math.round(c.top.p * 100)}<i>%</i></b><em>${c.group.length}</em></div>` });
        L.marker([c.lat, c.lng], { icon, zIndexOffset: 300 }).addTo(pinLayer)
          .on('click', () => map.setView([c.lat, c.lng], Math.min(18, map.getZoom() + 2)));
        continue;
      }
      const r = c.solo, t = pinTone(r), real = r.sp.source === 'butl' || r.sp.source === 'mine';
      /* HẠNG trong bảng xếp hạng DUY NHẤT (byHot) — đây là thứ trả lời "khu nào
         đáng đứng". Giờ vắng thì mọi quán đều 2%: con số đúng nhưng nhìn vào
         không biết đi đâu. Hạng ①②③ vẫn chỉ ra được chỗ tốt nhất quanh mình,
         mà không phải bịa cho con số % đẹp lên. */
      const hang = r.hotRank != null && r.hotRank < 3 ? r.hotRank + 1 : 0;
      /* ĐIỂM CỦA CHÍNH TÀI XẾ KHÔNG BAO GIỜ BỊ LÀM MỜ.
         Lỗi anh Long báo "lưu xong không thấy hiện lên bản đồ": điểm vừa thêm lúc
         8h sáng bị coi là "quán chưa mở" → vẽ thành chấm xám mờ 40% với đúng một
         dấu chấm, trên nền bản đồ đen thì coi như vô hình. Quán trên bản đồ đóng
         cửa thì làm mờ được, chứ dữ liệu do tài xế tự nhập thì phải luôn thấy rõ. */
      const moi = vuaThem && r.sp.pid === vuaThem;
      const cls = 'pin' + (r.isBest ? ' pin-best' : hang ? ' pin-top' : '') +
        (real ? ' pin-real' : '') + (r.open || real ? '' : ' pin-off') + (moi ? ' pin-new' : '');
      const sz = r.isBest ? 56 : (hang || moi) ? 46 : 40;
      const face = r.open
        ? `<b>${r.hotScore}<i>%</i></b>` +
          (r.isBest ? '<span class="pin-star">⭐</span>'
           : hang ? `<span class="pin-rank">${hang}</span>`
           : r.p >= 0.5 ? '<span class="pin-star">🔥</span>' : '')
        : real ? '<b class="pin-dd">📍</b>' : '<b class="pin-x">·</b>';
      const icon = L.divIcon({ className: '', iconSize: [sz, sz], iconAnchor: [sz / 2, sz / 2],
        html: `<div class="${cls}" style="--c:${t.c}">${face}</div>` });
      L.marker([r.sp.lat, r.sp.lng], { icon, zIndexOffset: r.isBest ? 1000 : hang ? 900 : real ? 600 : r.tier * 100 })
        .addTo(pinLayer).on('click', () => openSpot(r));
    }
    /* 🅿️ ĐIỂM CHỜ TỐI ƯU — chỗ đứng giữa cụm quán để với tới nhiều chỗ cùng lúc.
       Đây mới đúng là "vị trí tốt nhất để đứng"; bản refactor trước làm mất nó. */
    const w = m && m.wait && m.wait.cnt >= 3 ? m.wait : null;
    if (w && G.showForecast && b.contains([w.center.lat, w.center.lng])) {
      const wi = L.divIcon({ className: '', iconSize: [46, 46], iconAnchor: [23, 23],
        html: '<div class="pin pin-wait"><b>🅿️</b></div>' });
      L.marker([w.center.lat, w.center.lng], { icon: wi, zIndexOffset: 950 }).addTo(pinLayer)
        .on('click', openWait);
    }
  }
  /* POPUP 🅿️ — phải có ĐI ĐẾN và phải kể tên quán trong cụm.
     Trước đây bấm vào chỉ hiện một dòng chữ rồi thôi: biết là chỗ tốt mà không
     có đường nào tới, cũng không biết đứng đó thì quanh mình có quán nào. */
  function openWait() {
    const d = G.decision, w = d && d.wait;
    if (!w) return;
    const ds = (w.spots || []).map(s => `<button class="wl" data-go="${s.id}">
        <i>${s.p}<em>%</em></i>
        <div><b>${esc(s.name)}${s.xe ? ' ' + K.XE_ICON[s.xe] : ''}</b><small>cách ${s.m} m${s.addr ? ' · ' + esc(s.addr) : ''}</small></div>
        <span>›</span></button>`).join('');
    const html = `<div class="pop">
      <div class="pop-h" style="--c:#fcd34d"><b>🅿️ Điểm chờ tối ưu</b><em>${w.n}</em></div>
      <div class="pop-s">Đứng giữa cụm <b>${w.n} quán</b> trong bán kính đi bộ 750 m · cách bạn ${w.km} km · ~${w.eta} phút</div>
      <a class="pop-go" href="${esc(w.nav)}" target="_blank" rel="noopener">🧭 ĐI ĐẾN CHỖ ĐỨNG</a>
      ${ds ? `<div class="wlist">${ds}</div>` : ''}
      <div class="pop-n">Đây là chỗ ĐỨNG CHỜ giữa cụm, không phải địa chỉ quán — bấm tên quán ở trên để dẫn thẳng tới quán đó.</div>
    </div>`;
    const pop = L.popup({ className: 'sp-popup', maxWidth: 290, closeButton: false })
      .setLatLng([w.lat, w.lng]).setContent(html).openOn(map);
    let n = 0;
    (function bind() {
      const root = pop.getElement && pop.getElement();
      if (!root) { if (n++ < 5) setTimeout(bind, 40); return; }
      root.querySelectorAll('[data-go]').forEach(b => b.onclick = () => {
        const r = RADAR.findR(b.dataset.go);
        if (r) { map.closePopup(); map.setView([r.sp.lat, r.sp.lng], Math.max(16, map.getZoom())); openSpot(r); }
      });
    })();
  }
  /* Nền: vùng phủ sóng 5km + quầng nhiệt + đường tới điểm.
     Chỉ vẽ lại khi thứ liên quan đổi — không đụng tới layer chấm. */
  let lastRing = '';
  function drawRings(m) {
    if (!map || !m) return;
    const sig = [G.you.lat.toFixed(4), G.you.lng.toFixed(4), G.showForecast ? 1 : 0,
      m.best ? m.best.sp.id : '-', m.route ? m.route.seq.map(r => r.sp.id).join('') : '-',
      m.wait ? m.wait.center.lat.toFixed(4) : '-'].join('|');
    if (sig === lastRing) return;
    lastRing = sig;
    ringLayer.clearLayers(); lineLayer.clearLayers();
    // vòng đi bộ 750m quanh điểm chờ tối ưu
    const w0 = m.wait && m.wait.cnt >= 3 ? m.wait : null;
    if (w0 && G.showForecast) {
      L.circle([w0.center.lat, w0.center.lng], { radius: 750, color: '#0b1220', weight: 7, opacity: .45, fillOpacity: 0, interactive: false }).addTo(ringLayer);
      L.circle([w0.center.lat, w0.center.lng], { radius: 750, color: '#fcd34d', weight: 2.5, opacity: .95, dashArray: '8 7', fillColor: '#fbbf24', fillOpacity: .1, interactive: false }).addTo(ringLayer);
    }
    // vùng phủ sóng — viền tối lót dưới nên nổi hẳn trên bản đồ đêm
    L.circle([G.you.lat, G.you.lng], { radius: K.COVER_R, color: '#04121f', weight: 8, opacity: .5, fillOpacity: 0, interactive: false }).addTo(ringLayer);
    L.circle([G.you.lat, G.you.lng], { radius: K.COVER_R, color: '#7dd3fc', weight: 3, opacity: .9, dashArray: '14 10', fillColor: '#38bdf8', fillOpacity: .05, interactive: false }).addTo(ringLayer);
    if (!G.showForecast) return;
    // quầng nhiệt CHỈ cho 10 chỗ mạnh nhất — vẽ hết thì cả bản đồ là một đám mây
    for (const r of (m.byHot || []).slice(0, 10)) {
      if (!r.open) continue;
      const c = pinTone(r).c;
      L.circle([r.sp.lat, r.sp.lng], { radius: 180 + r.sDemand * 320, color: c, weight: 1.5, opacity: .5, fillColor: c, fillOpacity: 0.05 + r.sDemand * 0.09, interactive: false }).addTo(ringLayer);
    }
    if (m.best) L.polyline([[G.you.lat, G.you.lng], [m.best.sp.lat, m.best.sp.lng]],
      { color: '#5eead4', weight: 4, opacity: .95, dashArray: '8 9', lineCap: 'round', interactive: false }).addTo(lineLayer);
    if (m.route) {
      const pts = [[G.you.lat, G.you.lng], ...m.route.seq.map(r => [r.sp.lat, r.sp.lng])];
      L.polyline(pts, { color: '#0b1220', weight: 10, opacity: .5, lineCap: 'round', interactive: false }).addTo(lineLayer);
      L.polyline(pts, { color: '#fbbf24', weight: 5, opacity: .85, lineCap: 'round', interactive: false }).addTo(lineLayer);
    }
  }

  /* ═════════════ ① THANH TRẠNG THÁI (trên cùng — 1 dòng, hết) ═════════════ */
  function paintTop(d) {
    const t = toneOf(d);
    const el = $('#statusbar'); if (!el) return;
    const wx = d.temp != null ? ` · ${d.temp}°` : '';
    el.innerHTML = `
      <button id="tb-state" class="tb-state" style="--c:${t.c}">${t.bar} ${t.barTxt}</button>
      <span class="tb-clock">${esc(d.clock)}${wx}</span>
      <button id="tb-online" class="tb-go${G.online ? ' on' : ''}">${G.online ? 'Nhận khách' : 'Nghỉ'}</button>`;
    $('#tb-online').onclick = () => { A.setOnline(!G.online); toast(G.online ? 'Đang nhận khách' : 'Đã nghỉ'); };
    $('#tb-state').onclick = () => openSheet('#sheet-why');
  }

  /* ═════════════ ② THẺ QUYẾT ĐỊNH (dưới cùng — thứ tài xế nhìn 2 giây) ═════════════ */
  function paintCard(d) {
    const box = $('#card'); if (!box) return;
    const t = toneOf(d);
    if (G.pendingLog) return paintLogCard();
    if (!d.ok) {
      box.className = 'card glass card-quiet';
      box.innerHTML = `<div class="c-quiet"><b>${esc(d.headline || '—')}</b><span>${esc(d.sub || '')}</span>
        ${!G.online ? '<button id="c-on" class="c-go">BẮT ĐẦU</button>' : ''}</div>`;
      const b = $('#c-on'); if (b) b.onclick = () => A.setOnline(true);
      return;
    }
    const head = d.action === 'STAY' ? '🟢 ĐANG Ở ĐIỂM TỐT'
               : d.action === 'WAIT' ? '🟡 CHƯA NÊN ĐI'
               : d.status === 'HOT' ? '🔥 ĐIỂM NÓNG' : '🟢 NÊN ĐỨNG';
    const veh = d.vehicle ? ` ${K.XE_ICON[d.vehicle]}` : '';
    box.className = 'card glass';
    box.innerHTML = `
      <div class="c-top" style="--c:${t.c}"><span class="c-tag">${head}</span>
        <button id="c-why" class="c-why">Vì sao?</button></div>
      <div class="c-main">
        <button id="c-name" class="c-name"><b>${esc(d.recommended_name)}${veh}</b>
          <small>${esc(d.recommended_area)}${d.here ? ' · bạn đang ở đây' : ` · ${d.distance} km · ${d.eta} phút`}</small></button>
        <div class="c-p" style="--c:${t.c}"><b>${d.demand_score}<i>%</i></b><small>trong 30 phút</small></div>
      </div>
      ${d.peak ? `<button id="c-peak" class="c-peak">⏰ <b>${esc(d.peak.at)}</b> chỗ này lên <b>${d.peak.p}%</b>${d.peak.name !== d.recommended_name ? ` ở <b>${esc(d.peak.name)}</b>` : ''} — nghỉ tới đó</button>` : ''}
      ${!d.peak && d.wait && !d.here ? `<button id="c-wait" class="c-peak">🅿️ Đứng giữa cụm <b>${d.wait.n} điểm</b> · cách ${d.wait.km} km — phủ nhiều chỗ cùng lúc</button>` : ''}
      <div class="c-act">
        <a id="c-go" class="c-go" href="${esc(d.nav)}" target="_blank" rel="noopener">${d.here ? '🧭 MỞ BẢN ĐỒ' : 'ĐI ĐẾN'}</a>
        <button id="c-skip" class="c-alt" title="Đề xuất điểm khác">↻</button>
      </div>`;
    $('#c-why').onclick = () => openSheet('#sheet-why');
    // Bấm tên → bản đồ bay tới đúng chỗ đó. Điểm tốt nhất hay nằm ngoài khung
    // đang nhìn (4km), tài xế nhìn bản đồ toàn 2% mà không thấy ⭐ đâu.
    $('#c-name').onclick = () => { const r = RADAR.findR(d.spot_id); if (r) { map.setView([r.sp.lat, r.sp.lng], Math.max(15, map.getZoom())); openSpot(r); } };
    const pk = $('#c-peak'); if (pk) pk.onclick = () => openSheet('#sheet-why');
    const wt = $('#c-wait'); if (wt) wt.onclick = () => { map.setView([d.wait.lat, d.wait.lng], Math.max(15, map.getZoom())); openWait(); };
    $('#c-skip').onclick = () => {
      const nb = A.skipBest();
      toast(nb ? '↪ ' + U.cleanName(nb.sp) : 'Đã xem hết điểm gần đây');
    };
    $('#c-go').onclick = () => { G.session.suggested++; G.session.accepted++; };
  }
  /* Ghi cuốc ngay trên thẻ — 3 nút to, bấm được bằng ngón cái lúc đang cầm lái. */
  function paintLogCard() {
    const r = G.pendingLog, box = $('#card');
    box.className = 'card glass';
    box.innerHTML = `
      <div class="c-top"><span class="c-tag">📝 GHI KẾT QUẢ</span><button id="c-cancel" class="c-why">Bỏ qua</button></div>
      <div class="c-log-name">${esc(U.cleanName(r.sp))}</div>
      <div class="c-log">
        <button id="lg-yes" class="lg lg-yes">✅ CÓ KHÁCH</button>
        <button id="lg-busy" class="lg lg-busy">👀 ĐANG ĐÔNG</button>
        <button id="lg-no" class="lg lg-no">❌ CHƯA CÓ</button>
      </div>`;
    $('#c-cancel').onclick = () => { G.pendingLog = null; paint(G.metrics, G.decision); };
    $('#lg-yes').onclick = () => {
      box.querySelector('.c-log').innerHTML =
        `<button id="lg-oto" class="lg lg-half">🚗 Ô TÔ</button><button id="lg-may" class="lg lg-half">🏍️ XE MÁY</button>`;
      $('#lg-oto').onclick = () => doLog(r, true, 'oto');
      $('#lg-may').onclick = () => doLog(r, true, 'may');
    };
    $('#lg-busy').onclick = () => {
      const { cho } = A.logDong(r); SYNC.dirty('trip');
      toast(cho && cho.n >= 2
        ? `Đã ghi · khung này ${cho.no}/${cho.n} lần có cuốc trong 90 phút`
        : 'Đã ghi: quán đang đông', 4000);
    };
    $('#lg-no').onclick = () => doLog(r, false, '');
  }
  function doLog(r, win, xe) {
    const { captured } = A.logJob(r, win, xe);
    SYNC.dirty('trip');
    if (captured) SYNC.dirty('pick');
    const o = U.empOf(U.spotKey(r.sp));
    toast(win ? `✓ Đã ghi cuốc${o ? ` · điểm này ${o.win}/${o.n}` : ''}` : '✓ Đã ghi: chưa có khách', 3400);
  }

  /* ═════════════ ③ TẦNG 2 — "VÌ SAO?" ═════════════ */
  function paintWhy() {
    const el = $('#why-body'); if (!el) return;
    const d = G.decision, m = G.metrics;
    if (!d || !d.ok) { el.innerHTML = `<p class="hint">${esc(d && d.sub || 'Chưa có điểm nào để giải thích.')}</p>`; return; }
    const near = (m && m.cover) || [];
    const hot = near.filter(r => r.p >= 0.5).length;
    // Điểm chờ giữa cụm — chỉ nhắc khi nó thật sự phủ được nhiều chỗ hơn đứng ngay điểm đề xuất.
    const w = m && m.wait && m.wait.cnt >= 3 ? m.wait : null;
    el.innerHTML = `
      <div class="why-hero"><b>${d.demand_score}%</b><span>Khả năng có khách trong 30 phút<br>tại <b>${esc(d.recommended_name)}</b></span></div>
      <div class="why-rows">
        ${d.peak ? `<div class="why-r"><span>⏰</span>Quanh đây giờ này gần như không ai gọi lái hộ. Đáng đi nhất là <b>${esc(d.peak.at)}</b> — lúc đó <b>${esc(d.peak.name)}</b> lên <b>${d.peak.p}%</b>. Con số này chạy đúng công thức đang dùng, chỉ đổi giờ; tới giờ mở app ra sẽ thấy y hệt.</div>` : ''}
        ${d.reasons.map(r => `<div class="why-r"><span>${r.ico}</span>${esc(r.t)}</div>`).join('') || '<div class="why-r"><span>ℹ️</span>Chưa đủ cuốc thật ở đây để nói chắc — ghi vài cuốc nữa app sẽ nói rõ hơn.</div>'}
        ${w ? `<div class="why-r"><span>🅿️</span>Đứng giữa cụm <b>${w.cnt} điểm</b> (cách ${U.fmtDist(w.distYou)}) thì phủ được nhiều chỗ cùng lúc —
          <a href="${esc(U.gmapsDir(w.center.lat, w.center.lng))}" target="_blank" rel="noopener">mở chỗ đó</a></div>` : ''}
      </div>
      <p class="hint">Trên bản đồ: ⭐ là chỗ tốt nhất, ② ③ là hai chỗ kế tiếp, 🅿️ là chỗ đứng giữa cụm. Giờ vắng thì mọi chỗ đều vài phần trăm — con số đúng như vậy, nhưng thứ hạng vẫn chỉ ra được chỗ nào hơn.</p>
      <div class="why-grid">
        <div><b>${d.distance} km</b><span>Khoảng cách</span></div>
        <div><b>${d.eta} phút</b><span>Tới nơi</span></div>
        <div><b>~${d.estimated_wait} phút</b><span>Chờ tại điểm</span></div>
        <div><b>${d.confidence}%</b><span>Độ tin cậy</span></div>
        ${d.close_in != null ? `<div><b>${d.close_in} phút</b><span>Nữa tan quán</span></div>` : ''}
        <div><b>${near.length}</b><span>Điểm đang mở gần</span></div>
      </div>
      <p class="hint">Trong 5 km quanh bạn có <b>${near.length}</b> điểm đang mở, <b>${hot}</b> chỗ đạt trên 50%.
      Độ tin cậy tính từ số cuốc thật đã ghi ở điểm này và độ chính xác dự báo đo được của app.</p>`;
  }

  /* ═════════════ ④ ĐIỀU PHỐI — 3 CON SỐ, HẾT ═════════════ */
  function paintDash() {
    const el = $('#dash-body'); if (!el || $('#sheet-dash').hidden) return;
    const rs = RADAR.stats.jobs();
    const m = G.metrics;
    const avg = m && m.cover && m.cover.length ? Math.round(m.cover.reduce((s, r) => s + r.eta, 0) / m.cover.length) : 0;
    const top = rs && rs.quan[0], hr = rs && rs.hour[0];
    el.innerHTML = `
      <div class="kpis">
        <div class="kpi"><b>${rs ? Math.round(rs.rate * 100) : 0}<i>%</i></b><span>Tỷ lệ có khách</span></div>
        <div class="kpi"><b>${avg}<i> ph</i></b><span>Thời gian tới điểm</span></div>
        <div class="kpi"><b>${rs ? rs.wins : 0}</b><span>Cuốc thành công</span></div>
      </div>
      ${top ? `<div class="best-row"><span>🔥</span><div><b>${esc(top.k)}</b><small>Điểm bạn hiệu quả nhất</small></div><em>${Math.round(top.r * 100)}%</em></div>` : ''}
      ${hr ? `<div class="best-row"><span>🌙</span><div><b>${esc(hr.k)}</b><small>Khung giờ tốt nhất</small></div><em>${Math.round(hr.r * 100)}%</em></div>` : ''}
      ${!rs ? '<p class="hint">Chưa có cuốc nào được ghi. Sau mỗi lần đứng chờ, bấm ✅ hoặc ❌ ở thẻ dưới màn hình — app học từ đó.</p>' : ''}
      <button id="dash-more" class="more">XEM CHI TIẾT</button>
      <div id="dash-detail" hidden></div>`;
    $('#dash-more').onclick = () => {
      const box = $('#dash-detail');
      box.hidden = !box.hidden;
      $('#dash-more').textContent = box.hidden ? 'XEM CHI TIẾT' : 'THU GỌN';
      if (!box.hidden) box.innerHTML = dashDetail();
    };
  }
  /* TẦNG 2 của Điều phối — vẫn là số THẬT, chỉ là không nhét lên màn chính. */
  function dashDetail() {
    const rs = RADAR.stats.jobs(), cal = RADAR.stats.calib(), bs = RADAR.stats.band(), pk = RADAR.stats.peak();
    const m = G.metrics;
    let h = '';
    if (rs) h += `<h4>Cuốc đã ghi</h4><div class="kpis kpis-3">
        <div class="kpi"><b>${rs.n}</b><span>Tổng cuốc</span></div>
        <div class="kpi"><b>🚗 ${rs.oto}</b><span>Ô tô</span></div>
        <div class="kpi"><b>🏍️ ${rs.may}</b><span>Xe máy</span></div></div>`;
    if (rs && rs.dong) h += `<p class="hint">Trong <b>${rs.dong}</b> lần bạn ghi "quán đang đông", có <b>${rs.dongNo}</b> lần nổ cuốc thật trong 90 phút sau đó. Tỷ lệ cao thì đứng chờ đáng; thấp thì nên chạy sang điểm khác.</p>`;
    if (cal) h += `<h4>Dự báo có đúng không?</h4>` + cal.rows.map(r => {
      const act = r.win / r.n, ok = Math.abs(act - r.pred) <= 0.15;
      return `<div class="cal"><span>${esc(r.k)}</span><b>${r.win}/${r.n} = ${Math.round(act * 100)}%</b>
        <i class="${ok ? 'ok' : 'off'}">${ok ? 'khớp' : act > r.pred ? 'app báo thấp' : 'app báo cao'}</i></div>`;
    }).join('') + `<p class="hint">Mỗi cuốc lưu kèm % app dự báo <b>trước</b> khi biết kết quả. Bảng này so dự báo với thực tế — app nói phét là lộ ngay ở đây.</p>`;
    else h += `<p class="hint">Ghi đủ 4 cuốc là app mở bảng đối chiếu dự báo với thực tế để bạn tự kiểm chứng.</p>`;
    if (bs) h += `<h4>Khung giờ thật sự nổ cuốc</h4>` + bs.map(b =>
      `<div class="cal"><span>${b.ico} ${b.vi}</span><b>${Math.round(b.win / b.n * 100)}%</b><i>${b.n} lần</i></div>`).join('');
    if (pk.length) h += `<h4>Điểm × khung giờ cao điểm</h4>` + pk.map(p =>
      `<div class="cal"><span>${esc(p.name.slice(0, 30))}</span><b>${K.BAND_VI[p.band]}</b><i>${p.win}/${p.n}</i></div>`).join('');
    if (m && m.byHot && m.byHot.length) h += `<h4>Điểm đáng đứng quanh bạn</h4>` + m.byHot.slice(0, 10).map((r, i) =>
      `<div class="cal cal-tap" data-go="${r.sp.id}"><span>${i + 1}. ${esc(U.cleanName(r.sp))}</span><b>${r.hotScore}%</b><i>${U.fmtMin(r.eta)}</i></div>`).join('');
    if (m && m.route) h += `<h4>Cung đường rà cuốc</h4><p class="hint">Vòng ${U.fmtDist(m.route.dist)} (~${U.fmtMin(m.route.mins)}), đi ngang <b>${m.route.passN}</b> điểm đang mở.</p>
      <a class="more" href="${esc(U.routeUrl(m.route))}" target="_blank" rel="noopener">MỞ CUNG ĐƯỜNG</a>`;
    const picks = RADAR.picks.live(RADAR.picks.all());
    if (picks.length) h += `<h4>Điểm bạn tự thêm (${picks.length})</h4>` + picks.slice(0, 12).map(p => {
      const s = RADAR.picks.status(p);
      return `<div class="cal"><span>${esc(p.name.replace(/^★\s*/, '').slice(0, 30))}</span><b>${s.n ? s.w + '/' + s.n : '—'}</b><i class="${s.cls}">${s.vi}</i></div>`;
    }).join('');
    setTimeout(() => $$('#dash-detail .cal-tap').forEach(e => e.onclick = () => {
      const r = RADAR.findR(e.dataset.go); if (!r) return;
      closeSheets(); map.setView([r.sp.lat, r.sp.lng], 16); openSpot(r);
    }), 0);
    return h;
  }

  /* ═════════════ ⑤ CÀI ĐẶT — 4 công tắc + thiết bị + lối vào chẩn đoán ═════════════ */
  function paintSet() {
    const el = $('#set-body'); if (!el || $('#sheet-set').hidden) return;
    const s = SYNC.status();
    const sw = (id, ico, lbl, on) => `<label class="sw"><span>${ico} ${lbl}</span><input type="checkbox" id="${id}"${on ? ' checked' : ''}><i></i></label>`;
    // công tắc thông báo phải nói THẬT: chưa được cấp quyền thì hiện tắt, đừng vờ là đang bật
    const notifOn = G.notifOn && RADAR.flags.canNotify();
    el.innerHTML = `
      ${sw('sw-notif', '🔔', 'Thông báo điểm nóng', notifOn)}
      ${sw('sw-auto', '🔄', 'Tự động cập nhật dữ liệu', G.autoData)}
      ${sw('sw-fc', '📈', 'Dự báo nhu cầu trên bản đồ', G.showForecast)}
      ${sw('sw-wx', '🌦️', 'Thời tiết tự động', !G.rainManual)}
      <div class="seg"><button data-base="dark"${G.base === 'dark' ? ' class="on"' : ''}>🌙 Tối</button><button data-base="light"${G.base === 'light' ? ' class="on"' : ''}>☀️ Sáng</button></div>
      <button id="set-install" class="more" hidden>📲 Cài app vào máy</button>

      <h4>Dữ liệu quán</h4>
      <div class="dev-row"><span>Điểm đang dùng</span><b>${RADAR.banQuan().n}</b></div>
      <div class="dev-row"><span>Điểm quanh bạn (4km)</span><b>${RADAR.vung.near()}</b></div>
      <div class="dev-row"><span>Nạp lần cuối</span><b>${lucNao(napAt())}</b></div>
      <button id="set-nap" class="more">📍 NẠP QUÁN KHU NÀY</button>
      <p class="hint">App tự nạp khi bạn chạy sang khu chưa có dữ liệu. Bấm nút này khi muốn làm mới ngay — nạp xong app báo luôn <b>điểm cao nhất</b> của khu, và máy kia đang mở app cũng có theo.</p>

      <h4>Thiết bị</h4>
      <div class="dev-row"><span>Trạng thái</span><b>${s.dot} ${s.vi}${s.pending ? ' · ' + s.pending + ' chờ gửi' : ''}</b></div>
      <div class="dev-row"><span>Máy đang dùng chung</span><b>${s.devices || 1}</b></div>
      <div class="dev-code">MÃ TÀI XẾ<b>${esc(s.code)}</b></div>
      <p class="hint">Muốn dùng chung dữ liệu trên máy thứ 2: mở app máy đó, vào đây, bấm <b>Ghép máy</b> rồi gõ mã trên. Từ đó điểm đã lưu và cuốc đã ghi của cả hai máy nhập làm một.</p>
      <button id="set-pair" class="more">🔗 GHÉP MÁY</button>

      <button id="set-diag" class="more ghost">⚙️ Chẩn đoán hệ thống</button>`;
    const on = (id, fn) => { const e = $(id); if (e) e.onchange = fn; };
    on('#sw-notif', async e => {
      if (e.target.checked) { const ok = await A.enableNotif(); e.target.checked = ok; if (ok) toast('Đã bật thông báo'); }
      else { G.notifOn = false; RADAR.flags.set('roadai_laiho_notif', false); toast('Đã tắt thông báo'); }
    });
    on('#sw-auto', e => { G.autoData = e.target.checked; RADAR.flags.set('roadai_butl_autodata', G.autoData); if (G.autoData) A.refreshSpots(true, true); });
    on('#sw-fc', e => { G.showForecast = e.target.checked; RADAR.flags.set('roadai_butl_forecast', G.showForecast); lastRing = ''; RADAR.recompute(); });
    on('#sw-wx', e => { G.rainManual = !e.target.checked; if (!G.rainManual) A.fetchWeather(); RADAR.recompute(); });
    $$('#set-body .seg button').forEach(b => b.onclick = () => { setBase(b.dataset.base); paintSet(); });
    $('#set-pair').onclick = async () => {
      const v = window.prompt('Gõ MÃ TÀI XẾ của máy kia để dùng chung dữ liệu:', SYNC.status().code);
      if (v == null) return;
      const r = await SYNC.pair(v);
      toast(r.ok ? `✓ Đã ghép · ${r.n} điểm · ${r.trips} cuốc dùng chung` : (r.why || 'Chưa ghép được — kiểm tra mạng'), 4200);
      paintSet();
    };
    $('#set-nap').onclick = async () => {
      const b = $('#set-nap'); b.textContent = '⏳ ĐANG NẠP…'; b.disabled = true;
      await RADAR.vung.nap(true);          // toast của engine sẽ báo số điểm + điểm P cao nhất
      SYNC.push();                          // đẩy sổ khu lên ngay cho máy kia có theo
      paintSet();
    };
    $('#set-diag').onclick = () => openSheet('#sheet-diag');
    if (deferredPrompt) { const b = $('#set-install'); b.hidden = false; b.onclick = doInstall; }
  }

  /* ═════════════ ⑥ TẦNG 3 — CHẨN ĐOÁN (ADMIN/DEBUG, tài xế không cần thấy) ═════════════ */
  function paintDiag() {
    const el = $('#diag-body'); if (!el || $('#sheet-diag').hidden) return;
    const d = G.dataStatus || {}, s = SYNC.status(), c = RADAR.stats.counts();
    const sp = RADAR.spots(), bq = RADAR.banQuan(), kho = G.kho;
    const n = f => sp.filter(f).length;
    const row = (k, v) => `<div class="dev-row"><span>${k}</span><b>${v}</b></div>`;
    const t = ms => ms ? new Date(ms).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }) : '—';
    if (!kho) RADAR.health().then(paintDiag);   // hỏi một lần khi mở màn này
    el.innerHTML = `
      <h4>Đồng bộ</h4>
      ${row('Trạng thái', s.dot + ' ' + s.vi)}
      ${row('Hàng đợi chưa gửi', s.pending)}
      ${row('Thiết bị dùng chung', s.devices || 1)}
      ${row('Lần đồng bộ gần nhất', t(s.at))}
      ${row('Độ trễ máy chủ', s.lastMs ? s.lastMs + ' ms' : '—')}
      ${row('Kéo / đẩy / lỗi', s.pulls + ' / ' + s.pushes + ' / ' + s.fails)}
      ${row('Xung đột đã xử lý', s.conflicts)}
      ${row('Kho cuốc trên máy chủ', s.tripsReady === false ? '⚠️ chưa bật (chạy supabase/schema.sql)' : s.tripsReady ? 'sẵn sàng' : '—')}
      ${row('Cuốc: máy này / tất cả', RADAR.trips.mine().length + ' / ' + RADAR.trips.all().length)}
      ${row('Khu trong sổ dùng chung', (s.zones || 0) + ' · máy này giữ ' + RADAR.vung.list().length)}
      ${row('Mã máy', s.dev)}
      ${row('Mã tài xế', s.code)}
      ${row('Phiên bản app', s.ver)}
      ${s.err ? row('Lỗi gần nhất', '<span class="bad">' + esc(s.err) + '</span>') : ''}
      <div class="dev-code">MÃ BẢN ĐỒNG BỘ<b>${esc(s.rev || '—')}</b></div>

      <h4>Máy đang dùng chung tài khoản</h4>
      ${(s.devs || []).length ? s.devs.map(d => `<div class="cal"><span>${d.dev === s.dev ? '🟢 máy này' : '📱 ' + esc(d.dev.slice(0, 8))}</span>
        <b>${esc(d.app || '—')}</b><i>${d.seen ? t(d.seen) : '—'}${d.srev ? ' · #' + esc(d.srev) : ''}</i></div>`).join('')
        : '<p class="hint">Chưa nhận được danh sách — bấm ⚙️ Cài đặt → Ghép máy để nối máy thứ hai.</p>'}
      <p class="hint">Cột cuối là giờ máy đó online lần cuối và MÃ BẢN danh sách điểm nó đang chạy. Hai máy khác mã bản thì máy cũ tự đi lấy lại ngay, không phải đợi.</p>

      <h4>Nguồn dữ liệu điểm</h4>
      ${row('Điểm đón thật (chuyến BUTL)', n(x => x.source === 'butl'))}
      ${row('Quán đối tác BUTL', n(x => x.source === 'doitac'))}
      ${row('Bản đồ mở · tra được tên', n(x => x.source === 'osm'))}
      ${row('Bản đồ mở · chỉ có địa chỉ', n(x => x.source === 'osm-addr'))}
      ${row('Dùng chung / tự thêm / khu tự nạp', c.shared + ' / ' + c.mine + ' / ' + c.vung)}
      ${row('Nguồn', esc(d.source || '—'))}
      ${row('Danh sách dùng chung cập nhật', d.updatedAt ? new Date(d.updatedAt).toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' }) : '—')}
      ${row('Nạp quán lần cuối', lucNao(napAt()))}
      <div class="dev-code">MÃ QUÁN (toàn bộ kho)<b>${esc(bq.ma)}</b></div>
      <p class="hint"><b>Cách kiểm 2 máy giống nhau 100%:</b> mở mục này trên cả hai máy — <b>MÃ QUÁN</b> và số điểm (${bq.n}) phải y hệt. Khác mã nghĩa là còn khu nào đó chưa nạp xong, chờ chút hoặc bấm "Nạp điểm khu đang đứng".<br>
      MÃ BẢN dữ liệu chung: <b>#${esc(d.rev || '—')}</b>. Nguồn: OpenStreetMap (© OpenStreetMap contributors, ODbL) · Overture Maps (© Overture Maps Foundation, CDLA-Permissive 2.0) · tên &amp; địa chỉ đối chiếu VietMap.</p>
      <button id="dg-refresh" class="more">Cập nhật danh sách điểm</button>
      <button id="dg-resync" class="more ghost">Đồng bộ lại máy này</button>

      <h4>Kho dữ liệu (Supabase)</h4>
      ${row('Tình trạng', kho ? (kho.ok ? '🟢 sống · ' + kho.ms + ' ms' : '🔴 ' + esc(kho.db || 'lỗi')) : '⏳ đang hỏi…')}
      ${kho && kho.rows != null ? row('Số dòng đang giữ', kho.rows) : ''}
      ${kho && kho.schema ? row('Cấu trúc bảng', kho.schema === 'day_du' ? 'đầy đủ' : '⚠️ thiếu cột') : ''}
      <p class="hint">Kho chạy gói miễn phí nên sẽ <b>tự ngủ</b> nếu nhiều ngày không ai dùng — lúc đó đồng bộ sẽ lỗi. App có lịch tự đánh thức mỗi ngày, và mỗi lần anh mở app cũng là một lần đánh thức.</p>
      <button id="dg-health" class="more ghost">Kiểm tra kho ngay</button>

      <h4>Sổ khu dùng chung (${RADAR.vung.live().length})</h4>
      ${RADAR.vung.live().length ? RADAR.vung.live().map(z => {
        const v = RADAR.vung.list().find(x => x.key === z.key);
        const p = v ? RADAR.vung.pCao(z.key) : null;
        return `<div class="cal"><span>${esc(z.ten || z.key)}<br><em style="font-style:normal;opacity:.6;font-size:10.5px">nạp ${lucNao(z.ts)}</em></span>
          <b>${v ? v.spots.length + ' điểm' : '⏳ đang nạp'}${p ? ' · P ' + p.p + '%' : ''}</b><i class="x" data-vung="${esc(z.key)}">xoá</i></div>`;
      }).join('') : '<p class="hint">Sổ khu trống. App tự nạp khi bạn chạy sang vùng chưa có dữ liệu — và máy kia sẽ tự có theo.</p>'}
      ${row('Điểm quanh đây (4km)', RADAR.vung.near())}
      <p class="hint">Máy nào nạp được khu nào là cả tài khoản có khu đó; máy còn lại đang mở app sẽ tự lấy quán của khu đó trong khoảng 12 giây. Sổ chỉ giữ ô lưới — danh sách quán mỗi máy tự lấy từ cùng một bản chụp nên luôn khớp nhau.</p>
      <button id="dg-nap" class="more ghost">Nạp điểm khu đang đứng</button>

      <h4>Mô phỏng (chỉ để thử)</h4>
      <label class="rng">Khung giờ <b id="dg-hl">${G.simHour == null ? 'giờ thực' : String(G.simHour).padStart(2, '0') + ':00'}</b>
        <input id="dg-hour" type="range" min="-1" max="23" step="1" value="${G.simHour == null ? -1 : G.simHour}"></label>
      <label class="rng">Mưa <b id="dg-rl">${Math.round(G.rain * 100)}%</b>
        <input id="dg-rain" type="range" min="0" max="100" step="5" value="${Math.round(G.rain * 100)}"></label>
      <div class="seg seg-4">${Object.entries(DAY_SHORT).map(([k, v]) => `<button data-day="${k}"${G.dayType === k ? ' class="on"' : ''}>${v}</button>`).join('')}</div>
      <label class="sw"><span>⚽ Đêm có bóng đá lớn</span><input type="checkbox" id="dg-match"${G.match ? ' checked' : ''}><i></i></label>
      <label class="sw"><span>🗺️ Hiện hết điểm (kể cả đang đóng)</span><input type="checkbox" id="dg-all"${G.hienHet ? ' checked' : ''}><i></i></label>

      <h4>Nguy hiểm</h4>
      <button id="dg-unhide" class="more ghost">Bỏ ẩn ${RADAR.hidden.set().size} điểm đã ẩn</button>
      <button id="dg-reset" class="more ghost bad">Xoá những gì AI đã học</button>`;

    $('#dg-refresh').onclick = () => { toast('Đang cập nhật…'); A.refreshSpots(true, true).then(paintDiag); };
    $('#dg-resync').onclick = A.hardResync;
    $('#dg-health').onclick = () => { G.kho = null; paintDiag(); RADAR.health().then(paintDiag); };
    $('#dg-nap').onclick = () => { RADAR.vung.nap(true).then(() => { SYNC.push(); paintDiag(); }); };
    $$('#diag-body .x[data-vung]').forEach(e => e.onclick = () => { RADAR.vung.xoa(e.dataset.vung); paintDiag(); });
    $('#dg-hour').oninput = e => { const v = +e.target.value; G.simHour = v < 0 ? null : v; $('#dg-hl').textContent = v < 0 ? 'giờ thực' : String(v).padStart(2, '0') + ':00'; RADAR.recompute(); };
    $('#dg-rain').oninput = e => { G.rain = +e.target.value / 100; G.rainManual = true; $('#dg-rl').textContent = e.target.value + '%'; RADAR.recompute(); };
    $$('#diag-body .seg-4 button').forEach(b => b.onclick = () => { G.dayType = b.dataset.day; RADAR.recompute(); paintDiag(); });
    $('#dg-match').onchange = e => { G.match = e.target.checked; RADAR.recompute(); };
    $('#dg-all').onchange = e => { G.hienHet = e.target.checked; try { localStorage.setItem('roadai_laiho_hienhet', G.hienHet ? '1' : '0'); } catch (x) {} lastSig = ''; RADAR.recompute(); };
    $('#dg-unhide').onclick = () => { const n2 = A.unhideAll(); SYNC.dirty('hide'); toast('Đã bỏ ẩn ' + n2 + ' điểm'); paintDiag(); };
    $('#dg-reset').onclick = () => {
      if (!window.confirm(`Xoá toàn bộ những gì AI đã học (${G.days} ngày · ${G.resolved} cuốc)?\nNhật ký cuốc vẫn giữ nguyên.`)) return;
      A.resetBrain(); toast('Đã xoá — app học lại từ đầu'); paintDiag();
    };
  }

  /* ═════════════ CHI TIẾT MỘT ĐIỂM ═════════════ */
  function openSpot(r) {
    if (!r) return;
    const t = pinTone(r), pid = r.sp.pid, mine = r.sp.source === 'mine';
    const bb = U.bestBandOf(U.spotKey(r.sp));
    const x = U.xeCuaSpot(r.sp);
    const note = K.NOTES()[U.spotKey(r.sp)];
    const fav = K.FAV().has(U.spotKey(r.sp));
    const html = `<div class="pop">
      <div class="pop-h" style="--c:${t.c}"><b>${esc(U.cleanName(r.sp))}</b><em>${r.hotScore}%</em></div>
      <div class="pop-s">${esc(r.sp.addr || K.CAT_VI[r.sp.cat] || '')}${r.open ? '' : ' · đang đóng cửa'}</div>
      <div class="pop-g">
        <span>${U.fmtDist(r.dist)} · ${U.fmtMin(r.eta)}</span>
        ${r.emp && r.emp.n ? `<span>✅ ${r.emp.win}/${r.emp.n} cuốc thật</span>` : ''}
        ${bb ? `<span>${bb.ico} ${bb.vi}</span>` : ''}
        ${x ? `<span>${K.XE_ICON[x.chinh]}${x.khai ? ' khai' : ` ${Math.max(x.oto, x.may)}/${x.oto + x.may}`}</span>` : ''}
        ${r.sp.cat !== 'diemdon' ? `<span>🕛 tan ${U.fmtClose(r.sp.closeH)}</span>` : ''}
      </div>
      ${note ? `<div class="pop-n">📝 ${esc(note)}</div>` : ''}
      <button class="pop-go" data-a="go">ĐI ĐẾN</button>
      <div class="pop-more">
        <button data-a="log">📝 Ghi cuốc</button>
        <button data-a="fav">${fav ? '♥' : '♡'}</button>
        <button data-a="note">📝</button>
        <button data-a="fix">📍</button>
        <button data-a="hide">🚫</button>
        ${mine && pid ? '<button data-a="ren">✏️</button><button data-a="del">🗑</button>' : ''}
      </div></div>`;
    const pop = L.popup({ className: 'sp-popup', maxWidth: 270, closeButton: false })
      .setLatLng([r.sp.lat, r.sp.lng]).setContent(html).openOn(map);
    // Nối nút sau khi Leaflet dựng xong DOM. Thử lại vài nhịp phòng khi máy chậm —
    // popup mà không bấm được nút nào thì coi như hỏng cả tính năng.
    let n = 0;
    (function bind() {
      const root = pop.getElement && pop.getElement();
      if (!root) { if (n++ < 5) setTimeout(bind, 40); return; }
      root.querySelectorAll('[data-a]').forEach(b => b.onclick = () => act(b.dataset.a, r, pop));
    })();
  }
  function act(a, r, pop) {
    const pid = r.sp.pid;
    if (a === 'go') { window.open(U.navUrl(r.sp), '_blank', 'noopener'); G.pendingLog = r; paint(G.metrics, G.decision); map.closePopup(); return; }
    if (a === 'log') { G.pendingLog = r; map.closePopup(); paint(G.metrics, G.decision); return; }
    if (a === 'fav') { const on = A.toggleFav(r.sp.id); toast(on ? 'Đã lưu yêu thích' : 'Đã bỏ yêu thích'); map.closePopup(); return; }
    if (a === 'note') { const v = window.prompt('Ghi chú (giờ đông, chỗ đỗ xe…):', K.NOTES()[U.spotKey(r.sp)] || ''); if (v == null) return; A.setNote(r.sp.id, v); toast('Đã lưu ghi chú'); map.closePopup(); return; }
    if (a === 'fix') {
      if (!G.hasGps) { toast('Bật GPS và đứng đúng chỗ rồi bấm lại', 3800); return; }
      A.fixSpot(r.sp.id); SYNC.dirty('pick'); toast('Đã dời điểm về chỗ bạn đang đứng'); map.closePopup(); return;
    }
    if (a === 'hide') { A.hideSpot(r.sp.id); SYNC.dirty('hide'); toast('Đã ẩn điểm này'); map.closePopup(); return; }
    if (a === 'ren') { const v = window.prompt('Tên điểm:', U.cleanName(r.sp)); if (!v || !v.trim()) return; A.renamePick(pid, v); SYNC.dirty('pick'); toast('Đã đổi tên'); map.closePopup(); return; }
    if (a === 'del') {
      const s = A.delPick(pid);
      if (s && s.n >= 3 && !window.confirm(`Điểm này đã ghi ${s.w}/${s.n} cuốc thật. Vẫn xoá?`)) return;
      SYNC.dirty('pick'); toast('Đã xoá điểm'); map.closePopup(); return;
    }
  }

  /* ═════════════ SHEET ═════════════ */
  function openSheet(id) {
    closeSheets();
    const el = $(id); if (!el) return;
    el.hidden = false; document.body.classList.add('sheet-open');
    if (id === '#sheet-dash') paintDash();
    if (id === '#sheet-set') paintSet();
    if (id === '#sheet-diag') paintDiag();
    if (id === '#sheet-why') paintWhy();
    if (id === '#sheet-add') paintAdd();
  }
  function closeSheets() { $$('.sheet').forEach(s => s.hidden = true); document.body.classList.remove('sheet-open'); }

  /* ═════════════ THÊM QUÁN (§8, §9) ═════════════
     Hỏi đúng HAI thứ tài xế biết mà máy không đoán được: TÊN QUÁN và KHÁCH Ở ĐÂY
     THƯỜNG ĐI XE GÌ. Còn lại chạy ngầm hết: GPS → gộp trùng 55m → chấm điểm →
     lưu → đẩy lên máy chủ → mọi máy đang mở app đều có.
     Gõ tên thì gợi ý quán ĐÃ CÓ gần đây — chống chuyện cùng một quán bị nhập 3
     kiểu tên thành 3 chấm, không chấm nào đủ cuốc để kết luận gì. */
  let addXe = '', addBusy = false, addAddr = '', addQuan = '', addDcState = 'cho';
  let addPick = null;      // quán ĐÃ CÓ mà tài xế chọn dùng lại (thay vì tạo mới)
  let addTrung = null;     // danh sách quán nghi trùng tên, hiện ra để hỏi lại
  let addBuilt = false, addrTouched = false;
  function openAdd() {
    addXe = ''; addAddr = ''; addQuan = ''; addDcState = 'cho'; addPick = null; addTrung = null;
    addBuilt = false; addrTouched = false;
    openSheet('#sheet-add');
    // Lấy GPS rồi hỏi ĐỊA CHỈ THẬT chỗ đang đứng — chạy ngầm, không chặn tay tài xế.
    (async () => {
      await A.locateNow();
      addDcState = 'dang'; syncAdd();
      const d = await A.diaChiTaiDay();
      if (d.ok) { addAddr = d.addr; addQuan = d.quan; addDcState = 'xong'; }
      else addDcState = 'hut';
      syncAdd();
    })();
  }

  /* ═══ DỰNG KHUNG ĐÚNG MỘT LẦN ═══
     ⚠️ LỖI NẶNG ĐÃ SỬA (anh Long báo: "vẫn không nhập tay tên quán được"):
     bản trước vẽ lại TOÀN BỘ form sau mỗi 260ms khi gõ, tức là THAY LUÔN CÁI Ô
     INPUT. Trên điện thoại: gõ một chữ → 260ms sau ô bị thay → mất focus, bàn
     phím đóng. Gõ tiếng Việt Telex thì còn tệ hơn: bộ gõ đang ghép dấu mà ô bị
     thay giữa chừng là đứt, không ra được chữ nào.
     Bản cũ (#here-search) làm ĐÚNG: input nằm NGOÀI, chỉ vẽ lại phần thân bên
     dưới. Giờ quay lại đúng cách đó — khung dựng một lần, sau đó chỉ cập nhật
     mấy khối động, hai ô nhập KHÔNG BAO GIỜ bị đụng tới. */
  function buildAdd() {
    const el = $('#add-body'); if (!el) return;
    el.innerHTML = `
      <div id="add-pick"></div>
      <label class="lbl" id="add-lbl-ten">Tên quán <em>bắt buộc</em></label>
      <input id="add-name" class="inp" type="text" autocomplete="off" autocapitalize="words"
             enterkeyhint="done" placeholder="Vd: Ốc Quyên, Bia Hơi 68…" />
      <div id="add-goi"></div>
      <div id="add-trung"></div>

      <label class="lbl">Địa chỉ <em>lấy theo định vị · sửa được</em></label>
      <input id="add-addr" class="inp" type="text" autocomplete="off" placeholder="Số nhà, đường, phường…" />
      <div class="gps-row"><span id="add-gps"></span>
        <button id="add-relocate" class="lnk">lấy lại vị trí</button></div>

      <label class="lbl">Khách ở đây thường đi <em>bắt buộc</em></label>
      <div class="vehs">
        <button data-xe="may" class="vch"><i class="tick"></i>🏍️<span>Xe máy</span></button>
        <button data-xe="oto" class="vch"><i class="tick"></i>🚗<span>Ô tô</span></button>
        <button data-xe="ca2" class="vch"><i class="tick"></i>🚗🏍️<span>Cả hai</span></button>
      </div>

      <p class="hint">Lưu xong app đẩy thẳng lên kho chung — máy còn lại đang mở app sẽ có quán này trong khoảng 12 giây.</p>
      <div class="add-bar"><button id="add-save" class="more">💾 LƯU QUÁN</button></div>`;

    const inp = $('#add-name');
    // CHỈ cập nhật danh sách gợi ý, TUYỆT ĐỐI không đụng vào chính ô đang gõ.
    inp.oninput = () => {
      if (addPick) { addPick = null; syncPick(); }     // sửa tên = thôi dùng quán đã chọn
      addTrung = null; syncTrung();
      clearTimeout(inp._t); inp._t = setTimeout(syncGoi, 260);
    };
    inp.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); inp.blur(); } };
    const dc = $('#add-addr');
    dc.oninput = () => { addrTouched = true; addAddr = dc.value; };
    $$('#add-body .vch').forEach(b => b.onclick = () => {
      addXe = addXe === b.dataset.xe ? '' : b.dataset.xe; syncXe();
    });
    $('#add-relocate').onclick = async () => {
      addDcState = 'dang'; addrTouched = false; syncAdd();
      await A.locateNow();
      const d = await A.diaChiTaiDay();
      if (d.ok) { addAddr = d.addr; addQuan = d.quan; addDcState = 'xong'; } else addDcState = 'hut';
      syncAdd();
    };
    $('#add-save').onclick = () => luuQuan();
    addBuilt = true;
  }
  const dongGoi = x => `<button class="goi-r" data-sp="${x.sp.id}">
      <b>${esc(U.cleanName(x.sp))}</b><small>${esc(x.sp.addr || K.CAT_VI[x.sp.cat] || '')} · cách ${U.fmtDist(x.d)}</small></button>`;
  function syncGoi() {
    const box = $('#add-goi'); if (!box) return;
    const q = tenDangGo();
    // Gợi ý chỉ hiện khi đã gõ ≥2 chữ và chưa chọn quán nào — đỡ nuốt màn hình.
    const goi = (!addPick && q.length >= 2) ? A.timQuanGan(q, 4) : [];
    box.innerHTML = goi.length
      ? `<div class="goi">${goi.map(dongGoi).join('')}</div>
         <p class="hint">Quán này đã có sẵn thì bấm vào dòng trên — app dùng lại đúng chỗ đó thay vì tạo chấm trùng.</p>`
      : '';
    box.querySelectorAll('.goi-r').forEach(b => b.onclick = () => chonQuanCo(b.dataset.sp));
  }
  function syncTrung() {
    const box = $('#add-trung'); if (!box) return;
    box.innerHTML = (addTrung && addTrung.length)
      ? `<div class="trung"><b>⚠️ Chỗ này hình như đã có trong radar</b>
           <div class="goi">${addTrung.map(dongGoi).join('')}</div>
           <button id="add-force" class="lnk lnk-warn">Không phải — vẫn thêm “${esc(tenDangGo())}” thành quán mới</button>
         </div>`
      : '';
    box.querySelectorAll('.goi-r').forEach(b => b.onclick = () => chonQuanCo(b.dataset.sp));
    const fo = $('#add-force'); if (fo) fo.onclick = () => { addTrung = null; syncTrung(); return luuQuan(true); };
  }
  function syncPick() {
    const box = $('#add-pick'); if (!box) return;
    box.innerHTML = addPick
      ? `<div class="daco"><div><b>✓ Dùng quán đã có</b>
           <small>${esc(addPick.name)}${addPick.addr ? ' · ' + esc(addPick.addr) : ''}</small></div>
           <button id="add-clear" class="lnk">đổi</button></div>
         <p class="hint">Lưu sẽ cập nhật vào đúng quán này — không tạo chấm mới.</p>`
      : '';
    const cl = $('#add-clear');
    if (cl) cl.onclick = () => { addPick = null; addTrung = null; syncPick(); syncGoi(); syncTrung(); };
  }
  function syncXe() {
    $$('#add-body .vch').forEach(b => {
      const on = addXe === b.dataset.xe;
      b.classList.toggle('on', on);
      const t = b.querySelector('.tick'); if (t) t.textContent = on ? '✓' : '';
    });
  }
  function syncDc() {
    const dc = $('#add-addr'); if (!dc) return;
    dc.placeholder = { cho: '⏳ đang lấy vị trí…', dang: '⏳ đang tra địa chỉ…',
      hut: 'Bản đồ chưa tra được — anh gõ tay giúp em', xong: 'Số nhà, đường, phường…' }[addDcState];
    // Chỉ điền hộ khi tài xế CHƯA tự gõ gì — không giật chữ khỏi tay người đang nhập.
    if (!addrTouched && addAddr && dc.value !== addAddr) dc.value = addAddr;
    const g = $('#add-gps');
    if (g) g.textContent = `${G.hasGps ? '📍' : '⏳'} ${G.you.lat.toFixed(5)}, ${G.you.lng.toFixed(5)}` + (addQuan ? ' · ' + addQuan : '');
  }
  const tenDangGo = () => addPick ? addPick.name : (($('#add-name') && $('#add-name').value) || '').trim();
  function syncAdd() {
    if ($('#sheet-add').hidden) return;
    syncPick(); syncGoi(); syncTrung(); syncXe(); syncDc();
    const s = $('#add-save');
    if (s) { s.textContent = addBusy ? '⏳ ĐANG LƯU…' : '💾 LƯU QUÁN'; s.disabled = !!addBusy; }
  }
  function paintAdd() {
    if ($('#sheet-add').hidden) return;
    if (!addBuilt) buildAdd();
    syncAdd();
  }
  /* Chọn một quán ĐÃ CÓ: không đóng form, không lưu vội — chỉ ghim nó lại.
     Tài xế vẫn còn phải tick loại xe, rồi bấm LƯU thì app cập nhật vào ĐÚNG quán
     đó. Bản trước bắt phải tick xe TRƯỚC mới bấm được dòng gợi ý, ngược đời. */
  function chonQuanCo(id) {
    const sp = A.spotById(id); if (!sp) return;
    addPick = { id, name: U.cleanName(sp), addr: sp.addr || '', lat: sp.lat, lng: sp.lng };
    addTrung = null;
    const nm = $('#add-name'); if (nm) nm.value = addPick.name;   // ghi tên vào ô, không dựng lại ô
    if (sp.addr && !addrTouched) { addAddr = sp.addr; addDcState = 'xong'; }
    const x = U.xeCuaSpot(sp); if (!addXe && x) addXe = x.chinh;
    syncAdd();
    toast('Đã chọn “' + addPick.name + '” — tick loại xe rồi bấm LƯU', 3200);
  }
  async function luuQuan(boQuaTrung) {
    if (addBusy) return;
    const nm = addPick ? addPick.name : (($('#add-name') && $('#add-name').value) || '').trim();
    const dc = (($('#add-addr') && $('#add-addr').value) || '').trim();
    if (!nm) { toast('Gõ tên quán đã'); const i = $('#add-name'); if (i) { i.focus(); i.scrollIntoView({ block: 'center' }); } return; }
    if (!addXe) { toast('Chọn khách ở đây đi xe máy hay ô tô'); return; }

    /* CHỐNG TRÙNG: gõ đúng tên một quán đã có rồi bấm LƯU thì KHÔNG tạo chấm mới —
       hỏi lại trước. upsertPick chỉ gộp khi cách <55m, mà toạ độ quán trên bản đồ
       lệch cả trăm mét là chuyện thường, nên không có bước này là kho đầy chấm rác. */
    if (!addPick && !boQuaTrung) {
      const t = A.timTrung(nm, G.you.lat, G.you.lng);
      if (t.length) {
        addTrung = t; syncTrung();
        const el = $('#add-body .trung'); if (el && el.scrollIntoView) el.scrollIntoView({ block: 'center' });
        toast('Quán này hình như đã có — kiểm giúp em trước khi thêm', 4200);
        return;
      }
    }

    addBusy = true; syncAdd();
    try {
      let p, gop, capNhat = false, pid = null;
      if (addPick) {                                   // dùng lại quán đã có
        const sp = A.capNhatQuan(addPick.id, addXe, dc);
        if (!sp) throw new Error('không tìm thấy quán');
        p = { name: addPick.name, lat: addPick.lat, lng: addPick.lng }; gop = false; capNhat = true;
        const moi = RADAR.spots().find(s => Math.abs(s.lat - sp.lat) < 1e-4 && Math.abs(s.lng - sp.lng) < 1e-4 && s.pid);
        pid = moi ? moi.pid : null;
      } else {
        if (!G.hasGps) await A.locateNow();
        ({ p, gop } = A.addPointHere(nm, 'phonhau', addXe, dc, addQuan));
        pid = p.id;
      }
      SYNC.dirty('pick', pid);
      const ok = await SYNC.push();                    // đẩy lên NGAY, không đợi chu kỳ
      closeSheets();
      const dau = capNhat ? `✓ Đã cập nhật “${nm}” ${K.XE_ICON[addXe]}`
        : gop ? `✓ Đã gộp vào “${U.cleanName(p)}”`
        : `✓ Đã lưu “${nm}” ${K.XE_ICON[addXe]}`;
      toast(dau + (ok ? ' — đã lên kho chung' : ' — chưa có mạng, app sẽ tự gửi sau'), 4200);
      if (pid) chiTanNoi(pid);                         // bay tới + làm nổi + mở thẻ chi tiết
      else if (map && p) map.setView([p.lat, p.lng], Math.max(16, map.getZoom()));
    } catch (e) {
      closeSheets();
      toast('Đã lưu vào máy, chưa đẩy lên được — app sẽ tự gửi khi có mạng', 4200);
    } finally { addBusy = false; addPick = null; addTrung = null; }
  }

  /* ═════════════ CÀI APP ═════════════ */
  let deferredPrompt = null;
  try { window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferredPrompt = e; }); } catch (e) {}
  async function doInstall() {
    if (!deferredPrompt) { toast('iPhone: bấm Chia sẻ → Thêm vào MH chính', 4600); return; }
    deferredPrompt.prompt();
    const r = await deferredPrompt.userChoice.catch(() => ({}));
    deferredPrompt = null;
    toast(r && r.outcome === 'accepted' ? '✓ Đã cài Driver Radar' : 'Đã đóng');
  }

  /* ═════════════ VẼ LẠI (engine gọi vào đây) ═════════════ */
  let painting = false;
  function paint(m, d) {
    if (painting) return; painting = true;
    try {
      d = d || G.decision || {}; m = m || G.metrics;
      paintTop(d); paintCard(d);
      drawRings(m); drawPins(m);
      if (!$('#sheet-dash').hidden) paintDash();
      if (!$('#sheet-why').hidden) paintWhy();
      if (!$('#sheet-diag').hidden) paintDiag();
      /* Thanh "khu này chưa có điểm" — chỉ hiện đúng lúc cần, tự ẩn khi đã có dữ liệu.
         Hiện ra thì phải ĐẨY 2 nút tròn xuống, không thì nó nằm chồng lên nhau. */
      const nb = $('#newzone');
      if (nb) {
        const hien = G.quanGan != null && G.quanGan < RADAR.vung.min;
        nb.hidden = !hien;
        nb.textContent = RADAR.vung.busy() ? '⏳ ĐANG TÌM ĐIỂM QUANH ĐÂY…' : '📍 TÌM ĐIỂM QUANH ĐÂY';
        document.body.classList.toggle('zone-on', hien);
      }
    } finally { painting = false; }
  }
  function syncBadge(s) {
    const e = $('#syncdot'); if (!e) return;
    e.textContent = s.dot;
    e.title = s.vi + (s.pending ? ' · ' + s.pending + ' việc chờ gửi' : '');
    e.className = 'syncdot s-' + s.state;
  }

  /* ═════════════ NỐI DÂY ═════════════ */
  function wire() {
    $('#btn-center').onclick = async () => {
      centerMap(true); toast('Đang định vị…', 4000);
      const ok = await A.locateNow();
      toast(ok ? '📍 Đã lấy đúng vị trí' : 'Chưa lấy được GPS — kéo chấm xanh tới chỗ bạn đứng', 3600);
      if (ok) centerMap(true);
    };
    $('#btn-add').onclick = openAdd;
    $('#nav-log').onclick = () => {
      const r = (G.metrics && G.metrics.best) || null;
      if (!r) return toast('Chưa có điểm nào để ghi');
      G.session.suggested++; G.pendingLog = r; closeSheets(); paint(G.metrics, G.decision);
      window.scrollTo(0, 0);
    };
    $('#nav-dash').onclick = () => openSheet('#sheet-dash');
    $('#nav-set').onclick = () => openSheet('#sheet-set');
    $$('.sheet-x').forEach(b => b.onclick = closeSheets);
    $$('#filters button').forEach(b => b.onclick = () => {
      $$('#filters button').forEach(x => x.classList.remove('on'));
      b.classList.add('on'); A.setFilter(b.dataset.f);
    });
    const nz = $('#newzone'); if (nz) nz.onclick = () => { nz.hidden = true; toast('Đang tìm điểm quanh đây…', 5000); RADAR.vung.nap(true); };
    document.addEventListener('keydown', e => { if (e.key === 'Escape') closeSheets(); });
  }

  /* ═════════════ KHỞI ĐỘNG ═════════════ */
  function boot() {
    initMap();
    moveMe(G.you);
    wire();
    RADAR.boot();     // engine: dựng kho điểm, tính lần đầu, bật GPS + vòng cập nhật
    SYNC.boot();      // đồng bộ: đẩy phần của máy này lên rồi nhận bản gộp về
    centerMap(false);
    syncBadge(SYNC.status());
  }

  return { boot, paint, toast, syncBadge, centerMap, moveMe, openSheet, closeSheets, openSpot, openWait,
           syncAddNow: () => { syncGoi(); syncTrung(); } };   // cho bộ tự kiểm chạy phần chống dội ngay
})();
if (typeof window !== 'undefined') window.UI = UI;
document.addEventListener('DOMContentLoaded', () => UI.boot());
