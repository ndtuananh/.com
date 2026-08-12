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
      const cls = 'pin' + (r.isBest ? ' pin-best' : '') + (real ? ' pin-real' : '') + (r.open ? '' : ' pin-off');
      const sz = r.isBest ? 54 : 40;
      const face = r.open
        ? `<b>${r.hotScore}<i>%</i></b>` + (r.isBest ? '<span class="pin-star">⭐</span>' : r.p >= 0.5 ? '<span class="pin-star">🔥</span>' : '')
        : '<b class="pin-x">·</b>';
      const icon = L.divIcon({ className: '', iconSize: [sz, sz], iconAnchor: [sz / 2, sz / 2],
        html: `<div class="${cls}" style="--c:${t.c}">${face}</div>` });
      L.marker([r.sp.lat, r.sp.lng], { icon, zIndexOffset: r.isBest ? 1000 : real ? 600 : r.tier * 100 })
        .addTo(pinLayer).on('click', () => openSpot(r));
    }
  }
  /* Nền: vùng phủ sóng 5km + quầng nhiệt + đường tới điểm.
     Chỉ vẽ lại khi thứ liên quan đổi — không đụng tới layer chấm. */
  let lastRing = '';
  function drawRings(m) {
    if (!map || !m) return;
    const sig = [G.you.lat.toFixed(4), G.you.lng.toFixed(4), G.showForecast ? 1 : 0,
      m.best ? m.best.sp.id : '-', m.route ? m.route.seq.map(r => r.sp.id).join('') : '-'].join('|');
    if (sig === lastRing) return;
    lastRing = sig;
    ringLayer.clearLayers(); lineLayer.clearLayers();
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
        <div class="c-name"><b>${esc(d.recommended_name)}${veh}</b>
          <small>${esc(d.recommended_area)}${d.here ? ' · bạn đang ở đây' : ` · ${d.distance} km · ${d.eta} phút`}</small></div>
        <div class="c-p" style="--c:${t.c}"><b>${d.demand_score}<i>%</i></b><small>trong 30 phút</small></div>
      </div>
      <div class="c-act">
        <a id="c-go" class="c-go" href="${esc(d.nav)}" target="_blank" rel="noopener">${d.here ? '🧭 MỞ BẢN ĐỒ' : 'ĐI ĐẾN'}</a>
        <button id="c-skip" class="c-alt" title="Đề xuất điểm khác">↻</button>
      </div>`;
    $('#c-why').onclick = () => openSheet('#sheet-why');
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
        ${d.reasons.map(r => `<div class="why-r"><span>${r.ico}</span>${esc(r.t)}</div>`).join('') || '<div class="why-r"><span>ℹ️</span>Chưa đủ cuốc thật ở đây để nói chắc — ghi vài cuốc nữa app sẽ nói rõ hơn.</div>'}
        ${w ? `<div class="why-r"><span>🅿️</span>Đứng giữa cụm <b>${w.cnt} điểm</b> (cách ${U.fmtDist(w.distYou)}) thì phủ được nhiều chỗ cùng lúc —
          <a href="${esc(U.gmapsDir(w.center.lat, w.center.lng))}" target="_blank" rel="noopener">mở chỗ đó</a></div>` : ''}
      </div>
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
    $('#set-diag').onclick = () => openSheet('#sheet-diag');
    if (deferredPrompt) { const b = $('#set-install'); b.hidden = false; b.onclick = doInstall; }
  }

  /* ═════════════ ⑥ TẦNG 3 — CHẨN ĐOÁN (ADMIN/DEBUG, tài xế không cần thấy) ═════════════ */
  function paintDiag() {
    const el = $('#diag-body'); if (!el || $('#sheet-diag').hidden) return;
    const d = G.dataStatus || {}, s = SYNC.status(), c = RADAR.stats.counts();
    const sp = RADAR.spots();
    const n = f => sp.filter(f).length;
    const row = (k, v) => `<div class="dev-row"><span>${k}</span><b>${v}</b></div>`;
    const t = ms => ms ? new Date(ms).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }) : '—';
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
      ${row('Mã máy', s.dev)}
      ${row('Mã tài xế', s.code)}
      ${row('Phiên bản app', s.ver)}
      ${s.err ? row('Lỗi gần nhất', '<span class="bad">' + esc(s.err) + '</span>') : ''}
      <div class="dev-code">MÃ BẢN ĐỒNG BỘ<b>${esc(s.rev || '—')}</b></div>

      <h4>Nguồn dữ liệu điểm</h4>
      ${row('Điểm đón thật (chuyến BUTL)', n(x => x.source === 'butl'))}
      ${row('Quán đối tác BUTL', n(x => x.source === 'doitac'))}
      ${row('Bản đồ mở · tra được tên', n(x => x.source === 'osm'))}
      ${row('Bản đồ mở · chỉ có địa chỉ', n(x => x.source === 'osm-addr'))}
      ${row('Dùng chung / tự thêm / khu tự nạp', c.shared + ' / ' + c.mine + ' / ' + c.vung)}
      ${row('Nguồn', esc(d.source || '—'))}
      ${row('Cập nhật lúc', d.updatedAt ? new Date(d.updatedAt).toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' }) : '—')}
      <div class="dev-code">MÃ BẢN DỮ LIỆU<b>#${esc(d.rev || '—')}</b></div>
      <p class="hint">Nguồn: OpenStreetMap (© OpenStreetMap contributors, ODbL) · Overture Maps (© Overture Maps Foundation, CDLA-Permissive 2.0) · tên &amp; địa chỉ đối chiếu VietMap. Hai máy cùng MÃ BẢN = chắc chắn cùng dữ liệu.</p>
      <button id="dg-refresh" class="more">Cập nhật danh sách điểm</button>
      <button id="dg-resync" class="more ghost">Đồng bộ lại máy này</button>

      <h4>Khu đã nạp (${RADAR.vung.list().length}/${RADAR.vung.max})</h4>
      ${RADAR.vung.list().length ? RADAR.vung.list().map(v => `<div class="cal"><span>${esc(v.ten || v.key)}</span><b>${v.spots.length} điểm</b><i class="x" data-vung="${esc(v.key)}">xoá</i></div>`).join('')
        : '<p class="hint">Chưa nạp khu nào. App tự nạp khi bạn chạy sang vùng chưa có dữ liệu.</p>'}
      ${row('Điểm quanh đây (4km)', RADAR.vung.near())}
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
    $('#dg-nap').onclick = () => { RADAR.vung.nap(true).then(paintDiag); };
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
        ${x ? `<span>${K.XE_ICON[x.chinh]}</span>` : ''}
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
  }
  function closeSheets() { $$('.sheet').forEach(s => s.hidden = true); document.body.classList.remove('sheet-open'); }

  /* ═════════════ THÊM ĐIỂM — MỘT CHẠM (§8, §9) ═════════════
     Tài xế chỉ thấy: "Đang xác định vị trí…" → "✓ Đã ghi nhận điểm đón."
     Phía sau: GPS → gộp trùng trong 55m → chấm điểm → lưu → đẩy lên máy chủ → mọi máy thấy. */
  let adding = false;
  async function addHere() {
    if (adding) return; adding = true;
    toast('Đang xác định vị trí…', 6000);
    try {
      await A.locateNow();
      const { p, gop } = A.addPointHere();
      SYNC.dirty('pick', p.id);
      toast(gop ? '✓ Đã ghi nhận (gộp vào điểm có sẵn)' : '✓ Đã ghi nhận điểm đón.', 3000);
      if (map) map.setView([p.lat, p.lng], Math.max(16, map.getZoom()));
    } catch (e) { toast('Chưa lấy được vị trí — thử lại giúp em', 3400); }
    finally { adding = false; }
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
    $('#btn-add').onclick = addHere;
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

  return { boot, paint, toast, syncBadge, centerMap, moveMe, openSheet, closeSheets, openSpot };
})();
if (typeof window !== 'undefined') window.UI = UI;
document.addEventListener('DOMContentLoaded', () => UI.boot());
