/* RoadAI · Driver Radar — ĐIỂM ĐÓN THẬT, ĐỌC NGUYÊN VĂN TỪ ẢNH CHUYẾN BUTL (nguồn "butl").
   ─────────────────────────────────────────────────────────────────────────────
   LUẬT VÀNG CỦA FILE NÀY (nạp 01/08/2026, thay toàn bộ bản cũ):
   1) TÊN = ĐÚNG THỨ BUTL HIỆN. Quán có tên thì lấy nguyên tên; KHÔNG có tên thì
      lấy CHÍNH ĐỊA CHỈ làm tên. TUYỆT ĐỐI không tự đặt tên quán (bản cũ ghi kiểu
      "Nhậu Phạm Văn Đồng (Vườn Xoài / Bia Hà Nội)" — tên bịa, tài xế tới nơi
      không thấy quán nào tên vậy → mất niềm tin, đã xoá sạch).
   2) TOẠ ĐỘ = TRA TỪ BẢN ĐỒ THẬT (VietMap, đối chiếu OpenStreetMap), không ước
      chừng theo quận. Mỗi điểm ghi rõ ĐỘ CHÍNH XÁC ở trường `prec`:
        'chuẩn'  = bản đồ có đúng số nhà / đúng POI tên quán
        '≈100m'… = bản đồ chưa có số nhà đó, vị trí nội suy giữa 2 số nhà có thật
                   hoặc lấy theo đúng con đường/khu dân cư ghi trong địa chỉ.
      App HIỆN con số này ra cho tài xế, không giấu.
   3) `addr` = địa chỉ nguyên văn trên app BUTL (kể cả chỗ bị cắt "…"), để tài xế
      tự đối chiếu. `evi` = bằng chứng chuyến thật: giờ đón · loại xe · giá cuốc.
   Nguồn: 24 ảnh chuyến anh Long gửi 01/08/2026.
   Lần sau có ảnh mới: thêm 1 dòng, giữ nguyên 3 luật trên.
   ───────────────────────────────────────────────────────────────────────────── */
window.BUTL_PICKUPS = [
  /* ===== BÌNH THẠNH — sân chính buổi tối ===== */
  { name: '292/7 Bình Lợi', cat: 'diemdon', lat: 10.83573, lng: 106.70316, quan: 'Bình Thạnh',
    addr: '292/7 Bình Lợi, P.Bình Lợi Trung', prec: 'chuẩn', evi: '21:59 · xe hơi · 300.420đ' },
  { name: 'KHÓI - cơm tấm', cat: 'nhahang', lat: 10.81437, lng: 106.70074, quan: 'Bình Thạnh',
    addr: '12B Phan Chu Trinh, P.13 (P.Bình Thạnh)', prec: '≈150m', evi: '22:56 · xe máy · 257.000đ' },
  { name: 'Chung Cư Cửu Long - Cổng B', cat: 'diemdon', lat: 10.82218, lng: 106.70110, quan: 'Bình Thạnh',
    addr: 'Phạm Văn Đồng, P.Bình Lợi Trung', prec: 'chuẩn', evi: 'xe hơi · 366.080đ' },
  { name: '440/6 Nơ Trang Long', cat: 'diemdon', lat: 10.81958, lng: 106.70308, quan: 'Bình Thạnh',
    addr: '440/6 Nơ Trang Long, P.Bình Lợi Trung', prec: 'chuẩn', evi: 'xe hơi · 336.180đ' },
  { name: '407/11 Phạm Văn Đồng', cat: 'diemdon', lat: 10.82282, lng: 106.70163, quan: 'Bình Thạnh',
    addr: '407/11 Phạm Văn Đồng, P.Bình Lợi Trung', prec: '≈200m', evi: '18:58 · xe hơi · 246.880đ' },

  /* ===== TP THỦ ĐỨC ===== */
  { name: 'Nhà Hàng Bên Sông - Cổng 2', cat: 'nhahang', lat: 10.83036, lng: 106.73292, quan: 'TP Thủ Đức',
    addr: '17/3 Phạm Văn Đồng, Hiệp Bình Chánh', prec: '≈150m', evi: '20:21 · xe máy · 213.280đ' },
  { name: 'Ẩm Thực 36', cat: 'phonhau', lat: 10.79881, lng: 106.73402, quan: 'TP Thủ Đức',
    addr: '24 Đường Số 7, P.An Khánh', prec: 'chuẩn', evi: '23:48 · xe hơi · 372.780đ' },
  { name: '163 Trần Não (DNTN TM Ngọc Thành)', cat: 'diemdon', lat: 10.79061, lng: 106.73038, quan: 'TP Thủ Đức',
    addr: '163 Trần Não, P.An Khánh', prec: 'chuẩn', evi: '16:19 · xe hơi · 250.600đ' },
  { name: '150 Xuân Thủy (Thảo Điền)', cat: 'diemdon', lat: 10.80454, lng: 106.73921, quan: 'TP Thủ Đức',
    addr: 'Xuân Thủy, 150, P.An Khánh', prec: '≈150m', evi: '21:07 · xe hơi · 516.160đ' },
  { name: '67/13 Đường Số 2 (KP.8)', cat: 'diemdon', lat: 10.83755, lng: 106.75026, quan: 'TP Thủ Đức',
    addr: '67/13 Đường Số 2, KP.8, P.Thủ Đức', prec: '≈120m', evi: 'xe hơi · 238.650đ' },
  { name: '1060 Kha Vạn Cân', cat: 'diemdon', lat: 10.85648, lng: 106.75731, quan: 'TP Thủ Đức',
    addr: '1060 Kha Vạn Cân, P.Thủ Đức', prec: 'chuẩn', evi: '19:09 · xe hơi · 419.240đ' },
  { name: '130 Đường Số 11 (Tam Bình)', cat: 'diemdon', lat: 10.86131, lng: 106.73222, quan: 'TP Thủ Đức',
    addr: '130 Đường Số 11, P.Tam Bình', prec: 'chuẩn', evi: '17:32 · xe máy · 213.280đ' },

  /* ===== GÒ VẤP ===== */
  { name: '373/12/2 Thống Nhất', cat: 'diemdon', lat: 10.84211, lng: 106.66471, quan: 'Gò Vấp',
    addr: '373/12/2 Thống Nhất, P.Thông Tây Hội', prec: 'chuẩn', evi: '01:00 · xe máy · 226.590đ' },
  { name: 'Tiem Giat Healing (KDC CityLand)', cat: 'diemdon', lat: 10.83671, lng: 106.66700, quan: 'Gò Vấp',
    addr: 'Đường Số 10, KDC CityLand Park Hills', prec: '≈300m', evi: '21:30 · xe hơi · 451.840đ' },
  { name: '79 Đường Số 10 (P.Gò Vấp)', cat: 'diemdon', lat: 10.83670, lng: 106.66934, quan: 'Gò Vấp',
    addr: '79 Đường Số 10, P.Gò Vấp', prec: '≈300m', evi: 'xe máy · 377.900đ' },

  /* ===== QUẬN 8 ===== */
  { name: '1008 Tạ Quang Bửu (cạnh Bến xe Q8)', cat: 'diemdon', lat: 10.73358, lng: 106.65286, quan: 'Quận 8',
    addr: '1008 Tạ Quang Bửu, P.Bình Đông', prec: '≈80m', evi: '20:38 · xe máy · 186.660đ' },
  { name: '810 Tạ Quang Bửu', cat: 'diemdon', lat: 10.73692, lng: 106.67051, quan: 'Quận 8',
    addr: '810 Tạ Quang Bửu, P.Chánh Hưng', prec: '≈200m', evi: 'xe hơi · 412.980đ' },
  { name: 'Nhà Hàng Mộc Sơn (KDC Bình Điền)', cat: 'nhahang', lat: 10.69830, lng: 106.61157, quan: 'Quận 8',
    addr: '8-10-12 Đường Số 3, KDC Bình Điền, P.Bình Đông', prec: '≈350m', evi: '23:03 · xe máy · 227.800đ' },

  /* ===== QUẬN 7 ===== */
  { name: 'Ẩm Thực Sân Vườn Mái Lá', cat: 'phonhau', lat: 10.74123, lng: 106.70886, quan: 'Quận 7',
    addr: '1D Đường Số 36, P.Tân Quy', prec: 'chuẩn', evi: '19:28 · xe máy · 253.210đ' },
  { name: 'Nhà Hàng Hàng Dương Sakura', cat: 'nhahang', lat: 10.73567, lng: 106.70519, quan: 'Quận 7',
    addr: '132 Đường Số 65, KDC Tân Quy Đông', prec: 'chuẩn', evi: '22:34 · xe máy · 341.500đ' },

  /* ===== BÌNH TÂN (khu nhà anh Long) ===== */
  { name: '205 Đường Số 32', cat: 'diemdon', lat: 10.74993, lng: 106.60869, quan: 'Bình Tân',
    addr: '205 Đường Số 32, Tiểu Khu 1, P.An Lạc', prec: 'chuẩn', evi: '20:34 · xe hơi · 279.120đ' },
  { name: '26 Đường Số 34', cat: 'diemdon', lat: 10.75297, lng: 106.60767, quan: 'Bình Tân',
    addr: '26 Đường Số 34, P.An Lạc', prec: '≈100m', evi: '20:39 · xe hơi · 311.360đ' },
  { name: '442-452 Đường Số 1', cat: 'diemdon', lat: 10.74642, lng: 106.60721, quan: 'Bình Tân',
    addr: '442-452 Đường Số 1, P.An Lạc', prec: 'chuẩn', evi: '21:52 · xe hơi · 372.780đ' },

  /* ===== NGOÀI TP.HCM ===== */
  { name: '306/10/11 Hẻm 306 Nguyễn Ái Quốc', cat: 'diemdon', lat: 10.97267, lng: 106.88616, quan: 'Biên Hoà · Đồng Nai',
    addr: '306/10/11 Hẻm 306 Nguyễn Ái Quốc, Khu Phố 1', prec: '≈150m', evi: '22:26 · xe hơi · 497.400đ' },
];

/* size = 13 cho mọi điểm: đây là điểm ĐÃ NỔ CUỐC THẬT, sức hút đến từ bằng chứng
   (app đã tự cộng ưu tiên cho nguồn 'butl'), KHÔNG tự chấm điểm to nhỏ cho từng quán.
   homeKm = 7 (mặc định quãng chở khách về) — không có số thật thì không bịa số riêng. */
window.LEARNED_SPOTS = window.BUTL_PICKUPS.map(p =>
  [p.name, p.cat, p.lat, p.lng, 13, 7, p.quan, 'butl', null, p.addr, p.prec, p.evi]);
