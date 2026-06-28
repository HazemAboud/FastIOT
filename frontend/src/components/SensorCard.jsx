import { useState } from 'react'

function getMatchingLabel(val, thresholds) {
  if (val == null || !thresholds || thresholds.length === 0) return null
  const num = typeof val === 'string' ? parseFloat(val) : val
  if (isNaN(num)) return null
  for (const t of thresholds) {
    const minOk = t.min_threshold == null || num >= t.min_threshold
    const maxOk = t.max_threshold == null || num <= t.max_threshold
    if (minOk && maxOk) return t.label
  }
  return null
}

function SensorCard({ device, value, timestamp, thresholds }) {
  const isActuator = device.device_type === 'actuator'
  const displayUnit = device.unit && device.unit !== 'continuous' && device.unit !== 'switch' ? device.unit : ''
  const hasThresholds = thresholds && thresholds.length > 0
  const [showLabel, setShowLabel] = useState(false)

  let displayValue
  const isSwitch = device.unit === 'switch'
  const isOn = value === 'ON' || value === '1' || value === 1

  if (showLabel && hasThresholds) {
    const label = getMatchingLabel(value, thresholds)
    displayValue = label != null ? label : (value != null ? value : '--')
  } else if (isSwitch) {
    displayValue = value != null ? (isOn ? 'ON' : 'OFF') : '--'
  } else {
    displayValue = value != null ? value : '--'
  }

  return (
    <div className="sensor-card">
      <div className="sensor-card-header">
        <span className="sensor-card-name">{device.name}</span>
        {hasThresholds && (
          <span
            className={`threshold-toggle ${showLabel ? 'threshold-toggle-label' : 'threshold-toggle-value'}`}
            onClick={() => setShowLabel(!showLabel)}
            title={showLabel ? 'Show raw value' : 'Show threshold label'}
          >
            {showLabel ? 'Label' : 'Value'}
          </span>
        )}
        <span className={`device-type-badge ${isActuator ? 'device-type-actuator' : 'device-type-sensor'}`}>
          {device.device_type}
        </span>
      </div>
      <div className={`sensor-card-value${isSwitch ? ' sensor-card-actuator' : ''}`}>
        {isSwitch && value != null && !showLabel ? (
          <span className={`actuator-status-badge ${isOn ? 'actuator-on' : 'actuator-off'}`}>
            {displayValue}
          </span>
        ) : (
          <span className={showLabel && hasThresholds ? 'threshold-label-value' : ''}>
            {displayValue}
          </span>
        )}
        {!showLabel && displayUnit && (
          <span className="sensor-card-unit">{displayUnit}</span>
        )}
      </div>
      <div className="sensor-card-footer">
        <span>{timestamp ? new Date(timestamp).toLocaleTimeString() : 'No data'}</span>
      </div>
    </div>
  )
}

export default SensorCard