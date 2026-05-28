// Generates a short, URL-safe, human-friendly invite code.
//
// Why a custom alphabet: we drop ambiguous characters (0/O, 1/I/l) so codes
// are easy to read aloud and type without confusion — important since people
// will share these verbally or copy them by hand. We also use uppercase only
// for the same reason.
//
// Length 8 over a 30-char alphabet = 30^8 ≈ 6.5 × 10^11 possibilities.
// Collisions are astronomically unlikely at hackathon scale, but the DB's
// UNIQUE constraint on invite_code is the real guarantee — this is just to
// make collisions rare enough that we almost never need to retry.

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789' // no 0,O,1,I,l

export function generateInviteCode(length = 8): string {
  // crypto.getRandomValues gives cryptographically-random bytes. We don't
  // strictly need crypto-grade randomness for an invite code, but it's free
  // here and avoids Math.random()'s weak distribution. Works in both the
  // Node and edge runtimes Next uses.
  const bytes = new Uint8Array(length)
  crypto.getRandomValues(bytes)

  let code = ''
  for (let i = 0; i < length; i++) {
    // Map each random byte into the alphabet range via modulo. Slight modulo
    // bias exists (256 % 30 ≠ 0) but is irrelevant for this purpose.
    code += ALPHABET[bytes[i] % ALPHABET.length]
  }
  return code
}