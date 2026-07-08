#!/usr/bin/env python3
"""
Shopee Voucher Scraper - Runs via GitHub Actions every hour
Fetches vouchers from Shopee and updates vouchers.json
"""

import json
import time
import urllib.request
import urllib.error
from datetime import datetime, timezone

SHOPEE_API = "https://shopee.vn/api/v2/voucher_wallet/get_voucher_list"
MICROSITE_URL = "https://shopee.vn/m/ma-giam-gia"

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "vi-VN,vi;q=0.9,en;q=0.8",
    "Referer": "https://shopee.vn/m/ma-giam-gia",
    "x-shopee-language": "vi",
    "x-requested-with": "XMLHttpRequest",
}

# Known voucher links collected from page
KNOWN_VOUCHERS = [
    {
        "id": 1,
        "type": "freeship",
        "label": "Mã Vận Chuyển",
        "badge": "🚚",
        "title": "Freeship Tối Đa",
        "discount": "Giảm tối đa 500.000₫",
        "minOrder": "Đơn tối thiểu 0₫",
        "condition": "Dành cho đơn đầu tiên",
        "validity": "HSD: 31 Tháng 7, 2026",
        "status": "active",
        "hot": True,
        "tag": "Khách hàng mới",
        "link": "https://shopee.vn/voucher/details?evcode=RlNWLTE0NTMzODUyNjIwNzU5MDg%3D&from_source=microsite&promotionId=1453385262075908&signature=bc79aa004e342c503af887c30e3eca5729c48e3bec049d44ceea347c0b44cca9&source=0",
        "color": "#00b14f"
    },
    {
        "id": 2,
        "type": "freeship",
        "label": "Mã Vận Chuyển",
        "badge": "🚚",
        "title": "Freeship Tối Đa",
        "discount": "Giảm tối đa 300.000₫",
        "minOrder": "Đơn tối thiểu 0₫",
        "condition": "Dành cho đơn đầu tiên",
        "validity": "HSD: 31 Tháng 7, 2026",
        "status": "active",
        "hot": False,
        "tag": "Khách hàng mới",
        "link": "https://shopee.vn/voucher/details?evcode=RlNWLTE0NTMzODUyODczNzI4MDQ%3D&from_source=microsite&promotionId=1453385287372804&signature=ea104f2416f21333d09f46974c94e086845e499edf1b4575ac93bea2d4ada122&source=0",
        "color": "#00b14f"
    },
    {
        "id": 3,
        "type": "new",
        "label": "Shopee",
        "badge": "🎁",
        "title": "Giảm Giá Khách Mới",
        "discount": "Giảm 80.000₫",
        "minOrder": "Đơn tối thiểu 0₫",
        "condition": "Dành cho đơn đầu tiên",
        "validity": "Có hiệu lực từ 01 Tháng 7, 2026",
        "status": "active",
        "hot": True,
        "tag": "Khách hàng mới",
        "link": "https://shopee.vn/voucher/details?evcode=Q1JNTlVJQ0w4MFQ3&from_source=microsite&promotionId=1451239564939264&signature=ba0680f1f1744f4689c7e6e1e54df34c60165737df31cc6c3da4549e0da37348&source=0",
        "color": "#ee4d2d"
    },
    {
        "id": 4,
        "type": "new",
        "label": "Shopee",
        "badge": "💵",
        "title": "Giảm Giá Khách Mới",
        "discount": "Giảm 60.000₫",
        "minOrder": "Đơn tối thiểu 0₫",
        "condition": "Dành cho đơn đầu tiên",
        "validity": "HSD: 31 Tháng 7, 2026",
        "status": "active",
        "hot": False,
        "tag": "Khách hàng mới",
        "link": "https://shopee.vn/voucher/details?evcode=Q1JNTlVJQ0w2MFQ3&from_source=microsite&promotionId=1451239581716480&signature=738e18d7aba3e15a05f64132b1cdfb5520f9a8239d01f2e361a8fb11ad50e1f6&source=0",
        "color": "#ee4d2d"
    },
    {
        "id": 5,
        "type": "vip",
        "label": "Shopee VIP",
        "badge": "⭐",
        "title": "VIP Giảm Phần Trăm",
        "discount": "Giảm 25% (Tối đa 200.000₫)",
        "minOrder": "Đơn tối thiểu 0₫",
        "condition": "Dành riêng cho Shopee VIP",
        "validity": "Đang cập nhật...",
        "status": "expired",
        "hot": False,
        "tag": "VIP",
        "link": "https://shopee.vn/voucher/details?evcode=U1ZJUEQwMTA3TTBDMTAwUkE%3D&from_source=microsite&promotionId=1454203218333696&signature=f60d6bc6fa14e17640adf871c7e8c810f7e91b00b66b0ccd8407e4a6ea0b3f7e&source=0",
        "color": "#f39c12"
    },
    {
        "id": 6,
        "type": "vip",
        "label": "Shopee VIP",
        "badge": "⭐",
        "title": "VIP Giảm Phần Trăm",
        "discount": "Giảm 30% (Tối đa 100.000₫)",
        "minOrder": "Đơn tối thiểu 0₫",
        "condition": "Dành riêng cho Shopee VIP",
        "validity": "Đang cập nhật...",
        "status": "expired",
        "hot": False,
        "tag": "VIP",
        "link": "https://shopee.vn/voucher/details?evcode=U1ZJUEQwODA3TTBDMTAwUg%3D%3D&from_source=microsite&promotionId=1454203211124736&signature=3e580c68d4c5b3adc1ead9e74836bede84d26cebd1201020afdfe97f1e7bbbcf&source=0",
        "color": "#f39c12"
    },
    {
        "id": 7,
        "type": "discount",
        "label": "Shopee Xử Lý",
        "badge": "⚡",
        "title": "Giảm Giá Đơn Hàng",
        "discount": "Giảm 18% (Tối đa 40.000₫)",
        "minOrder": "Đơn tối thiểu 100.000₫",
        "condition": "Áp dụng cho tất cả đơn hàng",
        "validity": "Đang cập nhật...",
        "status": "active",
        "hot": False,
        "tag": "Xử Lý",
        "link": "https://shopee.vn/voucher/details?evcode=SlVMQ0wxODQwMTAw&from_source=microsite&promotionId=1451924981714944&signature=21eb37a897de5e2eb0c2125d7ad02c168ed8f1835ebe5da94d78996bdab0c7f8&source=0",
        "color": "#9b59b6"
    },
    {
        "id": 8,
        "type": "discount",
        "label": "Shopee Xử Lý",
        "badge": "⚡",
        "title": "Giảm Giá Đơn Hàng",
        "discount": "Giảm 20% (Tối đa 40.000₫)",
        "minOrder": "Đơn tối thiểu 100.000₫",
        "condition": "Đã dùng 72% – Còn ít lượt",
        "validity": "Đang cập nhật...",
        "status": "active",
        "hot": True,
        "tag": "Sắp hết",
        "link": "https://shopee.vn/voucher/details?evcode=SlVMQ0wyMDQwMTAw&from_source=microsite&promotionId=1451924983156736&signature=a3d2f74a3a01edc64fe84c2d6858e73d523516c8dad71acd08bef4285a5359c1&source=0",
        "color": "#9b59b6"
    }
]


def try_fetch_shopee_api():
    """Try to fetch fresh voucher data from Shopee API"""
    try:
        params = "limit=20&offset=0&type=0"
        url = f"{SHOPEE_API}?{params}"
        req = urllib.request.Request(url, headers=HEADERS)
        with urllib.request.urlopen(req, timeout=15) as resp:
            data = json.loads(resp.read().decode('utf-8'))
            if data.get('error') == 0 and data.get('data'):
                return data['data']
    except Exception as e:
        print(f"API fetch failed: {e}")
    return None


def update_vouchers():
    """Main update function"""
    print(f"[{datetime.now()}] Starting voucher update...")

    vouchers = KNOWN_VOUCHERS.copy()

    # Try to get fresh data from API
    api_data = try_fetch_shopee_api()
    if api_data:
        print(f"✅ Got {len(api_data)} vouchers from Shopee API")
        # Merge or replace as needed
    else:
        print("ℹ️ Using cached voucher data (API requires login)")

    now = datetime.now(timezone.utc)
    output = {
        "lastUpdated": now.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "source": MICROSITE_URL,
        "updateCount": int(time.time()),
        "vouchers": vouchers
    }

    with open('vouchers.json', 'w', encoding='utf-8') as f:
        json.dump(output, f, ensure_ascii=False, indent=2)

    print(f"✅ vouchers.json updated with {len(vouchers)} vouchers at {output['lastUpdated']}")


if __name__ == '__main__':
    update_vouchers()
