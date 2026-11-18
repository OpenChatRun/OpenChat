import { QueryClientProvider } from '@tanstack/react-query';
import { StrictMode, useEffect, useState, useSyncExternalStore } from 'react';
import { createRoot } from 'react-dom/client';
import { api, preference, queryClient, session } from './app-context';
import { LANGUAGE_PREFERENCE, startLocale, t } from './i18n';
import { ForgotPasswordPage, ResetPasswordPage, SetupPage, SetupUnconfiguredPage, SignInPage } from './pages/account-pages';
import { WorkspaceApp } from './pages/workspace-pages';
import { takeTokenFromUrl } from './session';
import { applyTheme } from './theme-picker';
import './styles.css';

startLocale(preference.get(LANGUAGE_PREFERENCE), navigator.languages ?? [navigator.language]);
applyTheme();

const path = window.location.pathname;
// Taken once at load, before anything renders, so that the token leaves the address bar at once.
const urlToken = path === '/reset-password' ? takeTokenFromUrl(window.location, window.history) : null;

function SignedInOrOut() {
  const signedIn = useSyncExternalStore(session.subscribe, session.isSignedIn);
  const [checking, setChecking] = useState(true);
  const [setup, setSetup] = useState<'ready' | 'needed' | 'unconfigured'>('ready');
  useEffect(() => {
    // The cookie may hold a session from an earlier visit. A new installation may still need its first admin:
    // if that cannot be found out, the sign-in page is the right thing to show.
    const setupStatus = api.getSetup().then((answer) => setSetup(answer.status), () => undefined);
    void Promise.all([session.refresh(), setupStatus]).finally(() => setChecking(false));
  }, []);
  if (signedIn) return <WorkspaceApp />;
  if (checking) return <p className="p-6 text-sm" role="status">{t('loading')}</p>;
  if (setup === 'needed') return <SetupPage />;
  if (setup === 'unconfigured') return <SetupUnconfiguredPage />;
  return path === '/forgot-password' ? <ForgotPasswordPage /> : <SignInPage />;
}

function App() {
  if (path === '/reset-password') return <ResetPasswordPage token={urlToken} />;
  return <SignedInOrOut />;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
);
