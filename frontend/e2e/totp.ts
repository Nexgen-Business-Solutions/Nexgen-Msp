import { createHmac } from 'node:crypto';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function decode(secret: string): Buffer {
  let bits = '';

  for (const character of secret.replace(/=+$/, '').toUpperCase()) {
    const index = ALPHABET.indexOf(character);

    if (index < 0) continue;

    bits += index.toString(2).padStart(5, '0');
  }

  const bytes = bits.match(/.{8}/g) ?? [];

  return Buffer.from(bytes.map((byte) => parseInt(byte, 2)));
}

/** The six digits the phone would show, for the secret the fixture handed us. */
export function totp(secret: string, at = Date.now()): string {
  const counter = Buffer.alloc(8);

  counter.writeBigUInt64BE(BigInt(Math.floor(at / 1000 / 30)));

  const digest = createHmac('sha1', decode(secret)).update(counter).digest();
  const offset = digest[digest.length - 1] & 0xf;
  const code =
    ((digest[offset] & 0x7f) << 24) |
    ((digest[offset + 1] & 0xff) << 16) |
    ((digest[offset + 2] & 0xff) << 8) |
    (digest[offset + 3] & 0xff);

  return String(code % 1_000_000).padStart(6, '0');
}
