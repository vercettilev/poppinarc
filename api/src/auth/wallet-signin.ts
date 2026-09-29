import { Injectable } from '@nestjs/common';
import { getAddress, isAddress, verifyMessage } from 'viem';
import { createSiweMessage, generateSiweNonce, parseSiweMessage, validateSiweMessage } from 'viem/siwe';

/**
 * SIGN-IN WITH A WALLET (EIP-4361, "Sign-In with Ethereum").
 *
 * The server writes the whole message, not the page: the address has to be
 * checksummed (EIP-55) and the domain has to be this service's own host,
 * and both are easier to get right once, here, than in a page script. The
 * page only asks the wallet to sign the text it is given.
 *
 * A challenge is single-use and short-lived, remembered with the exact text
 * it was issued with, so a signature is only ever accepted for the message
 * this service wrote, for the address it was written for, once. The nonce is
 * letters and digits only, which every wallet accepts.
 *
 * Signatures are checked by recovering the signer, so an ordinary account
 * (MetaMask, Rabby, Rainbow, Coinbase Wallet) works; a smart-contract
 * account would need an on-chain check on its own network and is not
 * offered here.
 */
export const CHALLENGE_MS = 10 * 60 * 1000;
const MAX_PENDING = 10_000;

export class WalletSigninRejected extends Error {}

interface Pending {
  address: string;
  message: string;
  expires: number;
}

@Injectable()
export class WalletSignin {
  private readonly pending = new Map<string, Pending>();

  challenge(p: { address: unknown; chainId: unknown; domain: string; uri: string }, now: number = Date.now()): string {
    if (typeof p.address !== 'string' || !isAddress(p.address, { strict: false })) {
      throw new WalletSigninRejected('That is not a wallet address.');
    }
    const chainId = Number(p.chainId);
    if (!Number.isSafeInteger(chainId) || chainId < 1) throw new WalletSigninRejected('The wallet did not say which network it is on.');
    this.prune(now);
    const address = getAddress(p.address);
    const nonce = generateSiweNonce();
    const message = createSiweMessage({
      address,
      chainId,
      domain: p.domain,
      uri: p.uri,
      version: '1',
      nonce,
      statement: 'Sign in to Poppin. This costs nothing and moves no money.',
      issuedAt: new Date(now),
      expirationTime: new Date(now + CHALLENGE_MS),
    });
    this.pending.set(nonce, { address: address.toLowerCase(), message, expires: now + CHALLENGE_MS });
    return message;
  }

  /** The signer's lowercase address, once; anything else throws a sentence the page can show. */
  async verify(p: { message: unknown; signature: unknown }, now: number = Date.now()): Promise<string> {
    if (typeof p.message !== 'string' || typeof p.signature !== 'string' || !/^0x[0-9a-fA-F]+$/.test(p.signature)) {
      throw new WalletSigninRejected('The signature did not arrive. Try again.');
    }
    const parsed = parseSiweMessage(p.message);
    const nonce = parsed.nonce ?? '';
    const pending = this.pending.get(nonce);
    // Single use, whatever happens next.
    this.pending.delete(nonce);
    if (!pending || pending.message !== p.message || pending.expires <= now) {
      throw new WalletSigninRejected('That sign-in request expired. Try again.');
    }
    if (!validateSiweMessage({ message: parsed, nonce, time: new Date(now) })) {
      throw new WalletSigninRejected('That sign-in request expired. Try again.');
    }
    const address = parsed.address as `0x${string}`;
    const ok = await verifyMessage({ address, message: p.message, signature: p.signature as `0x${string}` }).catch(() => false);
    if (!ok || address.toLowerCase() !== pending.address) {
      throw new WalletSigninRejected('The signature does not match this wallet.');
    }
    return pending.address;
  }

  private prune(now: number): void {
    for (const [k, v] of this.pending) if (v.expires <= now) this.pending.delete(k);
    if (this.pending.size >= MAX_PENDING) {
      // Oldest first: a Map iterates in insertion order.
      const extra = this.pending.size - MAX_PENDING + 1;
      let i = 0;
      for (const k of this.pending.keys()) {
        if (i++ >= extra) break;
        this.pending.delete(k);
      }
    }
  }
}
