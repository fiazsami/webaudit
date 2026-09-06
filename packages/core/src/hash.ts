/**
 * A deterministic, dependency-free string hash.
 *
 * **Not cryptographic.** Its only job is identity: giving a finding a stable id
 * so the same observation on the same page produces the same id on every run,
 * across both hosts, which is what makes deduplication and diffing possible. Do
 * not use it where collision resistance matters — for that a host supplies real
 * SHA-256 through a port, as the snapshot builder does for inline scripts.
 *
 * FNV-1a, 64-bit, rendered as 16 lowercase hex characters. Chosen because it is
 * ten lines of arithmetic with no crypto API behind it, and core has neither
 * `node:crypto` nor SubtleCrypto (hard rule 1).
 */

const FNV_OFFSET_BASIS = 0xcbf29ce484222325n;
const FNV_PRIME = 0x100000001b3n;
const MASK_64 = 0xffffffffffffffffn;

export function stableHash(input: string): string {
  let hash = FNV_OFFSET_BASIS;

  // Hash UTF-16 code units as two bytes each: no TextEncoder in core, and the
  // mapping is a bijection, so distinct strings still hash distinctly.
  for (let index = 0; index < input.length; index += 1) {
    const unit = input.charCodeAt(index);
    hash = ((hash ^ BigInt(unit & 0xff)) * FNV_PRIME) & MASK_64;
    hash = ((hash ^ BigInt(unit >> 8)) * FNV_PRIME) & MASK_64;
  }

  return hash.toString(16).padStart(16, "0");
}
