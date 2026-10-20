import { generateKeyBetween } from "fractional-indexing";

// Card order within a column (section 6: rank = fractional string). Keys sort with plain string comparison,
// which is SQLite's default BINARY collation, so ORDER BY rank gives board order.

/**
 * A rank between two neighbours (either may be null at a column's ends). If the neighbours are out of order —
 * someone else moved a card in the meantime — the card goes after `after`, which keeps the move valid.
 */
export function rankBetween(after: string | null, before: string | null): string {
  if (after !== null && before !== null && after >= before) return generateKeyBetween(after, null);
  return generateKeyBetween(after, before);
}
