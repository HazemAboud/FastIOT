import { useState, useEffect, useCallback } from 'react'
import api from '../api'
import { useToast } from '../components/ToastContext'
import ConfirmModal from '../components/ConfirmModal'
import LoadingSpinner from '../components/LoadingSpinner'

function getControlType(possibleValues) {
  if (!possibleValues || possibleValues.length === 0) return 'text'
  if (possibleValues.length === 1 && possibleValues[0] === 'field') return 'text'
  if (possibleValues.length === 2) return 'toggle'
  return 'slider'
}

function ConfigControl({ config, onSave }) {
  const pv = config.possible_values
  const type = getControlType(pv)
  const [localValue, setLocalValue] = useState(config.value)

  useEffect(() => {
    setLocalValue(config.value)
  }, [config.value])

  const commit = useCallback((val) => {
    setLocalValue(val)
    onSave(config, val)
  }, [config, onSave])

  if (type === 'toggle') {
    const [valA, valB] = pv
    const isOn = localValue === valA
    return (
      <div className="toggle-container">
        <span className="toggle-label" data-active={!isOn}>{valB}</span>
        <label className="toggle-switch">
          <input type="checkbox" checked={isOn} onChange={() => commit(isOn ? valB : valA)} />
          <span className="toggle-slider" />
        </label>
        <span className="toggle-label" data-active={isOn}>{valA}</span>
      </div>
    )
  }

  if (type === 'slider') {
    const idx = pv.indexOf(localValue)
    const value = idx >= 0 ? idx : 0
    return (
      <div className="slider-container">
        <input
          type="range" min={0} max={pv.length - 1} value={value}
          onChange={(e) => commit(pv[parseInt(e.target.value, 10)])}
          className="config-slider"
        />
        <div className="slider-labels">
          {pv.map((v) => (
            <span
              key={v}
              className={`slider-label ${v === pv[value] ? 'active' : ''}`}
              onClick={() => commit(v)}
            >{v}</span>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="text-control-row">
      <input
        type="text"
        className="config-input"
        value={localValue}
        onChange={(e) => setLocalValue(e.target.value)}
        onBlur={() => localValue !== config.value && commit(localValue)}
        onKeyDown={(e) => e.key === 'Enter' && commit(localValue)}
      />
      {localValue !== config.value && (
        <button className="btn btn-sm btn-success" onClick={() => commit(localValue)}>Save</button>
      )}
    </div>
  )
}

function Configuration({ user }) {
  const addToast = useToast()
  const [controllers, setControllers] = useState([])
  const [selectedController, setSelectedController] = useState(null)
  const [configs, setConfigs] = useState([])
  const [showAdd, setShowAdd] = useState(false)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState({})
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleteId, setDeleteId] = useState(null)
  const [newConfig, setNewConfig] = useState({
    name: '', read_route: '', update_route: '', method: 'GET', possible_values: '',
  })

  useEffect(() => {
    api.get('/controllers').then((res) => {
      setControllers(res.data)
      setLoading(false)
    }).catch(() => { setLoading(false) })
  }, [])

  useEffect(() => {
    if (!selectedController) return
    api.get(`/configs?controller_id=${selectedController.id}`).then((res) => {
      setConfigs(res.data)
    }).catch(() => {
      addToast('Failed to load configs', 'error')
    })
  }, [selectedController])

  const saveConfig = useCallback(async (config, newValue) => {
    try {
      const res = await api.put(`/configs/${config.id}`, { value: newValue })
      setConfigs((prev) => prev.map((c) => (c.id === config.id ? res.data : c)))
      addToast('Config updated', 'success')
    } catch (err) {
      addToast(err.response?.data?.detail || 'Failed to update config', 'error')
    }
  }, [])

  const refreshConfig = async (configId) => {
    setRefreshing((prev) => ({ ...prev, [configId]: true }))
    try {
      const res = await api.get(`/configs/${configId}/sync`)
      setConfigs((prev) => prev.map((c) => (c.id === configId ? res.data : c)))
      addToast('Config refreshed', 'success')
    } catch (err) {
      addToast(err.response?.data?.detail || 'Failed to refresh config', 'error')
    }
    setRefreshing((prev) => ({ ...prev, [configId]: false }))
  }

  const refreshAll = async () => {
    const ids = configs.map((c) => c.id)
    setRefreshing((prev) => {
      const next = { ...prev }
      ids.forEach((id) => { next[id] = true })
      return next
    })
    let success = 0
    let failed = 0
    await Promise.allSettled(ids.map((id) =>
      api.get(`/configs/${id}/sync`).then((res) => {
        setConfigs((prev) => prev.map((c) => (c.id === id ? res.data : c)))
        success++
      }).catch(() => { failed++ })
    ))
    setRefreshing((prev) => {
      const next = { ...prev }
      ids.forEach((id) => { next[id] = false })
      return next
    })
    addToast(`Refreshed: ${success} ok, ${failed} failed`, failed > 0 ? 'error' : 'success')
  }

  const deleteConfig = async () => {
    if (deleteId === null) return
    try {
      await api.delete(`/configs/${deleteId}`)
      setConfigs(configs.filter((c) => c.id !== deleteId))
      addToast('Config deleted', 'info')
    } catch {
      addToast('Failed to delete config', 'error')
    }
    setDeleteOpen(false)
    setDeleteId(null)
  }

  const addConfig = async (e) => {
    e.preventDefault()
    if (!selectedController) return
    try {
      const body = {
        controller_id: selectedController.id,
        name: newConfig.name,
        read_route: newConfig.read_route,
        update_route: newConfig.update_route,
        method: newConfig.method,
        possible_values: newConfig.possible_values
          ? newConfig.possible_values.split(',').map((s) => s.trim())
          : null,
      }
      const res = await api.post('/configs', body)
      setConfigs([...configs, res.data])
      setNewConfig({ name: '', read_route: '', update_route: '', method: 'GET', possible_values: '' })
      setShowAdd(false)
      addToast('Config created', 'success')
    } catch (err) {
      addToast(err.response?.data?.detail || 'Failed to create config', 'error')
    }
  }

  if (loading) return <LoadingSpinner text="Loading controllers..." />

  if (!selectedController) {
    return (
      <div className="dashboard">
        <div className="page-header">
          <h1>Configuration</h1>
        </div>
        <p className="page-subtitle">Select a controller to configure.</p>
        <div className="controller-grid">
          {controllers.map((c) => (
            <div key={c.id} className="card controller-card" onClick={() => setSelectedController(c)}>
              <h3>{c.name}</h3>
              <p className="card-topic">{c.mqtt_topic}</p>
              {c.description && <p className="card-desc">{c.description}</p>}
            </div>
          ))}
          {controllers.length === 0 && (
            <div className="empty-state"><p>No controllers registered yet.</p></div>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="dashboard">
      <div className="page-header">
        <h1>Configuration</h1>
        <button className="btn btn-secondary" onClick={() => setSelectedController(null)}>Back</button>
      </div>

      <div className="config-header">
        <h2>{selectedController.name}</h2>
        <p className="page-subtitle">{selectedController.mqtt_topic}</p>
      </div>

      <div className="config-toolbar">
        <button className="btn btn-primary" onClick={() => setShowAdd(!showAdd)}>
          {showAdd ? 'Cancel' : 'Add Config'}
        </button>
        <button className="btn btn-secondary" onClick={refreshAll} disabled={configs.length === 0}>
          {Object.values(refreshing).some(Boolean) ? 'Refreshing...' : 'Refresh All'}
        </button>
      </div>

      {showAdd && (
        <div className="modal-overlay" onClick={() => setShowAdd(false)}>
          <div className="modal-content modal-content-wide" onClick={(e) => e.stopPropagation()}>
            <h3 className="modal-title">Add Configuration</h3>
            <form onSubmit={addConfig}>
              <div className="form-group">
                <label>Name</label>
                <input type="text" value={newConfig.name} onChange={(e) => setNewConfig({ ...newConfig, name: e.target.value })} required />
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>Read Route</label>
                  <input type="text" value={newConfig.read_route} onChange={(e) => setNewConfig({ ...newConfig, read_route: e.target.value })} required />
                </div>
                <div className="form-group">
                  <label>Update Route</label>
                  <input type="text" value={newConfig.update_route} onChange={(e) => setNewConfig({ ...newConfig, update_route: e.target.value })} required />
                </div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>Method</label>
                  <select value={newConfig.method} onChange={(e) => setNewConfig({ ...newConfig, method: e.target.value })} className="form-select" style={{ marginBottom: 0 }}>
                    <option value="GET">GET</option>
                    <option value="POST">POST</option>
                    <option value="PUT">PUT</option>
                  </select>
                </div>
                <div className="form-group">
                  <label>Possible Values (comma-separated)</label>
                  <input type="text" value={newConfig.possible_values} onChange={(e) => setNewConfig({ ...newConfig, possible_values: e.target.value })} placeholder="e.g. ON, OFF | use 'field' for free text" />
                </div>
              </div>
              <div className="modal-actions">
                <button type="button" className="btn btn-secondary" onClick={() => setShowAdd(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary">Create Config</button>
              </div>
            </form>
          </div>
        </div>
      )}

      <div className="config-grid">
        {configs.length === 0 ? (
          <div className="empty-state"><p>No configuration entries for this controller.</p></div>
        ) : (
          configs.map((config) => (
            <div key={config.id} className="card config-card">
              <div className="config-card-header">
                <h4 style={{ margin: 0, fontSize: '0.95rem' }}>{config.name}</h4>
                <button className="btn btn-sm btn-danger" onClick={() => { setDeleteId(config.id); setDeleteOpen(true) }}>×</button>
              </div>
              <div className="config-control-area">
                <ConfigControl config={config} onSave={saveConfig} />
              </div>
            </div>
          ))
        )}
      </div>

      <ConfirmModal
        open={deleteOpen}
        title="Delete Config"
        message="Are you sure you want to delete this configuration entry?"
        onConfirm={deleteConfig}
        onCancel={() => { setDeleteOpen(false); setDeleteId(null) }}
      />
    </div>
  )
}

export default Configuration
