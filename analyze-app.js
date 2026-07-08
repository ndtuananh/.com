const ANALYSIS_JSON = 'analysis.json';

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

function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2800);
}

function copyCommand() {
  const url = document.getElementById('urlInput').value.trim();
  if (!url) {
    showToast('⚠️ Dán link sản phẩm Shopee vào ô trước đã.');
    return;
  }
  const cmd = `node analyze.mjs "${url}"`;
  navigator.clipboard.writeText(cmd)
    .then(() => showToast('✅ Đã sao chép lệnh — dán vào terminal dự án.'))
    .catch(() => showToast('⚠️ Không sao chép được, hãy tự gõ: ' + cmd));
}

const fmt = n => (typeof n === 'number' ? n.toLocaleString('vi-VN') + '₫' : '—');

const REC_META = {
  BUY_NOW: { label: '🔥 NÊN MUA NGAY', className: 'buy' },
  WAIT: { label: '⏳ CÂN NHẮC / CÓ THỂ CHỜ', className: 'wait' },
  NOT_GOOD: { label: '👎 CHƯA PHẢI DEAL TỐT', className: 'bad' },
};

function scoreClass(score) {
  if (score >= 72) return 'good';
  if (score >= 45) return 'mid';
  return 'low';
}

function renderResult(d) {
  const rec = REC_META[d.recommendation] || REC_META.WAIT;
  const html = `
    <div class="an-card an-summary">
      <div class="an-score ${scoreClass(d.deal_score)}">
        <div class="an-score-num">${d.deal_score}</div>
        <div class="an-score-label">Deal Score</div>
      </div>
      <div class="an-summary-body">
        <div class="an-rec ${rec.className}">${rec.label}</div>
        <h2 class="an-title">${d.product_name}</h2>
        <div class="an-shop">
          🏬 ${d.shop_name || 'Không rõ shop'}
          ${d.shop.is_official ? '<span class="an-badge">Chính hãng/Mall</span>' : ''}
          ${d.shop.rating ? `<span class="an-badge muted">⭐ ${d.shop.rating.toFixed(1)}</span>` : ''}
        </div>
      </div>
    </div>

    <div class="an-grid">
      <div class="an-card">
        <h3>💰 Thanh toán</h3>
        <div class="an-price-orig">${fmt(d.original_price)}</div>
        <div class="an-price-final">${fmt(d.final_price)}</div>
        <div class="an-price-note">Giá niêm yết: ${fmt(d.sale_price)} ${d.shopee_discount_percent ? `(-${d.shopee_discount_percent}%)` : ''}</div>
      </div>

      <div class="an-card">
        <h3>🎁 Tiết kiệm</h3>
        <div class="an-saving">${fmt(d.saving_money)}</div>
        <div class="an-price-note">${d.saving_percent}% so với giá gốc</div>
        <ul class="an-breakdown">
          ${d.voucher_shop ? `<li>Voucher Shop: <b>-${fmt(d.voucher_shop)}</b></li>` : ''}
          ${d.voucher_shopee ? `<li>Voucher Shopee: <b>-${fmt(d.voucher_shopee)}</b></li>` : ''}
          ${d.shipping_free ? `<li>Miễn phí vận chuyển</li>` : ''}
          ${d.coins_detected ? `<li>Hoàn Xu: <b>${fmt(d.coins)}</b></li>` : ''}
          ${!d.voucher_shop && !d.voucher_shopee && !d.shipping_free && !d.coins_detected ? '<li class="muted">Không phát hiện voucher/ưu đãi nào đang áp dụng</li>' : ''}
        </ul>
      </div>

      <div class="an-card">
        <h3>📦 Giá trị nhận được</h3>
        <ul class="an-breakdown">
          ${d.rating ? `<li>Đánh giá: <b>${d.rating.toFixed(1)}/5</b> (${(d.rating_count || 0).toLocaleString('vi-VN')} lượt)</li>` : '<li class="muted">Chưa có đánh giá</li>'}
          ${d.sold_display ? `<li>Đã bán: <b>${d.sold_display}</b></li>` : ''}
          ${d.gift_detected ? `<li>🎁 ${d.gift_note}</li>` : ''}
        </ul>
      </div>
    </div>

    ${d.unlock_next_discount_note ? `
      <div class="an-card an-unlock">
        🔓 <b>Còn thiếu ${fmt(d.unlock_next_discount)}</b> để mở khoá ưu đãi lớn hơn — ${d.unlock_next_discount_note}
      </div>` : ''}

    <div class="an-card">
      <h3>📋 Vì sao Deal Score = ${d.deal_score}</h3>
      <ul class="an-reasons">
        ${d.reason.map(r => `<li>${r}</li>`).join('')}
      </ul>
    </div>

    <div class="an-card an-estimate">
      <h3>🔮 Ước tính (không phải số liệu chính thức)</h3>
      <p class="an-estimate-note">${d.estimates.note}</p>
      <ul class="an-reasons">
        <li>${d.estimates.flash_sale}</li>
        <li>${d.estimates.price_trend}</li>
        ${d.estimates.price_history_points > 1 ? `<li>Giá thấp nhất từng ghi nhận (theo dõi local): ${fmt(d.estimates.lowest_price_tracked)}</li>` : ''}
      </ul>
    </div>

    <p class="an-meta">Nguồn: <a href="${d.url}" target="_blank" rel="noopener">${d.url}</a> — phân tích lúc ${new Date(d.scraped_at).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })}</p>
  `;
  document.getElementById('result').innerHTML = html;
  document.getElementById('result').style.display = 'block';
  document.getElementById('emptyState').style.display = 'none';
}

async function loadAnalysis() {
  try {
    const res = await fetch(`${ANALYSIS_JSON}?t=${Date.now()}`);
    if (!res.ok) throw new Error('not found');
    const data = await res.json();
    renderResult(data);
    showToast('✅ Đã tải kết quả phân tích!');
  } catch (e) {
    document.getElementById('result').style.display = 'none';
    document.getElementById('emptyState').style.display = 'block';
    showToast('⚠️ Chưa tìm thấy analysis.json — hãy chạy lệnh phân tích trước.');
  }
}

document.addEventListener('DOMContentLoaded', () => {
  createParticles();
  loadAnalysis();
});
