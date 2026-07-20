/* RoadAI · Driver Radar — ĐIỂM ĐÓN THẬT học từ app BUTL của tài xế (nguồn: "butl").
   Nơi ĐÃ TỪNG nổ cuốc lái hộ thật (đọc từ ảnh chuyến BUTL) → ƯU TIÊN hơn OSM, đẩy cầu 1.3×.
   Data thật cho thấy sân chính của tài xế là THỦ ĐỨC (Phạm Văn Đồng/Hiệp Bình/Bình Quới/Linh Xuân)
   + Gò Vấp (Hạnh Thông), ngoài Bình Tân. Mỗi lần gửi ảnh chuyến mới, thêm ĐIỂM ĐÓN vào đây.
   [tên, nhóm, lat, lng, size, homeKm, quận, nguồn] */
window.LEARNED_SPOTS = [
  ["★ Quán Thịt Nướng Xuyên Đêm — 413 Tên Lửa","phonhau",10.7418,106.6096,15,4,"Bình Tân","butl"],
  ["★ Nhậu Nguyễn Cửu Phú (Tân Tạo)","phonhau",10.75403,106.58624,14,12,"Bình Tân","butl"],
  ["★ Nhậu Đường Số 1 (An Lạc)","phonhau",10.739,106.609,13,9,"Bình Tân","butl"],
  ["★ Vựa cua Ba Phi (Phạm Văn Đồng)","nhahang",10.829,106.723,15,7,"TP Thủ Đức","butl"],
  ["★ Nhà Hàng Bên Sông (Kha Vạn Cân)","nhahang",10.833,106.718,14,7,"TP Thủ Đức","butl"],
  ["★ Nhậu Phạm Văn Đồng (Hiệp Bình)","phonhau",10.82767,106.72154,16,8,"TP Thủ Đức","butl"],
  ["★ Bò Né 3 Ngon (Hoàng Diệu 2)","nhahang",10.858,106.762,13,8,"TP Thủ Đức","butl"],
  ["★ Nhậu Hoàng Diệu 2 (Linh Xuân)","phonhau",10.85429,106.76923,13,8,"TP Thủ Đức","butl"],
  ["★ Ẩm Thực Mr Ốc Ngon (Tô Ngọc Vân)","phonhau",10.8535,106.75136,13,7,"TP Thủ Đức","butl"],
  ["★ Hi Nàng (Đỗ Xuân Hợp)","nhahang",10.818,106.772,12,8,"TP Thủ Đức","butl"],
  ["★ Nhậu Bình Quới","phonhau",10.81479,106.71797,14,8,"Bình Thạnh","butl"],
  ["★ Quán Dê Núi Vĩnh Lộc (Bình Quới)","nhahang",10.81479,106.71797,13,8,"Bình Thạnh","butl"],
  ["★ Nhậu Bình Trưng (Bình Trưng Đông)","phonhau",10.783,106.756,13,8,"TP Thủ Đức","butl"],
  ["★ Daddy Cool Dinner (City Park)","nhahang",10.78723,106.762,12,8,"TP Thủ Đức","butl"],
  ["★ Cà Phê Sala (Đường Số 32, Bình Trưng)","nhahang",10.78723,106.762,11,8,"TP Thủ Đức","butl"],
  ["★ Nhậu Bình Phú (Tam Bình)","phonhau",10.86862,106.73506,12,9,"TP Thủ Đức","butl"],
  ["★ Cơm Tấm Lu (Thống Nhất, Bình Thọ)","nhahang",10.849,106.762,11,9,"TP Thủ Đức","butl"],
  ["★ Mommy Sành Điệu (Đường Số 13, Hiệp Bình)","nhahang",10.82202,106.7183,11,7,"TP Thủ Đức","butl"],
  ["★ Vườn Lan Minh Thiện (Phạm Văn Đồng)","nhahang",10.86214,106.7545,12,7,"TP Thủ Đức","butl"],
  ["★ Chống trộm Hyperion (Phạm Văn Đồng)","phonhau",10.82767,106.72154,12,8,"TP Thủ Đức","butl"],
  ["★ Nhậu Hiệp Bình (khu đường số)","phonhau",10.84274,106.71841,14,7,"TP Thủ Đức","butl"],
  ["★ Tá Lả Quán (339 Phạm Văn Đồng)","phonhau",10.81622,106.68163,13,8,"Gò Vấp","butl"],
  ["★ Chill Garden (Hạnh Thông)","nhahang",10.828,106.688,12,8,"Gò Vấp","butl"],
  ["★ Nhậu Nguyễn Thượng Hiền (Gò Vấp)","phonhau",10.83,106.687,12,8,"Gò Vấp","butl"],
  ["★ Nhậu Thảo Điền (Nguyễn Văn Hương)","bar",10.806,106.734,12,7,"TP Thủ Đức","butl"],
  ["★ Nhậu Hoàng Sa (kênh Nhiêu Lộc)","phonhau",10.79349,106.69421,12,6,"Quận 3","butl"],
  ["★ Nhậu Chu Văn An (Bình Thạnh)","phonhau",10.81102,106.7057,11,7,"Bình Thạnh","butl"],
  ["★ Bar/Nhậu Lê Thánh Tôn (Q1)","bar",10.77908,106.70359,12,6,"Quận 1","butl"],
  ["★ Nhậu An Phú Đông (Q12)","phonhau",10.856,106.705,11,9,"Quận 12","butl"],
  ["★ Nhậu Tân Sơn Nhì (Tân Phú)","phonhau",10.79945,106.63227,11,8,"Tân Phú","butl"],
  ["★ Nhậu Nơ Trang Long (Bình Lợi Trung)","phonhau",10.81200,106.70100,13,7,"Bình Thạnh","butl"],
  ["★ Nhậu Phan Văn Trị (Bình Lợi)","phonhau",10.82000,106.70000,12,7,"Bình Thạnh","butl"],
  ["★ Nhậu Bình Lợi Trung (Phạm Văn Đồng)","phonhau",10.81500,106.71300,14,7,"Bình Thạnh","butl"],
  ["★ Nhậu Nguyễn Thái Sơn (Gò Vấp)","phonhau",10.82300,106.68300,12,8,"Gò Vấp","butl"],
  ["★ Nhậu Dạ Nam (Chánh Hưng Q8)","phonhau",10.74300,106.66500,11,8,"Quận 8","butl"],
  ["★ Nhậu Kỳ Đồng (Nhiêu Lộc Q3)","phonhau",10.78300,106.68200,11,6,"Quận 3","butl"],
  ["★ Nhậu Bà Điểm (Hóc Môn)","phonhau",10.84500,106.60500,10,10,"Hóc Môn","butl"]
];
