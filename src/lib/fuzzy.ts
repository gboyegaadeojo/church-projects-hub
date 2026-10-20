/** Fuzzy match: the letters of the query appear in order in the text, ignoring case (section 11.5, 11.11). */
export function fuzzyMatch(text: string, query: string): boolean {
  const n = text.toLowerCase();
  let i = 0;
  for (const ch of query.toLowerCase()) {
    if (ch === " ") continue;
    i = n.indexOf(ch, i);
    if (i < 0) return false;
    i += 1;
  }
  return true;
}
