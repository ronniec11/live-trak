// Shared per-unit color coding + two ways to show a unit-of-measure
// breakdown: a compact segmented bar (one shared bar, split into a
// compartment per unit, with actual/target numbers) for detail views, and
// simple stacked rows (one small bar per unit, just a percentage) for a
// tighter summary like a scope card.
const UOM_COLOR = { SF: 'bg-accent', LF: 'bg-yellow-400', each: 'bg-purple-400' }

export function pageUomDisplay(u) {
  return u === 'each' ? 'Each' : u
}

// groups: [{ unit: 'SF'|'LF'|'each', value, target, pct }] — value/target
// already in that unit's own numbers, pct already computed (0 when no
// target is set). A single-unit scope still renders fine here (one
// compartment = a plain bar, same as before this existed).
export default function UomProgressBar({ groups, size = 'md' }) {
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
            </div>
            <span className="text-muted truncate">
              {g.value.toLocaleString(undefined, { maximumFractionDigits: 0 })}
              {g.target > 0 && <> / {g.target.toLocaleString()} · {g.pct}%</>}
            </span>
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

// groups: same shape as above. One row per unit — a dot, "{Unit} · {pct}%",
// and its own full-width bar underneath — no actual/target numbers, just
// the percentage. Used where the detail (real values vs. target) belongs
// one click away instead of on the summary itself (a scope card; click
// into the scope to see the numbers).
export function UomProgressRows({ groups, size = 'md' }) {
  if (!groups || groups.length === 0) return null
  const barH = size === 'sm' ? 'h-1' : size === 'lg' ? 'h-2' : 'h-1.5'

  return (
    <div className="space-y-2">
      {groups.map(g => (
        <div key={g.unit}>
          <div className="flex items-center gap-1.5 text-xs mb-1">
            <span className={`w-2 h-2 rounded-full shrink-0 ${UOM_COLOR[g.unit] || 'bg-accent'}`} />
            <span className="font-medium text-gray-700 dark:text-gray-300">{pageUomDisplay(g.unit)} · {g.pct}%</span>
          </div>
          <div className={`${barH} bg-surface-3 rounded-full overflow-hidden`}>
            <div className={`h-full rounded-full transition-all duration-700 ${UOM_COLOR[g.unit] || 'bg-accent'}`} style={{ width: `${g.pct}%` }} />
          </div>
        </div>
      ))}
    </div>
  )
}
