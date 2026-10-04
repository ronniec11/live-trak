import { useRef, useState } from 'react'
import Navbar from './Navbar'

// How far (px) a pull has to travel before releasing it triggers a
// refresh — rubber-banded (0.5x) against the raw touch delta below so it
// never tracks the finger 1:1, same damped feel as iOS's own pull-to-
// refresh. MAX_PULL caps how far the indicator can travel so a long drag
// doesn't fling it off past the navbar.
const PULL_THRESHOLD = 70
const MAX_PULL = 100

// Pull-down-to-refresh for touch devices (iPad in the field, mainly) — a
// quick, obvious "get everything back in sync" gesture alongside the
// existing sync buttons (OfflineSyncButton etc.), not a replacement for
// them. Deliberately a full page reload rather than re-fetching data in
// place: that guarantees it's actually fully in sync with no per-page
// refetch wiring to keep maintained as new pages get added, and matches
// what a pull-to-refresh gesture means in every native app already.
//
// Only engages via touch events (mouse/trackpad scrolling is untouched)
// and only when `main` is already scrolled to the very top — otherwise a
// normal downward scroll gesture mid-list would be misread as a pull.
// Canvas.jsx (the floor plan editor) doesn't render through this Layout
// at all, so this never fights with panning/zooming a sheet.
export default function Layout({ children, fullHeight = false }) {
  const mainRef = useRef(null)
  const touchStartY = useRef(null)
  const pullingRef = useRef(false)
  const [pullDistance, setPullDistance] = useState(0)
  const [refreshing, setRefreshing] = useState(false)

  function onTouchStart(e) {
    if (refreshing) return
    const main = mainRef.current
    // e.touches.length > 1 — a second finger means this is a pinch (e.g.
    // zooming the Leaflet map preview on ProjectDetail, which disables its
    // OWN touch handling for the small sidebar widget but doesn't swallow
    // the underlying touch events) rather than a one-finger pull, so don't
    // even start tracking it.
    if (!main || main.scrollTop > 0 || e.touches.length > 1) { touchStartY.current = null; pullingRef.current = false; return }
    touchStartY.current = e.touches[0].clientY
    pullingRef.current = true
  }

  function onTouchMove(e) {
    if (!pullingRef.current || touchStartY.current == null) return
    // A second finger joining mid-gesture turns this into a pinch — bail
    // out rather than keep reading touches[0], which stays free to travel
    // well past PULL_THRESHOLD on a fast two-finger zoom and would
    // otherwise trigger a real page reload mid-gesture (see onTouchStart).
    if (e.touches.length > 1) { pullingRef.current = false; touchStartY.current = null; setPullDistance(0); return }
    const delta = e.touches[0].clientY - touchStartY.current
    if (delta <= 0) { setPullDistance(0); return }
    setPullDistance(Math.min(MAX_PULL, delta * 0.5))
  }

  function onTouchEnd() {
    if (!pullingRef.current) return
    pullingRef.current = false
    touchStartY.current = null
    if (pullDistance >= PULL_THRESHOLD) {
      setRefreshing(true)
      window.location.reload()
    } else {
      setPullDistance(0)
    }
  }

  const showIndicator = pullDistance > 0 || refreshing

  return (
    <div className="flex flex-col h-screen bg-bg">
      <Navbar />
      {showIndicator && (
        <div className="fixed left-0 right-0 z-50 flex justify-center pointer-events-none" style={{ top: 14 }}>
          <div
            className="w-7 h-7 bg-surface border border-border rounded-full shadow-lg flex items-center justify-center"
            style={{
              transform: `translateY(${refreshing ? 0 : pullDistance * 0.4}px)`,
              transition: pullingRef.current ? 'none' : 'transform 0.2s ease-out',
              opacity: refreshing ? 1 : Math.min(1, pullDistance / PULL_THRESHOLD),
            }}
          >
            <div className={`w-4 h-4 border-2 border-accent border-t-transparent rounded-full ${refreshing || pullDistance >= PULL_THRESHOLD ? 'animate-spin' : ''}`} />
          </div>
        </div>
      )}
      <main
        ref={mainRef}
        className={`flex-1 overflow-auto overscroll-y-contain ${fullHeight ? 'flex flex-col' : ''}`}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        style={{
          // 'none' at rest, not translateY(0px) — ANY non-'none' transform
          // on this element (even a zero one) makes it the containing
          // block for every position:fixed descendant inside it, which is
          // how every modal in this app is built. With that permanently
          // on, a modal opened after scrolling main down would anchor to
          // main's scrolled content instead of the actual screen — exactly
          // the "modal opens off at the top, can't see it" bug this fixes.
          transform: pullDistance > 0 ? `translateY(${pullDistance}px)` : 'none',
          transition: pullingRef.current ? 'none' : 'transform 0.2s ease-out',
        }}
      >
        {children}
      </main>
    </div>
  )
}
