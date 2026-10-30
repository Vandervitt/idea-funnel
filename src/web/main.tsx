import { StrictMode, useEffect, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router';
import { QueryClientProvider } from '@tanstack/react-query';
import { ApiError, AUTH_CHANGE_KEY, queryClient, UNAUTHORIZED_EVENT, useMe } from './api';
import { ToastProvider } from './components/ui';
import { StageMoverProvider } from './components/StageMover';
import { Layout } from './components/Layout';
import { BoardPage } from './pages/BoardPage';
import { ListPage } from './pages/ListPage';
import { InsightsPage } from './pages/InsightsPage';
import { ReviewPage } from './pages/ReviewPage';
import { LoginPage } from './pages/LoginPage';
import { SettingsPage } from './pages/SettingsPage';
import './styles.css';

function RequireAuth({ children }: { children: ReactNode }) {
  const location = useLocation();
  const navigate = useNavigate();
  const next = encodeURIComponent(location.pathname + location.search);
  const me = useMe();

  // Any 401 later on (session expired) sends the user back to login.
  useEffect(() => {
    const onUnauthorized = () => {
      queryClient.clear();
      navigate(`/login?next=${next}`, { replace: true });
    };
    const onAuthChange = (event: StorageEvent) => {
      if (event.key === AUTH_CHANGE_KEY) window.location.reload();
    };
    window.addEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
    window.addEventListener('storage', onAuthChange);
    return () => {
      window.removeEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
      window.removeEventListener('storage', onAuthChange);
    };
  }, [navigate, next]);

  if (me.isPending) return null;
  if (me.error instanceof ApiError && me.error.status === 401) return <Navigate to={`/login?next=${next}`} replace />;
  if (me.isError) return <p className="p-8 text-danger">服务暂时不可用，请稍后刷新重试。</p>;
  return children;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route element={<RequireAuth><StageMoverProvider><Layout /></StageMoverProvider></RequireAuth>}>
              <Route index element={<BoardPage />} />
              <Route path="list" element={<ListPage />} />
              <Route path="review" element={<ReviewPage />} />
              <Route path="insights" element={<InsightsPage />} />
              <Route path="settings" element={<SettingsPage />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Route>
          </Routes>
        </BrowserRouter>
      </ToastProvider>
    </QueryClientProvider>
  </StrictMode>,
);
