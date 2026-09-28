/**
 * BASE58, THE TWENTY LINES INSTEAD OF A DEPENDENCY.
 *
 * The page wallet needs exactly one thing from base58: turn a 64-byte
 * signature into the string every Solana surface calls a signature.
 * @solana/web3.js keeps its own encoder private, and `bs58` would be a new
 * package inside the content script, which is the one bundle this repo has
 * already spent a surgery shrinking (2.2MB to 284K per page). So it lives
 * here, small and tested, rather than costing a dependency for one call.
 */
const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'

export function base58Encode(bytes: Uint8Array): string {
  if (bytes.length === 0) return ''
  /* Leading zero bytes are not a number, they are positions, and base58
     spells each of them as the first character of the alphabet. Dropping
     them would silently shorten a signature that happens to start with
     one. */
  let zeros = 0
  while (zeros < bytes.length && bytes[zeros] === 0) zeros++

  /* Repeated division in base 256, collecting base-58 digits. The buffer
     is sized by the known ratio log(256)/log(58), rounded up. */
  const size = Math.floor(((bytes.length - zeros) * 138) / 100) + 1
  const out = new Uint8Array(size)
  let length = 0
  for (let i = zeros; i < bytes.length; i++) {
    let carry = bytes[i]!
    let j = 0
    for (let k = size - 1; (carry !== 0 || j < length) && k >= 0; k--, j++) {
      carry += 256 * out[k]!
      out[k] = carry % 58
      carry = (carry / 58) | 0
    }
    length = j
  }

  let s = '1'.repeat(zeros)
  for (let i = size - length; i < size; i++) s += ALPHABET[out[i]!]
  return s
}
