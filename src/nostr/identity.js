import { schnorr } from '@noble/curves/secp256k1.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js'

export function passphraseToPrivkey(passphrase) {
  const bytes = sha256(new TextEncoder().encode(passphrase))
  return bytesToHex(bytes)
}

export function privkeyToPubkey(privkeyHex) {
  return bytesToHex(schnorr.getPublicKey(hexToBytes(privkeyHex)))
}

export function randomPassphrase(cryptoApi = globalThis.crypto) {
  const bytes = new Uint8Array(16)
  cryptoApi.getRandomValues(bytes)
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}
