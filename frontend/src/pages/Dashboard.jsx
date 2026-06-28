import { useState, useEffect, useRef, useCallback } from 'react'
import api from '../api'
import { useToast } from '../components/ToastContext'
import SensorCard from '../components/SensorCard'
import SensorCardGrid from '../components/SensorCardGrid'
import RealtimeChart from '../components/RealtimeChart'
import HistoricalStatsCard from '../components/HistoricalStatsCard'
import HistoricalChart from '../components/HistoricalChart'
import ConfirmModal from '../components/ConfirmModal'
import LoadingSpinner from '../components/LoadingSpinner'

const TABS = [
  { key: 'realtime', label: 'Real-Time Data' },
  { key: 'historical', label: 'Historical' },
  { key: 'actuators', label: 'Actuators' },
  { key: 'health', label: 'Health' },
  { key: 'insights', label: 'Insights' },
]

const STORAGE_KEY = 'selectedControllerId'

function ActuatorContinuousControl({ device, onCommand }) {
  const [val, setVal] = useState('')
  return (
    <div className="actuator-continuous">
      <input
        type="number"
        value={val}
        onChange={(e) => setVal(e.target.value)}
        className="config-input"
        style={{ width: 80 }}
      />
      <button className="btn btn-sm btn-primary" onClick={() => onCommand(device, val)} disabled={val === ''}>
        Send
      </button>
    </div>
  )
}

function Dashboard({ user }) {
  const addToast = useToast()
  const [controllers, setControllers] = useState([])
  const [selectedControllerId, setSelectedControllerId] = useState(() => localStorage.getItem(STORAGE_KEY) || '')
  const [devices, setDevices] = useState([])
  const [deviceData, setDeviceData] = useState({})
  const [realtimeHistory, setRealtimeHistory] = useState({})
  const [historicalData, setHistoricalData] = useState({})
  const [healthData, setHealthData] = useState([])
  const [healthLoading, setHealthLoading] = useState(false)
  const [healthError, setHealthError] = useState(null)
  const [thresholdsMap, setThresholdsMap] = useState({})

  const [activeTab, setActiveTab] = useState('realtime')
  const [loading, setLoading] = useState(true)
  const [subscribing, setSubscribing] = useState(false)
  const [historicalLimit, setHistoricalLimit] = useState({})
  const wsRef = useRef(null)
  const healthInterval = useRef(null)

  useEffect(() => {
    api.get('/controllers').then((res) => {
      setControllers(res.data)
      setLoading(false)
    }).catch(() => { setLoading(false) })
  }, [])

  // Auto-subscribe on mount if coming from localStorage
  useEffect(() => {
    if (selectedControllerId && controllers.length > 0) {
      const ctrl = controllers.find((c) => String(c.id) === String(selectedControllerId))
      if (ctrl) {
        subscribeToController(parseInt(selectedControllerId, 10))
      }
    }
  }, [controllers])

  const handleWsMessage = useCallback((event) => {
    try {
      const data = JSON.parse(event.data)
      if (data.type === 'device_data') {
        if (data.device_type !== 'actuator') {
          setDeviceData((prev) => ({
            ...prev,
            [data.device_id]: { value: data.value, timestamp: data.timestamp, device_name: data.device_name },
          }))
        }
        setRealtimeHistory((prev) => {
          const current = prev[data.device_id] || []
          const updated = [...current, { time: data.timestamp, value: data.value }]
          return { ...prev, [data.device_id]: updated.slice(-80) }
        })
        setHealthData((prev) =>
          prev.map((h) =>
            h.device_id === data.device_id
              ? { ...h, last_value: typeof data.value === 'number' ? data.value : h.last_value, last_value_str: typeof data.value === 'string' ? data.value : h.last_value_str, last_timestamp: data.timestamp, status: 'healthy' }
              : h
          )
        )
      }
    } catch {}
  }, [])

  useEffect(() => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const host = window.location.host
    const ws = new WebSocket(`${protocol}//${host}/api/ws`)
    ws.onmessage = handleWsMessage
    ws.onerror = () => {}
    ws.onclose = () => {}
    wsRef.current = ws
    return () => ws.close()
  }, [handleWsMessage])

  const subscribeToController = async (id) => {
    setSubscribing(true)
    try {
      await api.post(`/mqtt/subscribe/${id}`)
      const res = await api.get('/devices')
      const filtered = res.data.filter((d) => d.controller_id === id)
      setDevices(filtered)
      filtered.forEach((d) => {
        api.get(`/thresholds?device_id=${d.id}`).then((tres) => {
          if (tres.data.length > 0) {
            setThresholdsMap((prev) => ({ ...prev, [d.id]: tres.data }))
          }
        }).catch(() => {})
      })
      addToast('Subscribed to controller', 'success')
    } catch (err) {
      addToast(err.response?.data?.detail || 'Failed to subscribe', 'error')
    }
    setSubscribing(false)
  }

  const handleControllerChange = async (e) => {
    const ctrlId = e.target.value
    setSelectedControllerId(ctrlId)
    setDeviceData({})
    setRealtimeHistory({})
    setHistoricalData({})
    setHistoricalLimit({})
    setHealthData([])
    setHealthError(null)
    setThresholdsMap({})

    if (ctrlId) {
      localStorage.setItem(STORAGE_KEY, ctrlId)
      await subscribeToController(parseInt(ctrlId, 10))
    } else {
      localStorage.removeItem(STORAGE_KEY)
      setDevices([])
    }
  }

  // Load initial data
  useEffect(() => {
    if (!selectedControllerId) return
    const id = parseInt(selectedControllerId, 10)
    if (devices.length === 0) return

    const limit = activeTab === 'historical' ? 1000 : 20
    devices.forEach((d) => {
      api.get(`/devices/${d.id}/data?limit=${limit}`).then((res) => {
        setHistoricalData((prev) => ({ ...prev, [d.id]: res.data }))
      }).catch(() => {})
    })
    return () => {
      if (healthInterval.current) clearInterval(healthInterval.current)
    }
  }, [selectedControllerId, devices, activeTab])

  // Fetch health data when health tab is active
  useEffect(() => {
    if (!selectedControllerId || devices.length === 0) return
    const id = parseInt(selectedControllerId, 10)

    const fetchHealth = () => {
      setHealthLoading(true)
      setHealthError(null)
      api.get(`/devices/health?controller_id=${id}`).then((res) => {
        setHealthData(res.data)
        setHealthLoading(false)
      }).catch((err) => {
        setHealthError(err.response?.data?.detail || 'Failed to load health data')
        setHealthLoading(false)
      })
    }

    if (activeTab === 'health') {
      fetchHealth()
      healthInterval.current = setInterval(fetchHealth, 10000)
    }

    return () => {
      if (healthInterval.current) clearInterval(healthInterval.current)
    }
  }, [selectedControllerId, devices, activeTab])

  // Read retained MQTT value every time the actuators tab is shown
  useEffect(() => {
    if (activeTab !== 'actuators' || devices.length === 0) return
    devices.filter(d => d.device_type === 'actuator').forEach((d) => {
      api.get(`/mqtt/retained/${d.id}`).then((res) => {
        if (res.data.value != null) {
          setDeviceData((prev) => ({
            ...prev,
            [d.id]: { value: res.data.value, timestamp: new Date().toISOString(), device_name: d.name },
          }))
        }
      }).catch(() => {})
    })
  }, [activeTab, devices])

  const handleActuatorCommand = async (device, command) => {
    try {
      await api.post('/mqtt/publish', { device_id: device.id, value: command })
      const retained = await api.get(`/mqtt/retained/${device.id}`)
      if (retained.data.value != null) {
        setDeviceData((prev) => ({
          ...prev,
          [device.id]: { value: retained.data.value, timestamp: new Date().toISOString(), device_name: device.name },
        }))
      }
    } catch (err) {
      addToast(err.response?.data?.detail || 'Failed to send command', 'error')
    }
  }

  const handleUnsubscribe = async () => {
    if (!selectedControllerId) return
    try {
      await api.post(`/mqtt/unsubscribe/${parseInt(selectedControllerId, 10)}`)
      setSelectedControllerId('')
      localStorage.removeItem(STORAGE_KEY)
      setDevices([])
      setDeviceData({})
      setRealtimeHistory({})
      setHealthData([])
      setHistoricalData({})
      addToast('Unsubscribed', 'info')
    } catch {
      addToast('Failed to unsubscribe', 'error')
    }
  }

  const handleLoadMore = async (deviceId) => {
    const current = historicalLimit[deviceId] || 1000
    try {
      const res = await api.get(`/devices/${deviceId}/data?limit=1000&offset=${current}`)
      if (res.data.length > 0) {
        setHistoricalData((prev) => ({
          ...prev,
          [deviceId]: [...(prev[deviceId] || []), ...res.data],
        }))
        setHistoricalLimit((prev) => ({ ...prev, [deviceId]: current + res.data.length }))
      } else {
        addToast('No more data', 'info')
      }
    } catch {
      addToast('Failed to load more data', 'error')
    }
  }

  const renderRealtimeActuatorActions = (device) => {
    if (device.device_type !== 'actuator') return null
    if (device.unit === 'continuous') {
      return <ActuatorContinuousControl device={device} onCommand={handleActuatorCommand} />
    }
    return (
      <div className="actuator-controls">
        <button className="btn btn-sm btn-success" onClick={() => handleActuatorCommand(device, 'ON')}>ON</button>
        <button className="btn btn-sm btn-danger" onClick={() => handleActuatorCommand(device, 'OFF')}>OFF</button>
      </div>
    )
  }

  const renderRealtime = () => (
    <div className="tab-pane">
      <h3>Real-Time Data</h3>
      {devices.length === 0 ? (
        <p>{subscribing ? 'Subscribing...' : 'No devices registered for this controller.'}</p>
      ) : (
        <>
          <SensorCardGrid>
            {devices.filter(d => d.device_type === 'sensor').map((d) => (
              <div key={d.id} className="sensor-card-wrapper">
                <SensorCard
                  device={d}
                  value={deviceData[d.id]?.value}
                  timestamp={deviceData[d.id]?.timestamp}
                  thresholds={thresholdsMap[d.id]}
                />
              </div>
            ))}
          </SensorCardGrid>
          {devices.filter(d => d.device_type === 'sensor').length > 0 && (
            <div className="sensor-charts">
              {devices.filter(d => d.device_type === 'sensor').map((d) => (
                <RealtimeChart key={d.id} device={d} data={realtimeHistory[d.id] || []} />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )

  const renderActuators = () => {
    const actuatorDevices = devices.filter(d => d.device_type === 'actuator')
    return (
      <div className="tab-pane">
        <h3>Actuator Controls</h3>
        {actuatorDevices.length === 0 ? (
          <p>No actuators registered for this controller.</p>
        ) : (
          <div className="actuator-grid">
            {actuatorDevices.map((d) => {
              const val = deviceData[d.id]?.value
              const isSwitch = d.unit === 'switch'
              const isOn = val === 'ON' || val === '1' || val === 1
              return (
                <div key={d.id} className="actuator-card">
                  <div className="actuator-card-name">{d.name}</div>
                  <div className="actuator-card-value">
                    {val != null ? (
                      <span className={`actuator-status-badge ${isOn ? 'actuator-on' : 'actuator-off'}`}>
                        {isSwitch ? (isOn ? 'ON' : 'OFF') : val}
                      </span>
                    ) : (
                      '--'
                    )}
                  </div>
                  {renderRealtimeActuatorActions(d)}
                </div>
              )
            })}
          </div>
        )}
      </div>
    )
  }

  const renderHistorical = () => (
    <div className="tab-pane">
      <h3>Historical Data</h3>
      {devices.length === 0 ? (
        <p>No devices registered for this controller.</p>
      ) : (
        devices.filter(d => d.device_type === 'sensor').map((d) => {
          const data = historicalData[d.id] || []
          const values = data.map(r => r.value).filter(v => v != null)
          const count = values.length
          const avg = count > 0 ? values.reduce((a, b) => a + b, 0) / count : null
          const std = count > 1
            ? Math.sqrt(values.reduce((sum, v) => sum + (v - avg) * (v - avg), 0) / count)
            : null
          const chartData = [...data].reverse().map(r => ({ timestamp: r.timestamp, value: r.value }))
          return (
            <div key={d.id} className="sensor-group">
              <SensorCardGrid>
                <HistoricalStatsCard device={d} average={avg} stdDeviation={std} count={count} />
              </SensorCardGrid>
              <div className="historical-charts-row">
                {chartData.length > 0 && <HistoricalChart device={d} data={chartData} />}
              </div>
              {data.length > 0 && (
                <button className="btn btn-sm btn-secondary" onClick={() => handleLoadMore(d.id)} style={{ marginTop: '0.5rem' }}>
                  Load more
                </button>
              )}
            </div>
          )
        })
      )}
    </div>
  )

  const [insightPrompt, setInsightPrompt] = useState('')
  const [insightStatus, setInsightStatus] = useState(null)
  const [insightRecommendations, setInsightRecommendations] = useState([])
  const [insightAnswer, setInsightAnswer] = useState(null)
  const [insightLoading, setInsightLoading] = useState(false)

  const insightStatusColors = {
    Normal: { bg: '#d4edda', color: '#155724', label: 'Normal' },
    Caution: { bg: '#fff3cd', color: '#856404', label: 'Caution' },
    Danger: { bg: '#f8d7da', color: '#721c24', label: 'Danger' },
    Critical: { bg: '#dc3545', color: '#fff', label: 'Critical' },
  }

  const renderInsights = () => (
    <div className="tab-pane">
      <h3>AI Insights</h3>
      <p>Analyzes the latest 30 readings from your sensors to assess room conditions.</p>
      <div className="insights-input-row" style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem' }}>
        <textarea
          className="form-input"
          value={insightPrompt}
          onChange={(e) => setInsightPrompt(e.target.value)}
          placeholder=""
          rows={2}
          style={{ flex: 1, resize: 'vertical' }}
        />
        <button
          className="btn btn-primary"
          onClick={async () => {
            setInsightLoading(true)
            setInsightStatus(null)
            setInsightRecommendations([])
            setInsightAnswer(null)
            try {
              const res = await api.post('/ai/insight', {
                prompt: insightPrompt,
                device_context: null,
              })
              setInsightStatus(res.data.status)
              const recs = res.data.recommendations
              setInsightRecommendations(Array.isArray(recs) ? recs : (recs ? [recs] : []))
              setInsightAnswer(res.data.answer || null)
            } catch (err) {
              setInsightStatus('Caution')
              setInsightRecommendations(['Error: ' + (err.response?.data?.detail || 'Failed to get AI insight')])
            }
            setInsightLoading(false)
          }}
          disabled={insightLoading}
          style={{ alignSelf: 'stretch', minWidth: 100 }}
        >
          {insightLoading ? 'Analyzing...' : 'Analyze'}
        </button>
      </div>
      {insightStatus && (
        <div className="insight-result">
          <div className="insight-status-banner" style={{
            background: (insightStatusColors[insightStatus] || insightStatusColors.Caution).bg,
            color: (insightStatusColors[insightStatus] || insightStatusColors.Caution).color,
            padding: '1rem',
            borderRadius: 8,
            fontSize: '1.25rem',
            fontWeight: 700,
            textAlign: 'center',
            marginBottom: '1rem',
            border: `2px solid ${(insightStatusColors[insightStatus] || insightStatusColors.Caution).color}`,
          }}>
            System Status: {insightStatus}
          </div>
          {insightRecommendations.length > 0 && (
            <div style={{
              background: 'var(--surface-color)',
              border: '1px solid var(--border-color)',
              borderRadius: 8,
              padding: '1rem',
              marginBottom: insightAnswer ? '1rem' : 0,
            }}>
              <h4 style={{ marginTop: 0, marginBottom: '0.75rem' }}>Recommendations</h4>
              <ul style={{ margin: 0, paddingLeft: '1.25rem', lineHeight: 1.8 }}>
                {insightRecommendations.map((rec, i) => (
                  <li key={i}>{rec}</li>
                ))}
              </ul>
            </div>
          )}
          {insightPrompt && insightAnswer && (
            <div style={{
              background: 'var(--surface-color)',
              border: '1px solid var(--border-color)',
              borderRadius: 8,
              padding: '1rem',
            }}>
              <h4 style={{ marginTop: 0, marginBottom: '0.75rem' }}>Answer</h4>
              <div style={{ margin: 0, lineHeight: 1.7, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{insightAnswer}</div>
            </div>
          )}
        </div>
      )}
    </div>
  )

  if (loading) return <LoadingSpinner text="Loading controllers..." />

  return (
    <div className="dashboard">
      <div className="page-header">
        <h1>Welcome, {user.username}</h1>
      </div>

      <div className="controller-select-row">
        <div className="form-group" style={{ flex: 1, marginBottom: 0 }}>
          <label>Select Controller</label>
          <select value={selectedControllerId} onChange={handleControllerChange} className="form-select" style={{ marginBottom: 0 }}>
            <option value="">-- Choose a controller --</option>
            {controllers.map((c) => (
              <option key={c.id} value={c.id}>{c.name} ({c.mqtt_topic})</option>
            ))}
          </select>
        </div>
        {selectedControllerId && (
          <div className="controller-actions" style={{ display: 'flex', gap: '0.5rem', marginTop: 24 }}>
            <button className="btn btn-secondary" onClick={handleUnsubscribe} style={{ height: 42 }}>
              Unsubscribe
            </button>
          </div>
        )}
      </div>

      {selectedControllerId && (
        <>
          <div className="tabs">
            {TABS.map((tab) => (
              <button
                key={tab.key}
                className={`tab ${activeTab === tab.key ? 'active' : ''}`}
                onClick={() => setActiveTab(tab.key)}
              >
                {tab.key === 'insights' && (
                  <svg className="tab-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: 16, height: 16, marginRight: 4, verticalAlign: 'middle' }}>
                    <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
                  </svg>
                )}
                {tab.label}
              </button>
            ))}
          </div>

          <div className="tab-content">
            {activeTab === 'realtime' && renderRealtime()}
            {activeTab === 'historical' && renderHistorical()}
            {activeTab === 'actuators' && renderActuators()}
            {activeTab === 'insights' && renderInsights()}
            {activeTab === 'health' && (
              <div className="tab-pane">
                <div className="tab-pane-header">
                  <h3>Device Health</h3>
                  <button className="btn btn-sm btn-secondary" onClick={() => {
                    const id = parseInt(selectedControllerId, 10)
                    setHealthLoading(true)
                    setHealthError(null)
                    api.get(`/devices/health?controller_id=${id}`).then((res) => {
                      setHealthData(res.data)
                      setHealthLoading(false)
                    }).catch((err) => {
                      setHealthError(err.response?.data?.detail || 'Failed to load health data')
                      setHealthLoading(false)
                    })
                  }}>Refresh Now</button>
                </div>
                {healthLoading ? (
                  <p>Loading health data...</p>
                ) : healthError ? (
                  <p className="error-message">{healthError}</p>
                ) : healthData.length === 0 ? (
                  <p>No devices registered for this controller.</p>
                ) : (
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Device</th>
                        <th>Type</th>
                        <th>Status</th>
                        <th>Last Value</th>
                        <th>Last Reading</th>
                      </tr>
                    </thead>
                    <tbody>
                      {healthData.map((h) => (
                        <tr key={h.device_id}>
                          <td>{h.device_name} {h.unit && h.unit !== 'continuous' && h.unit !== 'switch' ? `(${h.unit})` : ''}</td>
                          <td>{h.device_type}</td>
                          <td>
                            <span className={`health-dot health-${h.status}`} />
                            {h.status === 'healthy' ? 'Healthy' : h.status === 'warning' ? 'Warning' : h.status === 'critical' ? 'Critical' : 'No Data'}
                          </td>
                          <td>{h.last_value_str || (h.last_value != null ? h.last_value : '--')}</td>
                          <td>{h.last_timestamp ? new Date(h.last_timestamp).toLocaleString() : '--'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            )}
          </div>
        </>
      )}

    </div>
  )
}

export default Dashboard
