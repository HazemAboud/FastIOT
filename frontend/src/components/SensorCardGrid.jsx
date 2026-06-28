function buildRows(items) {
  if (!items || items.length === 0) return []
  const rows = []
  const total = items.length

  if (total <= 3) {
    rows.push({ type: 'multi', items })
    return rows
  }

  rows.push({ type: 'multi', items: items.slice(0, 3) })

  let i = 3
  while (i < total) {
    rows.push({ type: 'full', items: [items[i]] })
    i++
    if (i < total) {
      const n = Math.min(3, total - i)
      rows.push({ type: 'multi', items: items.slice(i, i + n) })
      i += n
    }
  }

  return rows
}

function SensorCardGrid({ children, className = '' }) {
  const items = Array.isArray(children) ? children : [children]
  const rows = buildRows(items)

  return (
    <div className={`sensor-card-grid ${className}`}>
      {rows.map((row, ri) => (
        <div
          key={ri}
          className={`sensor-card-row ${row.type === 'full' ? 'sensor-card-row-full' : ''}`}
        >
          {row.items.map((child, ci) => (
            <div key={ci} className="sensor-card-cell">
              {child}
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}

export default SensorCardGrid
