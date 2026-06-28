import { useState, useEffect, useRef } from 'react'
import api from '../api'
import { useToast } from '../components/ToastContext'
import ConfirmModal from '../components/ConfirmModal'
import LoadingSpinner from '../components/LoadingSpinner'

function formatRange(t) {
  if (t.min_threshold != null && t.max_threshold != null)
    return `if ${t.min_threshold} to ${t.max_threshold}`
  if (t.min_threshold != null) return `if more than ${t.min_threshold}`
  if (t.max_threshold != null) return `if less than ${t.max_threshold}`
  return ''
}

function Threshold() {
  const addToast = useToast()
  const [controllers, setControllers] = useState([])
  const [selectedController, setSelectedController] = useState(null)
  const [devices, setDevices] = useState([])
  const [selectedDevice, setSelectedDevice] = useState(null)
  const [thresholds, setThresholds] = useState([])
  const [loading, setLoading] = useState(true)
  const [fetching, setFetching] = useState(false)
  const [pushLoading, setPushLoading] = useState(false)
  const [fetchError, setFetchError] = useState(null)
  const [showModal, setShowModal] = useState(false)
  const [editId, setEditId] = useState(null)
  const [deleteId, setDeleteId] = useState(null)

  const [label, setLabel] = useState('')
  const [minVal, setMinVal] = useState('')
  const [maxVal, setMaxVal] = useState('')
  const [routeUrl, setRouteUrl] = useState('')
  const [routeMethod, setRouteMethod] = useState('PUT')
  const routeTimer = useRef(null)

  useEffect(() => {
    api.get('/controllers').then((res) => {
      setControllers(res.data)
      setLoading(false)
    }).catch(() => { setLoading(false) })
  }, [])

  useEffect(() => {
    if (!selectedController) return
    api.get(`/devices?controller_id=${selectedController.id}`).then((res) => {
      setDevices(res.data)
    }).catch(() => addToast('Failed to load devices', 'error'))
  }, [selectedController])

  const doSync = async (deviceId, route) => {
    if (!route) {
      setFetchError('No ESP route configured. Enter the route URL above.')
      return
    }
    setFetching(true)
    setFetchError(null)
    try {
      const res = await api.post(`/thresholds/sync?device_id=${deviceId}`)
      setThresholds(res.data)
      addToast('Thresholds synced from ESP', 'success')
    } catch (err) {
      const msg = err.response?.data?.detail || 'Sync failed — check the route URL and ESP connection'
      setFetchError(msg)
      addToast(msg, 'error')
      const res = await api.get(`/thresholds?device_id=${deviceId}`)
      setThresholds(res.data)
    }
    setFetching(false)
  }

  useEffect(() => {
    if (!selectedDevice) return
    setRouteUrl(selectedDevice.threshold_read_route || '')
    setRouteMethod(selectedDevice.threshold_method || 'PUT')
    setThresholds([])
    setFetchError(null)
    if (selectedDevice.threshold_read_route) {
      doSync(selectedDevice.id, selectedDevice.threshold_read_route)
    }
  }, [selectedDevice])

  const saveRoute = async (url, method) => {
    if (!selectedDevice) return
    try {
      const body = { threshold_read_route: url, threshold_update_route: url, threshold_method: method }
      await api.put(`/devices/${selectedDevice.id}`, body)
      if (url.length > 0) doSync(selectedDevice.id, url)
    } catch (err) {
      addToast(err.response?.data?.detail || 'Failed to save route', 'error')
    }
  }

  const handleRouteChange = (url) => {
    setRouteUrl(url)
    if (routeTimer.current) clearTimeout(routeTimer.current)
    routeTimer.current = setTimeout(() => saveRoute(url, routeMethod), 800)
  }

  const handleMethodChange = (method) => {
    setRouteMethod(method)
    if (routeTimer.current) clearTimeout(routeTimer.current)
    routeTimer.current = setTimeout(() => saveRoute(routeUrl, method), 800)
  }

  const pushToEsp = async () => {
    if (!selectedDevice) return
    setPushLoading(true)
    try {
      await api.post(`/thresholds/push?device_id=${selectedDevice.id}`)
      addToast('Thresholds pushed to ESP', 'success')
    } catch (err) {
      addToast(err.response?.data?.detail || 'Push failed', 'error')
    }
    setPushLoading(false)
  }

  const saveThreshold = async (e) => {
    e.preventDefault()
    if (!selectedDevice) return
    try {
      const body = {
        device_id: selectedDevice.id,
        label,
        min_threshold: minVal !== '' ? parseFloat(minVal) : null,
        max_threshold: maxVal !== '' ? parseFloat(maxVal) : null,
      }
      const res = await api.put(`/thresholds/${editId}`, body)
      setThresholds(thresholds.map((t) => (t.id === editId ? res.data : t)))
      addToast('Threshold updated', 'success')
      closeModal()
    } catch (err) {
      addToast(err.response?.data?.detail || 'Failed to save threshold', 'error')
    }
  }

  const startEdit = (t) => {
    setLabel(t.label)
    setMinVal(t.min_threshold != null ? String(t.min_threshold) : '')
    setMaxVal(t.max_threshold != null ? String(t.max_threshold) : '')
    setEditId(t.id)
    setShowModal(true)
  }

  const closeModal = () => {
    setLabel('')
    setMinVal('')
    setMaxVal('')
    setShowModal(false)
    setEditId(null)
  }

  const confirmDelete = async () => {
    if (deleteId === null) return
    try {
      await api.delete(`/thresholds/${deleteId}`)
      setThresholds(thresholds.filter((t) => t.id !== deleteId))
      addToast('Threshold deleted', 'info')
    } catch { addToast('Failed to delete threshold', 'error') }
    setDeleteId(null)
  }

  if (loading) return <LoadingSpinner text="Loading controllers..." />

  if (!selectedController) {
    return (
      <div className="dashboard">
        <div className="page-header"><h1>Threshold</h1></div>
        <p className="page-subtitle">Select a controller.</p>
        <div className="controller-grid">
          {controllers.map((c) => (
            <div key={c.id} className="card controller-card" onClick={() => setSelectedController(c)}>
              <h3>{c.name}</h3>
              <p className="card-topic">{c.mqtt_topic}</p>
            </div>
          ))}
        </div>
      </div>
    )
  }

  if (!selectedDevice) {
    return (
      <div className="dashboard">
        <div className="page-header">
          <button className="btn btn-secondary" onClick={() => setSelectedController(null)}>&larr; Back</button>
          <h1>{selectedController.name} — Threshold</h1>
        </div>
        <p className="page-subtitle">Select a sensor device.</p>
        <div className="controller-grid">
          {devices.filter((d) => d.device_type === 'sensor').map((d) => (
            <div key={d.id} className="card controller-card" onClick={() => setSelectedDevice(d)}>
              <h3>{d.name}</h3>
              <p className="card-topic">{d.unit || d.device_type}</p>
            </div>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="dashboard">
      <div className="page-header">
        <button className="btn btn-secondary" onClick={() => setSelectedDevice(null)}>&larr; Back</button>
        <h1>{selectedDevice.name}</h1>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: '0.5rem' }}>
          <button className="btn btn-sm btn-primary" onClick={pushToEsp} disabled={pushLoading}>
            {pushLoading ? 'Pushing...' : 'Push to ESP'}
          </button>
        </div>
      </div>

      <div className="esp-sync-row" style={{ marginBottom: '0.75rem' }}>
        <input type="text" className="form-input" value={routeUrl}
          onChange={(e) => handleRouteChange(e.target.value)}
          placeholder="http://10.186.208.79/api/threshold/temperature" />
        <select className="form-select route-method" value={routeMethod}
          onChange={(e) => handleMethodChange(e.target.value)}>
          <option value="GET">GET</option>
          <option value="POST">POST</option>
          <option value="PUT">PUT</option>
        </select>
        <button className="btn btn-sm btn-outline" onClick={() => doSync(selectedDevice.id, routeUrl)} disabled={fetching}>
          {fetching ? 'Fetching...' : 'Fetch from ESP'}
        </button>
      </div>

      {fetchError && (
        <div className="alert alert-error" style={{ marginBottom: '0.75rem', padding: '0.5rem 0.75rem', fontSize: '0.8rem' }}>
          {fetchError}
        </div>
      )}

      <div className="threshold-list">
        {fetching && thresholds.length === 0 ? (
          <div className="card" style={{ padding: '2rem', textAlign: 'center' }}>
            <p className="page-subtitle" style={{ marginBottom: 0 }}>Fetching thresholds from ESP...</p>
          </div>
        ) : thresholds.length === 0 ? (
          <div className="card" style={{ padding: '2rem', textAlign: 'center' }}>
            <p className="page-subtitle" style={{ marginBottom: 0 }}>
              No thresholds. Enter the ESP route URL above and click Fetch.
            </p>
          </div>
        ) : (
          thresholds.map((t) => (
            <div key={t.id} className="threshold-item">
              <div className="threshold-item-label">{t.label}</div>
              <div className="threshold-item-condition">{formatRange(t)}</div>
              <div className="threshold-item-actions">
                <span className="threshold-action-link" onClick={() => startEdit(t)}>Edit</span>
                <span className="threshold-action-link threshold-action-danger" onClick={() => setDeleteId(t.id)}>Delete</span>
              </div>
            </div>
          ))
        )}
      </div>

      {showModal && (
        <div className="modal-overlay" onClick={closeModal}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 400 }}>
            <h3 className="modal-title">Edit Threshold</h3>
            <form onSubmit={saveThreshold}>
              <div className="form-group">
                <label>Label</label>
                <input type="text" className="form-input" value={label} required
                  onChange={(e) => setLabel(e.target.value)} />
              </div>
              <div className="form-row">
                <div className="form-group" style={{ flex: 1 }}>
                  <label>Min</label>
                  <input type="number" className="form-input" value={minVal} step="any"
                    onChange={(e) => setMinVal(e.target.value)} />
                </div>
                <div className="form-group" style={{ flex: 1 }}>
                  <label>Max</label>
                  <input type="number" className="form-input" value={maxVal} step="any"
                    onChange={(e) => setMaxVal(e.target.value)} />
                </div>
              </div>
              <div className="modal-actions" style={{ marginTop: '0.75rem' }}>
                <button type="button" className="btn btn-secondary" onClick={closeModal}>Cancel</button>
                <button type="submit" className="btn btn-primary">Update</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {deleteId !== null && (
        <ConfirmModal
          message="Delete this threshold?"
          onConfirm={confirmDelete}
          onCancel={() => setDeleteId(null)}
        />
      )}
    </div>
  )
}

export default Threshold