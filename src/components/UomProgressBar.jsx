// One progress bar, divided into equal compartments — one per unit of
// measure present in whatever's being summarized (a scope's pages, a
// job's scopes). A scope/job can span SF/LF/Each sheets at once, so this
// shows all of them at a glance without stacking a whole extra bar per
// unit. Shared by ScopeDetail.jsx (a scope's own Daily/Total Progress),
// ProjectDetail.jsx (a scope card's Daily/Total Progress, and the job
// dashboard's own progress detail modal).
const UOM_COLOR = { SF: 'bg-accent', LF: 'bg-yellow-400', each: 'bg-purple-400' }

export function pageUomDisplay(u) {
  return u === 'each' ? 'Each' : u
}

// groups: [{ unit: 'SF'|'LF'|'each', value, target, pct }] — value/target
// already in that unit's own numbers, pct already computed (0 when no
// target is set). A single-unit scope still renders fine here (one
// compartment = a plain bar, same as before this existed).
//
// showValues=false drops the actual/target numbers from the legend,
// leaving just "{Unit} · {pct}%" — for a summary (a scope card) where the
// real numbers are a click away on the scope's own page rather than
// duplicated here.
export default function UomProgressBar({ groups, size = 'md', showValues = true }) {
  if (!groups || groups.length === 0) return null
  const barH = size === 'sm' ? 'h-1' : size === 'lg' ? 'h-2.5' : 'h-1.5'
  const textSize = size === 'lg' ? 'text-xs' : 'text-[11px]'

  return (
    <div>
      <div className="grid gap-1 mb-1" style={{ gridTemplateColumns: `repeat(${groups.length}, 1fr)` }}>
        {groups.map(g => (
          <div key={g.unit} className={`min-w-0 flex flex-col gap-0.5 ${textSize}`}>
            <div className="flex items-center gap-1 min-w-0">
              <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${UOM_COLOR[g.unit] || 'bg-accent'}`} />
              <span className="font-semibold text-gray-900 dark:text-white truncate">{pageUomDisplay(g.unit)}</span>
              {!showValues && <span className="text-muted font-normal">· {g.pct}%</span>}
            </div>
            {showValues && (
              <span className="text-muted truncate">
                {g.value.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                {g.target > 0 && <> / {g.target.toLocaleString()} · {g.pct}%</>}
              </span>
            )}
          </div>
        ))}
      </div>
      <div className={`flex gap-0.5 ${barH} rounded-full overflow-hidden`}>
        {groups.map(g => (
          <div key={g.unit} className="flex-1 min-w-0 bg-surface-3 relative">
            <div
              className={`absolute inset-y-0 left-0 rounded-full transition-all duration-700 ${UOM_COLOR[g.unit] || 'bg-accent'}`}
              style={{ width: `${g.pct}%` }}
            />
          </div>
        ))}
      </div>
    </div>
  )
}
