/* RoadAI · Driver Radar — QUÁN ĐỐI TÁC BUTL, TOẠ ĐỘ ĐÃ ĐỐI CHIẾU BẢN ĐỒ THẬT (01/08/2026).
   ─────────────────────────────────────────────────────────────────────────────
   VÌ SAO PHẢI LÀM LẠI: bản cũ đặt toạ độ theo CẢM TÍNH quanh trung tâm quận —
   đối chiếu VietMap thì gần như quán nào cũng lệch 0,6–8 km (Hàng Dương Sakura
   lệch 1,96 km, Bò Tơ Nhân Phát Lê Văn Quới lệch 3,6 km, Ẩm thực Quê Nhà lệch
   8,4 km và thực ra nằm ở Thảo Điền chứ không phải Tân Bình). Chấm sai chỗ =
   dẫn tài xế đi lạc, tệ hơn là không có chấm nào.

   LUẬT: chỉ đưa lên bản đồ quán TRA ĐƯỢC trên VietMap.
     prec 'chuẩn'          = VietMap có đúng POI mang tên quán.
     prec 'đúng đường ±500m' = chỉ tra được CON ĐƯỜNG trong tên quán (vd "ICOOL
                              Đồng Đen" → đúng đường Đồng Đen, chưa rõ số nhà).
   Quán không tra được → nằm ở BUTL_UNVERIFIED bên dưới, KHÔNG vẽ lên bản đồ.
   Muốn bật lại: gửi link Google Maps / ảnh của quán, sẽ nạp toạ độ thật.

   Nguồn 'doitac' ≠ 'butl': đây là quán đối tác (khách hay gọi lái hộ), CHƯA
   phải nơi đã nổ cuốc thật. Điểm đã nổ cuốc nằm ở js/learned-spots.js.
   ───────────────────────────────────────────────────────────────────────────── */
window.BUTL_PARTNERS = [
  { name: 'Bò Tơ Nhân Phát Lê Văn Quới', cat: 'phonhau', lat: 10.77534, lng: 106.616, quan: 'Bình Tân',
    addr: 'Phường Bình Trị Đông, Quận Bình Tân', prec: 'chuẩn' },   // VietMap: Bò Tơ Nhân Phát 203 Lê Văn Quới Đường Lê Văn Quới · toạ độ cũ lệch 3636m
  { name: 'Dê Núi Vĩnh Lộc', cat: 'phonhau', lat: 10.81884, lng: 106.72597, quan: 'Bình Thạnh',
    addr: 'Hẻm 206 Bình Quới, Phường 28, Quận Bình Thạnh', prec: 'chuẩn' },   // VietMap: Quán Ăn Dê Núi Vĩnh Lộc · toạ độ cũ lệch 963m
  { name: 'Đá Lửa Nguyễn Cửu Vân', cat: 'phonhau', lat: 10.79601, lng: 106.70639, quan: 'Bình Thạnh',
    addr: 'Nguyễn Cửu Vân, Phường 17, Quận Bình Thạnh', prec: 'đúng đường ±500m' },   // VietMap: Bún Bò Hẻm Đá · toạ độ cũ lệch 127m
  { name: 'Heli Beer Garden', cat: 'beerclub', lat: 10.79921, lng: 106.72086, quan: 'Bình Thạnh',
    addr: 'Phường 25, Quận Bình Thạnh', prec: 'chuẩn' },   // VietMap: Heli Beer Garden Tân Cảng · toạ độ cũ lệch 178m
  { name: 'Phương Nam 300', cat: 'phonhau', lat: 10.79954, lng: 106.70695, quan: 'Bình Thạnh',
    addr: 'Phường 17, Quận Bình Thạnh', prec: 'chuẩn' },   // VietMap: Nhà Hàng Phương Nam 300 Đường Điện Biên Phủ · toạ độ cũ lệch 1066m
  { name: 'Quán Thùy Linh', cat: 'phonhau', lat: 10.80805, lng: 106.71544, quan: 'Bình Thạnh',
    addr: 'Phường 25, Quận Bình Thạnh', prec: 'chuẩn' },   // VietMap: QUÁN THUỲ LINH · toạ độ cũ lệch 322m
  { name: 'Ba Gác Quang Trung', cat: 'phonhau', lat: 10.82693, lng: 106.67932, quan: 'Gò Vấp',
    addr: '1 Ngõ Quang Trung, Phường 10, Quận Gò Vấp', prec: 'chuẩn' },   // VietMap: Ba Gác Vietnamese Grill & Beer Quang Trung · toạ độ cũ lệch 1164m
  { name: 'Bò Tơ Nhân Phát Lê Quang Định', cat: 'phonhau', lat: 10.81547, lng: 106.68926, quan: 'Gò Vấp',
    addr: '516 Ngõ Lê Quang Định, Phường 1, Quận Gò Vấp', prec: 'chuẩn' },   // VietMap: Hệ Thống Bò Tơ Nhân Phát Chi Nhánh Lê Quang Định · toạ độ cũ lệch 2411m
  { name: 'Đá Lửa Nguyễn Oanh', cat: 'phonhau', lat: 10.84097, lng: 106.6765, quan: 'Gò Vấp',
    addr: 'A Nguyễn Oanh, Phường 17, Quận Gò Vấp', prec: 'đúng đường ±500m' },   // VietMap: Cafe Sỏi Đá · toạ độ cũ lệch 257m
  { name: 'Karaoke Nnice Phan Văn Trị', cat: 'karaoke', lat: 10.82991, lng: 106.68137, quan: 'Gò Vấp',
    addr: '524 Đường Phan Văn Trị, Phường 1, Quận Gò Vấp', prec: 'chuẩn' },   // VietMap: Karaoke Nnice · toạ độ cũ lệch 1922m
  { name: 'OM nướng Phan Văn Trị', cat: 'phonhau', lat: 10.83391, lng: 106.66862, quan: 'Gò Vấp',
    addr: 'Đường Phan Văn Trị, Phường 10, Quận Gò Vấp', prec: 'đúng đường ±500m' },   // VietMap: Satrafoods Phan Văn Trị · toạ độ cũ lệch 168m
  { name: 'Thôn Yang Kỷ', cat: 'phonhau', lat: 10.84801, lng: 106.657, quan: 'Gò Vấp',
    addr: 'Phường 16, Quận Gò Vấp', prec: 'chuẩn' },   // VietMap: Thôn Yang Kỳ Lê Văn Thọ · toạ độ cũ lệch 2751m
  { name: 'Tiệm Bia Xe Lửa', cat: 'beerclub', lat: 10.81742, lng: 106.68588, quan: 'Gò Vấp',
    addr: 'Phường 1, Quận Gò Vấp', prec: 'chuẩn' },   // VietMap: Tiệm Bia Xe Lửa Phạm Văn Đồng · toạ độ cũ lệch 2017m
  { name: 'Warning Zone Quang Trung', cat: 'bar', lat: 10.82893, lng: 106.67245, quan: 'Gò Vấp',
    addr: '283 Ngõ Quang Trung, Phường 10, Quận Gò Vấp', prec: 'chuẩn' },   // VietMap: Warning Zone 283 · toạ độ cũ lệch 125m
  { name: 'Belgo Phan Xích Long', cat: 'beerclub', lat: 10.79748, lng: 106.69066, quan: 'Phú Nhuận',
    addr: 'Phan Xích Long, Phường 7, Quận Phú Nhuận', prec: 'đúng đường ±500m' },   // VietMap: Lotteria Phan Xích Long · toạ độ cũ lệch 8m
  { name: 'BIACRAFT Trường Sa', cat: 'beerclub', lat: 10.79143, lng: 106.68139, quan: 'Phú Nhuận',
    addr: 'Phường 11, Quận Phú Nhuận', prec: 'đúng đường ±500m' },   // VietMap: Đường Trường Sa · toạ độ cũ lệch 44m
  { name: 'ICOOL Phan Xích Long', cat: 'karaoke', lat: 10.79857, lng: 106.68817, quan: 'Phú Nhuận',
    addr: 'Đường Phan Xích Long, Phường 7, Quận Phú Nhuận', prec: 'đúng đường ±500m' },   // VietMap: Comebuy-Phan Xích Long · toạ độ cũ lệch 15m
  { name: 'Làm Tí Trường Sa', cat: 'phonhau', lat: 10.79722, lng: 106.68509, quan: 'Phú Nhuận',
    addr: 'Phường 2, Quận Phú Nhuận', prec: 'chuẩn' },   // VietMap: BBQ And Beer Làm Tí Đường Trường Sa · toạ độ cũ lệch 513m
  { name: 'OM nướng Hoàng Văn Thụ', cat: 'phonhau', lat: 10.80025, lng: 106.67265, quan: 'Phú Nhuận',
    addr: 'Hoàng Văn Thụ, Phường 9, Quận Phú Nhuận', prec: 'đúng đường ±500m' },   // VietMap: Vnvc Hoàng Văn Thụ · toạ độ cũ lệch 159m
  { name: 'Quán Nhậu Út Mai', cat: 'phonhau', lat: 10.79604, lng: 106.68926, quan: 'Phú Nhuận',
    addr: 'Phường 2, Quận Phú Nhuận', prec: 'chuẩn' },   // VietMap: Quán Nhậu Út Mai · toạ độ cũ lệch 689m
  { name: '5Ku Station', cat: 'phonhau', lat: 10.77918, lng: 106.7045, quan: 'Quận 1',
    addr: 'Phường Bến Nghé, Quận 1', prec: 'chuẩn' },   // VietMap: 5Ku Station Đường Thái Văn Lung · toạ độ cũ lệch 803m
  { name: 'Ba Gác', cat: 'phonhau', lat: 10.77188, lng: 106.70045, quan: 'Quận 1',
    addr: '61 Đường Nam Kỳ Khởi Nghĩa, Phường Bến Thành, Quận 1', prec: 'chuẩn' },   // VietMap: Ba Gác Nướng & Bia Nam Kỳ · toạ độ cũ lệch 13m
  { name: 'Bier Garden', cat: 'beerclub', lat: 10.77531, lng: 106.70366, quan: 'Quận 1',
    addr: 'Phường Bến Nghé, Quận 1', prec: 'chuẩn' },   // VietMap: Nhà Hàng Bier Garden Đường Đồng Khởi · toạ độ cũ lệch 254m
  { name: 'Chivago', cat: 'bar', lat: 10.76811, lng: 106.69522, quan: 'Quận 1',
    addr: '161 Bùi Viện, Phường Phạm Ngũ Lão, Quận 1', prec: 'chuẩn' },   // VietMap: Nhà Hàng Chivago Fried Chicken And Beer · toạ độ cũ lệch 595m
  { name: 'Dori Dori', cat: 'phonhau', lat: 10.77052, lng: 106.70377, quan: 'Quận 1',
    addr: 'Phường Nguyễn Thái Bình, Quận 1', prec: 'chuẩn' },   // VietMap: Dori Dori · toạ độ cũ lệch 412m
  { name: 'East West Brewing', cat: 'beerclub', lat: 10.77324, lng: 106.69613, quan: 'Quận 1',
    addr: 'Phường Bến Thành, Quận 1', prec: 'chuẩn' },   // VietMap: Nhà Hàng East West Brewing Đường Lý Tự Trọng · toạ độ cũ lệch 458m
  { name: 'IBiero Craft Beer', cat: 'beerclub', lat: 10.78573, lng: 106.69719, quan: 'Quận 1',
    addr: '35B Nguyễn Đình Chiểu, Phường Đa Kao, Quận 1', prec: 'chuẩn' },   // VietMap: Ibiero Craft Beer · toạ độ cũ lệch 1815m
  { name: 'ICOOL Mạc Đĩnh Chi', cat: 'karaoke', lat: 10.78466, lng: 106.69936, quan: 'Quận 1',
    addr: 'Đường Mạc Đĩnh Chi, Phường Đa Kao, Quận 1', prec: 'đúng đường ±500m' },   // VietMap: Ila Mạc Đĩnh Chi · toạ độ cũ lệch 1094m
  { name: 'The Street', cat: 'bar', lat: 10.78517, lng: 106.69881, quan: 'Quận 1',
    addr: 'Phường Đa Kao, Quận 1', prec: 'chuẩn' },   // VietMap: The Street Đường Mạc Đĩnh Chi · toạ độ cũ lệch 1408m
  { name: 'Ụt Ụt', cat: 'beerclub', lat: 10.76448, lng: 106.69847, quan: 'Quận 1',
    addr: 'Phường Cầu Ông Lãnh, Quận 1', prec: 'chuẩn' },   // VietMap: Quán Ụt Ụt Đường Võ Văn Kiệt · toạ độ cũ lệch 1609m
  { name: 'Bò Tơ Nhân Phát Bắc Hải', cat: 'phonhau', lat: 10.77471, lng: 106.67591, quan: 'Quận 10',
    addr: 'Đường Cao Thắng Nối Dài, Phường 12, Quận 10', prec: 'chuẩn' },   // VietMap: Quán Bò Tơ Nhân Phát · toạ độ cũ lệch 1622m
  { name: 'ICOOL Thành Thái', cat: 'karaoke', lat: 10.77474, lng: 106.66404, quan: 'Quận 10',
    addr: 'Thành Thái, Phường 14, Quận 10', prec: 'đúng đường ±500m' },   // VietMap: Chợ Thành Thái · toạ độ cũ lệch 313m
  { name: 'Ngô Đồng', cat: 'phonhau', lat: 10.76884, lng: 106.66852, quan: 'Quận 10',
    addr: 'Phường 12, Quận 10', prec: 'chuẩn' },   // VietMap: Dê Ngô Đồng Đường 3 Tháng 2 · toạ độ cũ lệch 360m
  { name: 'Ẩm Thực Anh Em', cat: 'phonhau', lat: 10.87179, lng: 106.63476, quan: 'Quận 12',
    addr: '6A Nguyễn Thị Búp, Phường Hiệp Thành, Quận 12', prec: 'chuẩn' },   // VietMap: Nhà Hàng Ẩm Thực Anh Em · toạ độ cũ lệch 2355m
  { name: 'Nhà hàng Đại Phú', cat: 'nhahang', lat: 10.82891, lng: 106.62703, quan: 'Quận 12',
    addr: 'Phường Đông Hưng Thuận, Quận 12', prec: 'chuẩn' },   // VietMap: Nhà Hàng Đại Phú · toạ độ cũ lệch 4911m
  { name: 'Sáu Cua', cat: 'phonhau', lat: 10.86682, lng: 106.64942, quan: 'Quận 12',
    addr: 'Phường Hiệp Thành, Quận 12', prec: 'chuẩn' },   // VietMap: Nhà Hàng Sáu Cua Đường Lê Văn Khương · toạ độ cũ lệch 849m
  { name: 'BIACRAFT Lê Ngô Cát', cat: 'beerclub', lat: 10.77716, lng: 106.68436, quan: 'Quận 3',
    addr: 'Phường Võ Thị Sáu, Quận 3', prec: 'đúng đường ±500m' },   // VietMap: 16L Lê Ngô Cát · toạ độ cũ lệch 628m
  { name: 'Karaoke Nnice Võ Thị Sáu', cat: 'karaoke', lat: 10.78617, lng: 106.69036, quan: 'Quận 3',
    addr: '121 Võ Thị Sáu, Phường Võ Thị Sáu, Quận 3', prec: 'chuẩn' },   // VietMap: Karaoke Nnice Võ Thị Sáu · toạ độ cũ lệch 744m
  { name: 'Men Quán', cat: 'phonhau', lat: 10.78269, lng: 106.682, quan: 'Quận 3',
    addr: 'Phường 9, Quận 3', prec: 'chuẩn' },   // VietMap: Men Quán Đường Kỳ Đồng · toạ độ cũ lệch 623m
  { name: 'Nam Phương Lầu', cat: 'nhahang', lat: 10.77658, lng: 106.68939, quan: 'Quận 3',
    addr: 'Phường Võ Thị Sáu, Quận 3', prec: 'chuẩn' },   // VietMap: Nam Phương Lầu Nguyễn Thị Diệu · toạ độ cũ lệch 849m
  { name: 'Warning Zone Võ Văn Tần', cat: 'bar', lat: 10.77621, lng: 106.6901, quan: 'Quận 3',
    addr: '99 Võ Văn Tần, Phường Võ Thị Sáu, Quận 3', prec: 'chuẩn' },   // VietMap: Quán Warning Zone 99 · toạ độ cũ lệch 905m
  { name: '5G Saigon', cat: 'phonhau', lat: 10.76229, lng: 106.70247, quan: 'Quận 4',
    addr: '235 Hoàng Diệu, Phường 8, Quận 4', prec: 'chuẩn' },   // VietMap: 5G Saigon-Beer · toạ độ cũ lệch 454m
  { name: 'ICOOL Trần Bình Trọng', cat: 'karaoke', lat: 10.75333, lng: 106.68149, quan: 'Quận 5',
    addr: 'Phường 1, Quận 5', prec: 'đúng đường ±500m' },   // VietMap: Hẻm 31 Trần Bình Trọng 33 Trần Bình Trọng · toạ độ cũ lệch 187m
  { name: 'Bò Tơ Nhân Phát Q6', cat: 'phonhau', lat: 10.75322, lng: 106.63178, quan: 'Quận 6',
    addr: '160 Đặng Nguyên Cẩn, Phường 13, Quận 6', prec: 'chuẩn' },   // VietMap: Hệ Thống Bò Tơ Tây Ninh Nhân Phát · toạ độ cũ lệch 766m
  { name: 'ICOOL Bình Phú', cat: 'karaoke', lat: 10.74645, lng: 106.63131, quan: 'Quận 6',
    addr: 'Bình Phú, Phường 11, Quận 6', prec: 'đúng đường ±500m' },   // VietMap: Vpbank Bình Phú · toạ độ cũ lệch 654m
  { name: 'Vườn Bia Công Viên', cat: 'beerclub', lat: 10.73981, lng: 106.62582, quan: 'Quận 6',
    addr: 'Phường 10, Quận 6', prec: 'chuẩn' },   // VietMap: VƯỜN BIA CÔNG VIÊN · toạ độ cũ lệch 1324m
  { name: 'Hằng Dương Sakura', cat: 'nhahang', lat: 10.73567, lng: 106.70519, quan: 'Quận 7',
    addr: 'Phường Tân Phong, Quận 7', prec: 'chuẩn' },   // VietMap: Hàng Dương Sakura · toạ độ cũ lệch 1960m
  { name: 'Malt South', cat: 'bar', lat: 10.72179, lng: 106.72643, quan: 'Quận 7',
    addr: 'Phường Tân Phú, Quận 7', prec: 'chuẩn' },   // VietMap: Malt South · toạ độ cũ lệch 1681m
  { name: 'Mộc Riêu Nướng Q7', cat: 'phonhau', lat: 10.73929, lng: 106.70806, quan: 'Quận 7',
    addr: '436 Đường Nguyễn Thị Thập, Phường Tân Quy, Quận 7', prec: 'chuẩn' },   // VietMap: Mộc Riêu Nướng · toạ độ cũ lệch 1889m
  { name: 'Pattaya', cat: 'phonhau', lat: 10.75157, lng: 106.70052, quan: 'Quận 7',
    addr: '749 Trần Xuân Soạn, Phường Tân Hưng, Quận 7', prec: 'chuẩn' },   // VietMap: Pattaya Food & Beer · toạ độ cũ lệch 2926m
  { name: 'ICOOL Dạ Nam', cat: 'karaoke', lat: 10.74808, lng: 106.68409, quan: 'Quận 8',
    addr: '147 Đường Dạ Nam, Phường Rạch Ông, Quận 8', prec: 'chuẩn' },   // VietMap: Karaoke Icool · toạ độ cũ lệch 3039m
  { name: 'ICOOL Dương Bá Trạc', cat: 'karaoke', lat: 10.74191, lng: 106.68839, quan: 'Quận 8',
    addr: 'Đường Dương Bá Trạc, Phường Rạch Ông, Quận 8', prec: 'chuẩn' },   // VietMap: Karaoke Icool · toạ độ cũ lệch 2899m
  { name: 'Ba Gác Trương Công Định', cat: 'phonhau', lat: 10.79917, lng: 106.6415, quan: 'Tân Bình',
    addr: 'Phường 14, Quận Tân Bình', prec: 'đúng đường ±500m' },   // VietMap: Ngã Ba Trương Công Định-403 Trường Chinh · toạ độ cũ lệch 720m
  { name: 'Ghiền Quán', cat: 'phonhau', lat: 10.79265, lng: 106.64444, quan: 'Tân Bình',
    addr: '109 Ngõ Đồng Đen, Phường 12, Quận Tân Bình', prec: 'chuẩn' },   // VietMap: Ghiền Quán · toạ độ cũ lệch 6508m
  { name: 'ICOOL Đồng Đen', cat: 'karaoke', lat: 10.78801, lng: 106.64323, quan: 'Tân Bình',
    addr: 'Phường 11, Quận Tân Bình', prec: 'đúng đường ±500m' },   // VietMap: 203 Đồng Đen · toạ độ cũ lệch 15m
  { name: 'Karaoke Nnice Cộng Hòa', cat: 'karaoke', lat: 10.80105, lng: 106.66088, quan: 'Tân Bình',
    addr: '16 Ngõ Cộng Hòa, Phường 4, Quận Tân Bình', prec: 'chuẩn' },   // VietMap: Karaoke Nnice 16 Cộng Hoà · toạ độ cũ lệch 2641m
  { name: 'Mộc Riêu Nướng Lam Sơn', cat: 'phonhau', lat: 10.80793, lng: 106.66646, quan: 'Tân Bình',
    addr: '9A Lam Sơn, Phường 2, Quận Tân Bình', prec: 'chuẩn' },   // VietMap: Mộc Riêu&Nướng · toạ độ cũ lệch 1878m
  { name: 'Vườn Ẩm Thực Số 7', cat: 'nhahang', lat: 10.79817, lng: 106.66516, quan: 'Tân Bình',
    addr: 'Phường 1, Quận Tân Bình', prec: 'chuẩn' },   // VietMap: Vườn Ẩm Thực Số 7 · toạ độ cũ lệch 1328m
  { name: 'Bò Tơ Nhân Phát Trương Vĩnh Ký', cat: 'phonhau', lat: 10.79401, lng: 106.63216, quan: 'Tân Phú',
    addr: 'Trương Vĩnh Ký, Phường Tân Thành, Quận Tân Phú', prec: 'đúng đường ±500m' },   // VietMap: Phở Bò 211 · toạ độ cũ lệch 154m
  { name: 'ICOOL Nguyễn Sơn', cat: 'karaoke', lat: 10.78107, lng: 106.63238, quan: 'Tân Phú',
    addr: 'Đường Nguyễn Sơn, Phường Phú Thạnh, Quận Tân Phú', prec: 'đúng đường ±500m' },   // VietMap: Katinat Nguyễn Sơn · toạ độ cũ lệch 1459m
  { name: 'Bia Tuyết Q9', cat: 'beerclub', lat: 10.84109, lng: 106.76583, quan: 'TP Thủ Đức',
    addr: 'Phường Bình Thọ, Thành Phố Thủ Đức', prec: 'chuẩn' },   // VietMap: Bãi Đậu Xe Bia Tuyết Q9 Đường Hòa Bình · toạ độ cũ lệch 1244m
  { name: 'BIACRAFT Thảo Điền', cat: 'beerclub', lat: 10.80357, lng: 106.73459, quan: 'TP Thủ Đức',
    addr: '90 Xuân Thủy, Phường Thảo Điền, Thành Phố Thủ Đức', prec: 'chuẩn' },   // VietMap: Biacraft Xuân Thủy Q.2 · toạ độ cũ lệch 616m
  { name: 'ICOOL Hoàng Diệu 2', cat: 'karaoke', lat: 10.86076, lng: 106.76106, quan: 'TP Thủ Đức',
    addr: 'Phường Linh Chiểu, Thành Phố Thủ Đức', prec: 'đúng đường ±500m' },   // VietMap: 2 Hoàng Diệu 2 · toạ độ cũ lệch 1315m
  { name: 'ICOOL Lê Văn Việt', cat: 'karaoke', lat: 10.84633, lng: 106.7783, quan: 'TP Thủ Đức',
    addr: 'Lê Văn Việt, Phường Hiệp Phú, Thành Phố Thủ Đức', prec: 'đúng đường ±500m' },   // VietMap: Cellphones Lê Văn Việt · toạ độ cũ lệch 2157m
  { name: 'Nhà hàng Ẩm thực Quê Nhà', cat: 'nhahang', lat: 10.81486, lng: 106.72657, quan: 'TP Thủ Đức',
    addr: '169 Nguyễn Văn Hưởng, Phường Thảo Điền, Thành Phố Thủ Đức', prec: 'chuẩn' },   // VietMap: Nhà Hàng Ẩm Thực Quê Nhà · toạ độ cũ lệch 8371m
  { name: 'Saigon Smokehouse', cat: 'nhahang', lat: 10.81336, lng: 106.73223, quan: 'TP Thủ Đức',
    addr: 'Phường Thảo Điền, Thành Phố Thủ Đức', prec: 'chuẩn' },   // VietMap: Saigon Smokehouse Nguyễn Văn Hưởng · toạ độ cũ lệch 1471m
];

/* Chưa xác minh được vị trí — cố tình KHÔNG hiển thị, thà thiếu còn hơn chỉ sai đường. */
window.BUTL_UNVERIFIED = [
  'District K — Quận 1',
  'Puzzle Kitchen & Bar — Quận 1',
  'Inn Saigon — Quận 1',
  'KINGDOM — Quận 1',
  'B3 Wine Bar & Grill — Quận 2',
  'PUB CCC — Quận 2',
  'Chợ hải sản 79 — Quận 2',
  'P ti Saigon — Quận 2',
  'Zumwhere Q3 — Quận 3',
  'Pasteur Street Beer — Quận 3',
  '939 Hòn Chồng — Quận 3',
  'Yoyo Central — Quận 3',
  'BIACRAFT Q7 — Quận 7',
  'Làm Tí 3 Tháng 2 — Quận 10',
  'The Noon kitchen and beer — Quận 10',
  'Nhà hàng Cậu Mập — Bình Thạnh',
  'Alibaba — Bình Thạnh',
  'Geonbae Pocha — Bình Thạnh',
  'Zumwhere Phú Nhuận — Phú Nhuận',
  'Quốc Dân Quán — Gò Vấp',
  'Big Pig Bar BBQ Beer — Tân Bình',
  'Ốc Thủy — Tân Phú',
  'Sườn Muối Ớt Tân Phú — Tân Phú',
  'Lắc Chill Zone — Tân Phú',
  'Bò Tơ Nhân Phát Thủ Đức — TP Thủ Đức',
  'Sài Gòn Yokocho — TP Thủ Đức',
  'The Hood — TP Thủ Đức',
];

/* [tên, nhóm, lat, lng, size, homeKm, quận, nguồn, pid, địa chỉ, độ chính xác] */
window.BUTL_SPOTS = window.BUTL_PARTNERS.map(p =>
  [p.name, p.cat, p.lat, p.lng, 12, 6, p.quan, 'doitac', null, p.addr, p.prec]);
