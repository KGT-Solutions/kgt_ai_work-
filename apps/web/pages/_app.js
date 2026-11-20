import { useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import '../styles/globals.css';
import { ToastProvider } from '../components/ui/toast';

// Pages can export `getLayout` to keep a shared shell mounted across route
// changes (the dashboard's sidebar and session stay put while its subpages switch).
export default function App({ Component, pageProps }) {
  // One client for the app's lifetime. Mutations (onboarding) don't need
  // aggressive refetching; reads default to a short stale window.
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { retry: false, refetchOnWindowFocus: false, staleTime: 30_000 },
          mutations: { retry: false }
        }
      })
  );
  const getLayout = Component.getLayout || ((page) => page);
  return (
    <QueryClientProvider client={queryClient}>
      <ToastProvider>{getLayout(<Component {...pageProps} />)}</ToastProvider>
    </QueryClientProvider>
  );
}
