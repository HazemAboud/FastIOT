import { Link, useNavigate } from 'react-router-dom'
import api from '../api'

function Navbar({ user, onLogout }) {
  const navigate = useNavigate()

  const handleLogout = async () => {
    try {
      await api.post('/logout')
    } catch {
      // ignore
    }
    onLogout()
    navigate('/login')
  }

  return (
    <nav className="navbar">
      <Link to="/" className="navbar-brand">FastIOT</Link>
      <div className="navbar-right">
        {user ? (
          <>
            <span className="navbar-user">{user.username}</span>
            <button className="btn btn-danger" style={{ width: 'auto', padding: '0.5rem 1rem' }} onClick={handleLogout}>
              Logout
            </button>
          </>
        ) : (
          <>
            <Link to="/login" className="btn btn-primary" style={{ width: 'auto', padding: '0.5rem 1rem', textDecoration: 'none' }}>
              Login
            </Link>
            <Link to="/register" className="btn btn-primary" style={{ width: 'auto', padding: '0.5rem 1rem', textDecoration: 'none', background: '#334155', color: '#e2e8f0' }}>
              Register
            </Link>
          </>
        )}
      </div>
    </nav>
  )
}

export default Navbar
