import { useMemo } from 'react'
import { Pencil, Trash2, PartyPopper } from 'lucide-react'
import { formatDayMonth, countdownLabel, nextEvent, nextOccurrence } from '../lib/dates'

// Grid of compact person cards, grouped under month headings so a long list
// stays scannable. Sorted by soonest celebration; reads left-to-right, then down.
export default function BirthdayList({ rows, onEdit, onDelete }) {
  const groups = useMemo(() => {
    const items = rows
      .map((r) => ({ ...r, ev: nextEvent(r) }))
      .filter((r) => r.ev)
      .sort((a, b) => a.ev.days - b.ev.days)

    const out = []
    for (const it of items) {
      const when = nextOccurrence(it.ev.date)
      const key = `${when.getFullYear()}-${when.getMonth()}`
      const label = when.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
      if (!out.length || out[out.length - 1].key !== key) out.push({ key, label, items: [] })
      out[out.length - 1].items.push(it)
    }
    return out
  }, [rows])

  if (groups.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-slate-300 bg-white/60 p-8 text-center">
        <PartyPopper className="mx-auto mb-2 text-brand-300" size={26} />
        <p className="text-sm text-muted">Nothing here. Try a wider range, or add someone.</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {groups.map((g) => (
        <section key={g.key}>
          <h3 className="mb-2 text-xs font-bold uppercase tracking-wider text-slate-400">{g.label}</h3>
          <ul className="grid gap-2.5 md:grid-cols-2 xl:grid-cols-3">
            {g.items.map((r) => {
              const today = r.is_active && r.ev.days === 0
              const soon = r.is_active && r.ev.days <= 7
              return (
                <li
                  key={r.id}
                  className={`group flex items-center gap-2.5 rounded-xl border bg-white px-3 py-2.5 shadow-soft transition hover:border-brand-300 ${
                    today ? 'border-accent-300 bg-accent-50/50' : soon ? 'border-brand-200' : 'border-slate-200'
                  } ${r.is_active ? '' : 'opacity-55'}`}
                >
                  <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg text-base ${
                    today ? 'bg-accent-500' : soon ? 'bg-brand-500' : 'bg-slate-100'
                  }`}>
                    🎂
                  </span>

                  <div className="min-w-0 flex-1 leading-tight">
                    <p className="truncate text-sm font-semibold text-ink">
                      {r.full_name}
                      {!r.is_active && <span className="ml-1.5 text-[10px] font-normal text-muted">(inactive)</span>}
                    </p>
                    <p className="truncate text-xs text-muted">
                      {r.birth_date && <span>🎂 {formatDayMonth(r.birth_date)}</span>}
                    </p>
                  </div>

                  <span className={`shrink-0 whitespace-nowrap text-xs font-semibold ${
                    today ? 'text-accent-700' : soon ? 'text-brand-700' : 'text-slate-400'
                  }`}>
                    {countdownLabel(r.ev.days)}
                  </span>

                  <div className="flex shrink-0 items-center opacity-60 transition group-hover:opacity-100">
                    <button onClick={() => onEdit(r)} className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-brand-600" title="Edit">
                      <Pencil size={14} />
                    </button>
                    <button onClick={() => onDelete(r)} className="rounded p-1 text-slate-400 hover:bg-rose-50 hover:text-rose-600" title="Delete">
                      <Trash2 size={14} />
                    </button>
                  </div>
                </li>
              )
            })}
          </ul>
        </section>
      ))}
    </div>
  )
}
