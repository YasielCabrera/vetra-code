/**
 * Fractional index keys: strings that sort with plain comparison, where a key can always be
 * generated between any two others, so moving an item rewrites only that item.
 *
 * The scheme is rocicorp/fractional-indexing (CC0): a variable-length integer part whose first
 * character encodes its length, then a base-62 fraction. Appending increments the integer, so
 * keys grow logarithmically with repeated appends instead of linearly.
 */

const DIGITS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const ZERO = DIGITS[0]!;
const LAST = DIGITS.at(-1)!;
const SMALLEST_INTEGER = `A${ZERO.repeat(26)}`;

function integerLength(head: string): number | null {
  if (head >= "a" && head <= "z") return head.charCodeAt(0) - "a".charCodeAt(0) + 2;
  if (head >= "A" && head <= "Z") return "Z".charCodeAt(0) - head.charCodeAt(0) + 2;
  return null;
}

function splitKey(key: string): { readonly integer: string; readonly fraction: string } | null {
  const length = integerLength(key.charAt(0));
  if (length === null || length > key.length) return null;
  return { integer: key.slice(0, length), fraction: key.slice(length) };
}

/** True when `key` is a well-formed key that other keys can be generated around. */
export function isFractionalIndexKey(key: string): boolean {
  const parts = splitKey(key);
  if (parts === null || key === SMALLEST_INTEGER) return false;
  for (const char of key.slice(1)) {
    if (!DIGITS.includes(char)) return false;
  }
  return !parts.fraction.endsWith(ZERO);
}

function midpoint(a: string, b: string | null): string {
  if (b !== null) {
    let n = 0;
    while ((a.charAt(n) || ZERO) === b.charAt(n)) n += 1;
    if (n > 0) return b.slice(0, n) + midpoint(a.slice(n), b.slice(n));
  }
  const digitA = a ? DIGITS.indexOf(a.charAt(0)) : 0;
  const digitB = b !== null ? DIGITS.indexOf(b.charAt(0)) : DIGITS.length;
  if (digitB - digitA > 1) return DIGITS.charAt(Math.round((digitA + digitB) / 2));
  if (b !== null && b.length > 1) return b.slice(0, 1);
  return DIGITS.charAt(digitA) + midpoint(a.slice(1), null);
}

function incrementInteger(integer: string): string | null {
  const head = integer.charAt(0);
  const digits = integer.slice(1).split("");
  for (let index = digits.length - 1; index >= 0; index -= 1) {
    const next = DIGITS.indexOf(digits[index]!) + 1;
    if (next < DIGITS.length) {
      digits[index] = DIGITS.charAt(next);
      return head + digits.join("");
    }
    digits[index] = ZERO;
  }
  if (head === "Z") return `a${ZERO}`;
  if (head === "z") return null;
  const nextHead = String.fromCharCode(head.charCodeAt(0) + 1);
  if (nextHead > "a") digits.push(ZERO);
  else digits.pop();
  return nextHead + digits.join("");
}

function decrementInteger(integer: string): string | null {
  const head = integer.charAt(0);
  const digits = integer.slice(1).split("");
  for (let index = digits.length - 1; index >= 0; index -= 1) {
    const previous = DIGITS.indexOf(digits[index]!) - 1;
    if (previous >= 0) {
      digits[index] = DIGITS.charAt(previous);
      return head + digits.join("");
    }
    digits[index] = LAST;
  }
  if (head === "a") return `Z${LAST}`;
  if (head === "A") return null;
  const previousHead = String.fromCharCode(head.charCodeAt(0) - 1);
  if (previousHead < "Z") digits.push(LAST);
  else digits.pop();
  return previousHead + digits.join("");
}

/**
 * A key that sorts strictly between `before` and `after`; null means the open end.
 * Throws when a bound is malformed or `before >= after`; check client-supplied keys with
 * `isFractionalIndexKey` first.
 */
export function keyBetween(before: string | null, after: string | null): string {
  if (before !== null && !isFractionalIndexKey(before)) {
    throw new Error(`Invalid fractional index key: ${before}`);
  }
  if (after !== null && !isFractionalIndexKey(after)) {
    throw new Error(`Invalid fractional index key: ${after}`);
  }
  if (before !== null && after !== null && before >= after) {
    throw new Error(`Fractional index keys out of order: ${before} >= ${after}`);
  }
  if (before === null) {
    if (after === null) return `a${ZERO}`;
    const { integer, fraction } = splitKey(after)!;
    if (integer === SMALLEST_INTEGER) return integer + midpoint("", fraction);
    if (integer < after) return integer;
    const previous = decrementInteger(integer);
    if (previous === null) throw new Error("Fractional index keys exhausted");
    return previous === SMALLEST_INTEGER ? previous + midpoint("", null) : previous;
  }
  const { integer, fraction } = splitKey(before)!;
  if (after === null) {
    return incrementInteger(integer) ?? integer + midpoint(fraction, null);
  }
  const afterParts = splitKey(after)!;
  if (integer === afterParts.integer) return integer + midpoint(fraction, afterParts.fraction);
  const next = incrementInteger(integer);
  if (next !== null && next < after) return next;
  return integer + midpoint(fraction, null);
}
