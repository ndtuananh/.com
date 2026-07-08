// ===== CONFIG =====
const VOUCHERS_JSON = 'vouchers.json';
const REFRESH_INTERVAL = 60; // seconds countdown display
const AUTO_FETCH_INTERVAL = 300000; // 5 mins re-fetch JSON

let allVouchers = [];
let currentFilter = 'all';
let countdown = REFRESH_INTERVAL;

// ===== COLOR MAPS =====
const colorMap = {
  freeship: { stripe: 'green', label: 'green', tag: 'green' },
  new:      { stripe: '',      label: '',      tag: '' },
  vip:      { stripe: 'gold',  label: 'gold',  tag: 'gold' },
  discount: { stripe: 'purple',label: 'purple',tag: 'purple' },
};

// ===== PARTICLES =====
function createParticles() {
  const container = document.getElementById('particles');
  for (let i = 0; i < 18; i++) {
    const p = document.createElement('div');
    p.className = 'particle';
    const size = Math.random() * 200 + 60;
    p.style.cssText = `
      width:${size}px; height:${size}px;
      left:${Math.random() * 100}%;
      animation-duration:${Math.random() * 18 + 12}s;
      animation-delay:${Math.random() * 10}s;
      opacity:${Math.random() * 0.12 + 0.04};
    `;
    container.appendChild(p);
  }
}

// ===== LOAD VOUCHERS =====
async function loadVouchers() {
  const btn = document.querySelector('.refresh-btn');
  btn && btn.classList.add('spinning');

  try {
    const res = await fetch(`${VOUCHERS_JSON}?t=${Date.now()}`);
    const data = await res.json();
    allVouchers = data.vouchers || [];

    updateStats();
    renderVouchers(allVouchers);
    updateLastUpdated(data.lastUpdated);
    showToast('✅ Đã cập nhật dữ liệu mới nhất!');
  } catch (e) {
    console.warn('Fallback to embedded data', e);
    allVouchers = getFallbackVouchers();
    updateStats();
    renderVouchers(allVouchers);
    updateLastUpdated(new Date().toISOString());
  } finally {
    btn && btn.classList.remove('spinning');
  }
}

// ===== UPDATE STATS =====
function updateStats() {
  document.getElementById('totalVouchers').textContent = allVouchers.length;
  const active = allVouchers.filter(v => v.status === 'active').length;
  document.getElementById('activeVouchers').textContent = active;
}

// ===== RENDER =====
function renderVouchers(vouchers) {
  const grid = document.getElementById('voucherGrid');
  const filtered = currentFilter === 'all'
    ? vouchers
    : vouchers.filter(v => v.type === currentFilter);

  if (filtered.length === 0) {
    grid.innerHTML = `<div class="empty-state"><div class="icon">🔍</div><p>Không có voucher phù hợp với bộ lọc này.</p></div>`;
    return;
  }

  grid.innerHTML = filtered.map((v, i) => buildCard(v, i)).join('');
}

function buildCard(v, idx) {
  const cm = colorMap[v.type] || {};
  const isExpired = v.status === 'expired';
  const stripeClass = cm.stripe ? `card-stripe ${cm.stripe}` : 'card-stripe';
  const labelClass = cm.label ? `card-label ${cm.label}` : 'card-label';
  const tagClass = cm.tag
    ? `card-tag ${cm.tag}`
    : v.tag === 'Sắp hết' ? 'card-tag danger' : 'card-tag';

  const ctaHtml = isExpired
    ? `<span class="card-cta disabled">Hết lượt</span>`
    : `<a class="card-cta" href="${v.link}" target="_blank" rel="noopener" onclick="trackClick(event,'${v.id}')">
         Lấy ngay →
       </a>`;

  const hotHtml = v.hot && !isExpired ? `<span class="hot-badge">HOT</span>` : '';

  return `
<div class="voucher-card ${isExpired ? 'expired' : ''}" 
     data-type="${v.type}"
     data-id="${v.id}"
     style="animation-delay:${idx * 0.07}s"
     onclick="handleCardClick(event, '${v.link}', ${isExpired})">
  <div class="${stripeClass}"></div>
  <div class="card-body">
    <div class="card-left" style="position:relative;">
      ${hotHtml}
      <div class="card-badge">${v.badge}</div>
      <div class="${labelClass}">${v.label}</div>
    </div>
    <div class="card-right">
      <div class="card-title">${v.title}</div>
      <div class="card-discount">${v.discount}</div>
      <div class="card-meta">
        <span>📦 ${v.minOrder}</span>
        <span class="card-condition">⚠️ ${v.condition}</span>
        <span>📅 ${v.validity}</span>
      </div>
    </div>
  </div>
  <div class="card-footer">
    <span class="${tagClass}">${v.tag}</span>
    ${ctaHtml}
  </div>
</div>`;
}

// ===== CLICK HANDLER =====
function handleCardClick(event, link, isExpired) {
  if (isExpired) {
    showToast('⚠️ Voucher này đã hết lượt sử dụng!');
    return;
  }
  // Let <a> handle the click naturally
}

function trackClick(event, id) {
  event.stopPropagation();
  showToast('🛍️ Đang mở trang Shopee...');
}

// ===== FILTER =====
function filterVouchers(type) {
  currentFilter = type;
  document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.filter === type);
  });
  renderVouchers(allVouchers);
}

// ===== TOAST =====
function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2800);
}

// ===== LAST UPDATED =====
function updateLastUpdated(isoStr) {
  try {
    const d = new Date(isoStr);
    const fmt = d.toLocaleString('vi-VN', {
      timeZone: 'Asia/Ho_Chi_Minh',
      hour: '2-digit', minute: '2-digit',
      day: '2-digit', month: '2-digit', year: 'numeric'
    });
    document.getElementById('lastUpdate').textContent = `Cập nhật lúc: ${fmt}`;
  } catch(_) {
    document.getElementById('lastUpdate').textContent = 'Vừa cập nhật';
  }
}

// ===== COUNTDOWN =====
function startCountdown() {
  countdown = REFRESH_INTERVAL;
  const el = document.getElementById('refreshCountdown');
  const tick = setInterval(() => {
    countdown--;
    if (el) el.textContent = countdown;
    if (countdown <= 0) {
      countdown = REFRESH_INTERVAL;
    }
  }, 1000);
}

// ===== FALLBACK DATA =====
function getFallbackVouchers() {
  return [
    { id:1, type:'freeship', label:'Mã Vận Chuyển', badge:'🚚', title:'Freeship Tối Đa', discount:'Giảm tối đa 500.000₫', minOrder:'Đơn tối thiểu 0₫', condition:'Dành cho đơn đầu tiên', validity:'HSD: 31 Tháng 7, 2026', status:'active', hot:true, tag:'Khách hàng mới', link:'https://shopee.vn/m/ma-giam-gia' },
    { id:2, type:'freeship', label:'Mã Vận Chuyển', badge:'🚚', title:'Freeship Tối Đa', discount:'Giảm tối đa 300.000₫', minOrder:'Đơn tối thiểu 0₫', condition:'Dành cho đơn đầu tiên', validity:'HSD: 31 Tháng 7, 2026', status:'active', hot:false, tag:'Khách hàng mới', link:'https://shopee.vn/m/ma-giam-gia' },
    { id:3, type:'new',      label:'Shopee',       badge:'🎁', title:'Giảm Giá Khách Mới', discount:'Giảm 80.000₫',          minOrder:'Đơn tối thiểu 0₫', condition:'Dành cho đơn đầu tiên', validity:'Từ 01 Tháng 7, 2026',    status:'active', hot:true, tag:'Khách hàng mới', link:'https://shopee.vn/m/ma-giam-gia' },
    { id:4, type:'new',      label:'Shopee',       badge:'💵', title:'Giảm Giá Khách Mới', discount:'Giảm 60.000₫',          minOrder:'Đơn tối thiểu 0₫', condition:'Dành cho đơn đầu tiên', validity:'HSD: 31 Tháng 7, 2026', status:'active', hot:false,tag:'Khách hàng mới', link:'https://shopee.vn/m/ma-giam-gia' },
    { id:7, type:'discount', label:'Shopee Xử Lý', badge:'⚡', title:'Giảm Giá Đơn Hàng', discount:'Giảm 18% (tối đa 40K₫)',minOrder:'Đơn tối thiểu 100k₫', condition:'Áp dụng tất cả đơn',   validity:'Đang cập nhật',         status:'active', hot:false,tag:'Xử Lý',         link:'https://shopee.vn/m/ma-giam-gia' },
    { id:8, type:'discount', label:'Shopee Xử Lý', badge:'⚡', title:'Giảm Giá Đơn Hàng', discount:'Giảm 20% (tối đa 40K₫)',minOrder:'Đơn tối thiểu 100k₫', condition:'Đã dùng 72% – Còn ít', validity:'Đang cập nhật',         status:'active', hot:true, tag:'Sắp hết',       link:'https://shopee.vn/m/ma-giam-gia' },
  ];
}

// ===== INIT =====
document.addEventListener('DOMContentLoaded', () => {
  createParticles();
  loadVouchers();
  startCountdown();

  // Auto re-fetch every 5 mins
  setInterval(loadVouchers, AUTO_FETCH_INTERVAL);
});
