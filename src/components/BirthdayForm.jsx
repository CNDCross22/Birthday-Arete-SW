import { useEffect, useState } from 'react'
import { X, Loader2 } from 'lucide-react'

// Most staff are Support Workers, so prefill it — still fully editable per person.
const empty = { full_name: '', person_email: '', birth_date: '', department: 'Support Worker', is_active: true }

// Add / edit a person. `initial` (a row) switches it into edit mode.
export default function BirthdayForm({ initial, onClose, onSave }) {
  const [form, setForm] = useState(empty)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const editing = Boolean(initial?.id)

  useEffect(() => {
    setForm(initial ? { ...empty, ...initial } : empty)
  }, [initial])

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))

  const submit = async (e) => {
    e.preventDefault()
    if (!form.full_name.trim() || !form.person_email.trim()) {
      setError('Name and email are required.')
      return
    }
    if (!form.birth_date) {
      setError('A birthday is required.')
      return
    }
    setSaving(true)
    setError('')
    try {
      const payload = {
        full_name: form.full_name.trim(),
        person_email: form.person_email.trim(),
        birth_date: form.birth_date || null,
        department: form.department.trim() || null,
        is_active: form.is_active,
      }
      if (editing) payload.id = initial.id
      await onSave(payload, editing)
      onClose()
    } catch (err) {
      setError(err.message || 'Could not save.')
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-40 grid place-items-center bg-ink/40 p-4 animate-fade-in" onMouseDown={onClose}>
      <div
        className="w-full max-w-md animate-scale-in rounded-2xl bg-white p-6 shadow-card"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-bold text-ink">{editing ? 'Edit person' : 'Add person'}</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><X size={18} /></button>
        </div>

        <form onSubmit={submit} className="space-y-3">
          <Field label="Full name *">
            <input value={form.full_name} onChange={set('full_name')} placeholder="e.g. Maria Santos" className={inputCls} />
          </Field>

          <Field label="Email *" hint="The greeting is sent here — to this person.">
            <input type="email" value={form.person_email} onChange={set('person_email')} placeholder="maria@aretecare.com.au" className={inputCls} />
          </Field>

          <Field label="Birthday *" hint="The 🎂 greeting is sent on this day.">
            <input type="date" value={form.birth_date} onChange={set('birth_date')} className={inputCls} />
          </Field>

          <Field label="Department" hint="Optional.">
            <input value={form.department} onChange={set('department')} placeholder="e.g. Care team" className={inputCls} />
          </Field>

          <label className="flex items-center gap-2 text-sm text-ink">
            <input
              type="checkbox"
              checked={form.is_active}
              onChange={(e) => setForm((f) => ({ ...f, is_active: e.target.checked }))}
              className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-400"
            />
            Active (include in greetings)
          </label>

          {error && <p className="rounded-lg border border-rose-200 bg-rose-50 p-2 text-xs text-rose-700">{error}</p>}

          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={onClose} className="rounded-lg px-4 py-2 text-sm font-medium text-muted hover:bg-slate-100">
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60"
            >
              {saving && <Loader2 size={15} className="animate-spin" />}
              {editing ? 'Save changes' : 'Add person'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

const inputCls =
  'w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100'

function Field({ label, hint, children }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-slate-400">{hint}</span>}
    </label>
  )
}
