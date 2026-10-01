import { useEffect, useState } from 'react'

// Austin, TX — used for the weather widget whenever a job has no address
// set yet, so the widget always has something to show rather than an empty
// box.
export const DEFAULT_WEATHER_LOCATION = { lat: 30.26, lon: -97.74, label: 'Austin, TX' }

// Open-Meteo's WMO weather codes collapsed to a short human label — see
// https://open-meteo.com/en/docs for the full table.
function weatherDescription(code) {
  const map = {
    0: 'Clear sky', 1: 'Mainly clear', 2: 'Partly cloudy', 3: 'Overcast',
    45: 'Fog', 48: 'Depositing rime fog',
    51: 'Light drizzle', 53: 'Drizzle', 55: 'Dense drizzle',
    56: 'Freezing drizzle', 57: 'Dense freezing drizzle',
    61: 'Light rain', 63: 'Rain', 65: 'Heavy rain',
    66: 'Freezing rain', 67: 'Heavy freezing rain',
    71: 'Light snow', 73: 'Snow', 75: 'Heavy snow', 77: 'Snow grains',
    80: 'Light showers', 81: 'Showers', 82: 'Violent showers',
    85: 'Light snow showers', 86: 'Heavy snow showers',
    95: 'Thunderstorm', 96: 'Thunderstorm, hail', 99: 'Severe thunderstorm, hail',
  }
  return map[code] || 'Weather'
}

function WeatherIcon({ code }) {
  const common = { className: 'w-7 h-7 text-accent shrink-0', fill: 'none', viewBox: '0 0 24 24', stroke: 'currentColor', strokeWidth: 1.5 }
  if (code === 0 || code === 1) {
    return <svg {...common}><circle cx="12" cy="12" r="4.5" /><path strokeLinecap="round" d="M12 2.5v2.5M12 19v2.5M4.22 4.22l1.77 1.77M18 18l1.78 1.78M2.5 12H5M19 12h2.5M4.22 19.78L6 18M18 6l1.78-1.78" /></svg>
  }
  if ([2, 3, 45, 48].includes(code)) {
    return <svg {...common}><path strokeLinecap="round" strokeLinejoin="round" d="M6.75 15.75a4.5 4.5 0 01.72-8.933 5.25 5.25 0 0110.06 1.5A4.001 4.001 0 0117.25 16H6.75z" /></svg>
  }
  if ([95, 96, 99].includes(code)) {
    return <svg {...common}><path strokeLinecap="round" strokeLinejoin="round" d="M6.75 12.75a4.5 4.5 0 01.72-8.933 5.25 5.25 0 0110.06 1.5A4.001 4.001 0 0117.25 13H6.75z" /><path strokeLinecap="round" strokeLinejoin="round" d="M13 14l-2.5 4h2.5l-2 4" /></svg>
  }
  if ([71, 73, 75, 77, 85, 86].includes(code)) {
    return <svg {...common}><path strokeLinecap="round" strokeLinejoin="round" d="M6.75 12.75a4.5 4.5 0 01.72-8.933 5.25 5.25 0 0110.06 1.5A4.001 4.001 0 0117.25 13H6.75z" /><path strokeLinecap="round" strokeLinejoin="round" d="M8 17v2.5M12 17v2.5M16 17v2.5" /></svg>
  }
  // Drizzle / rain / showers (the remaining, most common construction-relevant case)
  return (
    <svg {...common}><path strokeLinecap="round" strokeLinejoin="round" d="M6.75 12.75a4.5 4.5 0 01.72-8.933 5.25 5.25 0 0110.06 1.5A4.001 4.001 0 0117.25 13H6.75z" /><path strokeLinecap="round" strokeLinejoin="round" d="M8 16.5l-1 3M12 16.5l-1 3M16 16.5l-1 3" /></svg>
  )
}

// Resolves a job's address to coordinates once (Open-Meteo's free
// geocoding API, no key), falling back to Austin, TX when there's no
// address or geocoding fails. Shared by WeatherWidget and LocationMap
// (ProjectDetail.jsx) so the sidebar only geocodes the address a single
// time instead of each widget doing its own redundant lookup.
export function useJobLocation(address) {
  const [state, setState] = useState({ status: 'loading' })

  useEffect(() => {
    let cancelled = false
    async function load() {
      setState({ status: 'loading' })
      let { lat, lon, label } = DEFAULT_WEATHER_LOCATION
      let usedDefault = true
      if (address) {
        try {
          // Nominatim (OpenStreetMap's own geocoder), not Open-Meteo's
          // geocoding API — Open-Meteo only indexes place names (cities,
          // towns, landmarks), not street addresses, so a real job address
          // like "2801 W Bethel Rd, Coppell, TX" returned zero results
          // there every time and silently fell back to the Austin, TX
          // default, which is exactly why the weather/map never matched
          // the address actually set in Project Settings. Nominatim
          // geocodes full street addresses correctly.
          const geoRes = await fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(address)}&format=json&limit=1&addressdetails=1`)
          const results = await geoRes.json()
          const match = results?.[0]
          if (match) {
            lat = parseFloat(match.lat); lon = parseFloat(match.lon)
            const city = match.address?.city || match.address?.town || match.address?.village
            label = [city, match.address?.state].filter(Boolean).join(', ') || match.display_name
            usedDefault = false
          }
        } catch (e) {
          console.warn('[JobDetail] Geocoding failed, using default location:', e)
        }
      }
      if (!cancelled) setState({ status: 'ready', lat, lon, label, usedDefault })
    }
    load()
    return () => { cancelled = true }
  }, [address])

  return state
}

// "2024-06-01" -> a local Date at midnight on that calendar day. Open-Meteo
// returns plain date strings (no time/offset); new Date(str) parses those
// as UTC midnight, which can land on the PREVIOUS day once displayed in a
// negative-UTC-offset timezone (most of the US) — splitting the parts out
// and using the local Date constructor avoids that off-by-one.
function parseForecastDate(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number)
  return new Date(y, m - 1, d)
}

function forecastDayLabel(dateStr, idx) {
  if (idx === 0) return 'Today'
  return parseForecastDate(dateStr).toLocaleDateString(undefined, { weekday: 'short' })
}

function ForecastModal({ location, daily, onClose }) {
  return (
    <div className="modal-backdrop fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="modal-panel bg-surface border border-border rounded-2xl w-full max-w-md max-h-[85vh] overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-gray-900 dark:text-white">10-Day Forecast</h2>
            <p className="text-xs text-muted truncate">{location.label}</p>
          </div>
          <button onClick={onClose} className="btn-ghost p-1.5 shrink-0">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="overflow-y-auto min-h-0 p-2">
          {daily.time.map((dateStr, i) => (
            <div key={dateStr} className="flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-surface-2">
              <span className="w-10 text-sm font-medium text-gray-900 dark:text-white shrink-0">{forecastDayLabel(dateStr, i)}</span>
              <WeatherIcon code={daily.weather_code[i]} />
              <span className="flex-1 min-w-0 text-xs text-muted truncate">{weatherDescription(daily.weather_code[i])}</span>
              {daily.precipitation_probability_max[i] > 10 && (
                <span className="text-xs text-blue-600 dark:text-blue-400 font-medium shrink-0">{daily.precipitation_probability_max[i]}%</span>
              )}
              <span className="text-sm text-gray-900 dark:text-white shrink-0 w-16 text-right">
                {Math.round(daily.temperature_2m_max[i])}° <span className="text-muted">{Math.round(daily.temperature_2m_min[i])}°</span>
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

export default function WeatherWidget({ location }) {
  const [weather, setWeather] = useState({ status: 'loading' })
  const [forecastOpen, setForecastOpen] = useState(false)

  useEffect(() => {
    if (location.status !== 'ready') return
    let cancelled = false
    async function load() {
      setWeather({ status: 'loading' })
      try {
        const weatherRes = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${location.lat}&longitude=${location.lon}&current=temperature_2m,weather_code,wind_speed_10m&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max&forecast_days=10&timezone=auto&temperature_unit=fahrenheit&wind_speed_unit=mph`)
        const data = await weatherRes.json()
        if (cancelled) return
        if (!data?.current) { setWeather({ status: 'error' }); return }
        setWeather({ status: 'ready', current: data.current, daily: data.daily })
      } catch (e) {
        console.warn('[JobDetail] Weather fetch failed:', e)
        if (!cancelled) setWeather({ status: 'error' })
      }
    }
    load()
    return () => { cancelled = true }
  }, [location.status, location.lat, location.lon])

  if (location.status !== 'ready' || weather.status === 'loading') {
    return <div className="card animate-pulse h-[88px]" />
  }
  if (weather.status === 'error') {
    return (
      <div className="card flex items-center justify-center text-xs text-muted h-[88px]">
        Weather unavailable
      </div>
    )
  }

  const { current, daily } = weather
  return (
    <>
      <div
        role="button"
        tabIndex={0}
        onClick={() => setForecastOpen(true)}
        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setForecastOpen(true) } }}
        aria-label="Open 10-day forecast"
        className="card cursor-pointer hover:bg-surface-2 transition-colors"
      >
        <div className="flex items-center gap-3">
          <WeatherIcon code={current.weather_code} />
          <div className="min-w-0">
            <p className="text-xl font-bold text-gray-900 dark:text-white leading-tight">{Math.round(current.temperature_2m)}°F</p>
            {/* Rain is a big deal in construction — today's chance of rain
                shows right here at a glance, not just buried in the 10-day
                modal, color-coded blue so it reads as "precipitation" and
                not the green "on track" accent used everywhere else. */}
            <p className="text-xs text-muted truncate">
              {weatherDescription(current.weather_code)}
              {daily?.precipitation_probability_max?.[0] != null && (
                <> · <span className="text-blue-600 dark:text-blue-400 font-medium">{daily.precipitation_probability_max[0]}%</span></>
              )}
              {' · '}{Math.round(current.wind_speed_10m)} mph
            </p>
          </div>
        </div>
        <p className="text-xs text-muted mt-2">
          {location.usedDefault
            ? <>No job address set — showing <span className="font-medium text-gray-700 dark:text-gray-300">{location.label}</span></>
            : location.label}
        </p>
      </div>
      {forecastOpen && daily && (
        <ForecastModal location={location} daily={daily} onClose={() => setForecastOpen(false)} />
      )}
    </>
  )
}
