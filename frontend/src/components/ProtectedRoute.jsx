/**
 * ProtectedRoute
 *
 * Wraps any route that requires authentication.
 * Shows a full-screen loading spinner while the auth status is being
 * determined (session recovery on page load).
 * Redirects to /login (preserving the intended destination) if the
 * user is not authenticated.
 */

import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function ProtectedRoute({ children }) {
  const { isAuthenticated, isLoading } = useAuth();
  const location = useLocation();

  if (isLoading) {
    return (
      <div style={{
        minHeight:      '100vh',
        background:     '#060d18',
        display:        'flex',
        flexDirection:  'column',
        alignItems:     'center',
        justifyContent: 'center',
        gap:            '1rem',
        fontFamily:     "'DM Sans', sans-serif",
      }}>
        {/* Animated vault logo */}
        <div style={{
          width:         52,
          height:        52,
          borderRadius:  14,
          background:    'linear-gradient(135deg, #1a8a5e, #0d6346)',
          display:       'flex',
          alignItems:    'center',
          justifyContent:'center',
          fontSize:      26,
          animation:     'pulse 1.5s ease-in-out infinite',
        }}>
          ⬡
        </div>
        <p style={{ fontSize: 13, color: '#94a3b8', letterSpacing: '0.08em' }}>
          RESTORING SESSION…
        </p>
      </div>
    );
  }

  if (!isAuthenticated) {
    // Pass the intended location so we can redirect back after login
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  return children;
}
