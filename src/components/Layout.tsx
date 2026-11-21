import React, { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import {
  Bell,
  Menu,
  ShoppingBag,
  Sparkles,
  User,
  X,
  LogOut,
  ShieldCheck,
  Heart,
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import { apiRequest } from '../services/api';
import { usePolling } from '../kit';

interface NotificationItem {
  notification_id: string;
  message: string;
  created_at: string;
  read_at: string | null;
}

export const Layout: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const {
    user,
    token,
    cartCount,
    unreadNotifications,
    refreshNotifications,
    logout,
    featureFlags,
    toasts,
    dismissToast,
  } = useApp();
  const location = useLocation();
  const navigate = useNavigate();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);

  usePolling(refreshNotifications, 8000, Boolean(token));

  const openNotifications = async () => {
    if (!token) {
      navigate('/login');
      return;
    }
    const nextState = !notifOpen;
    setNotifOpen(nextState);
    if (nextState) {
      try {
        const res = await apiRequest<{ notifications: NotificationItem[] }>('/api/notifications');
        setNotifications(res.notifications);
      } catch {
        setNotifications([]);
      }
    }
  };

  const markAllRead = async () => {
    try {
      await apiRequest('/api/notifications/mark-read', { method: 'POST' });
      await refreshNotifications();
      setNotifications((prev) => prev.map((n) => ({ ...n, read_at: new Date().toISOString() })));
    } catch {
      // ignore
    }
  };

  const isActive = (path: string) =>
    path === '/' ? location.pathname === '/' : location.pathname.startsWith(path);

  return (
    <div className="min-h-screen flex flex-col bg-[#F8FAFC] text-[#111827]">
      {/* Clean Single-Row 3-Zone Top Navigation Bar */}
      <header className="sticky top-0 z-40 bg-white/95 backdrop-blur-sm border-b border-[#E2E8F0]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-8">
          {/* Zone 1: Brand wordmark only (single line, no clutter) */}
          <Link
            to="/"
            className="text-xl font-bold tracking-tight text-[#111827] whitespace-nowrap shrink-0"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            BazaarBridge
          </Link>

          {/* Zone 2: Clean single-line text nav links */}
          <nav aria-label="Main navigation" className="hidden lg:flex items-center gap-7 text-sm font-medium">
            <Link
              to="/"
              className={`whitespace-nowrap shrink-0 transition-colors ${
                isActive('/') ? 'text-[#4F46E5]' : 'text-[#64748B] hover:text-[#111827]'
              }`}
            >
              Home
            </Link>
            <Link
              to="/search"
              className={`whitespace-nowrap shrink-0 transition-colors ${
                isActive('/search') ? 'text-[#4F46E5]' : 'text-[#64748B] hover:text-[#111827]'
              }`}
            >
              Browse & Search
            </Link>
            <Link
              to="/products/50000000-0000-4000-8000-000000000001/compare"
              className={`whitespace-nowrap shrink-0 transition-colors ${
                location.pathname.includes('/compare')
                  ? 'text-[#4F46E5]'
                  : 'text-[#64748B] hover:text-[#111827]'
              }`}
            >
              Compare Deals
            </Link>
            <Link
              to="/outside-bangalore"
              className={`whitespace-nowrap shrink-0 transition-colors ${
                isActive('/outside-bangalore') ? 'text-[#4F46E5]' : 'text-[#64748B] hover:text-[#111827]'
              }`}
            >
              Outside Bangalore
            </Link>
            {user?.role === 'admin' ? (
              <Link
                to="/admin"
                className={`whitespace-nowrap shrink-0 transition-colors ${
                  isActive('/admin') ? 'text-[#4F46E5]' : 'text-[#64748B] hover:text-[#111827]'
                }`}
              >
                Admin Simulator
              </Link>
            ) : (
              <Link
                to="/orders"
                className={`whitespace-nowrap shrink-0 transition-colors ${
                  isActive('/orders') ? 'text-[#4F46E5]' : 'text-[#64748B] hover:text-[#111827]'
                }`}
              >
                Orders
              </Link>
            )}
          </nav>

          {/* Zone 3: Essential utility & primary action */}
          <div className="flex items-center gap-3 shrink-0">
            {featureFlags.has('FEATURE_ASSISTANT') && (
              <Link
                to="/assistant"
                aria-label="Shopping assistant"
                className="hidden sm:inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-[#4F46E5] hover:bg-indigo-50 rounded-lg transition-colors whitespace-nowrap shrink-0"
              >
                <Sparkles className="w-4 h-4" />
                <span>Assistant</span>
              </Link>
            )}

            {user && featureFlags.has('FEATURE_WISHLIST') && (
              <Link
                to="/wishlist"
                aria-label="Wishlist"
                className="p-2 text-[#64748B] hover:text-[#111827] rounded-lg transition-colors"
              >
                <Heart className="w-5 h-5" />
              </Link>
            )}

            {user && (
              <div className="relative">
                <button
                  type="button"
                  onClick={openNotifications}
                  aria-label={`Notifications (${unreadNotifications} unread)`}
                  className="relative p-2 text-[#64748B] hover:text-[#111827] rounded-lg transition-colors cursor-pointer"
                >
                  <Bell className="w-5 h-5" />
                  {unreadNotifications > 0 && (
                    <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-[#4F46E5] text-white text-[11px] font-semibold flex items-center justify-center tabular-nums">
                      {unreadNotifications}
                    </span>
                  )}
                </button>

                {notifOpen && (
                  <div className="absolute right-0 mt-2 w-80 sm:w-96 bg-white rounded-xl border border-[#E2E8F0] shadow-lg p-4 z-50">
                    <div className="flex items-center justify-between pb-3 border-b border-[#E2E8F0]">
                      <span className="text-sm font-semibold text-[#111827]">Notifications</span>
                      <div className="flex items-center gap-3">
                        <button
                          type="button"
                          onClick={markAllRead}
                          className="text-xs font-medium text-[#4F46E5] hover:underline cursor-pointer"
                        >
                          Mark all read
                        </button>
                        <button
                          type="button"
                          onClick={() => setNotifOpen(false)}
                          aria-label="Close notifications"
                          className="text-[#64748B] hover:text-[#111827] cursor-pointer"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                    <div className="max-h-72 overflow-y-auto divide-y divide-[#E2E8F0]">
                      {notifications.length === 0 ? (
                        <p className="py-6 text-center text-xs text-[#64748B]">
                          No notifications yet. Order, delivery, and refund updates appear here via the Kafka notifier consumer.
                        </p>
                      ) : (
                        notifications.map((n) => (
                          <div key={n.notification_id} className={`py-3 text-xs ${n.read_at ? 'text-[#64748B]' : 'text-[#111827] font-medium'}`}>
                            <p>{n.message}</p>
                            <p className="mt-1 text-[11px] text-[#64748B] tabular-nums">
                              {new Date(n.created_at).toLocaleTimeString()}
                            </p>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}

            <Link
              to="/cart"
              aria-label={`Shopping cart (${cartCount} items)`}
              className="relative inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-[#111827] hover:bg-slate-100 rounded-lg transition-colors whitespace-nowrap shrink-0"
            >
              <ShoppingBag className="w-5 h-5" />
              <span className="tabular-nums">{cartCount}</span>
            </Link>

            {user ? (
              <div className="hidden sm:flex items-center gap-2 pl-2 border-l border-[#E2E8F0]">
                <Link
                  to={user.role === 'admin' ? '/admin' : '/orders'}
                  className="inline-flex items-center gap-1.5 text-xs font-medium text-[#111827] hover:text-[#4F46E5] whitespace-nowrap"
                >
                  {user.role === 'admin' ? (
                    <ShieldCheck className="w-4 h-4 text-[#4F46E5]" />
                  ) : (
                    <User className="w-4 h-4 text-[#64748B]" />
                  )}
                  <span className="max-w-[130px] truncate">{user.role === 'admin' ? 'Admin' : 'Demo user'}</span>
                </Link>
                <button
                  type="button"
                  onClick={() => {
                    logout();
                    navigate('/');
                  }}
                  aria-label="Sign out"
                  className="p-1.5 text-[#64748B] hover:text-[#DC2626] rounded-md transition-colors cursor-pointer"
                >
                  <LogOut className="w-4 h-4" />
                </button>
              </div>
            ) : (
              <Link
                to="/login"
                className="px-4 py-2 text-sm font-medium text-white bg-[#4F46E5] hover:bg-[#4338CA] rounded-lg transition-colors whitespace-nowrap shrink-0"
              >
                Sign In
              </Link>
            )}

            <button
              type="button"
              onClick={() => setMobileOpen(!mobileOpen)}
              aria-label="Toggle navigation menu"
              className="lg:hidden p-2 text-[#111827] rounded-lg hover:bg-slate-100 cursor-pointer"
            >
              {mobileOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>
          </div>
        </div>

        {/* Mobile menu */}
        {mobileOpen && (
          <div className="lg:hidden border-t border-[#E2E8F0] bg-white px-4 py-4 space-y-2">
            {[
              { to: '/', label: 'Home' },
              { to: '/search', label: 'Browse & Search' },
              { to: '/products/50000000-0000-4000-8000-000000000001/compare', label: 'Compare Deals' },
              { to: '/outside-bangalore', label: 'Outside Bangalore' },
              { to: '/orders', label: 'My Orders' },
              ...(featureFlags.has('FEATURE_ASSISTANT') ? [{ to: '/assistant', label: 'Shopping Assistant' }] : []),
              { to: '/admin-login', label: 'Admin Portal' },
            ].map((item) => (
              <Link
                key={item.to}
                to={item.to}
                onClick={() => setMobileOpen(false)}
                className="block px-3 py-2.5 rounded-lg text-sm font-medium text-[#111827] hover:bg-slate-100"
              >
                {item.label}
              </Link>
            ))}
            {user && (
              <button
                type="button"
                onClick={() => {
                  logout();
                  setMobileOpen(false);
                  navigate('/');
                }}
                className="w-full text-left px-3 py-2.5 rounded-lg text-sm font-medium text-[#DC2626] hover:bg-red-50 cursor-pointer"
              >
                Sign Out ({user.email})
              </button>
            )}
          </div>
        )}
      </header>

      {/* Main Content */}
      <main className="flex-1">{children}</main>

      {/* Toast Container */}
      <div
        aria-live="polite"
        className="fixed bottom-5 right-5 z-50 flex flex-col gap-2 max-w-sm w-full pointer-events-none px-4 sm:px-0"
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`pointer-events-auto flex items-center justify-between gap-3 rounded-lg border px-4 py-3 text-sm shadow-md ${
              t.type === 'success'
                ? 'bg-white border-emerald-200 text-emerald-900'
                : t.type === 'error'
                  ? 'bg-white border-red-200 text-red-900'
                  : 'bg-white border-slate-200 text-[#111827]'
            }`}
          >
            <span>{t.text}</span>
            <button
              type="button"
              onClick={() => dismissToast(t.id)}
              aria-label="Dismiss message"
              className="text-[#64748B] hover:text-[#111827] cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        ))}
      </div>

      {/* Professional Footer */}
      <footer className="bg-white border-t border-[#E2E8F0] mt-16">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-8">
            <div className="md:col-span-1 space-y-3">
              <p className="text-lg font-bold text-[#111827]" style={{ fontFamily: 'var(--font-display)' }}>
                BazaarBridge
              </p>
              <p className="text-sm text-[#64748B] leading-relaxed">
                Multi-dealer commerce and hybrid local fulfilment connecting shoppers with transparent price, speed, rating, and stock comparisons.
              </p>
            </div>

            <div>
              <h3 className="text-sm font-semibold text-[#111827] mb-3">Marketplace</h3>
              <ul className="space-y-2 text-sm text-[#64748B]">
                <li><Link to="/search" className="hover:text-[#111827]">Browse Catalog</Link></li>
                <li><Link to="/products/50000000-0000-4000-8000-000000000001/compare" className="hover:text-[#111827]">5-Category Dealer Comparison</Link></li>
                <li><Link to="/outside-bangalore" className="hover:text-[#111827]">Outside Bangalore Transfers</Link></li>
                <li><Link to="/orders" className="hover:text-[#111827]">Order Tracking & OTP</Link></li>
              </ul>
            </div>

            <div>
              <h3 className="text-sm font-semibold text-[#111827] mb-3">Operations & Support</h3>
              <ul className="space-y-2 text-sm text-[#64748B]">
                <li><Link to="/admin-login" className="hover:text-[#111827]">Admin Simulator Login</Link></li>
                {featureFlags.has('FEATURE_SIM_SCREENS') && (
                  <>
                    <li><Link to="/simulated/support" className="hover:text-[#111827]">Customer Support (SAMPLE)</Link></li>
                    <li><Link to="/simulated/ops" className="hover:text-[#111827]">Picker & Rider Screens (SAMPLE)</Link></li>
                  </>
                )}
                <li><Link to="/login" className="hover:text-[#111827]">Customer Demo Sign In</Link></li>
              </ul>
            </div>

            <div>
              <h3 className="text-sm font-semibold text-[#111827] mb-3">Data Transparency</h3>
              <p className="text-xs text-[#64748B] leading-relaxed">
                Seeded catalog items, dealer reviews, price history, delivery fees, hubs, and demo OTPs are labelled SAMPLE or SIMULATED. No live third-party retailer inventory is claimed.
              </p>
              <p className="text-xs text-[#64748B] mt-3">
                Contact: support@bazaarbridge.dev · Bengaluru, Karnataka
              </p>
            </div>
          </div>

          <div className="mt-10 pt-6 border-t border-[#E2E8F0] flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-[#64748B]">
            <p>© 2026 BazaarBridge. Built on PostgreSQL, Kafka, and OpenSearch architecture.</p>
            <div className="flex items-center gap-6">
              <Link to="/simulated/support" className="hover:text-[#111827]">Privacy Policy</Link>
              <Link to="/simulated/support" className="hover:text-[#111827]">Terms & Conditions</Link>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
};
