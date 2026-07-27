import readXlsxFile from 'read-excel-file/browser'

// Parse a CSV or Excel file of people. Columns (headers auto-detected):
//   Full Name, Email, Birthday
// Email + a birthday are required for a row to be greetable.

const NAME_KEYS = ['full name', 'name', 'employee', 'staff', 'person']
const EMAIL_KEYS = ['email', 'e-mail', 'mail']
const BIRTH_KEYS = ['birth', 'dob', 'bday']

const pad = (n) => String(n).padStart(2, '0')
const norm = (h) => String(h ?? '').trim().toLowerCase()
const findCol = (header, keys) => header.findIndex((h) => keys.some((k) => h.includes(k)))

// Normalize any cell to 'YYYY-MM-DD', or null. Ambiguous d/m vs m/d → day-first (AU).
export function toISODate(value) {
  if (value == null || value === '') return null
  if (value instanceof Date && !isNaN(value)) {
    return `${value.getUTCFullYear()}-${pad(value.getUTCMonth() + 1)}-${pad(value.getUTCDate())}`
  }
  const s = String(value).trim()

  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/)
  if (m) return `${m[1]}-${pad(+m[2])}-${pad(+m[3])}`

  m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/)
  if (m) {
    let a = +m[1], b = +m[2], y = +m[3]
    if (y < 100) y += y <= 30 ? 2000 : 1900
    let day, mo
    if (a > 12) { day = a; mo = b } else if (b > 12) { day = b; mo = a } else { day = a; mo = b }
    if (mo >= 1 && mo <= 12 && day >= 1 && day <= 31) return `${y}-${pad(mo)}-${pad(day)}`
  }

  const t = Date.parse(s)
  if (!isNaN(t)) {
    const d = new Date(t)
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  }
  return null
}

function splitCSVLine(line) {
  const out = []
  let cur = '', inQ = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (inQ) {
      if (c === '"') { if (line[i + 1] === '"') { cur += '"'; i++ } else inQ = false }
      else cur += c
    } else if (c === '"') inQ = true
    else if (c === ',') { out.push(cur); cur = '' }
    else cur += c
  }
  out.push(cur)
  return out.map((s) => s.trim())
}

function parseCSV(text) {
  return text.replace(/\r\n?/g, '\n').split('\n').filter((l) => l.trim().length).map(splitCSVLine)
}

// → { valid: [{full_name, person_email, birth_date}], invalid: [{full_name, reason}] }
export async function parseBirthdayFile(file) {
  const lower = file.name.toLowerCase()
  let rows
  if (lower.endsWith('.csv') || file.type === 'text/csv') rows = parseCSV(await file.text())
  else rows = await readXlsxFile(file)
  if (!rows || rows.length === 0) return { valid: [], invalid: [], error: 'The file appears to be empty.' }

  const header = rows[0].map(norm)
  let nameIdx = findCol(header, NAME_KEYS)
  let emailIdx = findCol(header, EMAIL_KEYS)
  let birthIdx = findCol(header, BIRTH_KEYS)
  let dataRows = rows.slice(1)

  // No recognizable header at all → assume positional: name, email, birthday.
  if (nameIdx === -1 && emailIdx === -1 && birthIdx === -1) {
    nameIdx = 0; emailIdx = 1; birthIdx = 2
    dataRows = rows
  }

  const valid = [], invalid = []
  for (const r of dataRows) {
    const full_name = String(r[nameIdx] ?? '').trim()
    const person_email = emailIdx >= 0 ? String(r[emailIdx] ?? '').trim().toLowerCase() : ''
    const birth_date = birthIdx >= 0 ? toISODate(r[birthIdx]) : null

    if (!full_name && !person_email && !birth_date) continue // blank line
    let reason = ''
    if (!full_name) reason = 'no name'
    else if (!person_email || !/.+@.+\..+/.test(person_email)) reason = 'missing/invalid email'
    else if (!birth_date) reason = 'no birthday'
    if (reason) { invalid.push({ full_name: full_name || '(no name)', reason }); continue }
    valid.push({ full_name, person_email, birth_date })
  }
  return { valid, invalid }
}

export const TEMPLATE_CSV =
  'Full Name,Email,Birthday\n' +
  'Maria Santos,maria@aretecare.com.au,1992-03-21\n' +
  'Ben Cruz,ben@aretecare.com.au,05/11/1988\n'

export function downloadTemplate() {
  const blob = new Blob([TEMPLATE_CSV], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'greetings-import-template.csv'
  a.click()
  URL.revokeObjectURL(url)
}
