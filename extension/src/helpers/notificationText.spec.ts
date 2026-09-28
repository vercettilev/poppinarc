import { describe, expect, it } from "vitest"
import {
  NOTIFICATION_GLYPHS,
  notificationKind,
  notificationVerb,
} from "./notificationText"

/**
 * The vocabulary is MEASURED, not designed: apps/rabbit/src/app.service.ts is
 * the only writer of the notifications table, and these specs pin its actual
 * insert set. Two field-invisible bugs lived in the gap this closes — the
 * chip whitelisted `upvote_cast` (a flywheel EVENT type, never a
 * notification) and so dropped every real like; and `upvote_reply` had no
 * verb, so a liked reply read "took an action" on the panel and the card.
 */

describe("notificationKind", () => {
  it("knows every type the writer actually inserts", () => {
    expect(notificationKind("follow")).toBe("follow")
    expect(notificationKind("comment")).toBe("comment")
    expect(notificationKind("reply")).toBe("reply")
    expect(notificationKind("mention")).toBe("mention")
    expect(notificationKind("share")).toBe("share")
    expect(notificationKind("upvote_post")).toBe("like")
    expect(notificationKind("upvote_comment")).toBe("like")
    expect(notificationKind("upvote_reply")).toBe("like")
  })

  it("collapses every upvote era to one 'like', legacy rows included", () => {
    for (const t of ["upvote", "upvote_ditto"]) {
      expect(notificationKind(t)).toBe("like")
    }
  })

  it("refuses upvote_cast — a flywheel event type, not a notification", () => {
    // The chip's private map whitelisted this once and dropped every real
    // like while never matching a single row. The name must stay refused so
    // the mistake cannot come back looking plausible.
    expect(notificationKind("upvote_cast")).toBeNull()
  })

  it("refuses retired products and the unknown", () => {
    for (const t of [
      "arc_claim_available",
      "arc_resolution_needed",
      "stream_created",
      "group_chat_invitation",
      "post_deleted_by_admin", // authorless: surfaces handle it separately
      "",
      null,
      undefined,
    ]) {
      expect(notificationKind(t as string | null | undefined)).toBeNull()
    }
  })

  it("wears a glyph for every kind it can answer", () => {
    for (const t of [
      "follow",
      "comment",
      "reply",
      "mention",
      "share",
      "upvote_post",
    ]) {
      const kind = notificationKind(t)!
      expect(NOTIFICATION_GLYPHS[kind]).toContain("<svg")
    }
  })
})

describe("notificationVerb", () => {
  it("gives a liked reply real words", () => {
    expect(notificationVerb("upvote_reply")).toBe("liked your reply")
    expect(notificationVerb("upvote_reply", "announcement")).toBe(
      "liked your announcement reply",
    )
  })
})
