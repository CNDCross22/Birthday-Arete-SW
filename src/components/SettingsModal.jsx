import { useEffect, useState } from 'react'
import { X, Loader2, Clock, Play, RotateCcw, Save } from 'lucide-react'
import { getSettings, setSendTime, runGreetingsNow, resetGreetingLog } from '../lib/api'
import { useToast } from './Toast'

const pad = (n) => String(n).padStart(2, '0')
const timeLabel = (h, m = 0) => {
  const ampm = h < 12 ? 'AM' : 'PM'
  const hr = h % 12 === 0 ? 12 : h % 12
  return `${hr}:${pad(m)} ${ampm}`
}
const asInput = (cfg) => `${pad(cfg?.send_hour ?? 7)}:${pad(cfg?.send_minute ?? 0)}`

// Send-time configuration + testing tools, so nobody has to touch SQL.
export default function SettingsModal({ accessCode, onClose }) {
  const [cfg, setCfg] = useState(null)
  const [time, setTime] = useState('07:00')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [running, setRunning] = useState(false)
  const [resetting, setResetting] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState('')
  const toast = useToast()

  useEffect(() => {
    getSettings(accessCode)
      .then((d) => { setCfg(d); setTime(asInput(d)) })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const save = async () => {
    const [hStr, mStr] = String(time).split(':')
    const h = Number(hStr), mi = Number(mStr)
    if (!Number.isInteger(h) || !Number.isInteger(mi)) { setError('Please pick a valid time.'); return }
    setSaving(true); setError(''); setResult('')
    try {
      const d = await setSendTime(accessCode, h, mi)
      setCfg(d)
      setTime(asInput(d))
      toast(`Greetings will now send at ${timeLabel(d.send_hour, d.send_minute)}.`)
    } catch (e) { setError(e.message) } finally { setSaving(false) }
  }

  const runNow = async () => {
    setRunning(true); setError(''); setResult('')
    try {
      const r = await runGreetingsNow(accessCode)
      if (r.sent) {
        setResult(`✅ Sent — ${r.birthdays} birthday greeting${r.birthdays === 1 ? '' : 's'}.`)
        toast('Greetings sent.')
      } else {
        const extra = r.skipped?.length ? ` · skipped: ${r.skipped.join(', ')}` : ''
        setResult(`Nothing sent — ${r.reason || 'nobody is celebrating today'}${extra}`)
      }
    } catch (e) { setError(e.message) } finally { setRunning(false) }
  }

  const reset = async () => {
    setResetting(true); setError(''); setResult('')
    try {
      await resetGreetingLog(accessCode)
      setResult("History cleared — today's greetings can be sent again.")
      toast('Greeting history cleared.')
    } catch (e) { setError(e.message) } finally { setResetting(false) }
  }

  const unchanged = cfg && time === asInput(cfg)
  const city = cfg?.tz_city || 'Melbourne'

  return (
    <div className="fixed inset-0 z-40 grid place-items-center bg-ink/40 p-4 animate-fade-in" onMouseDown={onClose}>
      <div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-2xl bg-white p-6 shadow-card animate-scale-in" onMouseDown={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-bold text-ink">Settings</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><X size={18} /></button>
        </div>

        {loading ? (
          <div className="grid place-items-center py-10"><Loader2 className="animate-spin text-brand-500" size={22} /></div>
        ) : (
          <>
            {/* Send time */}
            <div className="rounded-xl border border-slate-200 p-4">
              <div className="mb-2 flex items-center gap-2">
                <Clock size={16} className="text-brand-600" />
                <h3 className="text-sm font-semibold text-ink">
                  Daily send time <span className="font-normal text-muted">({city} time)</span>
                </h3>
              </div>
              <p className="mb-3 text-xs text-muted">
                Enter the time as it reads on a <strong>{city}</strong> clock — set 7:00 AM and greetings go out
                at 7:00 AM in {city}, all year (daylight saving is handled for you).
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="time"
                  value={time}
                  onChange={(e) => setTime(e.target.value)}
                  className="w-32 rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100"
                />
                <span className="shrink-0 rounded-md bg-brand-50 px-2 py-1.5 text-xs font-semibold text-brand-700">
                  {city}{cfg?.tz_label ? ` · ${cfg.tz_label}` : ''}
                </span>
                <button
                  onClick={save}
                  disabled={saving || unchanged}
                  className="ml-auto flex items-center gap-1.5 rounded-lg bg-brand-600 px-3 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50"
                >
                  {saving ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />} Save
                </button>
              </div>
            </div>

            {/* Testing */}
            <div className="mt-4 rounded-xl border border-accent-200 bg-accent-50/40 p-4">
              <h3 className="mb-1 text-sm font-semibold text-ink">Testing</h3>
              <p className="mb-3 text-xs text-muted">Send right now, without waiting for the scheduled time.</p>
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={runNow}
                  disabled={running}
                  className="flex items-center gap-1.5 rounded-lg bg-accent-600 px-3 py-2 text-sm font-semibold text-white hover:bg-accent-700 disabled:opacity-60"
                >
                  {running ? <Loader2 size={15} className="animate-spin" /> : <Play size={15} />} Run greetings now
                </button>
                <button
                  onClick={reset}
                  disabled={resetting}
                  className="flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-ink hover:bg-slate-50 disabled:opacity-60"
                >
                  {resetting ? <Loader2 size={15} className="animate-spin" /> : <RotateCcw size={15} />} Reset history
                </button>
              </div>
              <p className="mt-3 text-[11px] leading-relaxed text-slate-400">
                <strong>Run now</strong> greets anyone whose birthday is today.
                Each person is greeted only once per year — use <strong>Reset history</strong> to allow a repeat while testing.
              </p>
            </div>

            {result && <p className="mt-3 rounded-lg border border-brand-200 bg-brand-50 p-2.5 text-xs text-ink">{result}</p>}
            {error && <p className="mt-3 rounded-lg border border-rose-200 bg-rose-50 p-2.5 text-xs text-rose-700">{error}</p>}
          </>
        )}
      </div>
    </div>
  )
}
