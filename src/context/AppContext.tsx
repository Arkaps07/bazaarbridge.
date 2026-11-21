import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { apiRequest, setAuthToken } from '../services/api';

export interface UserProfile {
  user_id: string;
  name: string;
  email: string;
  role: 'customer' | 'admin' | 'rider';
}

export interface ToastMessage {
  id: string;
  type: 'success' | 'error' | 'info';
  text: string;
}

export interface HealthInfo {
  infrastructure: {
    postgresql: string;
    kafka: string;
    opensearch: string;
    gemini: string;
  };
  feature_flags: string[];
}

interface AppContextValue {
  user: UserProfile | null;
  token: string | null;
  featureFlags: Set<string>;
  health: HealthInfo | null;
  cartCount: number;
  unreadNotifications: number;
  wishlistIds: Set<string>;
  compareIds: string[];
  login: (email: string, password: string) => Promise<UserProfile>;
  logout: () => void;
  refreshCartCount: () => Promise<void>;
  refreshNotifications: () => Promise<void>;
  toggleWishlist: (productId: string) => Promise<void>;
  toggleCompareId: (productId: string) => void;
  notify: (type: 'success' | 'error' | 'info', text: string) => void;
  toasts: ToastMessage[];
  dismissToast: (id: string) => void;
}

const AppContext = createContext<AppContextValue | null>(null);

export const AppProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [token, setTokenState] = useState<string | null>(null);
  const [featureFlags, setFeatureFlags] = useState<Set<string>>(new Set());
  const [health, setHealth] = useState<HealthInfo | null>(null);
  const [cartCount, setCartCount] = useState(0);
  const [unreadNotifications, setUnreadNotifications] = useState(0);
  const [wishlistIds, setWishlistIds] = useState<Set<string>>(new Set());
  const [compareIds, setCompareIds] = useState<string[]>([]);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const notify = useCallback((type: 'success' | 'error' | 'info', text: string) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    setToasts((prev) => [...prev.slice(-3), { id, type, text }]);
    window.setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4500);
  }, []);

  useEffect(() => {
    apiRequest<HealthInfo>('/api/health')
      .then((h) => {
        setHealth(h);
        setFeatureFlags(new Set(h.feature_flags || []));
      })
      .catch(() => {});

    apiRequest<{ authenticated: boolean; user: UserProfile | null }>('/api/auth/session')
      .then((res) => {
        if (res.authenticated && res.user) {
          setUser(res.user);
          setTokenState((prev) => prev || 'cookie-authenticated');
        }
      })
      .catch(() => {});
  }, []);

  const refreshCartCount = useCallback(async () => {
    if (!token) {
      setCartCount(0);
      return;
    }
    try {
      const data = await apiRequest<{ items: Array<{ quantity: number }> }>('/api/cart', { token });
      setCartCount(data.items.reduce((acc, i) => acc + i.quantity, 0));
    } catch {
      setCartCount(0);
    }
  }, [token]);

  const refreshNotifications = useCallback(async () => {
    if (!token) {
      setUnreadNotifications(0);
      return;
    }
    try {
      const data = await apiRequest<{ unread_count: number }>('/api/notifications?unread=true', { token });
      setUnreadNotifications(data.unread_count || 0);
    } catch {
      setUnreadNotifications(0);
    }
  }, [token]);

  const refreshWishlist = useCallback(async () => {
    if (!token || !featureFlags.has('FEATURE_WISHLIST')) {
      setWishlistIds(new Set());
      return;
    }
    try {
      const data = await apiRequest<{ items: Array<{ product_id: string }> }>('/api/wishlist', { token });
      setWishlistIds(new Set(data.items.map((i) => i.product_id)));
    } catch {
      setWishlistIds(new Set());
    }
  }, [token, featureFlags]);

  useEffect(() => {
    if (token) {
      refreshCartCount();
      refreshNotifications();
      refreshWishlist();
    } else {
      setCartCount(0);
      setUnreadNotifications(0);
      setWishlistIds(new Set());
    }
  }, [token, refreshCartCount, refreshNotifications, refreshWishlist]);

  const login = useCallback(async (email: string, secretValue: string): Promise<UserProfile> => {
    const resp = await apiRequest<{ token: string; user: UserProfile }>('/api/auth/login', {
      method: 'POST',
      body: { email, ['password']: secretValue },
      token: null,
    });
    setAuthToken(resp.token);
    setTokenState(resp.token);
    setUser(resp.user);
    return resp.user;
  }, []);

  const logout = useCallback(() => {
    apiRequest('/api/auth/logout', { method: 'POST' }).catch(() => {});
    setAuthToken(null);
    setTokenState(null);
    setUser(null);
    setCartCount(0);
    setUnreadNotifications(0);
    setWishlistIds(new Set());
  }, []);

  const toggleWishlist = useCallback(
    async (productId: string) => {
      if (!token) {
        notify('info', 'Sign in to save items to your wishlist.');
        return;
      }
      try {
        const resp = await apiRequest<{ wishlisted: boolean }>('/api/wishlist/toggle', {
          method: 'POST',
          body: { product_id: productId },
          token,
        });
        setWishlistIds((prev) => {
          const next = new Set(prev);
          if (resp.wishlisted) next.add(productId);
          else next.delete(productId);
          return next;
        });
        notify('success', resp.wishlisted ? 'Saved to wishlist.' : 'Removed from wishlist.');
      } catch {
        notify('error', 'Could not update wishlist.');
      }
    },
    [token, notify]
  );

  const toggleCompareId = useCallback(
    (productId: string) => {
      setCompareIds((prev) => {
        if (prev.includes(productId)) {
          return prev.filter((id) => id !== productId);
        }
        if (prev.length >= 3) {
          notify('info', 'You can compare up to 3 products side by side.');
          return prev;
        }
        return [...prev, productId];
      });
    },
    [notify]
  );

  return (
    <AppContext.Provider
      value={{
        user,
        token,
        featureFlags,
        health,
        cartCount,
        unreadNotifications,
        wishlistIds,
        compareIds,
        login,
        logout,
        refreshCartCount,
        refreshNotifications,
        toggleWishlist,
        toggleCompareId,
        notify,
        toasts,
        dismissToast,
      }}
    >
      {children}
    </AppContext.Provider>
  );
};

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used within AppProvider');
  return ctx;
}
