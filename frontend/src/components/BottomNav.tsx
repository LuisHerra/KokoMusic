import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useState, useEffect, useRef } from 'react';
import { useNotificationStore } from '../store/notificationStore';

function IconHome() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
      <path d="M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z"/>
    </svg>
  );
}

function IconSearch() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
      <path d="M15.5 14h-.79l-.28-.27A6.471 6.471 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/>
    </svg>
  );
}

function IconLibrary() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
      <path d="M4 6H2v14c0 1.1.9 2 2 2h14v-2H4V6zm16-4H8c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm-1 9H9V9h10v2zm-4 4H9v-2h6v2zm4-8H9V5h10v2z"/>
    </svg>
  );
}

function IconFriends() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
      <path d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z"/>
    </svg>
  );
}

function IconMore() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
      <path d="M6 10c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm12 0c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm-6 0c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z"/>
    </svg>
  );
}

function IconStats() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
      <path d="M16 6l2.29 2.29-4.88 4.88-4-4L2 16.59 3.41 18l6-6 4 4 6.3-6.29L22 12V6z"/>
    </svg>
  );
}

function IconDj() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm0-12c-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4-1.79-4-4-4zm0 6c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2z"/>
    </svg>
  );
}

function IconFollowing() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/>
    </svg>
  );
}

function IconEvents() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
      <path d="M19 4h-1V2h-2v2H8V2H6v2H5c-1.11 0-1.99.9-1.99 2L3 20c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 16H5V10h14v10zm0-12H5V6h14v2zm-7 5h5v5h-5v-5z"/>
    </svg>
  );
}

export default function BottomNav() {
  const [isOpen, setIsOpen] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const unreadCount = useNotificationStore((s) => s.unreadCount);
  const sheetRef = useRef<HTMLDivElement | null>(null);

  // Close sheet on click outside
  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      if (isOpen && sheetRef.current && !sheetRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, [isOpen]);

  // Close sheet on path change
  useEffect(() => {
    setIsOpen(false);
  }, [location.pathname]);

  const moreActive = ['/stats', '/dj', '/following', '/events', '/profile'].includes(location.pathname);

  return (
    <>
      <div className="bottom-nav">
        <NavLink to="/" className={({ isActive }) => `bottom-nav-item ${isActive ? 'active' : ''}`}>
          <IconHome />
          <span>Inicio</span>
        </NavLink>
        
        <NavLink to="/search" className={({ isActive }) => `bottom-nav-item ${isActive ? 'active' : ''}`}>
          <IconSearch />
          <span>Buscar</span>
        </NavLink>
        
        <NavLink to="/library" className={({ isActive }) => `bottom-nav-item ${isActive ? 'active' : ''}`}>
          <IconLibrary />
          <span>Tu Biblioteca</span>
        </NavLink>
        
        <NavLink to="/friends" className={({ isActive }) => `bottom-nav-item ${isActive ? 'active' : ''}`}>
          <IconFriends />
          <span>Amigos</span>
        </NavLink>
        
        <button 
          onClick={() => setIsOpen(!isOpen)} 
          className={`bottom-nav-item bottom-nav-btn ${moreActive || isOpen ? 'active' : ''}`}
        >
          <IconMore />
          <span>Más</span>
        </button>
      </div>

      {/* Bottom Sheet Menu */}
      <div className={`bottom-sheet-overlay ${isOpen ? 'open' : ''}`}>
        <div ref={sheetRef} className={`bottom-sheet-content ${isOpen ? 'open' : ''}`}>
          <div className="bottom-sheet-drag-handle" onClick={() => setIsOpen(false)} />
          <div className="bottom-sheet-header">
            <h4>Navegación KokoMusic</h4>
            <button className="bottom-sheet-close-btn" onClick={() => setIsOpen(false)}>✕</button>
          </div>
          
          <div className="bottom-sheet-grid">
            <button onClick={() => navigate('/stats')} className={`bottom-sheet-item ${location.pathname === '/stats' ? 'active' : ''}`}>
              <div className="bottom-sheet-icon-wrap"><IconStats /></div>
              <span>Estadísticas</span>
            </button>

            <button onClick={() => navigate('/dj')} className={`bottom-sheet-item ${location.pathname === '/dj' ? 'active' : ''}`}>
              <div className="bottom-sheet-icon-wrap"><IconDj /></div>
              <span>Modo DJ</span>
            </button>

            <button onClick={() => navigate('/following')} className={`bottom-sheet-item ${location.pathname === '/following' ? 'active' : ''}`}>
              <div className="bottom-sheet-icon-wrap" style={{ position: 'relative' }}>
                <IconFollowing />
                {unreadCount > 0 && (
                  <span className="bottom-sheet-badge">{unreadCount}</span>
                )}
              </div>
              <span>Siguiendo</span>
            </button>

            <button onClick={() => navigate('/events')} className={`bottom-sheet-item ${location.pathname === '/events' ? 'active' : ''}`}>
              <div className="bottom-sheet-icon-wrap"><IconEvents /></div>
              <span>Eventos</span>
            </button>

            <button onClick={() => navigate('/profile')} className={`bottom-sheet-item ${location.pathname === '/profile' ? 'active' : ''}`}>
              <div className="bottom-sheet-icon-wrap">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 3c1.66 0 3 1.34 3 3s-1.34 3-3 3-3-1.34-3-3 1.34-3 3-3zm0 14.2c-2.5 0-4.71-1.28-6-3.22.03-1.99 4-3.08 6-3.08 1.99 0 5.97 1.09 6 3.08-1.29 1.94-3.5 3.22-6 3.22z"/>
                </svg>
              </div>
              <span>Mi Perfil</span>
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
