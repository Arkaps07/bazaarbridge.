import React, { Suspense } from 'react';
import { BrowserRouter, Link, Route, Routes } from 'react-router-dom';
import { AppProvider } from './context/AppContext';
import { Layout } from './components/Layout';
import { HomePage } from './pages/HomePage';
import { LoginPage } from './pages/LoginPage';
import { AdminLoginPage } from './pages/AdminLoginPage';
import { SearchPage } from './pages/SearchPage';
import { ProductDetailPage } from './pages/ProductDetailPage';
import { DealerComparisonPage } from './pages/DealerComparisonPage';
import { OutsideBangalorePage } from './pages/OutsideBangalorePage';
import { CartPage } from './pages/CartPage';
import { CheckoutPage } from './pages/CheckoutPage';
import { OrdersPage } from './pages/OrdersPage';
import { OrderTrackingPage } from './pages/OrderTrackingPage';
import { AdminDashboardPage } from './pages/AdminDashboardPage';
import { AssistantPage } from './pages/AssistantPage';
import { WishlistPage } from './pages/WishlistPage';
import { CompareSpecsPage } from './pages/CompareSpecsPage';
import { SimulatedOpsPage, SimulatedSupportPage } from './simulated/SimulatedScreens';

const NotFoundPage: React.FC = () => (
  <div className="max-w-xl mx-auto px-4 py-20 text-center space-y-4">
    <h1 className="text-3xl font-bold text-[#111827]" style={{ fontFamily: 'var(--font-display)' }}>
      Page not found
    </h1>
    <p className="text-sm text-[#64748B]">
      The page you are looking for does not exist in BazaarBridge.
    </p>
    <Link
      to="/"
      className="inline-block rounded-lg bg-[#4F46E5] hover:bg-[#4338CA] px-5 py-2.5 text-sm font-semibold text-white"
    >
      Back to Marketplace Home
    </Link>
  </div>
);

export function App() {
  return (
    <BrowserRouter>
      <AppProvider>
        <Layout>
          <Suspense
            fallback={
              <div className="max-w-7xl mx-auto px-4 py-12">
                <div className="h-64 rounded-2xl bg-white border border-[#E2E8F0] animate-pulse" />
              </div>
            }
          >
            <Routes>
              <Route path="/" element={<HomePage />} />
              <Route path="/login" element={<LoginPage />} />
              <Route path="/admin-login" element={<AdminLoginPage />} />
              <Route path="/search" element={<SearchPage />} />
              <Route path="/products" element={<SearchPage />} />
              <Route path="/products/:id" element={<ProductDetailPage />} />
              <Route path="/products/:id/compare" element={<DealerComparisonPage />} />
              <Route path="/outside-bangalore" element={<OutsideBangalorePage />} />
              <Route path="/cart" element={<CartPage />} />
              <Route path="/checkout" element={<CheckoutPage />} />
              <Route path="/orders" element={<OrdersPage />} />
              <Route path="/orders/:id" element={<OrderTrackingPage />} />
              <Route path="/admin" element={<AdminDashboardPage />} />
              <Route path="/assistant" element={<AssistantPage />} />
              <Route path="/wishlist" element={<WishlistPage />} />
              <Route path="/compare" element={<CompareSpecsPage />} />
              <Route path="/simulated/ops" element={<SimulatedOpsPage />} />
              <Route path="/simulated/support" element={<SimulatedSupportPage />} />
              <Route path="*" element={<NotFoundPage />} />
            </Routes>
          </Suspense>
        </Layout>
      </AppProvider>
    </BrowserRouter>
  );
}

export default App;
