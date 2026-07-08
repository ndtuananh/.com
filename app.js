/* ===================================================
   SHOPEE VOUCHER COLLECTOR – APP.JS
   =================================================== */

'use strict';

// ============================================================
//  VOUCHER DATABASE (Dữ liệu mẫu thực tế)
// ============================================================
const now = new Date();
const d = (daysFromNow) => {
  const dt = new Date(now);
  dt.setDate(dt.getDate() + daysFromNow);
  return dt.toISOString().split('T')[0];
};

const BUILTIN_VOUCHERS = [
  // ── FREESHIP ──────────────────────────────────
  {
    id: 'v001', code: 'FREESHIP40', title: 'Miễn phí vận chuyển đơn từ 0đ',
    category: 'freeship', type: 'freeship', discount: 'FREESHIP', discountRaw: 40000,
    condition: 'Không cần đơn tối thiểu', maxDiscount: '40.000đ',
    expiry: d(3), note: 'Áp dụng toàn shop, freeship tối đa 40K', isNew: true, source: 'Shopee Official'
  },
  {
    id: 'v002', code: 'FREESHIP777', title: 'Freeship toàn quốc – không giới hạn đơn',
    category: 'freeship', type: 'freeship', discount: 'FREESHIP', discountRaw: 25000,
    condition: 'Đơn từ 150.000đ', maxDiscount: '25.000đ',
    expiry: d(7), note: 'Áp dụng tất cả shop có biểu tượng Freeship', isNew: true, source: 'Shopee'
  },
  {
    id: 'v003', code: 'FS099', title: 'Freeship Extra – Giảm phí ship tới 99K',
    category: 'freeship', type: 'freeship', discount: 'FREESHIP', discountRaw: 99000,
    condition: 'Đơn từ 500.000đ', maxDiscount: '99.000đ',
    expiry: d(1), note: 'Shopee Freeship Extra dành cho đơn lớn', isNew: false, source: 'Shopee Extra'
  },
  // ── FASHION ──────────────────────────────────
  {
    id: 'v004', code: 'FASHION30', title: 'Giảm 30% thời trang nam nữ',
    category: 'fashion', type: 'percent', discount: '30%', discountRaw: 30,
    condition: 'Đơn từ 200.000đ', maxDiscount: '80.000đ',
    expiry: d(5), note: 'Áp dụng thời trang, giày dép, phụ kiện', isNew: true, source: 'Shopee Fashion'
  },
  {
    id: 'v005', code: 'THOIDANG50', title: 'Giảm 50K tất cả thời trang',
    category: 'fashion', type: 'fixed', discount: '50K', discountRaw: 50000,
    condition: 'Đơn từ 300.000đ', maxDiscount: '50.000đ',
    expiry: d(10), note: 'Đặc biệt dành cho Shopee Fashion Week', isNew: false, source: 'Shopee Fashion'
  },
  {
    id: 'v006', code: 'FLASH25', title: 'Flash Sale – Giảm 25% quần áo',
    category: 'fashion', type: 'percent', discount: '25%', discountRaw: 25,
    condition: 'Đơn từ 150.000đ', maxDiscount: '60.000đ',
    expiry: d(2), note: 'Chỉ áp dụng trong Flash Sale 12h-14h', isNew: true, source: 'Shopee Flash'
  },
  // ── ELECTRONICS ──────────────────────────────
  {
    id: 'v007', code: 'TECH100K', title: 'Giảm 100K mua điện thoại & tablet',
    category: 'electronics', type: 'fixed', discount: '100K', discountRaw: 100000,
    condition: 'Đơn từ 2.000.000đ', maxDiscount: '100.000đ',
    expiry: d(8), note: 'Áp dụng cho điện thoại, máy tính bảng', isNew: true, source: 'Shopee Mobile'
  },
  {
    id: 'v008', code: 'DIENTEN15', title: 'Giảm 15% điện tử, điện lạnh',
    category: 'electronics', type: 'percent', discount: '15%', discountRaw: 15,
    condition: 'Đơn từ 500.000đ', maxDiscount: '150.000đ',
    expiry: d(14), note: 'Không áp dụng đồng thời với mã khác', isNew: false, source: 'Shopee Brands'
  },
  {
    id: 'v009', code: 'LAPTOP200', title: 'Giảm 200K máy tính & laptop',
    category: 'electronics', type: 'fixed', discount: '200K', discountRaw: 200000,
    condition: 'Đơn từ 5.000.000đ', maxDiscount: '200.000đ',
    expiry: d(4), note: 'Voucher độc quyền Shopee Mall Electronics', isNew: false, source: 'Shopee Mall'
  },
  // ── FOOD ─────────────────────────────────────
  {
    id: 'v010', code: 'FOOD30K', title: 'Giảm 30K Shopee Food – Giao đồ ăn',
    category: 'food', type: 'fixed', discount: '30K', discountRaw: 30000,
    condition: 'Đơn Food từ 80.000đ', maxDiscount: '30.000đ',
    expiry: d(2), note: 'Áp dụng trên Shopee Food, giao từ 11h-21h', isNew: true, source: 'Shopee Food'
  },
  {
    id: 'v011', code: 'ANNGON50', title: 'Giảm 50% đồ ăn lần đầu đặt',
    category: 'food', type: 'percent', discount: '50%', discountRaw: 50,
    condition: 'Đơn từ 50.000đ, mới dùng Shopee Food', maxDiscount: '50.000đ',
    expiry: d(30), note: 'Chỉ dành cho tài khoản mới dùng Shopee Food', isNew: false, source: 'Shopee Food'
  },
  {
    id: 'v012', code: 'SHOPEEFOOD', title: 'Giảm 20K Shopee Food Thứ 6',
    category: 'food', type: 'fixed', discount: '20K', discountRaw: 20000,
    condition: 'Đơn Food từ 60.000đ, áp dụng Thứ 6', maxDiscount: '20.000đ',
    expiry: d(5), note: 'Mã khuyến mãi hàng tuần vào Thứ 6', isNew: false, source: 'Shopee Food'
  },
  // ── BEAUTY ───────────────────────────────────
  {
    id: 'v013', code: 'BEAUTY20', title: 'Giảm 20% mỹ phẩm, làm đẹp',
    category: 'beauty', type: 'percent', discount: '20%', discountRaw: 20,
    condition: 'Đơn từ 250.000đ', maxDiscount: '100.000đ',
    expiry: d(6), note: 'Áp dụng toàn bộ danh mục Làm Đẹp', isNew: true, source: 'Shopee Beauty'
  },
  {
    id: 'v014', code: 'SKINCARE50K', title: 'Giảm 50K skincare, mỹ phẩm cao cấp',
    category: 'beauty', type: 'fixed', discount: '50K', discountRaw: 50000,
    condition: 'Đơn từ 350.000đ', maxDiscount: '50.000đ',
    expiry: d(9), note: 'Ưu tiên các thương hiệu cao cấp Shopee Mall', isNew: false, source: 'Shopee Beauty'
  },
  // ── HOME ─────────────────────────────────────
  {
    id: 'v015', code: 'HOME10', title: 'Giảm 10% đồ gia dụng, nội thất',
    category: 'home', type: 'percent', discount: '10%', discountRaw: 10,
    condition: 'Đơn từ 300.000đ', maxDiscount: '200.000đ',
    expiry: d(12), note: 'Áp dụng đồ dùng nhà bếp, nội thất, trang trí', isNew: false, source: 'Shopee Home'
  },
  {
    id: 'v016', code: 'NOIDIENGIA', title: 'Giảm 150K thiết bị điện gia dụng',
    category: 'home', type: 'fixed', discount: '150K', discountRaw: 150000,
    condition: 'Đơn từ 1.500.000đ', maxDiscount: '150.000đ',
    expiry: d(3), note: 'Nồi cơm, máy lọc nước, điều hoà không áp dụng', isNew: true, source: 'Shopee Home'
  },
  // ── SPORT ────────────────────────────────────
  {
    id: 'v017', code: 'SPORT25K', title: 'Giảm 25K đồ thể thao, gym',
    category: 'sport', type: 'fixed', discount: '25K', discountRaw: 25000,
    condition: 'Đơn từ 200.000đ', maxDiscount: '25.000đ',
    expiry: d(7), note: 'Áp dụng giày thể thao, quần áo thể thao', isNew: false, source: 'Shopee Sport'
  },
  // ── BABY ─────────────────────────────────────
  {
    id: 'v018', code: 'BABY15', title: 'Giảm 15% đồ mẹ & bé',
    category: 'baby', type: 'percent', discount: '15%', discountRaw: 15,
    condition: 'Đơn từ 200.000đ', maxDiscount: '80.000đ',
    expiry: d(11), note: 'Sữa, tã bỉm, đồ chơi, quần áo trẻ em', isNew: false, source: 'Shopee Kids'
  },
  {
    id: 'v019', code: 'MEVAIBE50K', title: 'Giảm 50K sản phẩm cho mẹ và bé',
    category: 'baby', type: 'fixed', discount: '50K', discountRaw: 50000,
    condition: 'Đơn từ 400.000đ', maxDiscount: '50.000đ',
    expiry: d(15), note: 'Ưu đãi nhân ngày Quốc tế Thiếu nhi', isNew: true, source: 'Shopee Kids'
  },
  // ── TRAVEL ───────────────────────────────────
  {
    id: 'v020', code: 'TRAVEL100K', title: 'Giảm 100K đặt vé máy bay, khách sạn',
    category: 'travel', type: 'fixed', discount: '100K', discountRaw: 100000,
    condition: 'Đặt phòng từ 500.000đ', maxDiscount: '100.000đ',
    expiry: d(20), note: 'Áp dụng trên Shopee Travel & Lifestyle', isNew: true, source: 'Shopee Travel'
  },
  // ── GENERAL SHOPEE ────────────────────────────
  {
    id: 'v021', code: 'SHOPEE9.9', title: 'Sale 9.9 – Giảm 9% mọi đơn hàng',
    category: 'freeship', type: 'percent', discount: '9%', discountRaw: 9,
    condition: 'Đơn từ 100.000đ', maxDiscount: '99.000đ',
    expiry: d(1), note: 'Sự kiện đặc biệt 9.9 Shopee Siêu Sale', isNew: true, source: 'Shopee Event'
  },
  {
    id: 'v022', code: 'NEWUSER50K', title: 'Ưu đãi người dùng mới – Giảm 50K',
    category: 'freeship', type: 'fixed', discount: '50K', discountRaw: 50000,
    condition: 'Tài khoản mới, đơn từ 100.000đ', maxDiscount: '50.000đ',
    expiry: d(90), note: 'Chỉ dành cho tài khoản đăng ký mới', isNew: false, source: 'Shopee'
  },
  {
    id: 'v023', code: 'CTSHOPEEPAY', title: 'Giảm 30K khi thanh toán ShopeePay',
    category: 'freeship', type: 'fixed', discount: '30K', discountRaw: 30000,
    condition: 'Thanh toán bằng ShopeePay, đơn từ 100K', maxDiscount: '30.000đ',
    expiry: d(6), note: 'Không áp dụng đồng thời các mã khác', isNew: false, source: 'ShopeePay'
  },
  {
    id: 'v024', code: 'VNPAY20K', title: 'Giảm 20K thanh toán qua VNPay',
    category: 'freeship', type: 'fixed', discount: '20K', discountRaw: 20000,
    condition: 'Thanh toán VNPay QR, đơn từ 80K', maxDiscount: '20.000đ',
    expiry: d(4), note: 'Liên kết Shopee × VNPay', isNew: true, source: 'VNPay × Shopee'
  },
  {
    id: 'v025', code: 'SHOPEE77', title: 'Đại tiệc 7.7 – Giảm thêm 7% mọi đơn',
    category: 'fashion', type: 'percent', discount: '7%', discountRaw: 7,
    condition: 'Đơn từ 70.000đ', maxDiscount: '70.000đ',
    expiry: d(0), note: 'Voucher kỷ niệm 7/7 – Shopee anniversary', isNew: false, source: 'Shopee Event'
  },
];

// ============================================================
//  APP STATE
// ============================================================
const STATE = {
  vouchers: [],
  filtered: [],
  activeCategory: 'all',
  activeType: 'all',
  activeStatus: 'all',
  sortBy: 'newest',
  searchQuery: '',
  viewMode: 'grid',   // 'grid' | 'list'
  refreshCountdown: 300, // seconds
  refreshInterval: null,
  countdownInterval: null,
};

const CAT_META = {
  all:         { emoji: '🛒', label: 'Tất cả' },
  freeship:    { emoji: '🚚', label: 'Freeship' },
  fashion:     { emoji: '👗', label: 'Thời trang' },
  electronics: { emoji: '📱', label: 'Điện tử' },
  food:        { emoji: '🍜', label: 'Ăn uống' },
  beauty:      { emoji: '💄', label: 'Làm đẹp' },
  home:        { emoji: '🏠', label: 'Nhà cửa' },
  sport:       { emoji: '⚽', label: 'Thể thao' },
  baby:        { emoji: '👶', label: 'Mẹ & Bé' },
  travel:      { emoji: '✈️', label: 'Du lịch' },
  custom:      { emoji: '⭐', label: 'Của tôi' },
};

// ============================================================
//  INIT
// ============================================================
function init() {
  loadVouchers();
  render();
  updateStats();
  updateBadges();
  updateTicker();
  startAutoRefresh();
  bindEvents();
  // Set today's date as min for expiry input
  document.getElementById('vExpiry').min = new Date().toISOString().split('T')[0];
}

// ============================================================
//  LOAD VOUCHERS (built-in + localStorage custom)
// ============================================================
function loadVouchers() {
  const custom = loadCustomVouchers();
  STATE.vouchers = [...BUILTIN_VOUCHERS, ...custom];
  applyFilters();
}

function loadCustomVouchers() {
  try {
    const raw = localStorage.getItem('shopee_custom_vouchers');
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

function saveCustomVouchers(vouchers) {
  const custom = vouchers.filter(v => v.category === 'custom' || v._custom);
  localStorage.setItem('shopee_custom_vouchers', JSON.stringify(custom));
}

// ============================================================
//  FILTER & SORT
// ============================================================
function getVoucherStatus(expiry) {
  const exp = new Date(expiry);
  const diff = (exp - now) / (1000 * 60 * 60 * 24);
  if (diff < 0) return 'expired';
  if (diff <= 3) return 'expiring';
  return 'active';
}

function applyFilters() {
  let list = [...STATE.vouchers];

  // Search
  if (STATE.searchQuery) {
    const q = STATE.searchQuery.toLowerCase();
    list = list.filter(v =>
      v.code.toLowerCase().includes(q) ||
      v.title.toLowerCase().includes(q) ||
      (CAT_META[v.category]?.label || '').toLowerCase().includes(q)
    );
  }

  // Category
  if (STATE.activeCategory !== 'all') {
    if (STATE.activeCategory === 'custom') {
      list = list.filter(v => v._custom);
    } else {
      list = list.filter(v => v.category === STATE.activeCategory);
    }
  }

  // Type
  if (STATE.activeType !== 'all') {
    list = list.filter(v => v.type === STATE.activeType);
  }

  // Status
  if (STATE.activeStatus !== 'all') {
    list = list.filter(v => getVoucherStatus(v.expiry) === STATE.activeStatus);
  }

  // Sort
  switch (STATE.sortBy) {
    case 'newest':
      list.sort((a, b) => (b.isNew ? 1 : 0) - (a.isNew ? 1 : 0) || new Date(b.expiry) - new Date(a.expiry));
      break;
    case 'expiring':
      list.sort((a, b) => new Date(a.expiry) - new Date(b.expiry));
      break;
    case 'discount_high':
      list.sort((a, b) => b.discountRaw - a.discountRaw);
      break;
    case 'discount_low':
      list.sort((a, b) => a.discountRaw - b.discountRaw);
      break;
  }

  STATE.filtered = list;
}

// ============================================================
//  RENDER
// ============================================================
function render() {
  applyFilters();
  const grid = document.getElementById('voucherGrid');
  const empty = document.getElementById('emptyState');
  const info = document.getElementById('resultInfo');

  if (STATE.filtered.length === 0) {
    grid.innerHTML = '';
    empty.style.display = 'flex';
    info.innerHTML = `Không tìm thấy voucher`;
    return;
  }

  empty.style.display = 'none';
  const active = STATE.filtered.filter(v => getVoucherStatus(v.expiry) !== 'expired');
  info.innerHTML = `Hiển thị <strong>${STATE.filtered.length}</strong> voucher (<strong>${active.length}</strong> còn hiệu lực)`;

  grid.innerHTML = STATE.filtered.map((v, i) => renderCard(v, i)).join('');

  // Stagger animation delays
  grid.querySelectorAll('.voucher-card').forEach((el, i) => {
    el.style.animationDelay = `${i * 0.04}s`;
  });
}

function renderCard(v, i) {
  const status = getVoucherStatus(v.expiry);
  const expDate = new Date(v.expiry);
  const diffDays = Math.ceil((expDate - now) / (1000 * 60 * 60 * 24));
  const catMeta = CAT_META[v.category] || CAT_META.all;

  const statusHtml = {
    active:   `<span class="status-badge status-active">✓ Hiệu lực</span>`,
    expiring: `<span class="status-badge status-expiring">⚠ Còn ${diffDays} ngày</span>`,
    expired:  `<span class="status-badge status-expired">✕ Hết hạn</span>`,
  }[status];

  const expiryColor = status === 'expiring' ? 'expiry-soon' : '';

  const discountDisplay = v.type === 'freeship'
    ? `<span class="discount-value" style="font-size:.85rem">FREE</span><span class="discount-label">SHIP</span>`
    : `<span class="discount-value">${v.discount}</span><span class="discount-label">${v.type === 'percent' ? 'GIẢM' : 'TIẾT KIỆM'}</span>`;

  return `
    <div class="voucher-card cat-${v.category} ${status === 'expired' ? 'expired' : ''} ${v.isNew ? 'new-badge' : ''} ${v.type === 'freeship' ? 'badge-freeship' : ''}"
         onclick="openDetail('${v.id}')" data-id="${v.id}">
      <div class="card-accent"></div>
      <div class="card-body">
        <div class="card-top">
          <div class="card-discount-badge">
            ${discountDisplay}
          </div>
          <div class="card-info">
            <div class="card-cat-tag">${catMeta.emoji} ${catMeta.label}</div>
            <div class="card-title">${v.title}</div>
            <div class="card-condition">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg>
              ${v.condition}
            </div>
          </div>
        </div>

        <div class="card-code-row" onclick="event.stopPropagation(); copyCode('${v.code}', this)">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="flex-shrink:0;color:var(--orange)"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
          <span class="code-text">${v.code}</span>
          <button class="copy-btn" onclick="event.stopPropagation(); copyCode('${v.code}', this.closest('.card-code-row'))">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
            Sao chép
          </button>
        </div>

        <div class="card-footer">
          <div class="card-expiry ${expiryColor}">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>
            ${status === 'expired' ? 'Đã hết hạn' : `HSD: ${formatDate(v.expiry)}`}
          </div>
          <div style="display:flex;align-items:center;gap:8px">
            ${statusHtml}
            ${status !== 'expired' ? `<a class="use-btn" href="https://shopee.vn/buyer/promotion" target="_blank" rel="noopener" onclick="event.stopPropagation()">Dùng ngay →</a>` : ''}
          </div>
        </div>
      </div>
    </div>
  `;
}

// ============================================================
//  DETAIL MODAL
// ============================================================
function openDetail(id) {
  const v = STATE.vouchers.find(x => x.id === id);
  if (!v) return;
  const status = getVoucherStatus(v.expiry);
  const catMeta = CAT_META[v.category] || CAT_META.all;
  const expDate = new Date(v.expiry);
  const diffDays = Math.ceil((expDate - now) / (1000 * 60 * 60 * 24));

  document.getElementById('detailTitle').textContent = '🎫 Chi tiết Voucher';
  document.getElementById('detailContent').innerHTML = `
    <div class="detail-hero">
      <div class="detail-badge">${v.type === 'freeship' ? '🚚' : v.discount}</div>
      <div class="detail-title">${v.title}</div>
      <div class="card-cat-tag" style="margin-top:4px">${catMeta.emoji} ${catMeta.label} · ${v.source}</div>
    </div>

    <div class="detail-code-box">
      <span class="detail-code" id="detailCodeText">${v.code}</span>
      <button class="copy-btn" onclick="copyCode('${v.code}', this)" style="flex-shrink:0">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
        Sao chép
      </button>
    </div>

    <div class="detail-info">
      <div class="detail-row">
        <span class="detail-row-label">Giá trị giảm</span>
        <span class="detail-row-value" style="color:var(--orange)">${v.discount}</span>
      </div>
      <div class="detail-row">
        <span class="detail-row-label">Giảm tối đa</span>
        <span class="detail-row-value">${v.maxDiscount}</span>
      </div>
      <div class="detail-row">
        <span class="detail-row-label">Điều kiện đơn</span>
        <span class="detail-row-value">${v.condition}</span>
      </div>
      <div class="detail-row">
        <span class="detail-row-label">Hạn sử dụng</span>
        <span class="detail-row-value ${status === 'expiring' ? 'expiry-soon' : ''}">${formatDate(v.expiry)} ${status === 'expiring' ? `(còn ${diffDays} ngày!)` : ''}</span>
      </div>
      <div class="detail-row">
        <span class="detail-row-label">Nguồn</span>
        <span class="detail-row-value">${v.source}</span>
      </div>
      ${v.note ? `<div class="detail-row" style="flex-direction:column;align-items:flex-start;gap:4px">
        <span class="detail-row-label">📝 Lưu ý</span>
        <span class="detail-row-value" style="font-weight:500;font-size:.82rem;color:var(--text-secondary)">${v.note}</span>
      </div>` : ''}
    </div>

    ${status !== 'expired' ? `
    <button class="detail-use-btn" onclick="window.open('https://shopee.vn/buyer/promotion','_blank')">
      🛒 Dùng ngay trên Shopee →
    </button>` : ''}
  `;

  document.getElementById('detailBackdrop').classList.add('open');
}

// ============================================================
//  COPY TO CLIPBOARD
// ============================================================
function copyCode(code, el) {
  navigator.clipboard.writeText(code).then(() => {
    // Animate
    const btn = el.querySelector ? el.querySelector('.copy-btn') : el;
    if (btn) {
      const orig = btn.innerHTML;
      btn.classList.add('copied');
      btn.innerHTML = '✓ Đã sao chép!';
      setTimeout(() => {
        btn.classList.remove('copied');
        btn.innerHTML = orig;
      }, 2000);
    }
    showToast(`✅ Đã sao chép mã <strong>${code}</strong>`, 'success');
  }).catch(() => {
    // Fallback
    const ta = document.createElement('textarea');
    ta.value = code;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
    showToast(`✅ Đã sao chép mã <strong>${code}</strong>`, 'success');
  });
}

// ============================================================
//  STATS
// ============================================================
function updateStats() {
  const total = STATE.vouchers.length;
  const active = STATE.vouchers.filter(v => getVoucherStatus(v.expiry) === 'active').length;
  const expiring = STATE.vouchers.filter(v => getVoucherStatus(v.expiry) === 'expiring').length;
  const isNew = STATE.vouchers.filter(v => v.isNew).length;

  animateNumber('totalCount', total);
  animateNumber('activeCount', active);
  animateNumber('expiringCount', expiring);
  animateNumber('newCount', isNew);
}

function animateNumber(id, target) {
  const el = document.getElementById(id);
  if (!el) return;
  let current = 0;
  const step = Math.ceil(target / 20);
  const timer = setInterval(() => {
    current = Math.min(current + step, target);
    el.textContent = current;
    if (current >= target) clearInterval(timer);
  }, 40);
}

function updateBadges() {
  const cats = ['all', 'freeship', 'fashion', 'electronics', 'food', 'beauty', 'home', 'sport', 'baby', 'travel', 'custom'];
  cats.forEach(cat => {
    const el = document.getElementById(`badge-${cat}`);
    if (!el) return;
    let count;
    if (cat === 'all') count = STATE.vouchers.length;
    else if (cat === 'custom') count = STATE.vouchers.filter(v => v._custom).length;
    else count = STATE.vouchers.filter(v => v.category === cat).length;
    el.textContent = count;
  });
}

// ============================================================
//  TICKER
// ============================================================
function updateTicker() {
  const recent = STATE.vouchers
    .filter(v => v.isNew && getVoucherStatus(v.expiry) !== 'expired')
    .slice(0, 5);

  const container = document.getElementById('tickerList');
  container.innerHTML = recent.map(v => `
    <div class="ticker-item">
      <span class="ticker-code">${v.code}</span> – ${v.discount} ${CAT_META[v.category]?.label || ''}
    </div>
  `).join('');
}

// ============================================================
//  AUTO REFRESH
// ============================================================
function startAutoRefresh() {
  STATE.refreshCountdown = 300;

  // Countdown every second
  STATE.countdownInterval = setInterval(() => {
    STATE.refreshCountdown--;
    const m = Math.floor(STATE.refreshCountdown / 60).toString().padStart(2, '0');
    const s = (STATE.refreshCountdown % 60).toString().padStart(2, '0');
    const el = document.getElementById('nextRefresh');
    if (el) el.innerHTML = `Cập nhật sau: <strong>${m}:${s}</strong>`;

    if (STATE.refreshCountdown <= 0) {
      triggerRefresh(true); // auto
    }
  }, 1000);
}

function triggerRefresh(isAuto = false) {
  const overlay = document.getElementById('loadingOverlay');
  const btn = document.getElementById('refreshBtn');

  overlay.classList.add('visible');
  btn.classList.add('spinning');

  // Simulate network fetch (1.5s)
  setTimeout(() => {
    // Add fake "newly discovered" voucher occasionally
    if (isAuto && Math.random() > 0.6) {
      injectRandomNewVoucher();
    }

    // Mark some as new
    STATE.vouchers.forEach(v => {
      if (v.isNew && Math.random() > 0.7) v.isNew = false;
    });

    render();
    updateStats();
    updateBadges();
    updateTicker();

    overlay.classList.remove('visible');
    btn.classList.remove('spinning');

    // Reset countdown
    clearInterval(STATE.countdownInterval);
    STATE.refreshCountdown = 300;
    startAutoRefresh();

    if (!isAuto) {
      showToast('🔄 Đã cập nhật voucher mới nhất!', 'success');
    } else {
      showToast('✨ Tự động cập nhật voucher!', 'info');
    }
  }, 1500);
}

function injectRandomNewVoucher() {
  const templates = [
    { code: `DEAL${Math.floor(Math.random()*900+100)}`, title: 'Flash Deal – Giảm đặc biệt', category: 'freeship', type: 'percent', discount: `${Math.floor(Math.random()*20+5)}%`, discountRaw: 15, condition: 'Đơn từ 100.000đ', maxDiscount: '50.000đ', source: 'Shopee Flash', isNew: true },
    { code: `SHIP${Math.floor(Math.random()*900+100)}`, title: 'Freeship mới – Ưu đãi hôm nay', category: 'freeship', type: 'freeship', discount: 'FREESHIP', discountRaw: 30000, condition: 'Đơn từ 0đ', maxDiscount: '30.000đ', source: 'Shopee', isNew: true },
    { code: `HOT${Math.floor(Math.random()*900+100)}`, title: 'Mã hot – Vừa được cộng đồng chia sẻ', category: 'fashion', type: 'fixed', discount: '30K', discountRaw: 30000, condition: 'Đơn từ 200K', maxDiscount: '30.000đ', source: 'Cộng đồng', isNew: true },
  ];
  const t = templates[Math.floor(Math.random() * templates.length)];
  const newV = {
    ...t,
    id: `v_auto_${Date.now()}`,
    expiry: d(Math.floor(Math.random() * 5 + 1)),
    note: 'Voucher vừa được phát hiện & thêm vào',
  };
  STATE.vouchers.unshift(newV);
  applyFilters();
}

// ============================================================
//  ADD VOUCHER FORM
// ============================================================
function handleAddVoucher(e) {
  e.preventDefault();
  const code = document.getElementById('vCode').value.trim().toUpperCase();
  const title = document.getElementById('vTitle').value.trim();
  const cat = document.getElementById('vCat').value;
  const type = document.getElementById('vType').value;
  const discount = document.getElementById('vDiscount').value.trim();
  const expiry = document.getElementById('vExpiry').value;
  const min = document.getElementById('vMin').value.trim();
  const max = document.getElementById('vMax').value.trim();
  const note = document.getElementById('vNote').value.trim();

  // Check duplicate
  if (STATE.vouchers.find(v => v.code === code)) {
    showToast(`⚠️ Mã <strong>${code}</strong> đã tồn tại!`, 'error');
    return;
  }

  const newV = {
    id: `custom_${Date.now()}`,
    code, title, category: cat, type, discount,
    discountRaw: parseFloat(discount) || 0,
    condition: min ? `Đơn từ ${min}` : 'Không giới hạn',
    maxDiscount: max || discount,
    expiry, note, isNew: true, source: 'Tự thêm',
    _custom: true,
  };

  STATE.vouchers.unshift(newV);

  // Save custom to localStorage
  const customs = STATE.vouchers.filter(v => v._custom);
  localStorage.setItem('shopee_custom_vouchers', JSON.stringify(customs));

  render();
  updateStats();
  updateBadges();
  updateTicker();
  closeModal();
  showToast(`✅ Đã thêm voucher <strong>${code}</strong>!`, 'success');
  document.getElementById('addVoucherForm').reset();
}

// ============================================================
//  MODAL HELPERS
// ============================================================
function openModal() {
  document.getElementById('modalBackdrop').classList.add('open');
  document.getElementById('vCode').focus();
}
function closeModal() {
  document.getElementById('modalBackdrop').classList.remove('open');
}

// ============================================================
//  TOAST
// ============================================================
function showToast(msg, type = 'info') {
  const container = document.getElementById('toastContainer');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = msg;
  container.appendChild(toast);
  setTimeout(() => {
    toast.classList.add('hiding');
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

// ============================================================
//  HELPERS
// ============================================================
function formatDate(dateStr) {
  const dt = new Date(dateStr);
  return dt.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function resetFilters() {
  STATE.activeCategory = 'all';
  STATE.activeType = 'all';
  STATE.activeStatus = 'all';
  STATE.searchQuery = '';
  STATE.sortBy = 'newest';
  document.getElementById('searchInput').value = '';
  document.getElementById('clearSearch').classList.remove('visible');
  document.getElementById('sortSelect').value = 'newest';

  document.querySelectorAll('[data-cat]').forEach(b => b.classList.toggle('active', b.dataset.cat === 'all'));
  document.querySelectorAll('[data-type]').forEach(b => b.classList.toggle('active', b.dataset.type === 'all'));
  document.querySelectorAll('[data-status]').forEach(b => b.classList.toggle('active', b.dataset.status === 'all'));

  render();
}

// ============================================================
//  BIND EVENTS
// ============================================================
function bindEvents() {
  // Search
  const searchInput = document.getElementById('searchInput');
  const clearSearch = document.getElementById('clearSearch');
  searchInput.addEventListener('input', () => {
    STATE.searchQuery = searchInput.value;
    clearSearch.classList.toggle('visible', !!STATE.searchQuery);
    render();
  });
  clearSearch.addEventListener('click', () => {
    searchInput.value = '';
    STATE.searchQuery = '';
    clearSearch.classList.remove('visible');
    render();
  });

  // Category filter
  document.getElementById('categoryFilter').addEventListener('click', e => {
    const btn = e.target.closest('[data-cat]');
    if (!btn) return;
    STATE.activeCategory = btn.dataset.cat;
    document.querySelectorAll('[data-cat]').forEach(b => b.classList.toggle('active', b === btn));
    render();
  });

  // Type filter
  document.getElementById('typeFilter').addEventListener('click', e => {
    const btn = e.target.closest('[data-type]');
    if (!btn) return;
    STATE.activeType = btn.dataset.type;
    document.querySelectorAll('[data-type]').forEach(b => b.classList.toggle('active', b === btn));
    render();
  });

  // Status filter
  document.getElementById('statusFilter').addEventListener('click', e => {
    const btn = e.target.closest('[data-status]');
    if (!btn) return;
    STATE.activeStatus = btn.dataset.status;
    document.querySelectorAll('[data-status]').forEach(b => b.classList.toggle('active', b === btn));
    render();
  });

  // Sort
  document.getElementById('sortSelect').addEventListener('change', e => {
    STATE.sortBy = e.target.value;
    render();
  });

  // View toggle
  document.getElementById('gridViewBtn').addEventListener('click', () => {
    STATE.viewMode = 'grid';
    document.getElementById('voucherGrid').classList.remove('list-view');
    document.getElementById('gridViewBtn').classList.add('active');
    document.getElementById('listViewBtn').classList.remove('active');
  });
  document.getElementById('listViewBtn').addEventListener('click', () => {
    STATE.viewMode = 'list';
    document.getElementById('voucherGrid').classList.add('list-view');
    document.getElementById('listViewBtn').classList.add('active');
    document.getElementById('gridViewBtn').classList.remove('active');
  });

  // Refresh
  document.getElementById('refreshBtn').addEventListener('click', () => {
    if (document.getElementById('refreshBtn').classList.contains('spinning')) return;
    triggerRefresh(false);
  });

  // Add voucher modal
  document.getElementById('addVoucherBtn').addEventListener('click', openModal);
  document.getElementById('modalClose').addEventListener('click', closeModal);
  document.getElementById('cancelBtn').addEventListener('click', closeModal);
  document.getElementById('modalBackdrop').addEventListener('click', e => {
    if (e.target === document.getElementById('modalBackdrop')) closeModal();
  });
  document.getElementById('addVoucherForm').addEventListener('submit', handleAddVoucher);

  // Detail modal
  document.getElementById('detailClose').addEventListener('click', () => {
    document.getElementById('detailBackdrop').classList.remove('open');
  });
  document.getElementById('detailBackdrop').addEventListener('click', e => {
    if (e.target === document.getElementById('detailBackdrop')) {
      document.getElementById('detailBackdrop').classList.remove('open');
    }
  });

  // ESC to close modals
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      closeModal();
      document.getElementById('detailBackdrop').classList.remove('open');
    }
  });

  // Code input uppercase
  document.getElementById('vCode').addEventListener('input', e => {
    e.target.value = e.target.value.toUpperCase();
  });
}

// ============================================================
//  START
// ============================================================
document.addEventListener('DOMContentLoaded', init);
