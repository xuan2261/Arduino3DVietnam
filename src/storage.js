const STORAGE_KEY = "arduino-3d-viet-progress-v1";
export function normalizeProgress(data) {
  if (!data || typeof data !== "object" || data.schemaVersion !== 1 || !Array.isArray(data.completed)) {
    throw new TypeError("Định dạng tiến độ không hợp lệ");
  }
  if (data.completed.length > 16 || data.completed.some(x => !Number.isInteger(x) || x < 1 || x > 16)) {
    throw new RangeError("Danh sách bài hoàn thành không hợp lệ");
  }
  return { schemaVersion: 1, completed: [...new Set(data.completed)].sort((a,b)=>a-b) };
}
export function readProgress() {
  try {
    const json = localStorage.getItem(STORAGE_KEY);
    return json ? normalizeProgress(JSON.parse(json)) : { schemaVersion: 1, completed: [] };
  } catch {
    return { schemaVersion: 1, completed: [] };
  }
}
export function saveProgress(data) {
  const clean = normalizeProgress(data);
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(clean)); return true; }
  catch { return false; }
}
export function exportProgress(data) {
  const clean = normalizeProgress(data);
  return JSON.stringify({ ...clean, exportedAt: new Date().toISOString(), app: "Arduino 3D Việt Nam" }, null, 2);
}
