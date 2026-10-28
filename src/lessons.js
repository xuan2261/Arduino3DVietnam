// Nội dung được biên soạn lại bằng tiếng Việt. Các Sketch là ví dụ
// cho phần cứng Arduino thật; phần mềm chỉ mô phỏng hành vi được mô tả.
const slider = (key, label, min, max, initial, unit = "", step = 1) =>
  ({ type: "slider", key, label, min, max, initial, unit, step });
const toggle = (key, label, initial = false) =>
  ({ type: "toggle", key, label, initial });
const select = (key, label, options, initial) =>
  ({ type: "select", key, label, options, initial });
const button = (key, label) => ({ type: "button", key, label, initial: false });
const piano = () => ({ type: "piano", key: "note", label: "Chọn nốt nhạc", initial: "" });

export const lessons = Object.freeze([
  {
    id: 1, slug: "lam-quen-arduino", title: "Làm quen với Arduino Uno R3",
    category: "CHƯƠNG 01 · KHỞI ĐẦU", level: "Nhập môn", minutes: 10,
    description: "Khám phá vi điều khiển, các chân kết nối và đèn LED tích hợp ngay trên bo mạch.",
    goal: "Nhận biết bo Arduino Uno R3, chân cấp nguồn, chân tín hiệu và đèn LED L tại D13.",
    theory: "Arduino Uno R3 sử dụng vi điều khiển ATmega328P. Bo có 14 chân vào/ra số D0–D13, 6 chân đọc tín hiệu tương tự A0–A5 và hoạt động ở mức logic 5 V. Đèn L trên bo phản ánh trạng thái chân D13.",
    insight: "HIGH thường tương ứng mức logic cao, LOW tương ứng mức thấp. Đèn trên mô hình giúp quan sát trạng thái xuất ra mà không cần lắp LED rời.",
    caution: "Không nối trực tiếp chân 5V với GND. Mô phỏng này không cấp nguồn hay nạp mã vào bo thật.",
    components: ["Arduino Uno R3", "Đèn L tích hợp", "Cáp USB-B (minh họa)"],
    wiring: [["LED L tích hợp", "D13", "Đèn có sẵn trên bo"], ["GND", "Mass chung", "Điểm tham chiếu điện áp"]],
    steps: ["Quan sát cổng USB-B, IC ATmega328P và các hàng chân D0–D13, A0–A5.", "Bật công tắc LED L giả lập rồi nhấn Chạy mô phỏng.", "Thử xoay mô hình, mở sơ đồ chân và quan sát đèn L."],
    controls: [toggle("ledEnabled", "Bật LED L", true)],
    sketch: `// Bài 01 — Điều khiển LED có sẵn trên Arduino Uno
const int LED = LED_BUILTIN;

void setup() {
  pinMode(LED, OUTPUT);
}

void loop() {
  digitalWrite(LED, HIGH);
  // Trong bài thực hành, hãy thử đổi HIGH thành LOW.
}`,
    quiz: { question: "Đèn LED L tích hợp trên Arduino Uno R3 thường nối với chân nào?", choices: ["A0", "D13", "5V", "RESET"], answer: 1, explanation: "Đúng! LED L tích hợp được điều khiển qua chân digital D13." }
  },
  {
    id: 2, slug: "led-nhap-nhay", title: "Làm LED nhấp nháy",
    category: "CHƯƠNG 01 · TÍN HIỆU SỐ", level: "Cơ bản", minutes: 15,
    description: "Tạo tín hiệu bật/tắt luân phiên và làm quen với hàm delay().",
    goal: "Hiểu OUTPUT, digitalWrite() và khoảng trễ tạo nhấp nháy LED.",
    theory: "Đèn LED có cực anode (+) và cathode (−). Khi dùng LED rời phải mắc điện trở hạn dòng nối tiếp, ví dụ 220 Ω với nguồn và linh kiện phù hợp. digitalWrite(HIGH) và digitalWrite(LOW) thay đổi mức tại chân digital.",
    insight: "Mỗi chu kỳ gồm hai lần chờ: thời gian sáng và thời gian tắt. Thay đổi khoảng trễ giúp thay đổi tốc độ nhấp nháy.",
    caution: "Không mắc LED trực tiếp vào nguồn mà bỏ qua điện trở hạn dòng.",
    components: ["Arduino Uno R3", "LED đỏ", "Điện trở 220 Ω", "Breadboard", "Dây nối"],
    wiring: [["D13", "Điện trở 220 Ω → LED (+)", "Giới hạn dòng LED"], ["LED (−)", "GND", "Khép kín đường dòng điện"]],
    steps: ["Xác định chân D13 và cực LED trong sơ đồ.", "Chọn thời gian giữ LED sáng/tắt ở thanh trượt.", "Chạy mô phỏng rồi thay đổi thời gian và quan sát nhịp nhấp nháy."],
    controls: [slider("interval", "Chu kỳ nửa nhịp", 200, 1800, 1000, "ms", 100)],
    sketch: `// Bài 02 — Blink LED, thay INTERVAL để thử nhịp
const int LED = 13;
const unsigned long INTERVAL = 1000;

void setup() {
  pinMode(LED, OUTPUT);
}

void loop() {
  digitalWrite(LED, HIGH);
  delay(INTERVAL);
  digitalWrite(LED, LOW);
  delay(INTERVAL);
}`,
    quiz: { question: "Hàm nào đặt chân D13 ở trạng thái mức cao?", choices: ["analogRead(13)", "pinMode(13, INPUT)", "digitalWrite(13, HIGH)", "delay(13)"], answer: 2, explanation: "digitalWrite(13, HIGH) đưa chân D13 về mức logic cao khi chân được cấu hình OUTPUT." }
  },
  {
    id: 3, slug: "nut-nhan", title: "Đọc trạng thái nút nhấn",
    category: "CHƯƠNG 01 · ĐẦU VÀO SỐ", level: "Cơ bản", minutes: 18,
    description: "Thử hai chế độ giữ nút và bật/tắt LED qua cạnh nhấn.",
    goal: "Phân biệt trạng thái HIGH/LOW, điện trở kéo xuống và xử lý nút nhấn.",
    theory: "Nút nhấn tạo kết nối điện khi được ấn. Mạch dùng điện trở kéo xuống 10 kΩ để giữ D2 ở LOW lúc thả; khi nhấn, D2 nhận 5V nên đọc HIGH. Có thể thay bằng INPUT_PULLUP với cách đấu và logic ngược.",
    insight: "Chế độ Giữ: LED sáng chỉ khi đang giữ nút. Chế độ Bật/tắt: mỗi lần nhấn hợp lệ sẽ đổi trạng thái LED; phải khử dội tín hiệu khi làm trên mạch thật.",
    caution: "Một chân INPUT không có trở kéo phù hợp có thể bị floating và đọc giá trị không ổn định.",
    components: ["Arduino Uno R3", "Nút nhấn 4 chân", "Điện trở kéo xuống 10 kΩ", "LED đỏ", "Điện trở 220 Ω"],
    wiring: [["5V", "Một bên nút nhấn", "Nguồn mức HIGH"], ["D2", "Bên còn lại của nút", "Đọc trạng thái nút"], ["D2", "Điện trở 10 kΩ → GND", "Kéo xuống khi thả"], ["D13", "LED + điện trở → GND", "Đèn đầu ra"]],
    steps: ["Quan sát đường 5V → nút → D2 và điện trở kéo xuống D2 → GND.", "Chọn chế độ Giữ nút, chạy mô phỏng và ấn giữ nút đỏ.", "Đổi sang chế độ Bật/tắt; nhấn và thả nhiều lần để quan sát LED đổi trạng thái."],
    controls: [select("buttonMode", "Chế độ", [["hold", "Giữ nút"], ["toggle", "Bật/tắt"]], "hold"), button("pressed", "Nhấn và giữ nút đỏ")],
    sketch: `// Bài 03 — Nút nhấn và LED (chế độ GIỮ)
const int BUTTON = 2;
const int LED = 13;

void setup() {
  pinMode(BUTTON, INPUT); // D2 có trở kéo xuống 10 kΩ
  pinMode(LED, OUTPUT);
  Serial.begin(9600);
}

void loop() {
  bool pressed = digitalRead(BUTTON) == HIGH;
  digitalWrite(LED, pressed ? HIGH : LOW);
  Serial.println(pressed ? "DA NHAN" : "DA THA");
  delay(30);
}
// Chế độ BẬT/TẮT trong mô phỏng minh họa
// xử lý cạnh nhấn và chống dội 30 ms.`,
    quiz: { question: "Điện trở kéo xuống 10 kΩ giúp điều gì khi nút chưa được nhấn?", choices: ["Tăng điện áp chân D2 lên 12 V", "Giữ D2 ở LOW, tránh floating", "Làm LED sáng mạnh hơn", "Thay thế điện trở hạn dòng LED"], answer: 1, explanation: "Điện trở kéo xuống đưa D2 về mức LOW xác định khi nút thả." }
  },
  {
    id: 4, slug: "bien-tro", title: "Đọc giá trị biến trở",
    category: "CHƯƠNG 02 · TÍN HIỆU ANALOG", level: "Cơ bản", minutes: 17,
    description: "Biến giá trị analog thành độ sáng LED bằng điều chế độ rộng xung PWM.",
    goal: "Đọc ADC 10 bit từ A0 và ánh xạ kết quả sang giá trị PWM 0–255.",
    theory: "Arduino Uno đọc analogRead(A0) theo thang giá trị 0–1023 trong phạm vi tham chiếu ADC. PWM analogWrite() trên chân hỗ trợ PWM tạo tín hiệu có chu kỳ nhiệm vụ thay đổi, không phải điện áp analog liên tục.",
    insight: "Đọc biến trở là đầu vào; thay đổi độ sáng LED qua PWM là đầu ra. Hai khái niệm độc lập.",
    caution: "Chỉ cấp cho A0 tín hiệu nằm trong phạm vi điện áp cho phép của bo.",
    components: ["Biến trở 10 kΩ", "LED", "Điện trở 220 Ω", "Arduino Uno"],
    wiring: [["5V", "Đầu ngoài biến trở", "Nguồn tham chiếu"], ["GND", "Đầu ngoài còn lại", "Mass"], ["A0", "Chân giữa biến trở", "Điện áp điều chỉnh"], ["D9 (PWM)", "Điện trở + LED → GND", "Điều chỉnh độ sáng"]],
    steps: ["Xem chân giữa biến trở nối với A0.", "Kéo thanh trượt từ 0 đến 1023 rồi bấm Chạy.", "Quan sát giá trị ADC và độ sáng LED thay đổi."],
    controls: [slider("analog", "Giá trị A0", 0, 1023, 512, "", 1)],
    sketch: `// Bài 04 — analogRead và PWM
const int POT = A0;
const int LED = 9;
void setup() { pinMode(LED, OUTPUT); }
void loop() {
  int adc = analogRead(POT);
  int pwm = map(adc, 0, 1023, 0, 255);
  analogWrite(LED, pwm);
  delay(30);
}`,
    quiz: { question: "analogRead(A0) trên Arduino Uno R3 thường trả về khoảng giá trị nào?", choices: ["0–1", "0–255", "0–1023", "−5–5"], answer: 2, explanation: "ADC của ATmega328P có độ phân giải 10 bit, tương ứng 1024 mức (0–1023)." }
  },
  {
    id: 5, slug: "led-rgb", title: "Trộn màu với LED RGB",
    category: "CHƯƠNG 02 · PWM & MÀU SẮC", level: "Cơ bản", minutes: 18,
    description: "Kết hợp ba kênh đỏ, xanh lá và xanh dương để tạo màu mới.",
    goal: "Hiểu nguyên lý phối màu cộng RGB và ba giá trị PWM độc lập.",
    theory: "LED RGB có ba kênh màu. Với loại cathode chung, các chân R/G/B lần lượt điều khiển độ sáng bằng PWM; mỗi kênh thường cần điện trở hạn dòng riêng.",
    insight: "Đỏ 255 + xanh lá 255 + xanh dương 0 tạo màu vàng; cả ba kênh cao tạo ánh sáng gần trắng (phụ thuộc LED thực).",
    caution: "LED RGB anode chung đảo logic điều khiển so với cathode chung.",
    components: ["LED RGB cathode chung", "Ba điện trở hạn dòng", "Arduino Uno"],
    wiring: [["D9", "R qua điện trở", "Kênh đỏ"], ["D10", "G qua điện trở", "Kênh xanh lá"], ["D11", "B qua điện trở", "Kênh xanh dương"], ["GND", "Cathode chung", "Mass"]],
    steps: ["Nhận biết từng chân R, G, B và cathode chung.", "Thay đổi từng thanh trượt từ 0 đến 255.", "Chạy mô phỏng và kết hợp nhiều kênh để tạo màu mới."],
    controls: [slider("red", "Đỏ (R)", 0, 255, 220), slider("green", "Xanh (G)", 0, 255, 100), slider("blue", "Lam (B)", 0, 255, 50)],
    sketch: `// Bài 05 — LED RGB cathode chung
const int R = 9, G = 10, B = 11;
void setup() {
  pinMode(R, OUTPUT); pinMode(G, OUTPUT); pinMode(B, OUTPUT);
}
void loop() {
  analogWrite(R, 220);
  analogWrite(G, 100);
  analogWrite(B, 50);
}`,
    quiz: { question: "Cần bao nhiêu kênh PWM độc lập để điều chỉnh R/G/B của LED RGB?", choices: ["Một", "Hai", "Ba", "Sáu"], answer: 2, explanation: "Ba kênh PWM điều chỉnh độc lập độ sáng của đỏ, xanh lá và xanh dương." }
  },
  {
    id: 6, slug: "cam-bien-anh-sang", title: "Đọc cảm biến ánh sáng",
    category: "CHƯƠNG 02 · CẢM BIẾN", level: "Cơ bản", minutes: 17,
    description: "Quan sát sự thay đổi giá trị analog khi môi trường tối đi.",
    goal: "Tạo ngưỡng để tự động bật LED khi giá trị cảm biến xuống thấp.",
    theory: "Quang trở LDR thay đổi điện trở theo cường độ sáng. Kết hợp với một điện trở cố định tạo mạch chia áp đo bằng A0. Chiều thay đổi ADC phụ thuộc vị trí của LDR trong mạch chia áp.",
    insight: "Trong sơ đồ bài này, ADC thấp đại diện ánh sáng yếu; nếu ADC < 400, LED bật.",
    caution: "Không áp dụng ngưỡng mẫu cho mọi cảm biến nếu chưa hiệu chuẩn.",
    components: ["LDR", "Điện trở 10 kΩ", "LED", "Arduino Uno"],
    wiring: [["5V", "LDR", "Nhánh dương chia áp"], ["A0", "Nút chia áp", "Đo điện áp cảm biến"], ["GND", "Điện trở 10 kΩ", "Nhánh mass"], ["D13", "LED báo tối", "Ngõ ra"]],
    steps: ["Đọc sơ đồ LDR và điện trở tạo cầu chia áp.", "Chỉnh mức ánh sáng giả lập ở A0.", "Chạy mô phỏng, thử giá trị nhỏ hơn và lớn hơn 400."],
    controls: [slider("light", "Mức ánh sáng", 0, 1023, 650)],
    sketch: `// Bài 06 — Theo dõi ánh sáng
const int SENSOR = A0;
const int LED = 13;
void setup() { pinMode(LED, OUTPUT); Serial.begin(9600); }
void loop() {
  int light = analogRead(SENSOR);
  digitalWrite(LED, light < 400 ? HIGH : LOW);
  Serial.println(light);
  delay(100);
}`,
    quiz: { question: "Vì sao cần một điện trở cùng với LDR để đọc qua A0?", choices: ["Để biến sự thay đổi điện trở thành điện áp đo được", "Để tạo tín hiệu USB", "Để tăng số chân digital", "Để đổi chân A0 thành GND"], answer: 0, explanation: "LDR và điện trở cố định tạo mạch chia áp, giúp Arduino đo ánh sáng dưới dạng điện áp." }
  },
  {
    id: 7, slug: "do-khoang-cach", title: "Đo khoảng cách bằng siêu âm",
    category: "CHƯƠNG 02 · CẢM BIẾN", level: "Trung bình", minutes: 20,
    description: "Dùng cảm biến HC-SR04 để mô phỏng đo khoảng cách đến vật cản.",
    goal: "Hiểu chân Trig/Echo và cách tính khoảng cách từ thời gian xung siêu âm.",
    theory: "HC-SR04 phát xung âm và đo thời gian phản hồi; khoảng cách xấp xỉ bằng thời gian khứ hồi nhân tốc độ âm thanh rồi chia đôi. Đặc tính đo bị ảnh hưởng bởi góc phản xạ và môi trường.",
    insight: "Mô phỏng cảnh báo khi khoảng cách dưới 20 cm; khoảng đo sử dụng ở đây chỉ là tham số giả lập.",
    caution: "Bài mô phỏng không thể đo vật cản ngoài đời qua webcam hoặc loa của máy tính.",
    components: ["HC-SR04", "LED cảnh báo", "Arduino Uno", "Breadboard"],
    wiring: [["5V", "VCC HC-SR04", "Nguồn cảm biến"], ["GND", "GND HC-SR04", "Mass chung"], ["D7", "Trig", "Phát xung"], ["D8", "Echo", "Nhận xung"], ["D13", "LED cảnh báo", "Đầu ra"]],
    steps: ["Nhận biết Trig phát xung và Echo nhận thời gian phản hồi.", "Thay đổi khoảng cách từ 2 đến 400 cm.", "Kiểm tra thời điểm LED cảnh báo sáng khi dưới 20 cm."],
    controls: [slider("distance", "Khoảng cách", 2, 400, 70, "cm")],
    sketch: `// Bài 07 — Đo khoảng cách HC-SR04
const int TRIG = 7, ECHO = 8, LED = 13;
void setup() { pinMode(TRIG, OUTPUT); pinMode(ECHO, INPUT); pinMode(LED, OUTPUT); }
void loop() {
  digitalWrite(TRIG, LOW); delayMicroseconds(2);
  digitalWrite(TRIG, HIGH); delayMicroseconds(10);
  digitalWrite(TRIG, LOW);
  unsigned long duration = pulseIn(ECHO, HIGH, 30000);
  float cm = duration * 0.0343 / 2.0;
  digitalWrite(LED, duration && cm < 20 ? HIGH : LOW);
  delay(100);
}`,
    quiz: { question: "Tại sao trong phép tính khoảng cách bằng thời gian Echo cần chia cho 2?", choices: ["Vì cảm biến có hai nguồn", "Vì sóng đi từ cảm biến đến vật rồi quay về", "Vì Arduino chỉ đọc số chẵn", "Vì chân Echo có hai trạng thái"], answer: 1, explanation: "Thời gian Echo đo cả hành trình đi và về, nên chia hai để suy ra khoảng cách một chiều." }
  },
  {
    id: 8, slug: "coi-buzzer", title: "Phát âm thanh với buzzer",
    category: "CHƯƠNG 03 · ÂM THANH", level: "Cơ bản", minutes: 15,
    description: "Điều chỉnh tần số và làm quen với hàm tone().",
    goal: "Liên hệ tần số dao động với độ cao của âm và điều khiển buzzer thụ động.",
    theory: "Buzzer thụ động có thể được điều khiển bằng tín hiệu vuông tại tần số mong muốn. tone(pin, frequency) là một cách phát tín hiệu âm đơn giản trên Arduino.",
    insight: "Tần số cao hơn thường tạo cảm giác âm cao hơn. Phần mềm hiển thị tần số giả lập; không tự phát âm khi chưa có thao tác của người học.",
    caution: "Dùng mức âm lượng vừa phải khi thử buzzer thực tế.",
    components: ["Buzzer thụ động", "Arduino Uno", "Dây nối"],
    wiring: [["D8", "Cực (+) buzzer", "Tín hiệu tone"], ["GND", "Cực (−) buzzer", "Mass"]],
    steps: ["Xem cực (+) và (−) của buzzer.", "Chỉnh tần số rồi bật công tắc âm.", "Chạy mô phỏng, quan sát tần số và thay đổi qua ba mức."],
    controls: [slider("frequency", "Tần số", 200, 2000, 440, "Hz", 10), toggle("sound", "Phát âm", true)],
    sketch: `// Bài 08 — Buzzer thụ động
const int BUZZER = 8;
void setup() {}
void loop() {
  tone(BUZZER, 440);
  delay(500);
  noTone(BUZZER);
  delay(500);
}`,
    quiz: { question: "Điều gì thay đổi chính khi tăng tần số từ 440 Hz lên 880 Hz?", choices: ["Âm thường cao hơn một quãng tám", "Âm tự động nhỏ hơn 50%", "Buzzer đổi màu", "Arduino tăng điện áp lên 10 V"], answer: 0, explanation: "880 Hz gấp đôi 440 Hz, tương ứng một quãng tám trong hệ âm nhạc." }
  },
  {
    id: 9, slug: "piano-mini", title: "Đàn piano mini",
    category: "CHƯƠNG 03 · ÂM NHẠC", level: "Trung bình", minutes: 20,
    description: "Chọn các nốt Đô–Rê–Mi để quan sát điều khiển buzzer.",
    goal: "Liên hệ các nốt nhạc với tần số và phát âm bằng tone().",
    theory: "Mỗi nốt nhạc có tần số cơ bản khác nhau. Ví dụ Đô 4 (C4) khoảng 262 Hz, La 4 (A4) là 440 Hz. Mạch đàn mẫu dùng 7 nút nối về GND tại D2–D8, cấu hình INPUT_PULLUP và chọn nốt theo nút đang nhấn; buzzer nhận âm ở D9.",
    insight: "Bài này chỉ hiển thị tần số và trạng thái nốt; nếu bật âm, trình duyệt có thể tạo âm thanh tổng hợp với Web Audio sau tương tác.",
    caution: "Không nên để âm lớn hoặc phát âm liên tục quá lâu.",
    components: ["Buzzer thụ động", "7 nút nhấn", "Arduino Uno"],
    wiring: [["D9", "Buzzer (+)", "Tín hiệu tone"], ["GND", "Buzzer (−)", "Mass"], ["D2–D8", "Một chân của 7 nút nhấn tương ứng", "Đầu vào INPUT_PULLUP"], ["GND", "Chân còn lại của mỗi nút nhấn", "Nhấn = LOW"]],
    steps: ["Xem bảng tần số các nốt.", "Nhấn Chạy mô phỏng, chọn Đô/Rê/Mi...", "So sánh nốt thấp và nốt cao bằng giá trị Hz."],
    controls: [piano()],
    sketch: `// Bài 09 — 7 nút đàn piano; mỗi nút nối GND
const byte BUZZER = 9;
const byte KEYS[7] = {2, 3, 4, 5, 6, 7, 8};
const int NOTES[7] = {262, 294, 330, 349, 392, 440, 494};
void setup() {
  for (byte i = 0; i < 7; ++i) pinMode(KEYS[i], INPUT_PULLUP);
}
void loop() {
  int selected = -1;
  for (byte i = 0; i < 7; ++i) {
    if (digitalRead(KEYS[i]) == LOW) { selected = i; break; }
  }
  if (selected >= 0) tone(BUZZER, NOTES[selected]);
  else noTone(BUZZER);
  delay(10);
}`,
    quiz: { question: "Trong Arduino, lệnh nào được dùng để phát tín hiệu âm ở tần số chỉ định?", choices: ["analogRead()", "tone()", "digitalRead()", "millis()"], answer: 1, explanation: "tone(pin, frequency) tạo tín hiệu âm trên chân được chọn." }
  },
  {
    id: 10, slug: "dong-co-dc", title: "Điều khiển động cơ DC",
    category: "CHƯƠNG 04 · CHUYỂN ĐỘNG", level: "Trung bình", minutes: 23,
    description: "Điều chỉnh tốc độ và chiều quay động cơ qua mạch điều khiển chuyên dụng.",
    goal: "Hiểu sự khác biệt giữa chân điều khiển Arduino và nguồn công suất của động cơ.",
    theory: "Động cơ DC cần dòng điện lớn hơn mức phù hợp với chân digital Arduino. Vì vậy phải dùng driver hoặc transistor thích hợp, nguồn riêng khi cần, diode bảo vệ với tải cảm và GND chung theo thiết kế driver.",
    insight: "PWM điều chỉnh công suất trung bình đưa đến động cơ; chiều quay thường được điều khiển qua các chân logic driver cầu H.",
    caution: "Không nối động cơ DC trực tiếp vào chân digital của Arduino Uno.",
    components: ["Động cơ DC", "Driver cầu H", "Nguồn cho động cơ", "Arduino Uno"],
    wiring: [["D9 (PWM)", "ENA của driver", "Điều chỉnh tốc độ"], ["D7", "IN1 của driver", "Chiều quay"], ["D8", "IN2 của driver", "Chiều quay"], ["GND", "GND driver", "Chung mass"]],
    steps: ["Quan sát vị trí driver giữa Arduino và động cơ.", "Chỉnh tốc độ và chiều quay.", "Chạy mô phỏng và thử đảo chiều khi tốc độ khác 0."],
    controls: [slider("motor", "Tốc độ PWM", 0, 255, 160), select("direction", "Chiều quay", [["forward", "Thuận"], ["reverse", "Ngược"]], "forward")],
    sketch: `// Bài 10 — Điều khiển driver cầu H
const int ENA = 9, IN1 = 7, IN2 = 8;
void setup() {
  pinMode(ENA, OUTPUT); pinMode(IN1, OUTPUT); pinMode(IN2, OUTPUT);
}
void loop() {
  digitalWrite(IN1, HIGH);
  digitalWrite(IN2, LOW);
  analogWrite(ENA, 160);
}`,
    quiz: { question: "Vì sao không cấp nguồn động cơ DC trực tiếp từ một chân digital?", choices: ["Vì chân digital chỉ hỗ trợ màu xanh", "Vì động cơ thường đòi hỏi dòng vượt mức chịu đựng của chân", "Vì ADC làm động cơ đảo chiều", "Vì bo Uno không có chân GND"], answer: 1, explanation: "Cần driver công suất để bảo vệ bo và điều khiển động cơ đúng cách." }
  },
  {
    id: 11, slug: "nhiet-do", title: "Đo và cảnh báo nhiệt độ",
    category: "CHƯƠNG 04 · CẢM BIẾN", level: "Cơ bản", minutes: 19,
    description: "Đọc nhiệt độ giả lập và bật cảnh báo nếu vượt ngưỡng.",
    goal: "Đổi điện áp cảm biến LM35 ra °C và so sánh với một ngưỡng.",
    theory: "LM35 xuất điện áp tuyến tính xấp xỉ 10 mV/°C trong phạm vi hoạt động của cảm biến. Với ADC tham chiếu 5 V, điện áp đo = ADC × (5 / 1023), sau đó quy đổi thành °C.",
    insight: "Chọn nhiệt độ trên 30 °C để kích hoạt đèn cảnh báo. Đây là ngưỡng minh họa, không phải tiêu chuẩn an toàn y tế hay công nghiệp.",
    caution: "Hiệu chuẩn và sử dụng đúng thông số cảm biến thật; số đo giả lập không phản ánh nhiệt độ phòng.",
    components: ["LM35", "LED cảnh báo", "Điện trở LED", "Arduino Uno"],
    wiring: [["5V", "Nguồn LM35", "Nguồn"], ["A0", "Ngõ ra LM35", "Đo tín hiệu"], ["GND", "GND LM35", "Mass"], ["D13", "LED cảnh báo", "Đầu ra"]],
    steps: ["Xem nguyên tắc 10 mV tương ứng 1 °C của LM35.", "Điều chỉnh nhiệt độ giả lập từ 0 đến 60 °C.", "Chạy mô phỏng và quan sát trạng thái vượt ngưỡng 30 °C."],
    controls: [slider("temp", "Nhiệt độ", 0, 60, 25, "°C")],
    sketch: `// Bài 11 — LM35 (tham chiếu ADC = 5 V)
const int SENSOR = A0, LED = 13;
void setup() { pinMode(LED, OUTPUT); Serial.begin(9600); }
void loop() {
  int adc = analogRead(SENSOR);
  float tempC = adc * 5.0 / 1023.0 * 100.0;
  digitalWrite(LED, tempC > 30.0 ? HIGH : LOW);
  Serial.println(tempC);
  delay(200);
}`,
    quiz: { question: "Theo đặc tính điển hình của LM35, 250 mV tương ứng xấp xỉ bao nhiêu °C?", choices: ["2,5 °C", "25 °C", "250 °C", "0 °C"], answer: 1, explanation: "LM35 khoảng 10 mV cho mỗi °C; 250 mV tương ứng 25 °C." }
  },
  {
    id: 12, slug: "dong-co-servo", title: "Điều khiển góc servo",
    category: "CHƯƠNG 04 · CHUYỂN ĐỘNG", level: "Cơ bản", minutes: 20,
    description: "Quay trục servo theo góc 0–180° trên mô hình ba chiều.",
    goal: "Hiểu lệnh Servo.write() và giới hạn góc của một servo phổ biến.",
    theory: "Servo thường nhận tín hiệu điều khiển theo dạng xung lặp và tự điều chỉnh vị trí cơ khí đến góc yêu cầu trong phạm vi thiết kế. Không phải mọi servo đều có cùng giới hạn hoặc tải trọng.",
    insight: "Mô phỏng góc quay, không mô phỏng mô-men xoắn, tải hoặc mức tiêu thụ dòng điện.",
    caution: "Servo có thể dùng dòng lớn, nhất là lúc khởi động hoặc bị giữ trục. Cần nguồn phù hợp và GND chung.",
    components: ["Servo SG90 (minh họa)", "Arduino Uno", "Nguồn phù hợp"],
    wiring: [["D9", "Dây tín hiệu servo", "Xung điều khiển"], ["5V (theo thiết kế)", "Nguồn servo", "Nguồn công suất"], ["GND", "GND servo", "Chung mass"]],
    steps: ["Nhận biết chân nguồn, GND và tín hiệu servo.", "Điều chỉnh góc ở thanh trượt.", "Chạy mô phỏng và quan sát trục servo quay."],
    controls: [slider("angle", "Góc servo", 0, 180, 90, "°")],
    sketch: `// Bài 12 — Điều khiển servo
#include <Servo.h>
Servo motor;
void setup() { motor.attach(9); }
void loop() {
  motor.write(90);
  delay(500);
  motor.write(0);
  delay(500);
  motor.write(180);
  delay(500);
}`,
    quiz: { question: "Hàm motor.write(90) trong thư viện Servo thường yêu cầu điều gì?", choices: ["Quay servo đến khoảng 90°", "Tăng điện áp đến 90 V", "Chạy trong 90 giây", "Ngắt GND"], answer: 0, explanation: "Servo.write(90) đặt vị trí góc yêu cầu ở khoảng 90° với servo góc thông dụng." }
  },
  {
    id: 13, slug: "dong-co-buoc", title: "Điều khiển động cơ bước",
    category: "CHƯƠNG 04 · CHUYỂN ĐỘNG", level: "Trung bình", minutes: 23,
    description: "Điều khiển vị trí quay bằng số bước thay vì chỉ tốc độ.",
    goal: "Hiểu số bước trên vòng và driver điều khiển động cơ bước.",
    theory: "Động cơ bước di chuyển theo các bước rời rạc. Với loại 200 bước/vòng, 50 bước tương ứng xấp xỉ 90°. Động cơ thực thường cần driver, giới hạn dòng và nguồn riêng.",
    insight: "Động cơ tham chiếu có 200 bước/vòng. Mã mẫu phát một lần 50 bước khi khởi động, không tự lặp. 90° là độ dịch chuyển tương đối từ vị trí bắt đầu, không phải góc tuyệt đối có phản hồi vị trí.",
    caution: "Không cấp trực tiếp các cuộn dây động cơ bước từ chân digital.",
    components: ["Động cơ bước", "Driver động cơ", "Arduino Uno"],
    wiring: [["D2", "STEP driver", "Xung bước"], ["D3", "DIR driver", "Chiều quay"], ["GND", "GND driver", "Chung mass"], ["Nguồn riêng", "VMOT driver", "Nguồn động cơ"]],
    steps: ["Tìm chân STEP và DIR của driver.", "Chỉnh số bước từ 0 đến 200.", "Chạy mô phỏng và so sánh góc quay với 200 bước/vòng."],
    controls: [slider("steps", "Số bước", 0, 200, 50, "bước")],
    sketch: `// Bài 13 — Quay 50 bước một lần khi khởi động
const int STEP_PIN = 2, DIR_PIN = 3;
void setup() {
  pinMode(STEP_PIN, OUTPUT);
  pinMode(DIR_PIN, OUTPUT);
  digitalWrite(DIR_PIN, HIGH);
  for (int i = 0; i < 50; i++) {
    digitalWrite(STEP_PIN, HIGH); delayMicroseconds(500);
    digitalWrite(STEP_PIN, LOW); delayMicroseconds(500);
  }
}
void loop() { /* Không phát thêm bước */ }`,
    quiz: { question: "Với động cơ 200 bước/vòng (không vi bước), 50 bước tương đương khoảng bao nhiêu độ?", choices: ["45°", "90°", "180°", "360°"], answer: 1, explanation: "50/200 × 360° = 90°." }
  },
  {
    id: 14, slug: "chau-cay-thong-minh", title: "Chậu cây thông minh",
    category: "CHƯƠNG 05 · DỰ ÁN ỨNG DỤNG", level: "Trung bình", minutes: 25,
    description: "Kết hợp cảm biến độ ẩm đất và tín hiệu điều khiển bơm giả lập.",
    goal: "Thiết lập ngưỡng độ ẩm để bật bơm khi đất quá khô.",
    theory: "Hệ thống tự động tưới đọc tín hiệu cảm biến độ ẩm và bật bộ điều khiển bơm khi giá trị nằm dưới ngưỡng. Cảm biến thực cần được hiệu chuẩn cho điều kiện đất, môi trường và điện áp.",
    insight: "Bài mẫu dùng ngưỡng 35%. Nếu độ ẩm dưới 35%, bơm mô phỏng bật. Cần bổ sung thời gian nghỉ và vùng trễ khi triển khai thực tế.",
    caution: "Không nối động cơ bơm trực tiếp vào chân digital; cần driver/relay đúng thông số và cách ly nguồn theo thiết kế.",
    components: ["Cảm biến độ ẩm đất", "Driver/relay bơm", "Bơm nước", "Arduino Uno"],
    wiring: [["A0", "Cảm biến độ ẩm", "Giá trị analog"], ["D8", "Driver bơm", "Điều khiển bật/tắt"], ["GND", "Mass chung", "Tham chiếu tín hiệu"]],
    steps: ["Xác định tín hiệu cảm biến và chân điều khiển bơm.", "Chỉnh độ ẩm giả lập xuống dưới 35%.", "Chạy mô phỏng và theo dõi bơm bật/tắt."],
    controls: [slider("moisture", "Độ ẩm đất", 0, 100, 48, "%")],
    sketch: `// Bài 14 — Chậu cây thông minh (giả định ADC tăng theo độ ẩm)
const int SOIL = A0, PUMP_DRIVER = 8;
void setup() { pinMode(PUMP_DRIVER, OUTPUT); }
void loop() {
  int adc = analogRead(SOIL);
  int moisture = map(adc, 0, 1023, 0, 100);
  bool dry = moisture < 35;
  digitalWrite(PUMP_DRIVER, dry ? HIGH : LOW);
  delay(300);
}`,
    quiz: { question: "Trong bài mẫu, điều kiện nào làm bơm giả lập bật?", choices: ["Độ ẩm > 80%", "Độ ẩm luôn bằng 100%", "Độ ẩm < 35%", "Không phụ thuộc cảm biến"], answer: 2, explanation: "Ngưỡng của bài này là 35%; khi độ ẩm thấp hơn, bơm mô phỏng bật." }
  },
  {
    id: 15, slug: "cam-bien-luc", title: "Cảm biến lực và lực nhấn",
    category: "CHƯƠNG 05 · CẢM BIẾN", level: "Trung bình", minutes: 21,
    description: "Quan sát cách tín hiệu cảm biến FSR thay đổi theo tác động lực.",
    goal: "Phân biệt giá trị ADC với giá trị lực và ý nghĩa của hiệu chuẩn.",
    theory: "FSR là điện trở nhạy lực. Khi lực tác động tăng, điện trở thay đổi và mạch chia áp đưa ra điện áp ADC. Quan hệ lực và tín hiệu thường phi tuyến, nên không tự suy diễn trực tiếp ADC thành đơn vị newton nếu chưa hiệu chuẩn.",
    insight: "Ở đây chỉ sử dụng chỉ số ADC 0–1023 để phân loại nhấn nhẹ hay mạnh, không công bố số đo lực chính xác.",
    caution: "FSR không thay thế thiết bị đo lực được hiệu chuẩn hoặc cảm biến an toàn công nghiệp.",
    components: ["FSR", "Điện trở cố định", "LED", "Arduino Uno"],
    wiring: [["5V", "FSR", "Nguồn chia áp"], ["A0", "Điểm giữa chia áp", "Giá trị ADC"], ["GND", "Điện trở cố định", "Mass"], ["D13", "LED báo mạnh", "Đầu ra"]],
    steps: ["Xem mạch chia áp của FSR.", "Điều chỉnh chỉ số ADC theo lực nhấn giả lập.", "Chạy mô phỏng và thử vượt ngưỡng 650."],
    controls: [slider("force", "Chỉ số FSR", 0, 1023, 300, "ADC")],
    sketch: `// Bài 15 — Quan sát điện áp từ FSR
const int FSR = A0, LED = 13;
void setup() { pinMode(LED, OUTPUT); Serial.begin(9600); }
void loop() {
  int raw = analogRead(FSR);
  digitalWrite(LED, raw > 650 ? HIGH : LOW);
  Serial.println(raw);
  delay(100);
}`,
    quiz: { question: "Vì sao không nên tự đổi trực tiếp giá trị FSR ADC sang lực N chính xác?", choices: ["Vì ADC chỉ có chữ số", "Vì FSR thường phi tuyến và cần hiệu chuẩn", "Vì FSR là cảm biến nhiệt", "Vì A0 không đo điện áp"], answer: 1, explanation: "Quan hệ ADC–lực của FSR không tuyến tính đơn giản và cần hiệu chuẩn theo thiết bị." }
  },
  {
    id: 16, slug: "du-an-tong-hop", title: "Dự án tổng hợp: Góc học tập thông minh",
    category: "CHƯƠNG 05 · THỬ THÁCH CUỐI", level: "Ứng dụng", minutes: 30,
    description: "Kết hợp ánh sáng, nhiệt độ và nút nhấn để đưa ra quyết định tự động.",
    goal: "Đọc nhiều đầu vào, ưu tiên cảnh báo nhiệt độ và tự điều khiển đèn khi trời tối.",
    theory: "Một dự án điều khiển gồm đầu vào, quy tắc quyết định và đầu ra. Trong mạch tham chiếu, LDR nối về 5V và điện trở 10 kΩ nối về GND tạo chia áp, nên ánh sáng yếu cho giá trị A0 thấp. LM35 đọc tại A1, nút D2 dùng INPUT_PULLUP (ấn = LOW), LED được giới hạn dòng và buzzer thụ động có cực tính phù hợp.",
    insight: "Hãy thử từng cảm biến riêng, rồi thay đổi hai tham số cùng lúc để thấy quy tắc ưu tiên. Nút chỉ tạm tắt LED, không tắt cảnh báo nhiệt.",
    caution: "Chỉ là mô phỏng giáo dục. Khi làm mạch thật cần kiểm tra chân LM35 theo đúng datasheet, hạn dòng LED, nguồn phù hợp cho buzzer và GND chung; không dùng làm hệ thống cảnh báo an toàn thực tế.",
    components: ["Arduino Uno R3", "LDR và điện trở chia áp 10 kΩ", "Cảm biến LM35", "Nút nhấn", "LED và điện trở 220 Ω", "Buzzer thụ động"],
    wiring: [
      ["5V", "LDR (một đầu)", "Nguồn nhánh trên chia áp"],
      ["A0", "Đầu còn lại LDR + đầu điện trở 10 kΩ", "Nút chia áp đo ánh sáng"],
      ["GND", "Đầu còn lại điện trở 10 kΩ", "Mass nhánh chia áp"],
      ["5V", "Nguồn LM35 (Vs)", "Cấp nguồn đúng datasheet"],
      ["A1", "Đầu ra LM35 (Vout)", "Đọc nhiệt độ analog"],
      ["GND", "GND LM35", "Mass chung cảm biến"],
      ["D2", "Một chân nút nhấn", "INPUT_PULLUP: mặc định HIGH"],
      ["GND", "Chân đối diện của nút nhấn", "Ấn xuống D2 = LOW"],
      ["D13", "Điện trở 220 Ω → anode LED (+)", "Hạn dòng LED"],
      ["GND", "Cathode LED (−)", "Hoàn thành đường dòng"],
      ["D8", "Cực (+) buzzer thụ động", "Tín hiệu tone (buzzer nhỏ, đúng định mức)"],
      ["GND", "Cực (−) buzzer", "Mass buzzer"]
    ],
    steps: ["Đối chiếu bảng chân: LDR chia áp A0, LM35 A1, nút D2–GND với INPUT_PULLUP, LED D13 qua điện trở, buzzer D8.", "Đặt ánh sáng dưới 400 để kiểm tra LED và tăng nhiệt độ trên 30 °C để xem cảnh báo.", "Nhấn và giữ nút điều khiển để tạm tắt đèn; cảnh báo nhiệt vẫn hoạt động độc lập."],
    controls: [slider("light", "Mức sáng", 0, 1023, 650), slider("temp", "Nhiệt độ", 0, 60, 25, "°C"), button("pressed", "Tạm tắt đèn")],
    sketch: `// Bài 16 — Logic tổng hợp
const int LIGHT = A0, TEMP = A1;
const int BUTTON = 2, LED = 13, BUZZER = 8;
void setup() {
  pinMode(BUTTON, INPUT_PULLUP);
  pinMode(LED, OUTPUT);
}
void loop() {
  bool dark = analogRead(LIGHT) < 400;
  float tempC = analogRead(TEMP) * 5.0 / 1023.0 * 100.0;
  bool overrideOff = digitalRead(BUTTON) == LOW;
  digitalWrite(LED, dark && !overrideOff ? HIGH : LOW);
  if (tempC > 30) tone(BUZZER, 880);
  else noTone(BUZZER);
  delay(100);
}`,
    quiz: { question: "Trong dự án cuối, nút nhấn tạm tắt đèn có làm mất cảnh báo nhiệt độ không?", choices: ["Có, luôn tắt cả hai", "Không, quy tắc nhiệt độ vẫn hoạt động", "Chỉ khi LED RGB được lắp", "Arduino tự khởi động lại"], answer: 1, explanation: "Quy tắc tắt đèn chỉ tác động lên LED; cảnh báo nhiệt độ được tính riêng." }
  }
]);

export const NOTES = Object.freeze([
  ["Đô", 262], ["Rê", 294], ["Mi", 330], ["Fa", 349],
  ["Sol", 392], ["La", 440], ["Si", 494]
]);

export function lessonById(id) {
  return lessons.find(lesson => lesson.id === Number(id)) ?? null;
}

export function defaultControls(lesson) {
  return Object.fromEntries(lesson.controls.map(control => [control.key, control.initial]));
}

export function validateLessons(collection = lessons) {
  if (collection.length !== 16) throw new Error("Phải có chính xác 16 bài học");
  const ids = new Set();
  for (const lesson of collection) {
    if (!Number.isInteger(lesson.id) || ids.has(lesson.id)) throw new Error("ID bài học không hợp lệ");
    ids.add(lesson.id);
    for (const field of ["slug", "title", "category", "description", "goal", "theory", "insight", "caution", "sketch"]) {
      if (typeof lesson[field] !== "string" || !lesson[field].trim()) throw new Error(`Bài ${lesson.id}: thiếu ${field}`);
    }
    if (lesson.wiring.length < 2 || lesson.steps.length < 3 || lesson.quiz.choices.length < 3) throw new Error(`Bài ${lesson.id}: thiếu dữ liệu`);
    if (lesson.quiz.answer < 0 || lesson.quiz.answer >= lesson.quiz.choices.length) throw new Error(`Bài ${lesson.id}: đáp án không hợp lệ`);
    if (lesson.controls.some(c => c.type === "slider" && (c.initial < c.min || c.initial > c.max))) throw new Error(`Bài ${lesson.id}: sai khoảng điều khiển`);
  }
  return true;
}
