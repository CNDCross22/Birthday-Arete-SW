import { useState } from 'react'
import { X, Upload, Loader2, Download, CheckCircle2 } from 'lucide-react'
import { parseBirthdayFile, downloadTemplate } from '../lib/importFile'
import { formatDayMonth } from '../lib/dates'

// Upload a CSV/Excel of name + birthday → preview → bulk import (parent dedups).
export default function ImportModal({ onClose, onImport }) {
  const [parsed, setParsed] = useState(null)
  const [parsing, setParsing] = useState(false)
  const [importing, setImporting] = useState(false)
  const [error, setError] = useState('')
  const [fileName, setFileName] = useState('')

  const onFile = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    setFileName(file.name)
    setError('')
    setParsed(null)
    setParsing(true)
    try {
      const res = await parseBirthdayFile(file)
      if (res.error) setError(res.error)
      else setParsed(res)
    } catch {
      setError("Couldn't read that file. Use a .csv or .xlsx with a name column and a date column.")
    } finally {
      setParsing(false)
    }
  }

  const doImport = async () => {
    if (!parsed?.valid?.length) return
    setImporting(true)
    setError('')
    try {
      await onImport(parsed.valid) // parent reloads, toasts, and closes
    } catch (err) {
      setError(err.message || 'Import failed.')
      setImporting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-40 grid place-items-center bg-ink/40 p-4 animate-fade-in" onMouseDown={onClose}>
      <div className="w-full max-w-lg animate-scale-in rounded-2xl bg-white p-6 shadow-card" onMouseDown={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-bold text-ink">Import birthdays</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><X size={18} /></button>
        </div>

        <p className="mb-3 text-sm text-muted">
          Upload a <strong>.csv</strong> or <strong>.xlsx</strong> with columns: <strong>Name, Email, Birthday</strong> (all three needed).
          <button onClick={downloadTemplate} className="ml-1 inline-flex items-center gap-1 font-semibold text-brand-600 hover:underline">
            <Download size={13} /> get template
          </button>
        </p>

        <label className="flex cursor-pointer flex-col items-center gap-2 rounded-xl border-2 border-dashed border-slate-300 bg-slate-50 p-6 text-center hover:border-brand-400 hover:bg-brand-50">
          <Upload size={22} className="text-brand-500" />
          <span className="text-sm font-medium text-ink">{fileName || 'Choose a CSV or Excel file'}</span>
          <span className="text-xs text-muted">click to browse</span>
          <input type="file" accept=".csv,.xlsx,.xls" className="hidden" onChange={onFile} />
        </label>

        {parsing && (
          <div className="mt-4 flex items-center gap-2 text-sm text-muted"><Loader2 size={16} className="animate-spin" /> Reading file…</div>
        )}

        {parsed && (
          <div className="mt-4 space-y-3">
            <div className="flex items-center gap-2 rounded-lg border border-brand-200 bg-brand-50 p-3 text-sm text-ink">
              <CheckCircle2 size={16} className="text-brand-600" />
              <span><strong>{parsed.valid.length}</strong> ready to import{parsed.invalid.length ? `, ${parsed.invalid.length} skipped` : ''}</span>
            </div>
            {parsed.valid.length > 0 && (
              <div className="max-h-40 overflow-y-auto rounded-lg border border-slate-200 text-sm">
                {parsed.valid.slice(0, 50).map((r, i) => (
                  <div key={i} className="flex items-center justify-between gap-2 border-b border-slate-100 px-3 py-1.5 last:border-0">
                    <span className="min-w-0 truncate text-ink">{r.full_name} <span className="text-slate-400">· {r.person_email}</span></span>
                    <span className="shrink-0 text-xs text-muted">
                      {r.birth_date ? `🎂 ${formatDayMonth(r.birth_date)}` : ''}
                    </span>
                  </div>
                ))}
                {parsed.valid.length > 50 && <div className="px-3 py-1.5 text-xs text-muted">+ {parsed.valid.length - 50} more…</div>}
              </div>
            )}
            {parsed.invalid.length > 0 && (
              <details className="text-xs text-muted">
                <summary className="cursor-pointer">Skipped rows ({parsed.invalid.length})</summary>
                <div className="mt-1 max-h-24 overflow-y-auto">
                  {parsed.invalid.slice(0, 30).map((r, i) => (<div key={i}>{r.full_name} — {r.reason}</div>))}
                </div>
              </details>
            )}
          </div>
        )}

        {error && <p className="mt-3 rounded-lg border border-rose-200 bg-rose-50 p-2 text-xs text-rose-700">{error}</p>}

        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-lg px-4 py-2 text-sm font-medium text-muted hover:bg-slate-100">Cancel</button>
          <button
            onClick={doImport}
            disabled={importing || !parsed?.valid?.length}
            className="flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60"
          >
            {importing && <Loader2 size={15} className="animate-spin" />}
            Import{parsed?.valid?.length ? ` ${parsed.valid.length}` : ''}
          </button>
        </div>
      </div>
    </div>
  )
}
