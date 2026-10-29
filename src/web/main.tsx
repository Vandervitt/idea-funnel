import { StrictMode, useEffect, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router';
import { QueryClientProvider, useQuery } from '@tanstack/react-query';
import { api, ApiError, queryClient, UNAUTHORIZED_EVENT } from './api';
import { ToastProvider } from './components/ui';
import { StageMoverProvider } from './components/StageMover';
import { Layout } from './components/Layout';
import { BoardPage } from './pages/BoardPage';
import { ListPage } from './pages/ListPage';
import { ReviewPage } from './pages/ReviewPage';
import { LoginPage } from './pages/LoginPage';
import { SettingsPage } from './pages/SettingsPage';
import './styles.css';

function RequireAuth({ children }: { children: ReactNode }) {
  const location = useLocation();
  const navigate = useNavigate();
  const next = encodeURIComponent(location.pathname + location.search);
  const me = useQuery({ queryKey: ['me'], queryFn: () => api('/me'), retry: false, staleTime: Infinity });

  // Any 401 later on (session expired) sends the user back to login.
  useEffect(() => {
    const onUnauthorized = () => {
      queryClient.clear();
      navigate(`/login?next=${next}`, { replace: true });
    };
    window.addEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
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
              <Route path="settings" element={<SettingsPage />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Route>
          </Routes>
        </BrowserRouter>
      </ToastProvider>
    </QueryClientProvider>
  </StrictMode>,
);
