/**
 * The compact "session|weekly%" text of the dock and the burger menu.
 *
 * A window the account does not have is left out (#126): verified Ultra
 * accounts have no 5-hour limit, so they show "93%" instead of "--|93%",
 * which looked like missing data. "--" only when neither window is known.
 */
export function formatUsagePair(
  session: number | null | undefined,
  weekly: number | null | undefined
): string {
  if (session == null && weekly == null) return '--'
  if (session == null) return `${Math.round(weekly as number)}%`
  if (weekly == null) return `${Math.round(session)}%`
  return `${Math.round(session)}|${Math.round(weekly)}%`
}
