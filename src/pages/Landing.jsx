import { Link } from 'react-router-dom'

// Public marketing page — only ever rendered at "/" for a logged-out
// visitor in an ordinary browser tab (see App.jsx's RootGate). Every icon
// here is a small hand-drawn SVG in the app's own brand colors, not a
// Unicode emoji — emoji render differently (and often worse) across
// platforms/fonts, and look generic next to the rest of the product.
const BRAND_BLUE = '#3b82f6'
const BRAND_GREEN = '#4ade80'

function IconBadge({ color, children }) {
  return (
    <div
      className="w-11 h-11 rounded-xl flex items-center justify-center shrink-0"
      style={{ background: `${color}1a`, color }}
    >
      {children}
    </div>
  )
}

const ICON_PROPS = { width: 22, height: 22, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' }

// Floor plan with a highlighted region — the Canvas markup tools.
function IconMarkup() {
  return (
    <svg {...ICON_PROPS}>
      <rect x="3" y="4" width="18" height="16" rx="1.5" />
      <path d="M3 10h18M9 4v6" />
      <rect x="11" y="12" width="7" height="5" rx="1" fill="currentColor" fillOpacity="0.25" stroke="none" />
    </svg>
  )
}
// Progress ring / target — SF-LF-count vs. daily & total targets.
function IconTarget() {
  return (
    <svg {...ICON_PROPS}>
      <circle cx="12" cy="12" r="8.5" />
      <circle cx="12" cy="12" r="4.5" />
      <path d="M12 3.5V7M20.5 12H17" />
    </svg>
  )
}
// Crew + clock — crew size, hours worked, man-hour rates.
function IconCrew() {
  return (
    <svg {...ICON_PROPS}>
      <circle cx="9" cy="8" r="3" />
      <path d="M3.5 19c0-3 2.5-5 5.5-5s5.5 2 5.5 5" />
      <circle cx="18" cy="7" r="4" />
      <path d="M18 5v2.3L19.3 8.6" />
    </svg>
  )
}
// Document with a checkmark — Sheet Reports.
function IconReport() {
  return (
    <svg {...ICON_PROPS}>
      <path d="M6 3h8l4 4v14H6z" />
      <path d="M14 3v4h4" />
      <path d="M9 13.5l2 2 4-4.5" />
    </svg>
  )
}
// Two overlapping people — invites/team.
function IconTeam() {
  return (
    <svg {...ICON_PROPS}>
      <circle cx="8.5" cy="8" r="3" />
      <path d="M3 19c0-2.8 2.5-5 5.5-5s5.5 2.2 5.5 5" />
      <circle cx="16.5" cy="9" r="2.5" />
      <path d="M14.5 19c.2-2.3 1.8-4 3.8-4 2.3 0 4.2 1.8 4.2 4.3" />
    </svg>
  )
}
// Cloud with a sync arrow — offline + sync.
function IconOffline() {
  return (
    <svg {...ICON_PROPS}>
      <path d="M7 17.5a4 4 0 010-8 5.5 5.5 0 0110.5-1.5A4 4 0 0118 17.5H7z" />
      <path d="M12 10v6M9.5 13.5L12 16l2.5-2.5" />
    </svg>
  )
}

const FEATURES = [
  { icon: IconMarkup, color: BRAND_BLUE, title: 'Mark up real floor plans', body: 'Highlight, draw, and measure production directly on the actual sheet — highlight, rectangle, polygon, pen, count, and linear-footage tools, all in one canvas.' },
  { icon: IconTarget, color: BRAND_GREEN, title: 'Track progress automatically', body: 'Every stroke adds up into SF, LF, or count — measured against daily and total targets, no manual math, no separate spreadsheet.' },
  { icon: IconCrew, color: BRAND_BLUE, title: 'Log crew, hours & rates', body: "Capture crew size and hours worked per session, and see production-per-man-hour update in real time as the sheet fills in." },
  { icon: IconReport, color: BRAND_GREEN, title: 'Branded Sheet Reports', body: 'Generate a polished, print-ready PDF — company logo, progress snapshot, session breakdown — in one tap, straight from the floor plan.' },
  { icon: IconTeam, color: BRAND_BLUE, title: 'Invite your whole team', body: 'Bring on foremen and PMs with a click. Roles control who can edit versus just view, so the field and the office see exactly what they need.' },
  { icon: IconOffline, color: BRAND_GREEN, title: 'Works offline on the jobsite', body: "No signal in the building? Keep marking up the plan — everything syncs the moment you're back online, with nothing lost in between." },
]

const STEPS = [
  { n: '1', title: 'Upload the plan', body: 'Drop in a PDF or image of the floor plan — Live-Trak tiles and calibrates it for fast, precise zoom and pan.' },
  { n: '2', title: 'Mark up as you go', body: "Crews highlight what's done, log hours, and snap a few completion photos — right on-site, right on the plan." },
  { n: '3', title: 'See it roll up instantly', body: 'Production, man-hour rates, and daily targets update live for every job, scope, and sheet in the company.' },
]

const PLANS = [
  { name: 'Basic', price: 25, blurb: 'Every new company starts here.', features: ['1 active job', 'Up to 2 team members', '2 floor plans, unlimited sessions'], trialTag: true },
  { name: 'Starter', price: 49, blurb: 'Small crews getting off spreadsheets.', features: ['Up to 3 active jobs', 'Up to 5 team members', 'Unlimited floor plans & sessions'] },
  { name: 'Pro', price: 149, blurb: 'Growing teams running several jobs at once.', features: ['Up to 15 active jobs', 'Up to 25 team members', 'Everything in Starter'], featured: true },
  { name: 'Business', price: 399, blurb: 'Larger operations, no limits.', features: ['Unlimited active jobs', 'Unlimited team members', 'Everything in Pro'] },
]

function NavBar() {
  return (
    <header className="relative z-10 max-w-6xl mx-auto px-5 sm:px-8 py-5 flex items-center justify-between">
      <div className="flex items-center gap-2.5">
        <img src="/live-trak-icon.svg?v=3" alt="" style={{ width: 32, height: 32 }} />
        <span className="text-lg font-semibold text-gray-900 dark:text-white tracking-tight">Live-Trak</span>
      </div>
      <div className="flex items-center gap-2 sm:gap-3">
        <Link to="/login" className="btn-ghost text-sm">Sign In</Link>
        <Link to="/login?mode=signup" className="btn-primary text-sm">Start Free Trial</Link>
      </div>
    </header>
  )
}

export default function Landing() {
  return (
    <div className="min-h-screen bg-bg overflow-x-hidden">
      <NavBar />

      {/* Hero */}
      <section className="relative">
        <div
          className="absolute inset-0 opacity-[0.03] pointer-events-none"
          style={{
            backgroundImage: `linear-gradient(${BRAND_GREEN} 1px, transparent 1px), linear-gradient(90deg, ${BRAND_GREEN} 1px, transparent 1px)`,
            backgroundSize: '40px 40px',
          }}
        />
        <div className="relative max-w-4xl mx-auto px-5 sm:px-8 pt-14 pb-16 sm:pt-20 sm:pb-24 text-center">
          <h1 className="text-4xl sm:text-5xl font-extrabold text-gray-900 dark:text-white tracking-tight leading-[1.1]">
            Production tracking,<br className="hidden sm:block" /> right on the floor plan.
          </h1>
          <p className="mt-5 text-base sm:text-lg text-muted max-w-2xl mx-auto">
            Live-Trak turns every sheet into a live production tracker — mark up what's done, log crew and hours, and roll it all up into reports your office actually wants to read.
          </p>
          <div className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-3">
            <Link to="/login?mode=signup" className="btn-primary text-sm px-6 py-3 w-full sm:w-auto">Start your 14-day free trial</Link>
            <Link to="/login" className="btn-secondary text-sm px-6 py-3 w-full sm:w-auto">Sign In</Link>
          </div>
          <p className="mt-3 text-xs text-muted">No charge until your trial ends. Cancel anytime.</p>
        </div>
      </section>

      {/* Features */}
      <section className="max-w-6xl mx-auto px-5 sm:px-8 pb-16 sm:pb-24">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {FEATURES.map(f => (
            <div key={f.title} className="card">
              <IconBadge color={f.color}><f.icon /></IconBadge>
              <h3 className="mt-4 text-sm font-semibold text-gray-900 dark:text-white">{f.title}</h3>
              <p className="mt-1.5 text-sm text-muted leading-relaxed">{f.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* How it works */}
      <section className="max-w-5xl mx-auto px-5 sm:px-8 pb-16 sm:pb-24">
        <h2 className="text-2xl font-bold text-gray-900 dark:text-white text-center mb-10">How it works</h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-8">
          {STEPS.map(s => (
            <div key={s.n} className="text-center sm:text-left">
              <div
                className="w-9 h-9 rounded-full flex items-center justify-center font-bold text-sm mb-3 mx-auto sm:mx-0"
                style={{ background: `${BRAND_GREEN}1a`, color: BRAND_GREEN }}
              >
                {s.n}
              </div>
              <h3 className="text-sm font-semibold text-gray-900 dark:text-white">{s.title}</h3>
              <p className="mt-1.5 text-sm text-muted leading-relaxed">{s.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Pricing */}
      <section className="max-w-6xl mx-auto px-5 sm:px-8 pb-16 sm:pb-24">
        <div className="text-center mb-10">
          <h2 className="text-2xl font-bold text-gray-900 dark:text-white">Simple, per-company pricing</h2>
          <p className="mt-2 text-sm text-muted">Every company starts on Basic with a 14-day free trial — upgrade to any plan below whenever you're ready, right from the app.</p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
          {PLANS.map(p => (
            <div key={p.name} className={`card flex flex-col ${p.featured ? 'border-accent' : ''} ${p.trialTag ? 'border-accent/60' : ''}`}>
              {p.featured && <div className="text-[11px] font-bold text-accent uppercase tracking-wide mb-2">Most popular</div>}
              {p.trialTag && <div className="text-[11px] font-bold text-accent uppercase tracking-wide mb-2">14-day free trial</div>}
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white">{p.name}</h3>
              <p className="text-xs text-muted mt-0.5 mb-3">{p.blurb}</p>
              <p className="text-3xl font-bold text-gray-900 dark:text-white mb-4">${p.price}<span className="text-sm font-normal text-muted">/month</span></p>
              <ul className="space-y-2 mb-6 flex-1">
                {p.features.map(f => (
                  <li key={f} className="text-sm text-gray-700 dark:text-gray-300 flex items-start gap-2">
                    <span className="text-accent shrink-0 mt-0.5">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="5,13 10,18 19,6" /></svg>
                    </span>
                    {f}
                  </li>
                ))}
              </ul>
              <Link to="/login?mode=signup" className={p.featured || p.trialTag ? 'btn-primary w-full text-center' : 'btn-secondary w-full text-center'}>
                {p.trialTag ? 'Start Free Trial' : 'Get Started'}
              </Link>
            </div>
          ))}
        </div>
      </section>

      {/* Final CTA */}
      <section className="max-w-4xl mx-auto px-5 sm:px-8 pb-20 text-center">
        <div className="card py-10 px-6">
          <h2 className="text-2xl font-bold text-gray-900 dark:text-white">Get your floor plans off the spreadsheet.</h2>
          <p className="mt-2 text-sm text-muted">Set up your company and invite your team in minutes.</p>
          <div className="mt-6">
            <Link to="/login?mode=signup" className="btn-primary text-sm px-6 py-3 inline-block">Start your 14-day free trial</Link>
          </div>
        </div>
      </section>

      <footer className="border-t border-border">
        <div className="max-w-6xl mx-auto px-5 sm:px-8 py-6 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-muted">
          <div className="flex items-center gap-2">
            <img src="/live-trak-icon.svg?v=3" alt="" style={{ width: 18, height: 18 }} />
            <span>&copy; {new Date().getFullYear()} Live-Trak. All rights reserved.</span>
          </div>
          <Link to="/login" className="hover:text-gray-900 dark:hover:text-white">Sign In</Link>
        </div>
      </footer>
    </div>
  )
}
