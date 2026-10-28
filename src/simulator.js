import { NOTES } from "./lessons.js";

// Pure, deterministic demonstration model, deliberately not an AVR/C++ emulator.
// Every result depends only on the given lesson, controls, clock and toggle state.
const clamp = (value, min, max) => Math.max(min, Math.min(max, Number.isFinite(+value) ? +value : min));
const yes = value => value === true;
const percent = value => Math.round(clamp(value, 0, 255) * 100 / 255);

export function simulate(lessonId, controls = {}, elapsedMs = 0, running = false, memory = {}) {
  const id = Number(lessonId);
  const t = Math.max(0, Number(elapsedMs) || 0);
  const c = controls;
  const output = {
    led: false, brightness: 0, rgb: "#ed6c5c", rgbIntensity: 0,
    angle: 0, motorSpeed: 0, motorDirection: 1,
    toneHz: 0, pump: false, button: yes(c.pressed),
    value: "—", status: "Sẵn sàng", serial: "Chưa chạy mô phỏng",
    pins: [], kind: "board"
  };
  switch (id) {
    case 1: {
      const lit = yes(c.ledEnabled) && running;
      Object.assign(output, { kind: "board", led: lit, brightness: lit ? 1 : 0,
        value: lit ? "LED L: HIGH" : "LED L: LOW",
        status: lit ? "Đèn L đang sáng" : "Đèn L đang tắt",
        serial: `D13 = ${lit ? "HIGH" : "LOW"}`,
        pins: [["D13", lit ? "HIGH" : "LOW"]] });
      break;
    }
    case 2: {
      const interval = clamp(c.interval, 200, 1800);
      const lit = running && (Math.floor(t / interval) % 2 === 0);
      Object.assign(output, { kind: "led", led: lit, brightness: lit ? 1 : 0,
        value: `${interval} ms / nửa nhịp`,
        status: running ? (lit ? "LED đang sáng" : "LED đang tắt") : "Đã dừng",
        serial: `LED D13: ${lit ? "HIGH" : "LOW"} · nhịp ${interval} ms`,
        pins: [["D13", lit ? "HIGH" : "LOW"]] });
      break;
    }
    case 3: {
      const mode = c.buttonMode === "toggle" ? "toggle" : "hold";
      const lit = running && (mode === "hold" ? yes(c.pressed) : yes(memory.toggleLed));
      Object.assign(output, { kind: "button", led: lit, brightness: lit ? 1 : 0,
        button: yes(c.pressed), value: `D2: ${c.pressed ? "HIGH" : "LOW"}`,
        status: mode === "hold" ? "Chế độ giữ nút" : "Chế độ bật/tắt",
        serial: `D2 = ${c.pressed ? "HIGH" : "LOW"} · D13 = ${lit ? "HIGH" : "LOW"} · ${mode}`,
        pins: [["D2", c.pressed ? "HIGH" : "LOW"], ["D13", lit ? "HIGH" : "LOW"]] });
      break;
    }
    case 4: {
      const adc = Math.round(clamp(c.analog, 0, 1023));
      const pwm = Math.round(adc * 255 / 1023);
      Object.assign(output, { kind: "potentiometer", led: running && pwm > 0,
        brightness: running ? pwm / 255 : 0, value: `ADC ${adc} → PWM ${pwm}`,
        status: `Độ sáng ${percent(pwm)}%`, serial: `A0=${adc}, D9 PWM=${running ? pwm : 0}`,
        pins: [["A0", String(adc)], ["D9", String(running ? pwm : 0)]] });
      break;
    }
    case 5: {
      const values = ["red", "green", "blue"].map(key => Math.round(clamp(c[key], 0, 255)));
      const color = "#" + values.map(v => v.toString(16).padStart(2, "0")).join("");
      const intensity = (values[0] + values[1] + values[2]) / 765;
      Object.assign(output, { kind: "rgb", led: running && intensity > 0,
        rgb: color, rgbIntensity: running ? intensity : 0, brightness: running ? intensity : 0,
        value: `RGB(${values.join(", ")})`, status: "Ba kênh PWM", serial: `D9/D10/D11 = ${values.join(" / ")}`,
        pins: [["D9", String(values[0])], ["D10", String(values[1])], ["D11", String(values[2])]] });
      break;
    }
    case 6: {
      const light = Math.round(clamp(c.light, 0, 1023));
      const dark = light < 400;
      Object.assign(output, { kind: "ldr", led: running && dark, brightness: running && dark ? 1 : 0,
        value: `Ánh sáng: ${light} ADC`, status: dark ? "Trời tối → BẬT đèn" : "Đủ sáng → TẮT đèn",
        serial: `A0=${light}; DARK=${dark}; LED=${running && dark ? "ON" : "OFF"}`,
        pins: [["A0", String(light)], ["D13", running && dark ? "HIGH" : "LOW"]] });
      break;
    }
    case 7: {
      const d = Math.round(clamp(c.distance, 2, 400));
      const alert = d < 20;
      const micros = Math.round(d * 2 / 0.0343);
      Object.assign(output, { kind: "ultrasonic", led: running && alert, brightness: running && alert ? 1 : 0,
        value: `${d} cm`, status: alert ? "Vật cản ở gần!" : "Khoảng cách an toàn",
        serial: `Echo ≈ ${micros} µs; distance=${d} cm`,
        pins: [["D7", "TRIG"], ["D8", `${micros} µs`], ["D13", running && alert ? "HIGH" : "LOW"]] });
      break;
    }
    case 8: {
      const hz = Math.round(clamp(c.frequency, 200, 2000));
      const play = running && yes(c.sound);
      Object.assign(output, { kind: "buzzer", toneHz: play ? hz : 0, value: `${hz} Hz`,
        status: play ? "Buzzer đang phát tín hiệu" : "Buzzer im lặng",
        serial: `D8 TONE = ${play ? hz : 0} Hz`, pins: [["D8", play ? `${hz} Hz` : "LOW"]] });
      break;
    }
    case 9: {
      const note = NOTES.find(([label]) => label === c.note);
      const hz = running && note ? note[1] : 0;
      Object.assign(output, { kind: "piano", toneHz: hz,
        value: note ? `${note[0]} · ${note[1]} Hz` : "Chọn một nốt nhạc",
        status: note ? `Nốt ${note[0]}` : "Chưa chọn nốt", serial: `D9 = ${hz} Hz`,
        pins: [["D9", hz ? `${hz} Hz` : "LOW"]] });
      break;
    }
    case 10: {
      const pwm = Math.round(clamp(c.motor, 0, 255));
      const dir = c.direction === "reverse" ? -1 : 1;
      Object.assign(output, { kind: "motor", motorSpeed: running ? pwm / 255 : 0, motorDirection: dir,
        value: `PWM ${pwm} / 255`, status: pwm ? (dir < 0 ? "Đảo chiều" : "Quay thuận") : "Động cơ dừng",
        serial: `ENA=${running ? pwm : 0}; IN1=${dir > 0}; IN2=${dir < 0}`,
        pins: [["D9", String(running ? pwm : 0)], ["D7", dir > 0 ? "HIGH" : "LOW"], ["D8", dir < 0 ? "HIGH" : "LOW"]] });
      break;
    }
    case 11: {
      const temp = clamp(c.temp, 0, 60);
      const adc = Math.round(temp / 100 / 5 * 1023);
      const hot = temp > 30;
      Object.assign(output, { kind: "temperature", led: running && hot, brightness: running && hot ? 1 : 0,
        value: `${temp} °C`, status: hot ? "Nhiệt độ vượt ngưỡng" : "Nhiệt độ bình thường",
        serial: `LM35 ADC≈${adc}; temp=${temp}°C`,
        pins: [["A0", String(adc)], ["D13", running && hot ? "HIGH" : "LOW"]] });
      break;
    }
    case 12: {
      const angle = Math.round(clamp(c.angle, 0, 180));
      Object.assign(output, { kind: "servo", angle: running ? angle : 90,
        value: `${angle}°`, status: "Đặt góc servo",
        serial: `Servo D9.write(${running ? angle : 90})`, pins: [["D9", `${angle}°`]] });
      break;
    }
    case 13: {
      const steps = Math.round(clamp(c.steps, 0, 200));
      const angle = steps * 1.8;
      Object.assign(output, { kind: "stepper", angle: running ? angle : 0,
        value: `${steps} bước · ${angle.toFixed(1)}°`, status: "200 bước / vòng",
        serial: `STEP=${steps}; angle=${angle.toFixed(1)}°`,
        pins: [["D2", `${steps} xung`], ["D3", "HIGH"]] });
      break;
    }
    case 14: {
      const moisture = Math.round(clamp(c.moisture, 0, 100));
      const pump = running && moisture < 35;
      Object.assign(output, { kind: "plant", pump, led: pump, brightness: pump ? .8 : 0,
        value: `Độ ẩm đất: ${moisture}%`, status: pump ? "Đất khô → BẬT bơm" : "Đủ ẩm → TẮT bơm",
        serial: `MOISTURE=${moisture}%; PUMP=${pump ? "ON" : "OFF"}`,
        pins: [["A0", `${moisture}%`], ["D8", pump ? "HIGH" : "LOW"]] });
      break;
    }
    case 15: {
      const raw = Math.round(clamp(c.force, 0, 1023));
      const alert = raw > 650;
      Object.assign(output, { kind: "force", led: running && alert, brightness: running && alert ? 1 : 0,
        value: `FSR: ${raw} ADC`, status: alert ? "Lực nhấn vượt ngưỡng" : "Lực nhấn nhẹ",
        serial: `FSR ADC=${raw}; D13=${running && alert ? "HIGH" : "LOW"}`,
        pins: [["A0", String(raw)], ["D13", running && alert ? "HIGH" : "LOW"]] });
      break;
    }
    case 16: {
      const light = Math.round(clamp(c.light, 0, 1023));
      const temp = clamp(c.temp, 0, 60);
      const lit = running && light < 400 && !yes(c.pressed);
      const hot = temp > 30;
      Object.assign(output, { kind: "project", led: lit, brightness: lit ? 1 : 0, toneHz: running && hot ? 880 : 0,
        button: yes(c.pressed), value: `Sáng ${light} · ${temp} °C`,
        status: hot ? "Cảnh báo nhiệt độ" : (lit ? "Đèn tự bật khi tối" : "Không cần bật đèn"),
        serial: `LIGHT=${light}; TEMP=${temp}°C; LED=${lit}; ALARM=${running && hot}`,
        pins: [["A0", String(light)], ["A1", `${temp}°C`], ["D2", c.pressed ? "LOW" : "HIGH"], ["D13", lit ? "HIGH" : "LOW"]] });
      break;
    }
    default: throw new RangeError("Bài mô phỏng không tồn tại");
  }
  return output;
}

export function advanceToggleState(memory = {}, mode = "hold", now = 0) {
  if (mode !== "toggle") return { ...memory };
  const previous = Number.isFinite(memory.lastPress) ? memory.lastPress : -Infinity;
  if (now - previous < 30) return { ...memory };
  return { ...memory, toggleLed: !memory.toggleLed, lastPress: now };
}
