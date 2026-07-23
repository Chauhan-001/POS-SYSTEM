import { Route, Routes, useLocation } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { LoginPage } from './pages/LoginPage'
import OTPVerificationPage from './pages/OTPVerificationPage'
import DashboardPage from './pages/DashboardPage'
import HowRewardsPage from './pages/HowRewardsPage'
import MenuPage from './pages/MenuPage'
import RewardsWalletPage from './pages/RewardsWalletPage'
import ProfilePage from './pages/ProfilePage'
import UltimateQrPage from './pages/UltimateQrPage'
import LandingPage from './pages/LandingPage'
import RedemptionHistoryPage from './pages/RedemptionHistoryPage'
import { PageShell } from './components/layout/PageShell'
import { GreenChilliCursor } from './components/ui/GreenChilliCursor'

const pageTransition = {
  initial: { opacity: 0, y: 12, scale: 0.98 },
  animate: { opacity: 1, y: 0, scale: 1 },
  exit: { opacity: 0, y: -8, scale: 0.98 },
  transition: { duration: 0.35, ease: [0.22, 1, 0.36, 1] as const },
}

export default function App() {
  const location = useLocation()

  return (
    <>
      <GreenChilliCursor />
      <AnimatePresence mode="wait">
      <motion.div key={location.pathname} {...pageTransition}>
        <Routes location={location}>
          <Route path="/" element={<LandingPage />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/otp-verification" element={<OTPVerificationPage />} />
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/how-rewards" element={<HowRewardsPage />} />
          <Route path="/menu" element={<MenuPage />} />
          <Route path="/rewards-wallet" element={<RewardsWalletPage />} />
          <Route path="/redemption-history" element={<RedemptionHistoryPage />} />
          <Route path="/profile" element={<ProfilePage />} />
          <Route path="/ultimate-qr" element={<UltimateQrPage />} />
          <Route
            path="*"
            element={
              <PageShell>
                <main className="min-h-dvh p-6 flex items-center justify-center">
                  <div className="text-center space-y-3">
                    <h1 className="text-2xl font-bold text-primary">Not Found</h1>
                    <p className="text-slate-600">Route placeholder (placeholder only).</p>
                  </div>
                </main>
              </PageShell>
            }
          />
        </Routes>
      </motion.div>
    </AnimatePresence>
    </>
  )
}
