/** Shown at once when the page is opened from the nav, while its first read runs. */
import './mor.css'

export default function Loading() {
  return (
    <div className="mor">
      <div className="mor-kicker">Magnifier Offline Reports</div>
      <div className="mor-opening" role="status">
        <span className="mor-spin on" aria-hidden /> Loading…
      </div>
    </div>
  )
}
