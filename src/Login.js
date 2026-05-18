import React, { useState, useEffect } from 'react';
import { supabase } from './supabaseClient';
import { MapContainer, TileLayer, Marker } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

// Add animation styles
const styleTag = document.createElement('style');
styleTag.textContent = `
  @keyframes bounceIn {
    0% { transform: rotate(-45deg) scale(0); opacity: 0; }
    50% { transform: rotate(-45deg) scale(1.2); opacity: 1; }
    70% { transform: rotate(-45deg) scale(0.9); }
    100% { transform: rotate(-45deg) scale(1); opacity: 1; }
  }
  @keyframes bounceOut {
    0% { transform: rotate(-45deg) scale(1); opacity: 1; }
    30% { transform: rotate(-45deg) scale(1.1); opacity: 1; }
    100% { transform: rotate(-45deg) scale(0); opacity: 0; }
  }
  .pin-bounce-in {
    animation: bounceIn 0.5s ease-out forwards;
  }
  .pin-bounce-out {
    animation: bounceOut 0.4s ease-in forwards;
  }
`;
document.head.appendChild(styleTag);

const createPinIcon = (animClass) => new L.DivIcon({
  className: 'custom-pin-animated',
  html: `<div class="${animClass}" style="
    width: 28px;
    height: 28px;
    background: #0d9488;
    border: 3px solid #fff;
    border-radius: 50% 50% 50% 0;
    box-shadow: 0 2px 8px rgba(0,0,0,0.3);
  "><div style="
    width: 10px;
    height: 10px;
    background: white;
    border-radius: 50%;
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
  "></div></div>`,
  iconSize: [28, 28],
  iconAnchor: [14, 28],
});

const allLocations = [
  { lat: 43.72, lng: -79.38 },
  { lat: 43.78, lng: -79.50 },
  { lat: 43.65, lng: -79.38 },
  { lat: 43.85, lng: -79.44 },
  { lat: 43.80, lng: -79.55 },
  { lat: 43.70, lng: -79.28 },
  { lat: 43.68, lng: -79.61 },
  { lat: 43.87, lng: -79.29 },
  { lat: 43.95, lng: -79.45 },
  { lat: 43.83, lng: -79.09 },
  { lat: 43.90, lng: -79.70 },
  { lat: 43.59, lng: -79.64 },
  { lat: 43.25, lng: -79.87 },
  { lat: 44.39, lng: -79.69 },
  { lat: 43.52, lng: -79.87 },
  { lat: 43.46, lng: -79.70 },
  { lat: 43.76, lng: -79.41 },
  { lat: 43.67, lng: -79.46 },
  { lat: 44.23, lng: -79.47 },
  { lat: 43.88, lng: -79.03 },
];

const loginMapCenters = [
  [43.72, -79.42],
  [43.78, -79.5],
  [43.65, -79.38],
  [43.85, -79.44],
  [43.8, -79.55],
  [43.7, -79.28],
  [43.68, -79.61],
  [43.87, -79.29],
];

function AnimatedMarker({ position, onRemove }) {
  const [, setAnimClass] = useState('pin-bounce-in');
  const [icon, setIcon] = useState(createPinIcon('pin-bounce-in'));

  useEffect(() => {
    const fadeOutTimer = setTimeout(() => {
      setAnimClass('pin-bounce-out');
      setIcon(createPinIcon('pin-bounce-out'));
    }, 4000);

    const removeTimer = setTimeout(() => {
      onRemove();
    }, 4500);

    return () => {
      clearTimeout(fadeOutTimer);
      clearTimeout(removeTimer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <Marker position={position} icon={icon} />;
}

function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [activeMarkers, setActiveMarkers] = useState([]);
  const markerIdRef = React.useRef(0);
  const initialCenterRef = React.useRef(loginMapCenters[Math.floor(Math.random() * loginMapCenters.length)]);

  useEffect(() => {
    const usedIndices = new Set();

    const addMarker = () => {
      if (usedIndices.size >= allLocations.length) {
        usedIndices.clear();
      }
      let index;
      do {
        index = Math.floor(Math.random() * allLocations.length);
      } while (usedIndices.has(index));

      usedIndices.add(index);
      const loc = allLocations[index];
      const id = markerIdRef.current++;
      const jitter = () => (Math.random() - 0.5) * 0.02;

      setActiveMarkers((prev) => [...prev, {
        id,
        lat: loc.lat + jitter(),
        lng: loc.lng + jitter(),
      }]);
    };

    const interval = setInterval(() => {
      addMarker();
    }, 1500);

    return () => clearInterval(interval);
  }, []);

  const removeMarker = (id) => {
    setActiveMarkers((prev) => prev.filter((m) => m.id !== id));
  };

  const handleLogin = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) setError(error.message);
    setLoading(false);
  };

  return (
    <div style={{ position: 'relative', height: '100vh', width: '100%' }}>

      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 0 }}>
        <MapContainer
          center={initialCenterRef.current}
          zoom={11}
          style={{ height: '100%', width: '100%' }}
          zoomControl={false}
          dragging={false}
          scrollWheelZoom={false}
          doubleClickZoom={false}
          attributionControl={false}
        >
          <TileLayer url="https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png" />
          {activeMarkers.map((m) => (
            <AnimatedMarker
              key={m.id}
              position={[m.lat, m.lng]}
              onRemove={() => removeMarker(m.id)}
            />
          ))}
        </MapContainer>
      </div>

      <div style={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: 'linear-gradient(135deg, rgba(4, 120, 87, 0.28) 0%, rgba(5, 150, 105, 0.22) 42%, rgba(6, 95, 70, 0.24) 100%)',
        zIndex: 1,
      }} />

      <div style={{
        position: 'relative',
        zIndex: 2,
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        height: '100%',
        fontFamily: "'DM Sans', sans-serif",
      }}>
        <form onSubmit={handleLogin} style={{
          background: 'rgba(222, 241, 229, 0.94)',
          backdropFilter: 'blur(14px)',
          padding: '36px',
          borderRadius: '18px',
          width: '380px',
          boxShadow: '0 18px 48px rgba(15, 23, 42, 0.2)',
          border: '1px solid rgba(194, 224, 207, 0.95)',
        }}>
          <div style={{
            width: '42px',
            height: '42px',
            margin: '0 auto 16px',
            borderRadius: '12px',
            background: '#047857',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: '0 8px 18px rgba(15, 118, 110, 0.22)',
          }}>
            <div style={{
              width: '16px',
              height: '16px',
              background: 'white',
              borderRadius: '50% 50% 50% 0',
              transform: 'rotate(-45deg)',
              position: 'relative',
            }}>
              <div style={{
                width: '6px',
                height: '6px',
                borderRadius: '50%',
              background: '#047857',
                position: 'absolute',
                top: '5px',
                left: '5px',
              }} />
            </div>
          </div>
          <h2 style={{
            textAlign: 'center',
            marginBottom: '6px',
            color: '#064e3b',
            fontSize: '25px',
            fontWeight: '700',
          }}>
            Appraisal Map
          </h2>

          <p style={{
            textAlign: 'center',
            color: '#6b7280',
            fontSize: '13px',
            marginBottom: '24px',
          }}>
            Sign in to access appraisal records
          </p>

          {error && (
            <div style={{
              color: '#991b1b',
              fontSize: '13px',
              background: '#fef2f2',
              border: '1px solid #fecaca',
              padding: '10px 14px',
              borderRadius: '8px',
              marginBottom: '14px',
            }}>
              {error}
            </div>
          )}

          <input
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            style={{
              width: '100%',
              padding: '13px 14px',
              marginBottom: '12px',
              borderRadius: '8px',
              border: '1px solid #cbd5e1',
              fontSize: '14px',
              boxSizing: 'border-box',
              outline: 'none',
              color: '#374151',
              background: '#f0fdf4',
            }}
            onFocus={(e) => e.target.style.borderColor = '#0d9488'}
            onBlur={(e) => e.target.style.borderColor = '#d1d5db'}
          />
          <input
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            style={{
              width: '100%',
              padding: '13px 14px',
              marginBottom: '18px',
              borderRadius: '8px',
              border: '1px solid #cbd5e1',
              fontSize: '14px',
              boxSizing: 'border-box',
              outline: 'none',
              color: '#374151',
              background: '#f0fdf4',
            }}
            onFocus={(e) => e.target.style.borderColor = '#0d9488'}
            onBlur={(e) => e.target.style.borderColor = '#d1d5db'}
          />
          <button
            type="submit"
            disabled={loading}
            style={{
              width: '100%',
              padding: '13px',
              backgroundColor: '#047857',
              color: 'white',
              border: 'none',
              borderRadius: '8px',
              cursor: loading ? 'not-allowed' : 'pointer',
              fontSize: '15px',
              fontWeight: '600',
              opacity: loading ? 0.7 : 1,
              boxShadow: '0 10px 18px rgba(4, 120, 87, 0.24)',
            }}
          >
            {loading ? 'Signing in...' : 'Sign In'}
          </button>
        </form>
      </div>
    </div>
  );
}

export default Login;
