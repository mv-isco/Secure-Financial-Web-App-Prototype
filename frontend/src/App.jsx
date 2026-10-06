/**
 * App.jsx — Root router
 *
 * Route map:
 *   /                 → redirect to /dashboard (or /login if unauthenticated)
 *   /login            → LoginPage   (public)
 *   /register         → RegisterPage (public)
 *   /dashboard        → DashboardPage (protected)
 *   /profile          → Profile inside the dashboard (protected)
 *
 * AuthProvider wraps everything so all pages can call useAuth().
 * ProtectedRoute guards /dashboard — redirects to /login if not authenticated,
 * and shows a loading spinner while session recovery is in progress.
 */

import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider }    from './context/AuthContext';
import ProtectedRoute      from './components/ProtectedRoute';
import LoginPage           from './pages/LoginPage';
import RegisterPage        from './pages/RegisterPage';
import DashboardPage       from './pages/DashboardPage';

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          {/* Public routes */}
          <Route path="/login"    element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />

          {/* Protected routes */}
          <Route
            path="/dashboard"
            element={
              <ProtectedRoute>
                <DashboardPage />
              </ProtectedRoute>
            }
          />
          <Route path="/profile" element={<ProtectedRoute><DashboardPage /></ProtectedRoute>} />

          {/* Default redirect */}
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
