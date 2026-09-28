import '../styles/globals.css';
import { ToastProvider } from '../components/ui/toast';

// Pages can export `getLayout` to keep a shared shell mounted across route
// changes (the dashboard's sidebar and session stay put while its subpages switch).
export default function App({ Component, pageProps }) {
  const getLayout = Component.getLayout || ((page) => page);
  return <ToastProvider>{getLayout(<Component {...pageProps} />)}</ToastProvider>;
}
