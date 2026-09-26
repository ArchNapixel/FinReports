/**
 * Money is handled as integer centavos everywhere in domain logic so sums
 * never drift. Convert at the edges (DB numeric ↔ centavos, display).
 */
export type Centavos = number;

export function toCentavos(value: number | string | null | undefined): Centavos {
  if (value === null || value === undefined || value === "") return 0;
  const n = typeof value === "string" ? Number(value.replace(/[₱,\s]/g, "")) : value;
  if (!Number.isFinite(n)) throw new Error(`Invalid amount: ${value}`);
  return Math.round(n * 100);
}

export function fromCentavos(c: Centavos): number {
  return Math.round(c) / 100;
}

/** Fixed two-decimal string used in hashes and DB payloads. */
export function centavosToDecimalString(c: Centavos): string {
  const sign = c < 0 ? "-" : "";
  const abs = Math.abs(Math.round(c));
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

const peso = new Intl.NumberFormat("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** UI formatting: ₱1,234.56 (negatives in parentheses, accountant style). */
export function formatPeso(c: Centavos, symbol = "₱"): string {
  const s = `${symbol}${peso.format(Math.abs(c) / 100)}`;
  return c < 0 ? `(${s})` : s;
}

/** PDF formatting: built-in PDF fonts lack the ₱ glyph, so use "PHP". */
export function formatPdf(c: Centavos): string {
  return formatPeso(c, "");
}

/** Round a centavo amount multiplied by a rate, half away from zero. */
export function applyRate(c: Centavos, rate: number): Centavos {
  const v = c * rate;
  return Math.sign(v) * Math.round(Math.abs(v) + 1e-9);
}
