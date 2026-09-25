// Display helpers for run metrics. Distances are stored in km and paces in
// seconds per km (run_details), matching Strava's metric API.

export function formatPace(secPerKm: number | null | undefined): string {
  if (secPerKm == null || !Number.isFinite(secPerKm) || secPerKm <= 0) return "—";
  const s = Math.round(secPerKm);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}/km`;
}

export function formatSeconds(sec: number | null | undefined): string {
  if (sec == null || !Number.isFinite(sec)) return "—";
  const s = Math.round(sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}`
    : `${m}:${String(r).padStart(2, "0")}`;
}

export function formatKm(km: number | string | null | undefined): string {
  if (km == null || km === "") return "—";
  return `${Math.round(Number(km) * 100) / 100} km`;
}

// Parses "m:ss", "h:mm:ss", or a bare number of minutes into seconds.
export function parseClock(raw: string): number | null {
  const s = raw.trim();
  if (!s) return null;
  if (/^\d+(\.\d+)?$/.test(s)) return Math.round(Number(s) * 60);
  const parts = s.split(":").map(Number);
  if (parts.some((p) => !Number.isFinite(p) || p < 0)) return null;
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return null;
}

// Clock string for a form's defaultValue, the inverse of parseClock.
export function toClock(sec: number | null | undefined): string {
  return sec == null ? "" : formatSeconds(sec);
}

export function numberField(formData: FormData, key: string): number | null {
  const raw = String(formData.get(key) ?? "").trim();
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

export function textField(formData: FormData, key: string): string | null {
  const raw = String(formData.get(key) ?? "").trim();
  return raw || null;
}
