import React, { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowRight, ShieldCheck, Store } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { ApiError } from '../services/api';

export const LoginPage: React.FC = () => {
  const { login, notify } = useApp();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const redirectTo = searchParams.get('next') || '/';

  const [email, setEmail] = useState('demo@bazaarbridge.dev');
  const [secretInput, setSecretInput] = useState('Demo@1234');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const profile = await login(email.trim(), secretInput);
      notify('success', `Welcome back, ${profile.name}.`);
      navigate(profile.role === 'admin' ? '/admin' : redirectTo);
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError('Unable to sign in right now. Please try again.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-14 sm:py-20">
      <div className="max-w-md mx-auto bg-white rounded-2xl border border-[#E2E8F0] p-8 shadow-sm">
        <div className="space-y-2 mb-6">
          <p className="text-xs font-medium uppercase tracking-wider text-[#4F46E5]">
            Customer Demo Access
          </p>
          <h1
            className="text-2xl font-bold text-[#111827] tracking-tight"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            Sign in to BazaarBridge
          </h1>
          <p className="text-sm text-[#64748B]">
            Prefilled with our SAMPLE customer account so you can test reservations, multi-dealer checkout, and live order tracking in one click.
          </p>
        </div>

        <div className="mb-6 rounded-xl bg-slate-50 border border-[#E2E8F0] p-4 text-xs text-[#64748B] space-y-1">
          <div className="flex items-center gap-2 font-medium text-[#111827]">
            <Store className="w-4 h-4 text-[#4F46E5]" />
            <span>SAMPLE Demo Customer Account</span>
          </div>
          <p>
            Email: <span className="font-mono text-[#111827]">demo@bazaarbridge.dev</span> · Password:{' '}
            <span className="font-mono text-[#111827]">Demo@1234</span>
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
            <label htmlFor="customer-email" className="block text-sm font-medium text-[#111827] mb-1.5">
              Email address
            </label>
            <input
              id="customer-email"
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-lg border border-[#E2E8F0] bg-white px-3.5 py-2.5 text-sm text-[#111827] focus:border-[#4F46E5] focus:outline-none focus:ring-2 focus:ring-indigo-100"
            />
          </div>

          <div>
            <label htmlFor="customer-password" className="block text-sm font-medium text-[#111827] mb-1.5">
              Password
            </label>
            <input
              id="customer-password"
              type="password"
              required
              autoComplete="current-password"
              value={secretInput}
              onChange={(e) => setSecretInput(e.target.value)}
              className="w-full rounded-lg border border-[#E2E8F0] bg-white px-3.5 py-2.5 text-sm text-[#111827] focus:border-[#4F46E5] focus:outline-none focus:ring-2 focus:ring-indigo-100"
            />
          </div>

          <button
            type="submit"
            disabled={submitting}
            className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-[#4F46E5] hover:bg-[#4338CA] disabled:opacity-60 px-4 py-3 text-sm font-semibold text-white transition-colors cursor-pointer"
          >
            <span>{submitting ? 'Signing in...' : 'Enter demo store'}</span>
            <ArrowRight className="w-4 h-4" />
          </button>
        </form>

        <div className="mt-6 pt-6 border-t border-[#E2E8F0] flex items-center justify-between text-xs text-[#64748B]">
          <span>Looking for operations controls?</span>
          <Link
            to="/admin-login"
            className="inline-flex items-center gap-1 font-medium text-[#4F46E5] hover:underline"
          >
            <ShieldCheck className="w-3.5 h-3.5" />
            <span>Admin Portal</span>
          </Link>
        </div>
      </div>
    </div>
  );
};
