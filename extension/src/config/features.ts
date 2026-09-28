import { ARC_EDITION } from "./edition"

/**
 * Connecting X (settings button, onboarding step, the identity step's door,
 * and the "Connect Your Twitter" task) is off.
 *
 * Not a code problem, and never was: GET /2/users/me — the one call every
 * surface makes to read back the linked handle — 403s with
 * client-not-enrolled, because the X app's Project has no paid access.
 *
 * WHAT CHANGED, measured 2026-08-26 against docs.x.com itself: the "$200/mo
 * cheapest plan" this comment used to name is gone. X retired subscriptions
 * on 2026-02-06 and moved everyone, legacy Basic included, to PAY-PER-USE:
 * credits bought upfront, no monthly minimum, no contract, a spend cap you
 * set yourself. A user read is $0.010 and an "owned" read $0.001, and this
 * product's whole appetite is ONE users/me per person, once, at the moment
 * they press connect. A thousand people linking X costs somewhere between
 * one and ten dollars, forever.
 *
 * So the wall is no longer the price. What is still missing is only the
 * setup: OAuth 2.0 credentials in X_CLIENT_ID/X_CLIENT_SECRET (backend),
 * https://api.poppin.so/api/v1/auth/x/callback registered on the X app, the
 * app attached to a Project, and a little credit loaded.
 *
 * Flip this back on once that is done — nothing else needs to change; every
 * surface already checks it, and the backend refuses honestly until its own
 * credentials exist (see x-oauth.controller).
 */
export const CONNECT_X_ENABLED = false

/**
 * THE PAGE CARD IS OFF. The floating card on pages the strip does not
 * cover (CoinGecko, a random blog) was the third surface, and on
 * 2026-09-16 it was the one misbehaving: two cards at once, a close that
 * did not close, a chart painted as a blue slab. The strip on X, Reddit
 * and the news adapters, and the side panel, are the product for now;
 * the card comes back when it earns it. Every mount path checks this:
 * the page-load attach, the SPA re-attach, the panel's "open a card for
 * this mint" message (answers card_disabled), and the chip's thin-tail
 * "Trade" key, which goes to the sidebar on that asset instead.
 */
export const PAGE_CARD_ENABLED = false
/**
 * SIGN IN WITH PHANTOM. The server verifies the wallet's signed sentence,
 * the chip signs trades in Phantom on the page, and the panel hands its
 * trades to the page beside it. Standing orders for wallet accounts are
 * the one leg still to come, and they say so.
 *
 * Off in the Arc edition: its money is a Circle wallet on Arc, and a Solana
 * wallet account has nothing there to trade from.
 */
export const PHANTOM_SIGNIN_ENABLED = !ARC_EDITION
