import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import api from '../api'
import { useToast } from '../components/ToastContext'
import ConfirmModal from '../components/ConfirmModal'

function UserProfile({ user, onLogout }) {
  const navigate = useNavigate()
  const addToast = useToast()
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [saving, setSaving] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const handleChangePassword = async (e) => {
    e.preventDefault()
    if (newPassword !== confirmPassword) {
      addToast('New passwords do not match', 'error')
      return
    }
    if (newPassword.length < 6) {
      addToast('New password must be at least 6 characters', 'error')
      return
    }
    setSaving(true)
    try {
      await api.put('/users/password', {
        current_password: currentPassword,
        new_password: newPassword,
      })
      addToast('Password changed successfully', 'success')
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
    } catch (err) {
      addToast(err.response?.data?.detail || 'Failed to change password', 'error')
    }
    setSaving(false)
  }

  const handleDeleteAccount = async () => {
    setDeleting(true)
    try {
      await api.delete('/users/account')
      addToast('Account deleted', 'info')
      onLogout()
      navigate('/login')
    } catch {
      addToast('Failed to delete account', 'error')
    }
    setDeleting(false)
    setDeleteOpen(false)
  }

  return (
    <div className="dashboard">
      <div className="page-header">
        <h1>Profile</h1>
      </div>

      <div className="profile-section">
        <div className="card" style={{ maxWidth: 480 }}>
          <h3>Account Info</h3>
          <div className="profile-info">
            <div className="profile-field">
              <span className="profile-label">Username</span>
              <span>{user.username}</span>
            </div>
            <div className="profile-field">
              <span className="profile-label">Email</span>
              <span>{user.email}</span>
            </div>
            <div className="profile-field">
              <span className="profile-label">Registered</span>
              <span>{user.registration_date ? new Date(user.registration_date).toLocaleDateString() : '—'}</span>
            </div>
          </div>
        </div>
      </div>

      <div className="profile-section">
        <div className="card" style={{ maxWidth: 480 }}>
          <h3>Change Password</h3>
          <form onSubmit={handleChangePassword}>
            <div className="form-group">
              <label>Current Password</label>
              <input type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} required />
            </div>
            <div className="form-group">
              <label>New Password</label>
              <input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} required minLength={6} />
            </div>
            <div className="form-group">
              <label>Confirm New Password</label>
              <input type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} required />
            </div>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? 'Saving...' : 'Change Password'}
            </button>
          </form>
        </div>
      </div>

      <div className="profile-section">
        <div className="card" style={{ maxWidth: 480, borderColor: '#fed7d7' }}>
          <h3 style={{ color: '#e53e3e' }}>Danger Zone</h3>
          <p style={{ fontSize: '0.85rem', color: '#718096', marginBottom: '0.75rem' }}>
            Delete your account and all associated data permanently.
          </p>
          <button className="btn btn-danger" onClick={() => setDeleteOpen(true)} disabled={deleting}>
            {deleting ? 'Deleting...' : 'Delete Account'}
          </button>
        </div>
      </div>

      <ConfirmModal
        open={deleteOpen}
        title="Delete Account"
        message="This action cannot be undone. All your controllers, devices, and data will be permanently deleted."
        onConfirm={handleDeleteAccount}
        onCancel={() => setDeleteOpen(false)}
      />
    </div>
  )
}

export default UserProfile
