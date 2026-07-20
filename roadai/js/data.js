/* RoadAI — dữ liệu mẫu (seed). Người dùng cộng đồng bổ sung sẽ lưu ở localStorage.
   Toạ độ [lat, lng]. type: camera | police | restrict | accident | flood | jam
   Đây là dữ liệu minh hoạ để chạy demo; production sẽ đồng bộ từ backend + cơ quan nhà nước. */
window.ROADAI_SEED = [
  // --- TP.HCM ---
  { type:'camera',   lat:10.80102, lng:106.71126, note:'Camera đèn đỏ — Ngã tư Hàng Xanh', kind:'redlight' },
  { type:'camera',   lat:10.79690, lng:106.70790, note:'Camera tốc độ — Điện Biên Phủ', kind:'speed', speed:60 },
  { type:'camera',   lat:10.78230, lng:106.69590, note:'Camera phạt nguội — Nam Kỳ Khởi Nghĩa', kind:'plate' },
  { type:'camera',   lat:10.77250, lng:106.70410, note:'Camera AI — Vòng xoay Bến Thành', kind:'ai' },
  { type:'camera',   lat:10.75870, lng:106.68260, note:'Camera tốc độ — Võ Văn Kiệt', kind:'speed', speed:70 },
  { type:'police',   lat:10.78990, lng:106.71830, note:'CSGT thường trực — Nguyễn Hữu Cảnh' },
  { type:'police',   lat:10.76410, lng:106.68210, note:'CSGT hay bắn tốc độ — Võ Văn Kiệt' },
  { type:'restrict', lat:10.77980, lng:106.69300, note:'Cấm ô tô giờ cao điểm 6-9h, 16-19h — Nguyễn Thị Minh Khai', hours:'6-9,16-19', ban:'car' },
  { type:'restrict', lat:10.76980, lng:106.70120, note:'Đường một chiều — Lê Lợi', ban:'oneway' },
  { type:'flood',    lat:10.79320, lng:106.72010, note:'Điểm ngập khi mưa — Nguyễn Hữu Cảnh' },
  { type:'jam',      lat:10.80230, lng:106.71010, note:'Hay kẹt giờ tan tầm — Xô Viết Nghệ Tĩnh' },
  { type:'accident', lat:10.75990, lng:106.68900, note:'Khu vực nhiều tai nạn — cầu Chữ Y' },

  // --- Hà Nội ---
  { type:'camera',   lat:21.02770, lng:105.85140, note:'Camera đèn đỏ — Ngã tư Bà Triệu', kind:'redlight' },
  { type:'camera',   lat:21.03680, lng:105.83450, note:'Camera tốc độ — Kim Mã', kind:'speed', speed:50 },
  { type:'police',   lat:21.01380, lng:105.85210, note:'CSGT — Đại Cồ Việt' },
  { type:'flood',    lat:21.00450, lng:105.84600, note:'Điểm ngập — Trường Chinh' },

  // --- Đà Nẵng ---
  { type:'camera',   lat:16.06780, lng:108.22080, note:'Camera tốc độ — cầu sông Hàn', kind:'speed', speed:60 },
  { type:'police',   lat:16.05410, lng:108.21730, note:'CSGT — Nguyễn Văn Linh' }
];
