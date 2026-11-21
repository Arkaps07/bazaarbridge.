import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Lock, ShieldCheck } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { ApiError } from '../services/api';

export const AdminLoginPage: React.FC = () => {
  const { login, logout, notify } = useApp();
  const navigate = useNavigate();

  // Security rule: admin password is NEVER prefilled in source code or DOM
  const [email, setEmail] = useState('admin@bazaarbridge.dev');
  const [passphrase, setPassphrase] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const profile = await login(email.trim(), passphrase);
      if (profile.role !== 'admin') {
        logout();
        setError('This account does not have administrator permissions. Sign in with an admin account.');
        return;
      }
      notify('success', 'Signed in to BazaarBridge Admin Operations.');
      navigate('/admin');
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError('Admin authentication failed. Verify your credentials and try again.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-14 sm:py-20">
      <div className="max-w-md mx-auto bg-white rounded-2xl border border-[#E2E8F0] p-8 shadow-sm">
        <div className="space-y-2 mb-6">
          <div className="inline-flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider text-[#111827]">
            <ShieldCheck className="w-4 h-4 text-[#4F46E5]" />
            <span>Restricted Operations Portal</span>
          </div>
          <h1
            className="text-2xl font-bold text-[#111827] tracking-tight"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            Admin Sign In
          </h1>
          <p className="text-sm text-[#64748B]">
            Authenticate with your configured administrator password to access the Fulfilment Simulator, Hub Controls, and Live-Proof Panel.
          </p>
        </div>

        <div className="mb-6 rounded-xl bg-slate-50 border border-[#E2E8F0] p-4 text-xs text-[#64748B] space-y-1">
          <p className="font-medium text-[#111827]">Security Notice</p>
          <p>
            Admin credentials are never prefilled. Enter the password configured in <span className="font-mono text-[#111827]">SEED_ADMIN_PASSWORD</span> (or your local seed environment).
          </p>
        </div>

        {error && (
          <div
            role="alert"
            className="mb-5 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-[#DC2626]"
          >
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="admin-email" className="block text-sm font-medium text-[#111827] mb-1.5">
              Admin email
            </label>
            <input
              id="admin-email"
              type="email"
              required
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-lg border border-[#E2E8F0] bg-white px-3.5 py-2.5 text-sm text-[#111827] focus:border-[#4F46E5] focus:outline-none focus:ring-2 focus:ring-indigo-100"
            />
          </div>

          <div>
            <label htmlFor="admin-password" className="block text-sm font-medium text-[#111827] mb-1.5">
              Admin password
            </label>
            <input
              id="admin-password"
              type="password"
              required
              autoComplete="current-password"
              placeholder="Enter administrator password"
              value={passphrase}
              onChange={(e) => setPassphrase(e.target.value)}
              className="w-full rounded-lg border border-[#E2E8F0] bg-white px-3.5 py-2.5 text-sm text-[#111827] focus:border-[#4F46E5] focus:outline-none focus:ring-2 focus:ring-indigo-100"
            />
          </div>

          <button
            type="submit"
            disabled={submitting}
            className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-[#111827] hover:bg-slate-800 disabled:opacity-60 px-4 py-3 text-sm font-semibold text-white transition-colors cursor-pointer"
          >
            <Lock className="w-4 h-4" />
            <span>{submitting ? 'Verifying...' : 'Sign in to Admin Dashboard'}</span>
          </button>
        </form>

        <div className="mt-6 pt-6 border-t border-[#E2E8F0] flex items-center justify-between text-xs text-[#64748B]">
          <span>Shopping as a customer?</span>
          <Link to="/login" className="font-medium text-[#4F46E5] hover:underline">
            Customer Demo Login
          </Link>
        </div>
      </div>
    </div>
  );
};
