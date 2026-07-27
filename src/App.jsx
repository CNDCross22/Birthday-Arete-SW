import { useMemo, useState } from 'react'
import { Plus, Search, Send, LogOut, Loader2, WifiOff, Upload, Users, CalendarDays, List, Settings, MoreHorizontal } from 'lucide-react'
import { useBirthdays } from './hooks/useBirthdays'
import { useToast } from './components/Toast'
import { useAccess } from './auth/AccessGate'
import { isDemo, hasFunctions, createBirthday, updateBirthday, removeBirthday, sendTestEmail, importBirthdays } from './lib/api'
import { nextEvent } from './lib/dates'
import BirthdayList from './components/BirthdayList'
import BirthdayForm from './components/BirthdayForm'
import ConfirmDialog from './components/ConfirmDialog'
import ImportModal from './components/ImportModal'
import RecipientsModal from './components/RecipientsModal'
import CalendarView from './components/CalendarView'
import SettingsModal from './components/SettingsModal'
import StatusStrip from './components/StatusStrip'

export default function App() {
  const { rows, loading, error, reload } = useBirthdays()
  const { code, signOut } = useAccess()
  const toast = useToast()

  const [query, setQuery] = useState('')
  const [editing, setEditing] = useState(null) // row or {} for new
  const [deleting, setDeleting] = useState(null)
  const [testing, setTesting] = useState(false)
  const [showImport, setShowImport] = useState(false)
  const [showRecipients, setShowRecipients] = useState(false)
  const [view, setView] = useState('list')
  const [showSettings, setShowSettings] = useState(false)
  const [scope, setScope] = useState('month')
  const [menuOpen, setMenuOpen] = useState(false)

  // Search, then scope. "Upcoming" keeps the list short on big teams.
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    let out = rows
    if (q) {
      out = out.filter((r) =>
        [r.full_name, r.person_email, r.department].filter(Boolean).some((v) => v.toLowerCase().includes(q)),
      )
    }
    // Searching always looks across everyone, so nobody is hidden by the filter.
    if (scope !== 'all' && !q) {
      const max = scope === 'today' ? 0 : scope === 'week' ? 7 : 30
      out = out.filter((r) => { const ev = nextEvent(r); return ev && ev.days <= max })
    }
    return out
  }, [rows, query, scope])

  const counts = useMemo(() => {
    const days = rows
      .filter((r) => r.is_active)
      .map((r) => nextEvent(r))
      .filter(Boolean)
      .map((e) => e.days)
    return {
      today: days.filter((d) => d === 0).length,
      week: days.filter((d) => d <= 7).length,
      month: days.filter((d) => d <= 30).length,
      all: rows.length,
    }
  }, [rows])

  const save = async (payload, wasEditing) => {
    if (wasEditing) await updateBirthday(code, payload)
    else await createBirthday(code, payload)
    await reload()
    toast(wasEditing ? 'Person updated.' : 'Person added.')
  }

  const confirmDelete = async () => {
    await removeBirthday(code, deleting.id)
    setDeleting(null)
    await reload()
    toast('Person removed.')
  }

  const runTest = async () => {
    setTesting(true)
    try {
      const res = await sendTestEmail(code)
      toast(`Test greeting sent to ${res.to}. Check the inbox.`)
    } catch (e) {
      toast(e.message || 'Test failed.', 'error')
    } finally {
      setTesting(false)
    }
  }

  const doImport = async (rows) => {
    const res = await importBirthdays(code, rows)
    await reload()
    setShowImport(false)
    toast(`Imported ${res.imported}${res.skipped ? ` (${res.skipped} already existed)` : ''}.`)
  }

  return (
    <div className={`mx-auto min-h-full px-4 pb-24 pt-6 ${view === 'calendar' ? 'max-w-5xl' : 'max-w-6xl'}`}>
      {/* Header */}
      <header className="mb-5 flex items-center gap-3">
        <img src={`${import.meta.env.BASE_URL}arete-logo.png`} alt="Arete Care" className="h-10 w-10 rounded-lg object-contain" onError={(e) => (e.currentTarget.style.display = 'none')} />
        <div className="flex-1">
          <h1 className="text-xl font-extrabold leading-tight text-ink">Birthdays &amp; Anniversaries</h1>
          <p className="text-sm text-muted">
            A warm greeting to each person on their birthday.
          </p>
        </div>
        {!isDemo && (
          <button onClick={signOut} className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-ink" title="Sign out">
            <LogOut size={18} />
          </button>
        )}
      </header>

      {isDemo && (
        <div className="mb-4 flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          <WifiOff size={16} />
          <span><strong>Demo mode</strong> — saving to this browser only. Add Supabase env vars to go live.</span>
        </div>
      )}

      {/* Toolbar */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative min-w-[180px] flex-1">
          <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search name, email, team…"
            className="w-full rounded-lg border border-slate-300 bg-white py-2.5 pl-9 pr-3 text-sm outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100"
          />
        </div>
        <div className="flex overflow-hidden rounded-lg border border-slate-300 bg-white">
          <button
            onClick={() => setView('list')}
            className={`px-3 py-2.5 ${view === 'list' ? 'bg-brand-600 text-white' : 'text-slate-500 hover:bg-slate-50'}`}
            title="List view"
          >
            <List size={16} />
          </button>
          <button
            onClick={() => setView('calendar')}
            className={`px-3 py-2.5 ${view === 'calendar' ? 'bg-brand-600 text-white' : 'text-slate-500 hover:bg-slate-50'}`}
            title="Calendar view"
          >
            <CalendarDays size={16} />
          </button>
        </div>
        {/* Secondary actions tucked into one menu to keep the bar clean */}
        <div className="relative">
          <button
            onClick={() => setMenuOpen((v) => !v)}
            className="rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-slate-500 hover:bg-slate-50 hover:text-ink"
            title="More actions"
          >
            <MoreHorizontal size={16} />
          </button>
          {menuOpen && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} />
              <div className="absolute right-0 z-20 mt-1 w-52 overflow-hidden rounded-xl border border-slate-200 bg-white py-1 shadow-card">
                <button
                  onClick={() => { setMenuOpen(false); setShowImport(true) }}
                  className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm text-ink hover:bg-slate-50"
                >
                  <Upload size={15} className="text-slate-400" /> Import from CSV/Excel
                </button>
                {!isDemo && hasFunctions && (
                  <>
                    <button
                      onClick={() => { setMenuOpen(false); setShowRecipients(true) }}
                      className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm text-ink hover:bg-slate-50"
                    >
                      <Users size={15} className="text-slate-400" /> Copies (BCC)
                    </button>
                    <button
                      onClick={() => { setMenuOpen(false); runTest() }}
                      disabled={testing}
                      className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm text-ink hover:bg-slate-50 disabled:opacity-60"
                    >
                      {testing ? <Loader2 size={15} className="animate-spin text-slate-400" /> : <Send size={15} className="text-slate-400" />}
                      Preview a greeting
                    </button>
                    <div className="my-1 border-t border-slate-100" />
                    <button
                      onClick={() => { setMenuOpen(false); setShowSettings(true) }}
                      className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm text-ink hover:bg-slate-50"
                    >
                      <Settings size={15} className="text-slate-400" /> Settings
                    </button>
                  </>
                )}
              </div>
            </>
          )}
        </div>
        <button
          onClick={() => setEditing({})}
          className="flex items-center gap-2 rounded-lg bg-brand-600 px-3.5 py-2.5 text-sm font-semibold text-white hover:bg-brand-700"
        >
          <Plus size={16} /> Add
        </button>
      </div>

      {!isDemo && hasFunctions && !loading && !error && (
        <StatusStrip accessCode={code} refreshKey={rows.length} />
      )}

      {/* The stats ARE the filter — reading them and using them is one action */}
      {!loading && !error && view === 'list' && (
        <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            { key: 'today', label: 'Today', n: counts.today, hot: true },
            { key: 'week', label: 'Next 7 days', n: counts.week },
            { key: 'month', label: 'Next 30 days', n: counts.month },
            { key: 'all', label: 'Everyone', n: counts.all },
          ].map((t) => {
            const on = scope === t.key
            const celebrating = t.hot && t.n > 0
            return (
              <button
                key={t.key}
                onClick={() => setScope(t.key)}
                className={`rounded-xl border px-3.5 py-3 text-left transition ${
                  on ? 'border-brand-400 bg-brand-50 ring-1 ring-brand-200'
                     : 'border-slate-200 bg-white hover:border-slate-300'
                }`}
              >
                <div className={`text-xl font-extrabold leading-none ${celebrating ? 'text-accent-600' : 'text-ink'}`}>
                  {celebrating && '🎉 '}{t.n}
                </div>
                <div className="mt-1.5 text-xs font-medium text-muted">{t.label}</div>
              </button>
            )
          })}
        </div>
      )}

      {query && !loading && !error && (
        <p className="mb-2 text-xs text-muted">
          {filtered.length} match{filtered.length === 1 ? '' : 'es'} for “{query}” — searching everyone.
        </p>
      )}

      {/* Body */}
      {loading ? (
        <div className="grid place-items-center py-16"><Loader2 className="animate-spin text-brand-500" size={26} /></div>
      ) : error ? (
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
          Couldn’t load people: {error}
        </div>
      ) : view === 'calendar' ? (
        <CalendarView rows={filtered} />
      ) : (
        <BirthdayList rows={filtered} onEdit={setEditing} onDelete={setDeleting} />
      )}

      {/* Modals */}
      {editing && (
        <BirthdayForm initial={editing.id ? editing : null} onClose={() => setEditing(null)} onSave={save} />
      )}
      {deleting && (
        <ConfirmDialog
          title="Remove person?"
          message={`This removes ${deleting.full_name} from greetings.`}
          confirmLabel="Remove"
          onCancel={() => setDeleting(null)}
          onConfirm={confirmDelete}
        />
      )}
      {showImport && <ImportModal onClose={() => setShowImport(false)} onImport={doImport} />}
      {showRecipients && <RecipientsModal accessCode={code} onClose={() => setShowRecipients(false)} />}
      {showSettings && <SettingsModal accessCode={code} onClose={() => setShowSettings(false)} />}
    </div>
  )
}
