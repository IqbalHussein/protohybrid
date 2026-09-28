/**
 * Form-field readers shared by every server action.
 *
 * Server actions receive FormData, where everything is a string and a missing
 * field is indistinguishable from a blank one. These collapse both to null so
 * an action can tell "not given" from "given as zero".
 */

/** Blank and unparseable both mean null, so a stray keystroke never writes NaN. */
export function optionalNumber(formData: FormData, key: string): number | null {
  const raw = String(formData.get(key) ?? "").trim();
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

export function optionalString(formData: FormData, key: string): string | null {
  return String(formData.get(key) ?? "").trim() || null;
}

export function requiredString(formData: FormData, key: string): string {
  const value = String(formData.get(key) ?? "").trim();
  if (!value) throw new Error(`Missing ${key}`);
  return value;
}
