import { Routes, Route, Navigate } from 'react-router-dom'
import { useState } from 'react'
import Login from './pages/Login'
import Register from './pages/Register'
import Dashboard from './pages/Dashboard'
import Configuration from './pages/Configuration'
import Devices from './pages/Devices'
import Threshold from './pages/Threshold'
import UserProfile from './pages/UserProfile'
import Sidebar from './components/Sidebar'

function App() {
  const [user, setUser] = useState(() => {
    const stored = localStorage.getItem('user')
    return stored ? JSON.parse(stored) : null
  })

  const [, setSessionId] = useState(() => localStorage.getItem('session_id'))

  const handleAuth = (session_id, userData) => {
    localStorage.setItem('session_id', session_id)
    localStorage.setItem('user', JSON.stringify(userData))
    setSessionId(session_id)
    setUser(userData)
  }

  const handleLogout = () => {
    localStorage.removeItem('session_id')
    localStorage.removeItem('user')
    setSessionId(null)
    setUser(null)
  }

  return (
    <div className="app">
      {user ? (
        <>
          <Sidebar user={user} onLogout={handleLogout} />
          <main className="main-content">
            <Routes>
              <Route path="/dashboard" element={<Dashboard user={user} />} />
              <Route path="/configuration" element={<Configuration user={user} />} />
              <Route path="/devices" element={<Devices user={user} />} />
              <Route path="/threshold" element={<Threshold user={user} />} />
              <Route path="/profile" element={<UserProfile user={user} onLogout={handleLogout} />} />
              <Route path="*" element={<Navigate to="/dashboard" />} />
            </Routes>
          </main>
        </>
      ) : (
        <div className="auth-page">
          <Routes>
            <Route path="/login" element={<Login onAuth={handleAuth} />} />
            <Route path="/register" element={<Register onAuth={handleAuth} />} />
            <Route path="*" element={<Navigate to="/login" />} />
          </Routes>
        </div>
      )}
    </div>
  )
}

export default App
