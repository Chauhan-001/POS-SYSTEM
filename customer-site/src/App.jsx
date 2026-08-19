import { HashRouter, Route, Routes, useParams } from 'react-router-dom';
import { SessionProvider } from './context/SessionContext';
import Home from './pages/Home';
import MenuPage from './pages/MenuPage';
import CartPage from './pages/CartPage';
import TrackPage from './pages/TrackPage';
import ReceiptPage from './pages/ReceiptPage';

/**
 * The QR sticker URL looks like:  http://host/#/{publicToken}?mode=table&ref=…
 * HashRouter keeps it working on static hosts / LAN deployments with no
 * server-side rewrites. mode + ref (table id / parking slot) ride in the
 * query string so the site knows where the customer is.
 */
function QrRoute() {
  const { token } = useParams();
  return <SessionProvider key={token} token={token} />;
}

export default function App() {
  return (
    <HashRouter>
      <Routes>
        <Route path="/" element={<Home />} />
        {/* Receipt QR landing: #/r/{receiptToken} — standalone (no store token
         * needed; the receipt token itself resolves restaurant + bill). */}
        <Route path="/r/:receiptToken" element={<ReceiptPage />} />
        {/* QR ordering entry: #/{token}?mode=table|car|pickup&ref=… */}
        <Route path="/:token" element={<QrRoute />}>
          <Route index element={<MenuPage />} />
          <Route path="cart" element={<CartPage />} />
          <Route path="track" element={<TrackPage />} />
        </Route>
        <Route path="*" element={<Home />} />
      </Routes>
    </HashRouter>
  );
}
