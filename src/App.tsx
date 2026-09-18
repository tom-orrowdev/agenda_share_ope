import { useState, useEffect, useRef, useCallback } from "react"
import { projectId, publicAnonKey } from "../utils/supabase/info"

type Category = "camion" | "secouriste" | "note" | "urgent"

interface Annotation {
  id: string
  category: Category
  text: string
  time: string
}

type AnnotationsMap = Record<string, Annotation[]>

const CATEGORIES: Record<Category, { label: string; color: string; bg: string }> = {
  camion:     { label: "Camion",     color: "#f97316", bg: "rgba(249,115,22,0.15)" },
  secouriste: { label: "Secouriste", color: "#38bdf8", bg: "rgba(56,189,248,0.15)" },
  note:       { label: "Note",       color: "#4ade80", bg: "rgba(74,222,128,0.15)" },
  urgent:     { label: "Urgent",     color: "#f43f5e", bg: "rgba(244,63,94,0.15)"  },
}

const MONTHS_FR = [
  "Janvier","Février","Mars","Avril","Mai","Juin",
  "Juillet","Août","Septembre","Octobre","Novembre","Décembre",
]
const DAYS_SHORT = ["L","M","M","J","V","S","D"]
const DAYS_FULL  = ["Lun","Mar","Mer","Jeu","Ven","Sam","Dim"]

const API = `https://${projectId}.supabase.co/functions/v1/make-server-dfb18bbe`
const AUTH_HEADERS = { Authorization: `Bearer ${publicAnonKey}` }

function daysInMonth(y: number, m: number) { return new Date(y, m + 1, 0).getDate() }
function firstDow(y: number, m: number) { const d = new Date(y, m, 1).getDay(); return d === 0 ? 6 : d - 1 }
function toKey(y: number, m: number, d: number) { return `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}` }
function dominantCat(anns: Annotation[]): Category | null {
  if (!anns.length) return null
  const c = { camion: 0, secouriste: 0, note: 0, urgent: 0 }
  anns.forEach(a => c[a.category]++)
  return Object.entries(c).sort((a, b) => b[1] - a[1])[0][0] as Category
}
function uniqueCats(anns: Annotation[]): Category[] {
  return [...new Set(anns.map(a => a.category))] as Category[]
}

const YEAR = 2026
const POLL_INTERVAL = 5000

type SyncStatus = "idle" | "loading" | "saving" | "error" | "ok"

export default function App() {
  const [annotations, setAnnotations] = useState<AnnotationsMap>({})
  const [selected, setSelected] = useState<string | null>(null)
  const [filter, setFilter] = useState<Category | "all">("all")
  const [view, setView] = useState<"year" | "month">("year")
  const [activeMonth, setActiveMonth] = useState(new Date().getMonth())
  const [newText, setNewText] = useState("")
  const [newTime, setNewTime] = useState("")
  const [newCat, setNewCat] = useState<Category>("camion")
  const [editingId, setEditingId] = useState<string | null>(null)
  const [tooltip, setTooltip] = useState<{ key: string; x: number; y: number } | null>(null)
  const [syncStatus, setSyncStatus] = useState<SyncStatus>("loading")
  const tooltipTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastFetchRef = useRef<string>("")
  const savingRef = useRef(false)

  const fetchAnnotations = useCallback(async (silent = false) => {
    try {
      if (!silent) setSyncStatus("loading")
      const res = await fetch(`${API}/annotations`, { headers: AUTH_HEADERS })
      if (!res.ok) throw new Error()
      const data: AnnotationsMap = await res.json()
      const serialized = JSON.stringify(data)
      if (serialized !== lastFetchRef.current) {
        lastFetchRef.current = serialized
        setAnnotations(data)
      }
      if (!silent) setSyncStatus("ok")
    } catch {
      setSyncStatus("error")
    }
  }, [])

  // Initial load
  useEffect(() => { fetchAnnotations() }, [fetchAnnotations])

  // Polling for shared updates
  useEffect(() => {
    const id = setInterval(() => {
      if (!savingRef.current) fetchAnnotations(true)
    }, POLL_INTERVAL)
    return () => clearInterval(id)
  }, [fetchAnnotations])

  // Leaving the selected day cancels any in-progress edit
  useEffect(() => {
    setEditingId(null)
    setNewText("")
    setNewTime("")
  }, [selected])

  const now = new Date()
  const todayKey = toKey(now.getFullYear(), now.getMonth(), now.getDate())

  const startEdit = (a: Annotation) => {
    setEditingId(a.id)
    setNewCat(a.category)
    setNewText(a.text)
    setNewTime(a.time)
  }

  const cancelEdit = () => {
    setEditingId(null)
    setNewText("")
    setNewTime("")
  }

  const saveAnnotation = async () => {
    if (!newText.trim() || !selected) return
    if (editingId) {
      const id = editingId
      const updates = { category: newCat, text: newText.trim(), time: newTime }
      // Optimistic update
      setAnnotations(p => ({ ...p, [selected]: (p[selected] || []).map(a => (a.id === id ? { ...a, ...updates } : a)) }))
      setEditingId(null)
      setNewText("")
      setNewTime("")
      setSyncStatus("saving")
      savingRef.current = true
      try {
        await fetch(`${API}/annotations/${selected}/${id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json", ...AUTH_HEADERS },
          body: JSON.stringify(updates),
        })
        setSyncStatus("ok")
      } catch {
        setSyncStatus("error")
      } finally {
        savingRef.current = false
      }
      return
    }

    const a: Annotation = { id: Date.now().toString(), category: newCat, text: newText.trim(), time: newTime }
    // Optimistic update
    setAnnotations(p => ({ ...p, [selected]: [...(p[selected] || []), a] }))
    setNewText("")
    setNewTime("")
    setSyncStatus("saving")
    savingRef.current = true
    try {
      await fetch(`${API}/annotations/${selected}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...AUTH_HEADERS },
        body: JSON.stringify(a),
      })
      setSyncStatus("ok")
    } catch {
      setSyncStatus("error")
    } finally {
      savingRef.current = false
    }
  }

  const removeAnnotation = async (date: string, id: string) => {
    if (editingId === id) cancelEdit()
    // Optimistic update
    setAnnotations(p => ({ ...p, [date]: (p[date] || []).filter(a => a.id !== id) }))
    setSyncStatus("saving")
    savingRef.current = true
    try {
      await fetch(`${API}/annotations/${date}/${id}`, { method: "DELETE", headers: AUTH_HEADERS })
      setSyncStatus("ok")
    } catch {
      setSyncStatus("error")
    } finally {
      savingRef.current = false
    }
  }

  const visibleFor = (key: string) => {
    const all = annotations[key] || []
    return filter === "all" ? all : all.filter(a => a.category === filter)
  }

  const selectedAnns = selected ? (annotations[selected] || []) : []
  const parseSel = selected ? { y: +selected.slice(0, 4), m: +selected.slice(5, 7) - 1, d: +selected.slice(8, 10) } : null

  const showTooltip = (key: string, e: React.MouseEvent) => {
    if (tooltipTimer.current) clearTimeout(tooltipTimer.current)
    if (!visibleFor(key).length) return
    tooltipTimer.current = setTimeout(() => setTooltip({ key, x: e.clientX, y: e.clientY }), 300)
  }
  const hideTooltip = () => {
    if (tooltipTimer.current) clearTimeout(tooltipTimer.current)
    setTooltip(null)
  }

  // ── Day cell (year view) ────────────────────────────────────────────────
  function DayCell({ y, m, d }: { y: number; m: number; d: number }) {
    const key    = toKey(y, m, d)
    const anns   = visibleFor(key)
    const cats   = uniqueCats(anns)
    const dom    = dominantCat(anns)
    const isToday = key === todayKey
    const isSel   = key === selected
    return (
      <button
        onClick={() => setSelected(key)}
        onMouseEnter={e => showTooltip(key, e)}
        onMouseLeave={hideTooltip}
        onMouseMove={e => { if (tooltip?.key === key) setTooltip(t => t ? { ...t, x: e.clientX, y: e.clientY } : null) }}
        className={["relative flex flex-col items-center rounded-sm pt-0.5 transition-all duration-100 overflow-hidden",
          isSel ? "ring-1 ring-orange-500/80" : "hover:brightness-125",
          isToday ? "ring-1 ring-orange-400" : ""].join(" ")}
        style={{ backgroundColor: dom && anns.length ? CATEGORIES[dom].bg : undefined, minHeight: 28 }}
      >
        <span className={`text-[11px] leading-tight font-mono z-10 ${isToday ? "text-orange-400 font-bold" : anns.length ? "text-slate-200" : "text-slate-500"}`}>
          {d}
        </span>
        {cats.length > 0 && (
          <div className="absolute bottom-0 left-0 right-0 flex h-[3px]">
            {cats.map(cat => <div key={cat} className="flex-1 h-full" style={{ backgroundColor: CATEGORIES[cat].color }} />)}
          </div>
        )}
        {anns.some(a => a.category === "urgent") && (
          <div className="absolute top-0.5 right-0.5 w-[5px] h-[5px] rounded-full bg-rose-500" />
        )}
      </button>
    )
  }

  // ── Mini month ──────────────────────────────────────────────────────────
  function MiniMonth({ m }: { m: number }) {
    const fd = firstDow(YEAR, m); const days = daysInMonth(YEAR, m)
    const cells: React.ReactNode[] = []
    for (let i = 0; i < fd; i++) cells.push(<div key={`e${i}`} />)
    for (let d = 1; d <= days; d++) cells.push(<DayCell key={d} y={YEAR} m={m} d={d} />)
    return (
      <div className="bg-[#131f30] rounded border border-[#1e2d42] p-3 flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-mono font-bold text-orange-400 uppercase tracking-widest">{MONTHS_FR[m]}</span>
          <button onClick={() => { setActiveMonth(m); setView("month") }} className="text-[10px] font-mono text-slate-600 hover:text-orange-400 transition-colors px-1">↗</button>
        </div>
        <div className="grid grid-cols-7 gap-0.5">
          {DAYS_SHORT.map((d, i) => <div key={i} className="text-center text-[9px] font-mono text-slate-700 font-semibold">{d}</div>)}
          {cells}
        </div>
      </div>
    )
  }

  // ── Full month view ─────────────────────────────────────────────────────
  function MonthView() {
    const fd = firstDow(YEAR, activeMonth); const days = daysInMonth(YEAR, activeMonth)
    const cells: React.ReactNode[] = []
    for (let i = 0; i < fd; i++) cells.push(<div key={`e${i}`} className="border border-[#1e2d42]/40 rounded min-h-[90px]" />)
    for (let d = 1; d <= days; d++) {
      const key  = toKey(YEAR, activeMonth, d)
      const anns = visibleFor(key)
      const cats = uniqueCats(anns)
      const dom  = dominantCat(anns)
      const isToday = key === todayKey; const isSel = key === selected
      cells.push(
        <button key={d} onClick={() => setSelected(key)}
          onMouseEnter={e => showTooltip(key, e)} onMouseLeave={hideTooltip}
          className={["border rounded min-h-[90px] p-2 text-left flex flex-col gap-1 transition-all duration-100 overflow-hidden relative",
            isSel ? "ring-1 ring-orange-500/60" : "hover:brightness-110",
            isToday ? "ring-1 ring-orange-400" : ""].join(" ")}
          style={{ borderColor: anns.length && dom ? CATEGORIES[dom].color : "#1e2d42", backgroundColor: dom ? CATEGORIES[dom].bg : "transparent" }}
        >
          <div className="flex items-center justify-between">
            <span className={`text-xs font-mono font-semibold ${isToday ? "text-orange-400" : anns.length ? "text-slate-300" : "text-slate-600"}`}>{d}</span>
            {anns.some(a => a.category === "urgent") && <span className="text-[9px] font-mono font-bold text-rose-400">URG</span>}
          </div>
          {cats.length > 0 && (
            <div className="flex flex-wrap gap-0.5">
              {cats.map(cat => <span key={cat} className="text-[9px] font-mono px-1 rounded-sm font-semibold" style={{ color: CATEGORIES[cat].color, backgroundColor: CATEGORIES[cat].bg }}>{CATEGORIES[cat].label.slice(0, 3).toUpperCase()}</span>)}
            </div>
          )}
          <div className="flex flex-col gap-0.5 overflow-hidden">
            {anns.slice(0, 3).map(a => (
              <div key={a.id} className="flex items-start gap-1.5">
                <span className="w-1 h-1 rounded-full mt-[4px] flex-shrink-0" style={{ backgroundColor: CATEGORIES[a.category].color }} />
                <span className="text-[10px] text-slate-400 leading-tight truncate">
                  {a.time && <span className="text-slate-600 mr-1 font-mono">{a.time}</span>}{a.text}
                </span>
              </div>
            ))}
            {anns.length > 3 && <span className="text-[9px] text-slate-700 font-mono">+{anns.length - 3}</span>}
          </div>
          {cats.length > 0 && (
            <div className="absolute bottom-0 left-0 right-0 flex h-[2px]">
              {cats.map(cat => <div key={cat} className="flex-1" style={{ backgroundColor: CATEGORIES[cat].color }} />)}
            </div>
          )}
        </button>
      )
    }
    return (
      <div className="flex-1 overflow-auto p-5 scrollbar-hide">
        <div className="max-w-5xl mx-auto">
          <div className="flex items-center gap-3 mb-5">
            <button onClick={() => setView("year")} className="text-[11px] font-mono text-slate-600 hover:text-orange-400 transition-colors">← Vue annuelle</button>
            <div className="flex items-center gap-1">
              <button onClick={() => setActiveMonth(m => Math.max(0, m - 1))} className="text-slate-600 hover:text-slate-300 px-2 py-1 rounded hover:bg-white/5 font-mono">‹</button>
              <h2 className="text-base font-mono font-bold text-white uppercase tracking-widest w-36 text-center">{MONTHS_FR[activeMonth]}</h2>
              <button onClick={() => setActiveMonth(m => Math.min(11, m + 1))} className="text-slate-600 hover:text-slate-300 px-2 py-1 rounded hover:bg-white/5 font-mono">›</button>
            </div>
          </div>
          <div className="grid grid-cols-7 gap-1 mb-1">
            {DAYS_FULL.map(d => <div key={d} className="text-center text-[10px] font-mono text-slate-700 font-semibold uppercase tracking-widest py-1">{d}</div>)}
          </div>
          <div className="grid grid-cols-7 gap-1">{cells}</div>
        </div>
      </div>
    )
  }

  // Sync status indicator
  const statusLabel: Record<SyncStatus, { label: string; color: string }> = {
    idle:    { label: "—",           color: "#475569" },
    loading: { label: "Chargement…", color: "#94a3b8" },
    saving:  { label: "Sauvegarde…", color: "#f97316" },
    ok:      { label: "Synchronisé", color: "#4ade80" },
    error:   { label: "Erreur sync", color: "#f43f5e" },
  }

  const tooltipAnns = tooltip ? visibleFor(tooltip.key) : []
  const tooltipDate = tooltip ? { d: +tooltip.key.slice(8, 10), m: +tooltip.key.slice(5, 7) - 1 } : null
  const allAnns = Object.values(annotations).flat()
  const counts = { camion: 0, secouriste: 0, note: 0, urgent: 0 }
  allAnns.forEach(a => counts[a.category]++)

  return (
    <div className="h-screen flex flex-col bg-[#0b1220] text-[#e2e8f0] overflow-hidden" style={{ fontFamily: "'Inter', sans-serif" }}>

      {/* Header */}
      <header className="flex items-center gap-3 px-4 py-2 border-b border-[#1e2d42] flex-shrink-0 flex-wrap">
        <div className="flex items-center gap-2 mr-2">
          <div className="flex flex-col gap-[3px]">
            <div className="w-4 h-[3px] bg-orange-500 rounded-full" />
            <div className="w-3 h-[3px] bg-sky-400 rounded-full" />
            <div className="w-4 h-[3px] bg-orange-500 rounded-full" />
          </div>
          <span className="font-mono font-bold text-sm tracking-[0.15em] text-white uppercase">Agenda 2026</span>
        </div>

        <div className="flex items-center rounded overflow-hidden border border-[#1e2d42]">
          {(["year", "month"] as const).map(v => (
            <button key={v} onClick={() => setView(v)}
              className={`text-[11px] font-mono px-3 py-1 transition-colors ${view === v ? "bg-orange-500 text-white" : "text-slate-500 hover:text-slate-300"}`}>
              {v === "year" ? "Annuel" : "Mensuel"}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-3 ml-2">
          {(Object.keys(CATEGORIES) as Category[]).map(cat => (
            <div key={cat} className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-sm" style={{ backgroundColor: CATEGORIES[cat].color }} />
              <span className="text-[10px] font-mono text-slate-500">{CATEGORIES[cat].label}</span>
            </div>
          ))}
        </div>

        <div className="flex items-center gap-1 ml-auto flex-wrap">
          <span className="text-[10px] font-mono text-slate-700 mr-1 uppercase tracking-widest">Filtre</span>
          {(["all", "camion", "secouriste", "note", "urgent"] as const).map(f => (
            <button key={f} onClick={() => setFilter(f)}
              className={`flex items-center gap-1 text-[10px] font-mono px-2.5 py-1 rounded transition-all ${filter === f ? "bg-white/10 text-white" : "text-slate-600 hover:text-slate-400"}`}>
              {f !== "all" && <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: CATEGORIES[f].color }} />}
              {f === "all" ? "Tout" : CATEGORIES[f].label}
            </button>
          ))}
        </div>
      </header>

      {/* Body */}
      <div className="flex flex-1 overflow-hidden">
        <div className="flex-1 overflow-hidden flex flex-col">
          {view === "year" ? (
            <div className="flex-1 overflow-auto p-4 scrollbar-hide">
              <div className="grid grid-cols-4 gap-3 max-w-6xl mx-auto">
                {Array.from({ length: 12 }, (_, i) => <MiniMonth key={i} m={i} />)}
              </div>
            </div>
          ) : <MonthView />}
        </div>

        {/* Side panel */}
        <div className="flex-shrink-0 border-l border-[#1e2d42] transition-all duration-200 overflow-hidden" style={{ width: selected ? 288 : 0 }}>
          {selected && parseSel && (
            <div className="w-72 h-full flex flex-col">
              <div className="flex items-start justify-between px-4 pt-4 pb-3 border-b border-[#1e2d42] flex-shrink-0">
                <div>
                  <div className="text-[10px] font-mono text-slate-600 uppercase tracking-widest mb-0.5">{MONTHS_FR[parseSel.m]} {YEAR}</div>
                  <div className="text-3xl font-mono font-bold text-white leading-none">{String(parseSel.d).padStart(2, "0")}</div>
                  <div className="flex gap-1.5 mt-1.5 flex-wrap">
                    {uniqueCats(selectedAnns).map(cat => (
                      <span key={cat} className="text-[9px] font-mono font-bold px-1.5 py-0.5 rounded" style={{ color: CATEGORIES[cat].color, backgroundColor: CATEGORIES[cat].bg }}>
                        {CATEGORIES[cat].label.toUpperCase()}
                      </span>
                    ))}
                  </div>
                </div>
                <button onClick={() => setSelected(null)} className="text-slate-600 hover:text-slate-400 transition-colors text-xl leading-none mt-1">×</button>
              </div>

              <div className="flex-1 overflow-y-auto p-4 space-y-2 scrollbar-hide">
                {selectedAnns.length === 0 && (
                  <p className="text-[11px] font-mono text-slate-700 text-center pt-6">Aucune annotation pour ce jour.</p>
                )}
                {selectedAnns.map(a => (
                  <div key={a.id} className="group relative rounded p-3 border-l-2" style={{ borderColor: CATEGORIES[a.category].color, backgroundColor: CATEGORIES[a.category].bg }}>
                    <div className="flex items-center gap-2 mb-1.5">
                      <span className="text-[9px] font-mono font-bold uppercase tracking-widest" style={{ color: CATEGORIES[a.category].color }}>{CATEGORIES[a.category].label}</span>
                      {a.time && <span className="text-[9px] font-mono text-slate-500">{a.time}</span>}
                    </div>
                    <p className="text-[12px] text-slate-300 leading-relaxed pr-10">{a.text}</p>
                    <div className="absolute top-2 right-2 flex items-center gap-2 opacity-0 group-hover:opacity-100">
                      <button onClick={() => startEdit(a)}
                        className="text-slate-700 hover:text-orange-400 transition-colors text-sm leading-none">✎</button>
                      <button onClick={() => removeAnnotation(selected, a.id)}
                        className="text-slate-700 hover:text-rose-400 transition-colors text-base leading-none">×</button>
                    </div>
                  </div>
                ))}
              </div>

              <div className="border-t border-[#1e2d42] p-4 flex-shrink-0 space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-[10px] font-mono text-slate-700 uppercase tracking-widest">{editingId ? "Modifier l'annotation" : "Nouvelle annotation"}</p>
                  {editingId && (
                    <button onClick={cancelEdit} className="text-[10px] font-mono text-slate-600 hover:text-slate-400 transition-colors">Annuler</button>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-1">
                  {(Object.keys(CATEGORIES) as Category[]).map(cat => (
                    <button key={cat} onClick={() => setNewCat(cat)}
                      className={`flex items-center gap-2 text-[10px] font-mono py-1.5 px-2 rounded transition-all ${newCat === cat ? "bg-white/10 text-white" : "text-slate-600 hover:text-slate-400"}`}>
                      <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: CATEGORIES[cat].color }} />
                      {CATEGORIES[cat].label}
                    </button>
                  ))}
                </div>
                <input type="time" value={newTime} onChange={e => setNewTime(e.target.value)}
                  className="w-full bg-[#182030] border border-[#1e2d42] rounded px-2.5 py-1.5 text-[11px] font-mono text-slate-300 focus:outline-none focus:border-orange-500/60 transition-colors" />
                <textarea value={newText} onChange={e => setNewText(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) saveAnnotation() }}
                  placeholder="Annotation libre..." rows={3}
                  className="w-full bg-[#182030] border border-[#1e2d42] rounded px-2.5 py-1.5 text-[12px] text-slate-300 focus:outline-none focus:border-orange-500/60 transition-colors resize-none scrollbar-hide"
                  style={{ fontFamily: "'Inter', sans-serif" }} />
                <button onClick={saveAnnotation} disabled={!newText.trim() || syncStatus === "saving"}
                  className="w-full py-1.5 rounded text-[11px] font-mono font-bold bg-orange-500 text-white hover:bg-orange-600 transition-colors disabled:opacity-25 disabled:cursor-not-allowed tracking-wide">
                  {syncStatus === "saving" ? "Sauvegarde…" : editingId ? "Enregistrer →" : "Ajouter →"}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Status bar */}
      <footer className="flex items-center gap-4 px-4 py-1.5 border-t border-[#1e2d42] flex-shrink-0">
        <div className="flex items-center gap-3">
          {(Object.keys(CATEGORIES) as Category[]).map(cat => (
            <div key={cat} className="flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: CATEGORIES[cat].color }} />
              <span className="text-[10px] font-mono text-slate-700">{counts[cat]} {CATEGORIES[cat].label.toLowerCase()}{counts[cat] !== 1 ? "s" : ""}</span>
            </div>
          ))}
        </div>

        {/* Sync status */}
        <div className="ml-auto flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: statusLabel[syncStatus].color }} />
          <span className="text-[10px] font-mono" style={{ color: statusLabel[syncStatus].color }}>
            {statusLabel[syncStatus].label}
          </span>
          {syncStatus === "error" && (
            <button onClick={() => fetchAnnotations()} className="text-[10px] font-mono text-slate-600 hover:text-slate-400 ml-1 underline">Réessayer</button>
          )}
        </div>
      </footer>

      {/* Floating tooltip */}
      {tooltip && tooltipAnns.length > 0 && tooltipDate && (
        <div className="fixed z-50 pointer-events-none" style={{ left: Math.min(tooltip.x + 12, window.innerWidth - 240), top: tooltip.y - 8, transform: "translateY(-100%)" }}>
          <div className="rounded border shadow-xl w-56 overflow-hidden" style={{ backgroundColor: "#0f1c2e", borderColor: "#2d4a6a" }}>
            <div className="px-3 py-2 border-b flex items-center gap-2" style={{ borderColor: "#1e2d42" }}>
              <span className="text-[11px] font-mono font-bold text-white">{String(tooltipDate.d).padStart(2, "0")} {MONTHS_FR[tooltipDate.m]}</span>
              <span className="text-[10px] font-mono text-slate-600 ml-auto">{tooltipAnns.length} annotation{tooltipAnns.length > 1 ? "s" : ""}</span>
            </div>
            <div className="px-3 py-2 flex flex-col gap-2">
              {tooltipAnns.map(a => (
                <div key={a.id} className="flex items-start gap-2">
                  <div className="w-[3px] self-stretch rounded-full flex-shrink-0 mt-0.5" style={{ backgroundColor: CATEGORIES[a.category].color }} />
                  <div className="flex flex-col min-w-0">
                    <div className="flex items-center gap-1.5 mb-0.5">
                      <span className="text-[9px] font-mono font-bold uppercase" style={{ color: CATEGORIES[a.category].color }}>{CATEGORIES[a.category].label}</span>
                      {a.time && <span className="text-[9px] font-mono text-slate-600">{a.time}</span>}
                    </div>
                    <p className="text-[11px] text-slate-300 leading-snug">{a.text}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
