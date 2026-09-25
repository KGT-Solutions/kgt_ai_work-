import '../styles/globals.css';
import { AlertProvider } from '../components/AppAlert';

export default function App({ Component, pageProps }) {
  return (
    <AlertProvider>
      <Component {...pageProps} />
    </AlertProvider>
  );
}
