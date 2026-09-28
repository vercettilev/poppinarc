import { differenceInDays, format, formatDistanceToNow } from "date-fns"
import dayjs from "dayjs"
import relativeTime from "dayjs/plugin/relativeTime"
dayjs.extend(relativeTime)

export const getRelativeTime = (date: string | Date) => {
  return dayjs(date).fromNow()
}

export const formatDistanceToNowWithDate = (date: string | Date) => {
  const now = new Date()
  const diffInDays = differenceInDays(now, new Date(date))
  if (diffInDays > 0) {
    return format(new Date(date), "MMM d, yyyy")
  }
  return formatDistanceToNow(new Date(date))
}

/**
 * "now", "3m", "2h", "5d" — the feed's clock, matching the trade card.
 *
 * `formatDistanceToNowWithDate` produces "about 2 hours", which is prose:
 * the "about" adds nothing a reader can use and the phrase is scanned, not
 * read. Two surfaces printing the same timestamp two different ways is the
 * split this closes.
 */
export const compactAge = (value: string | Date | undefined | null): string => {
  if (!value) return ""
  const ms = Date.now() - new Date(value).getTime()
  if (!Number.isFinite(ms) || ms < 0) return ""
  const m = Math.floor(ms / 60_000)
  if (m < 1) return "now"
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h`
  return `${Math.floor(h / 24)}d`
}
