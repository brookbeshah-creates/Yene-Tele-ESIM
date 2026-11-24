import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';

interface RouterContextValue {
  pathname: string;
  search: string;
  navigate: (to: string, options?: { replace?: boolean }) => void;
}

const RouterContext = createContext<RouterContextValue | null>(null);

function parseLocation(urlOrPath: string): { pathname: string; search: string } {
  const normalized = urlOrPath.startsWith('/') ? urlOrPath : `/${urlOrPath}`;
  const qIndex = normalized.indexOf('?');
  if (qIndex === -1) {
    return { pathname: normalized || '/', search: '' };
  }
  return {
    pathname: normalized.slice(0, qIndex) || '/',
    search: normalized.slice(qIndex),
  };
}

export function RouterProvider({ children }: { children: React.ReactNode }) {
  const [locationState, setLocationState] = useState<{ pathname: string; search: string }>(() => ({
    pathname: window.location.pathname || '/',
    search: window.location.search || '',
  }));

  useEffect(() => {
    const handlePop = () => {
      setLocationState({
        pathname: window.location.pathname || '/',
        search: window.location.search || '',
      });
    };
    window.addEventListener('popstate', handlePop);
    return () => window.removeEventListener('popstate', handlePop);
  }, []);

  const navigate = useCallback((to: string, options?: { replace?: boolean }) => {
    const target = to.startsWith('/') ? to : `/${to}`;
    if (options?.replace) {
      window.history.replaceState({}, '', target);
    } else {
      window.history.pushState({}, '', target);
    }
    setLocationState(parseLocation(target));
    window.scrollTo({ top: 0, behavior: 'auto' });
  }, []);

  return (
    <RouterContext.Provider
      value={{
        pathname: locationState.pathname,
        search: locationState.search,
        navigate,
      }}
    >
      {children}
    </RouterContext.Provider>
  );
}

export function useRouter(): RouterContextValue {
  const ctx = useContext(RouterContext);
  if (!ctx) throw new Error('useRouter must be used inside RouterProvider');
  return ctx;
}
