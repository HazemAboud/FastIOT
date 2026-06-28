import { useState, useEffect } from 'react'
import api from '../api'
import { useToast } from '../components/ToastContext'
import ConfirmModal from '../components/ConfirmModal'
import LoadingSpinner from '../components/LoadingSpinner'

function DeviceRow({ device, onEdit, onDelete }) {
  return (
    <tr>
      <td>{device.name}</td>
      <td><span className={`device-type-badge device-type-${device.device_type}`}>{device.device_type}</span></td>
      <td>{device.unit || '—'}</td>
      <td>
        <button className="btn btn-sm btn-secondary" onClick={() => onEdit(device)}>Edit</button>
        <button className="btn btn-sm btn-danger" style={{ marginLeft: 4 }} onClick={() => onDelete(device.id)}>×</button>
      </td>
    </tr>
  )
}

function ControllerCard({ controller, devices, onEdit, onDelete, onDeviceEdit, onDeviceDelete, onOpenAddDevice, onRefresh }) {
  const [expanded, setExpanded] = useState(false)
  const [uploading, setUploading] = useState(false)
  const addToast = useToast()

  const controllerDevices = devices.filter((d) => d.controller_id === controller.id)

  const handleImageUpload = async (e) => {
    const file = e.target.files[0]
    if (!file) return
    setUploading(true)
    try {
      const formData = new FormData()
      formData.append('file', file)
      await api.post(`/controllers/${controller.id}/image`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      onRefresh()
      addToast('Image uploaded', 'success')
    } catch (err) {
      addToast(err.response?.data?.detail || 'Failed to upload image', 'error')
    }
    setUploading(false)
  }

  return (
    <div className={`controller-card ${expanded ? 'expanded' : ''}`}>
      <div className="controller-card-image-wrap" onClick={() => setExpanded(!expanded)}>
        {controller.image ? (
          <img src={controller.image} alt={controller.name} className="controller-card-img" />
        ) : (
          <div className="controller-card-img-placeholder">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="40" height="40">
              <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
              <circle cx="8.5" cy="8.5" r="1.5" />
              <polyline points="21 15 16 10 5 21" />
            </svg>
          </div>
        )}
        <label className="controller-card-img-upload" onClick={(e) => e.stopPropagation()}>
          <input type="file" accept="image/*" onChange={handleImageUpload} style={{ display: 'none' }} />
          <span className="camera-icon" title={controller.image ? 'Change image' : 'Upload image'}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
              <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
              <circle cx="12" cy="13" r="4" />
            </svg>
          </span>
        </label>
        {uploading && <div className="controller-card-img-loading" />}
      </div>
      <div className="controller-card-header" onClick={() => setExpanded(!expanded)}>
        <div className="controller-card-info">
          <span className="controller-card-name">{controller.name}</span>
          <span className="controller-card-topic"><code>{controller.mqtt_topic}</code></span>
          {controller.description && <span className="controller-card-desc">{controller.description}</span>}
        </div>
        <div className="controller-card-chevron">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="18" height="18" style={{ transform: expanded ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }}>
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </div>
      </div>
      <div className="controller-card-actions" onClick={(e) => e.stopPropagation()}>
        <button className="btn btn-sm btn-secondary" onClick={() => onEdit(controller)}>Edit</button>
        <button className="btn btn-sm btn-danger" onClick={() => onDelete(controller.id)}>×</button>
      </div>

      {expanded && (
        <div className="controller-card-body">
          <div className="controller-card-body-header">
            <h3>Devices ({controllerDevices.length})</h3>
            <button className="btn btn-sm btn-primary" onClick={() => onOpenAddDevice(controller.id)}>
              Add Device
            </button>
          </div>

          {controllerDevices.length === 0 ? (
            <p className="text-muted" style={{ marginTop: '0.75rem' }}>No devices registered for this controller.</p>
          ) : (
            <table className="data-table" style={{ marginTop: '0.75rem' }}>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Type</th>
                  <th>Unit</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {controllerDevices.map((d) => (
                  <DeviceRow
                    key={d.id}
                    device={d}
                    onEdit={onDeviceEdit}
                    onDelete={(id) => onDeviceDelete(id)}
                  />
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  )
}

function Devices({ user }) {
  const addToast = useToast()
  const [controllers, setControllers] = useState([])
  const [devices, setDevices] = useState([])
  const [loading, setLoading] = useState(true)

  const [showAddController, setShowAddController] = useState(false)
  const [showEditController, setShowEditController] = useState(false)
  const [editControllerData, setEditControllerData] = useState(null)
  const [newController, setNewController] = useState({ name: '', mqtt_topic: '', description: '' })
  const [newControllerFile, setNewControllerFile] = useState(null)
  const [editControllerFile, setEditControllerFile] = useState(null)

  const [deleteCtrlOpen, setDeleteCtrlOpen] = useState(false)
  const [deleteCtrlId, setDeleteCtrlId] = useState(null)
  const [deleteDeviceOpen, setDeleteDeviceOpen] = useState(false)
  const [deleteDeviceId, setDeleteDeviceId] = useState(null)

  const [showAddDeviceModal, setShowAddDeviceModal] = useState(false)
  const [deviceModalController, setDeviceModalController] = useState(null)
  const [addDeviceForm, setAddDeviceForm] = useState({ name: '', device_type: 'sensor', unit: '' })

  const [showEditDeviceModal, setShowEditDeviceModal] = useState(false)
  const [editDeviceData, setEditDeviceData] = useState(null)
  const [editDeviceForm, setEditDeviceForm] = useState({ name: '', device_type: 'sensor', unit: '' })

  const fetchAll = async () => {
    setLoading(true)
    try {
      const [cRes, dRes] = await Promise.all([
        api.get('/controllers'),
        api.get('/devices'),
      ])
      setControllers(cRes.data)
      setDevices(dRes.data)
    } catch {
      addToast('Failed to load data', 'error')
    }
    setLoading(false)
  }

  useEffect(() => { fetchAll() }, [])

  const handleRegisterController = async (e) => {
    e.preventDefault()
    try {
      const res = await api.post('/controllers', newController)
      const ctrl = res.data
      if (newControllerFile) {
        const formData = new FormData()
        formData.append('file', newControllerFile)
        await api.post(`/controllers/${ctrl.id}/image`, formData, {
          headers: { 'Content-Type': 'multipart/form-data' },
        })
      }
      setNewController({ name: '', mqtt_topic: '', description: '' })
      setNewControllerFile(null)
      setShowAddController(false)
      addToast('Controller registered', 'success')
      fetchAll()
    } catch (err) {
      addToast(err.response?.data?.detail || 'Failed to register controller', 'error')
    }
  }

  const handleUpdateController = async (e) => {
    e.preventDefault()
    if (!editControllerData) return
    try {
      const res = await api.put(`/controllers/${editControllerData.id}`, {
        name: editControllerData.name,
        mqtt_topic: editControllerData.mqtt_topic,
        description: editControllerData.description,
      })
      setControllers(controllers.map((c) => (c.id === res.data.id ? res.data : c)))
      if (editControllerFile) {
        const formData = new FormData()
        formData.append('file', editControllerFile)
        await api.post(`/controllers/${editControllerData.id}/image`, formData, {
          headers: { 'Content-Type': 'multipart/form-data' },
        })
        setEditControllerFile(null)
        fetchAll()
      }
      setShowEditController(false)
      setEditControllerData(null)
      addToast('Controller updated', 'success')
    } catch (err) {
      addToast(err.response?.data?.detail || 'Failed to update controller', 'error')
    }
  }

  const handleDeleteControllerConfirm = async () => {
    if (deleteCtrlId === null) return
    try {
      await api.delete(`/controllers/${deleteCtrlId}`)
      setControllers(controllers.filter((c) => c.id !== deleteCtrlId))
      setDevices(devices.filter((d) => d.controller_id !== deleteCtrlId))
      addToast('Controller deleted', 'info')
    } catch {
      addToast('Failed to delete controller', 'error')
    }
    setDeleteCtrlOpen(false)
    setDeleteCtrlId(null)
  }

  const handleDeleteDevice = async () => {
    if (deleteDeviceId === null) return
    try {
      await api.delete(`/devices/${deleteDeviceId}`)
      setDevices(devices.filter((d) => d.id !== deleteDeviceId))
      addToast('Device deleted', 'info')
    } catch {
      addToast('Failed to delete device', 'error')
    }
    setDeleteDeviceOpen(false)
    setDeleteDeviceId(null)
  }

  const handleDeviceUpdate = (updated) => {
    setDevices(devices.map((d) => (d.id === updated.id ? updated : d)))
  }

  const openAddDevice = (controllerId) => {
    setDeviceModalController(controllerId)
    setAddDeviceForm({ name: '', device_type: 'sensor', unit: '' })
    setShowAddDeviceModal(true)
  }

  const handleCreateDevice = async (e) => {
    e.preventDefault()
    if (!deviceModalController) return
    try {
      await api.post('/devices', {
        controller_id: deviceModalController,
        name: addDeviceForm.name,
        device_type: addDeviceForm.device_type,
        unit: addDeviceForm.unit || null,
      })
      setShowAddDeviceModal(false)
      setDeviceModalController(null)
      addToast('Device registered', 'success')
      fetchAll()
    } catch (err) {
      addToast(err.response?.data?.detail || 'Failed to register device', 'error')
    }
  }

  const openEditDevice = (device) => {
    setEditDeviceData(device)
    setEditDeviceForm({
      name: device.name,
      device_type: device.device_type,
      unit: device.unit || '',
    })
    setShowEditDeviceModal(true)
  }

  const handleUpdateDevice = async (e) => {
    e.preventDefault()
    if (!editDeviceData) return
    try {
      const res = await api.put(`/devices/${editDeviceData.id}`, {
        name: editDeviceForm.name,
        device_type: editDeviceForm.device_type,
        unit: editDeviceForm.unit || null,
      })
      handleDeviceUpdate(res.data)
      setShowEditDeviceModal(false)
      setEditDeviceData(null)
      addToast('Device updated', 'success')
    } catch (err) {
      addToast(err.response?.data?.detail || 'Failed to update device', 'error')
    }
  }

  const openEditController = (controller) => {
    setEditControllerData({ ...controller })
    setEditControllerFile(null)
    setShowEditController(true)
  }

  if (loading) return <LoadingSpinner text="Loading..." />

  return (
    <div className="dashboard">
      <div className="page-header">
        <h1>Controllers</h1>
        <button className="btn btn-primary" onClick={() => setShowAddController(true)}>
          Add Controller
        </button>
      </div>

      {controllers.length === 0 ? (
        <div className="empty-state">
          <p>No controllers registered yet.</p>
        </div>
      ) : (
        <div className="controller-cards">
          {controllers.map((c) => (
            <ControllerCard
              key={c.id}
              controller={c}
              devices={devices}
              onEdit={openEditController}
              onDelete={(id) => { setDeleteCtrlId(id); setDeleteCtrlOpen(true) }}
              onDeviceEdit={openEditDevice}
              onDeviceDelete={(id) => { setDeleteDeviceId(id); setDeleteDeviceOpen(true) }}
              onOpenAddDevice={openAddDevice}
              onRefresh={fetchAll}
            />
          ))}
        </div>
      )}

      {/* ─── Add Controller Modal ─── */}
      {showAddController && (
        <div className="modal-overlay" onClick={() => setShowAddController(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 480 }}>
            <h3 className="modal-title">Add Controller</h3>
            <form onSubmit={handleRegisterController}>
              <div className="form-group">
                <label>Controller Name</label>
                <input type="text" value={newController.name} onChange={(e) => setNewController({ ...newController, name: e.target.value })} required />
              </div>
              <div className="form-group">
                <label>MQTT Topic</label>
                <input type="text" value={newController.mqtt_topic} onChange={(e) => setNewController({ ...newController, mqtt_topic: e.target.value })} required placeholder="e.g. fastiot/my-device" />
              </div>
              <div className="form-group">
                <label>Description (optional)</label>
                <input type="text" value={newController.description} onChange={(e) => setNewController({ ...newController, description: e.target.value })} />
              </div>
              <div className="form-group">
                <label>Image (optional)</label>
                <input type="file" accept="image/*" onChange={(e) => setNewControllerFile(e.target.files[0])} className="form-file-input" />
              </div>
              <div className="modal-actions">
                <button type="button" className="btn btn-secondary" onClick={() => setShowAddController(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary">Register Controller</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ─── Edit Controller Modal ─── */}
      {showEditController && editControllerData && (
        <div className="modal-overlay" onClick={() => { setShowEditController(false); setEditControllerData(null) }}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 480 }}>
            <h3 className="modal-title">Edit Controller</h3>
            <form onSubmit={handleUpdateController}>
              <div className="form-group">
                <label>Controller Name</label>
                <input type="text" value={editControllerData.name} onChange={(e) => setEditControllerData({ ...editControllerData, name: e.target.value })} required />
              </div>
              <div className="form-group">
                <label>MQTT Topic</label>
                <input type="text" value={editControllerData.mqtt_topic} onChange={(e) => setEditControllerData({ ...editControllerData, mqtt_topic: e.target.value })} required />
              </div>
              <div className="form-group">
                <label>Description</label>
                <input type="text" value={editControllerData.description || ''} onChange={(e) => setEditControllerData({ ...editControllerData, description: e.target.value })} />
              </div>
              <div className="form-group">
                <label>Image</label>
                {editControllerData.image && (
                  <div style={{ marginBottom: '0.5rem' }}>
                    <img src={editControllerData.image} alt="" style={{ width: 120, height: 80, objectFit: 'cover', borderRadius: 6 }} />
                  </div>
                )}
                <input type="file" accept="image/*" onChange={(e) => setEditControllerFile(e.target.files[0])} className="form-file-input" />
              </div>
              <div className="modal-actions">
                <button type="button" className="btn btn-secondary" onClick={() => { setShowEditController(false); setEditControllerData(null) }}>Cancel</button>
                <button type="submit" className="btn btn-primary">Save</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ─── Add Device Modal ─── */}
      {showAddDeviceModal && (
        <div className="modal-overlay" onClick={() => { setShowAddDeviceModal(false); setDeviceModalController(null) }}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 440 }}>
            <h3 className="modal-title">Add Device</h3>
            <form onSubmit={handleCreateDevice}>
              <div className="form-group">
                <label>Name</label>
                <input type="text" value={addDeviceForm.name} onChange={(e) => setAddDeviceForm({ ...addDeviceForm, name: e.target.value })} required />
              </div>
              <div className="form-row">
                <div className="form-group" style={{ flex: 1 }}>
                  <label>Type</label>
                  <select className="form-select" value={addDeviceForm.device_type} onChange={(e) => {
                    const isActuator = e.target.value === 'actuator'
                    setAddDeviceForm({ ...addDeviceForm, device_type: e.target.value, unit: isActuator ? 'switch' : '' })
                  }}>
                    <option value="sensor">sensor</option>
                    <option value="actuator">actuator</option>
                  </select>
                </div>
                <div className="form-group" style={{ flex: 1, marginLeft: '0.75rem' }}>
                  <label>Unit</label>
                  {addDeviceForm.device_type === 'actuator' ? (
                    <select className="form-select" value={addDeviceForm.unit} onChange={(e) => setAddDeviceForm({ ...addDeviceForm, unit: e.target.value })}>
                      <option value="switch">ON/OFF</option>
                      <option value="continuous">continuous</option>
                    </select>
                  ) : (
                    <input type="text" value={addDeviceForm.unit} onChange={(e) => setAddDeviceForm({ ...addDeviceForm, unit: e.target.value })} placeholder="e.g. °C" />
                  )}
                </div>
              </div>
              <div className="modal-actions">
                <button type="button" className="btn btn-secondary" onClick={() => { setShowAddDeviceModal(false); setDeviceModalController(null) }}>Cancel</button>
                <button type="submit" className="btn btn-primary">Register Device</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ─── Edit Device Modal ─── */}
      {showEditDeviceModal && editDeviceData && (
        <div className="modal-overlay" onClick={() => { setShowEditDeviceModal(false); setEditDeviceData(null) }}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 440 }}>
            <h3 className="modal-title">Edit Device</h3>
            <form onSubmit={handleUpdateDevice}>
              <div className="form-group">
                <label>Name</label>
                <input type="text" value={editDeviceForm.name} onChange={(e) => setEditDeviceForm({ ...editDeviceForm, name: e.target.value })} required />
              </div>
              <div className="form-row">
                <div className="form-group" style={{ flex: 1 }}>
                  <label>Type</label>
                  <select className="form-select" value={editDeviceForm.device_type} onChange={(e) => {
                    const isActuator = e.target.value === 'actuator'
                    setEditDeviceForm({ ...editDeviceForm, device_type: e.target.value, unit: isActuator ? 'switch' : '' })
                  }}>
                    <option value="sensor">sensor</option>
                    <option value="actuator">actuator</option>
                  </select>
                </div>
                <div className="form-group" style={{ flex: 1, marginLeft: '0.75rem' }}>
                  <label>Unit</label>
                  {editDeviceForm.device_type === 'actuator' ? (
                    <select className="form-select" value={editDeviceForm.unit} onChange={(e) => setEditDeviceForm({ ...editDeviceForm, unit: e.target.value })}>
                      <option value="switch">ON/OFF</option>
                      <option value="continuous">continuous</option>
                    </select>
                  ) : (
                    <input type="text" value={editDeviceForm.unit} onChange={(e) => setEditDeviceForm({ ...editDeviceForm, unit: e.target.value })} placeholder="e.g. °C" />
                  )}
                </div>
              </div>
              <div className="modal-actions">
                <button type="button" className="btn btn-secondary" onClick={() => { setShowEditDeviceModal(false); setEditDeviceData(null) }}>Cancel</button>
                <button type="submit" className="btn btn-primary">Save</button>
              </div>
            </form>
          </div>
        </div>
      )}

      <ConfirmModal
        open={deleteCtrlOpen}
        title="Delete Controller"
        message="This will permanently delete this controller and all its devices and data. Are you sure?"
        onConfirm={handleDeleteControllerConfirm}
        onCancel={() => { setDeleteCtrlOpen(false); setDeleteCtrlId(null) }}
      />

      <ConfirmModal
        open={deleteDeviceOpen}
        title="Delete Device"
        message="This will permanently delete this device and all its data. Are you sure?"
        onConfirm={handleDeleteDevice}
        onCancel={() => { setDeleteDeviceOpen(false); setDeleteDeviceId(null) }}
      />
    </div>
  )
}

export default Devices
