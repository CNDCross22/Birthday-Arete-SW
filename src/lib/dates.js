// Birthday date helpers. All "year-agnostic": we only care about month/day.

export function isLeapYear(y) {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0
}

// Parse 'YYYY-MM-DD' without timezone surprises (Date('YYYY-MM-DD') is UTC).
export function parseISO(iso) {
  const [y, m, d] = String(iso).split('-').map(Number)
  return { y, m, d }
}

// The date this birthday is observed in a given year.
// Feb-29 in a non-leap year is observed on Feb-28 (matches the Edge Function default).
function occurrenceInYear(year, m, d) {
  if (m === 2 && d === 29 && !isLeapYear(year)) return new Date(year, 1, 28)
  return new Date(year, m - 1, d)
}

// Next upcoming occurrence (today counts as 0 days away).
export function nextOccurrence(iso, from = new Date()) {
  const { m, d } = parseISO(iso)
  const today = new Date(from.getFullYear(), from.getMonth(), from.getDate())
  let occ = occurrenceInYear(today.getFullYear(), m, d)
  if (occ < today) occ = occurrenceInYear(today.getFullYear() + 1, m, d)
  return occ
}

export function daysUntilNextBirthday(iso, from = new Date()) {
  const today = new Date(from.getFullYear(), from.getMonth(), from.getDate())
  const occ = nextOccurrence(iso, from)
  return Math.round((occ - today) / 86400000)
}

// "12 August" — month + day, no year.
export function formatDayMonth(iso) {
  const { m, d } = parseISO(iso)
  return new Date(2001, m - 1, d).toLocaleDateString(undefined, { day: 'numeric', month: 'long' })
}

// Turning age on the next birthday, or null if the stored year is a placeholder.
export function turningAge(iso, from = new Date()) {
  const { y } = parseISO(iso)
  if (!y || y <= 1900) return null
  return nextOccurrence(iso, from).getFullYear() - y
}

export function countdownLabel(days) {
  if (days === 0) return 'Today 🎉'
  if (days === 1) return 'Tomorrow'
  return `in ${days} days`
}

// The upcoming birthday for a person, or null if none is recorded.
export function nextEvent(person, from = new Date()) {
  if (!person.birth_date) return null
  return { kind: 'birthday', date: person.birth_date, days: daysUntilNextBirthday(person.birth_date, from) }
}
