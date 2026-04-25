// @ts-nocheck
function parseDate(date) {
  if (date == null) return null
  const d = new Date(date)
  return Number.isNaN(d.getTime()) ? null : d
}

/** Valid ISO string for `<time dateTime={...}>`; omit if unparseable. */
export function toIsoDateTimeAttr(date) {
  const d = parseDate(date)
  return d ? d.toISOString() : undefined
}

export const DateTimeLong = ({ date }) => {
  const d = parseDate(date)
  if (!d) {
    return <>&mdash;</>
  }
  const dateString = d.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })
  return <>{dateString}</>
}
