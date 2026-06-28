function HistoricalStatsCard({ device, average, stdDeviation, count }) {
  const displayUnit = device.unit && device.unit !== 'continuous' && device.unit !== 'switch' ? device.unit : ''
  return (
    <div className="historical-stats-card">
      <div className="sensor-card-header">
        <span className="sensor-card-name">{device.name}</span>
        <span className="device-type-badge device-type-sensor">Stats</span>
      </div>
      <div className="stats-grid">
        <div className="stat-item">
          <span className="stat-label">Average</span>
          <span className="stat-value">
            {average != null ? Number(average).toFixed(2) : '--'}
            {displayUnit && <span className="sensor-card-unit">{displayUnit}</span>}
          </span>
        </div>
        <div className="stat-item">
          <span className="stat-label">Std Dev</span>
          <span className="stat-value">
            {stdDeviation != null ? Number(stdDeviation).toFixed(2) : '--'}
            {displayUnit && <span className="sensor-card-unit">{displayUnit}</span>}
          </span>
        </div>
        <div className="stat-item">
          <span className="stat-label">Samples</span>
          <span className="stat-value">{count != null ? count : '--'}</span>
        </div>
      </div>
    </div>
  )
}

export default HistoricalStatsCard
