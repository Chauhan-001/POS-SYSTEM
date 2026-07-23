import { Link } from 'react-router-dom'
import { PageShell } from '../components/layout/PageShell'
import { BottomNav } from '../components/layout/BottomNav'

type Redemption = {
  id: number
  name: string
  points: string
  date: string
  status: 'completed' | 'expired' | 'pending'
  image: string
}

const redemptions: Redemption[] = [
  {
    id: 1,
    name: 'Free Brownie',
    points: '200 pts',
    date: 'Mar 15, 2026',
    status: 'completed',
    image: 'https://lh3.googleusercontent.com/aida-public/AB6AXuA_BZTJSkGSkn-q_jvQRRhBmOxgMBcC5n-srXEo5wxPl0xSqg2WAdkAaKP4fI96FRsaiqg_vhc_W71GigQy1mZLPWKib0imVqW9MlH7O4vf5qrgAy5eMcoaetogmvzfZNdNHlIb4O3l0GOq8SSckZuhxwKga9lhXw7CnhS-H1b301J0bgncfuCLTyIktm7czp31a4jfhjJ9bAC_O6y0EYhEikd0E4FcraL-YQ5eZNiyhAuWZKgDBhTsDOZUP5p0UP-Uuc0AoktvHwwd',
  },
  {
    id: 2,
    name: 'Any Hot Beverage',
    points: '350 pts',
    date: 'Feb 28, 2026',
    status: 'completed',
    image: 'https://lh3.googleusercontent.com/aida-public/AB6AXuA8wkX0Poo3BtdySMwM--qJEygP9HlwvkGJHpsRv6cACVepoeyt9GoD42pff8XZcWvEoTdEk5Gxj-h9GSdFK_XutUcaWIznBz--PhGrgHR5dIi-oVSeEIzXUthdDuDF2dD60rm-bmEAW0WQdbrgiH2SPeoQHoCRmcq-9kEE8k_ofH8bM1E1QvPsOPuYjE_W7AT5mEMYAB_c_1QY-w18T7iI_SvTDf6yPXmJQOliJEgkVwCV0b2TtJgY9ZoTHNPhiH8PfkzAC4dJW4MC',
  },
  {
    id: 3,
    name: 'Masala Chai',
    points: '100 pts',
    date: 'Jan 10, 2026',
    status: 'expired',
    image: 'https://lh3.googleusercontent.com/aida-public/AB6AXuBxBn9ghFot1lJYgWuKlnozk3dK_xFDRBcaOABhLgcRsbR0MTTL9BIibmG0BR_oKQmui-HrVSNjSBomTZiTsok3sjDutKQ11DFUCewUP2E9I_LPr9CNT4er5zPJKPiLDq2sapZfuHQ2IE8rYsj5jIabaa3CLc6rzG-NyVrEFOdKhE7YZzYcmyQZvXd1iPT1FdIp3d3Odvi7sblX55dtLtYxj806yzMEXDjez-ZZ8SqU24ebP1zAoJlvXmOaDyH_rIwLlqo_0h8VECxZ',
  },
  {
    id: 4,
    name: 'Bun Maska',
    points: '50 pts',
    date: 'Dec 22, 2025',
    status: 'completed',
    image: 'https://lh3.googleusercontent.com/aida-public/AB6AXuBLynb03nKN6mL1MsnSSw5HhntZylgqaLuurA3O9CQH6PhvpVMjrThn1tDcEtj6QdzqZWxsL4WYDWsUJ-w7UG_6kW5oY0nUkB3wG0XQ1y3-kR16oNay9vkuNw8rIGNEREmXNi0N9wz-YE8Zt7HXmLiOFM67QmJod0hIm5ksV_YdwRget-ZJzVbkgtL5FH9HoUQBo3wBNITudtgYfIZBwUyL8t1ZIeeGsM0TpuxYunZXqZhof3dxwDTPrI4q_ZDbkhM1HfH38dkaKfKa',
  },
]

const statusMap = {
  completed: { label: 'Completed', class: 'bg-tertiary-container text-on-tertiary-container' },
  expired: { label: 'Expired', class: 'bg-error-container text-on-error-container' },
  pending: { label: 'Pending', class: 'bg-secondary-container text-on-secondary-container' },
}

export default function RedemptionHistoryPage() {
  return (
    <PageShell withBottomNav className="relative min-h-screen pb-32">
      <header className="sticky top-0 z-50 bg-surface/80 backdrop-blur-xl border-b border-outline-variant/30 flex items-center justify-between w-full px-container-margin py-3">
        <div className="flex items-center gap-3">
          <Link
            to="/rewards-wallet"
            className="w-10 h-10 flex items-center justify-center rounded-full hover:bg-surface-container transition-colors"
          >
            <span className="material-symbols-outlined text-on-surface">arrow_back</span>
          </Link>
          <div>
            <h1 className="text-title-md font-title-md text-on-surface leading-tight">
              Redemption History
            </h1>
            <p className="text-label-sm font-label-sm text-on-surface-variant">
              {redemptions.length} redemptions
            </p>
          </div>
        </div>
      </header>

      <main className="px-container-margin mt-4">
        {redemptions.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <span className="material-symbols-outlined text-[64px] text-outline mb-4">
              redeem
            </span>
            <h2 className="text-headline-lg-mobile font-headline-lg-mobile text-on-surface mb-2">
              No redemptions yet
            </h2>
            <p className="text-body-md text-on-surface-variant max-w-xs">
              Start earning points and redeem your first reward to see it here.
            </p>
            <Link
              to="/menu"
              className="mt-6 px-6 py-3 bg-primary text-on-primary rounded-xl font-bold shadow-md hover:bg-primary/90 transition-colors"
            >
              Browse Menu
            </Link>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            {redemptions.map((item) => {
              const status = statusMap[item.status]
              return (
                <div
                  key={item.id}
                  className="bg-white/80 backdrop-blur-sm rounded-2xl p-4 flex gap-4 border border-outline-variant/30 hover:shadow-md transition-all"
                >
                  <div className="w-16 h-16 md:w-20 md:h-20 rounded-xl overflow-hidden shrink-0 shadow-sm">
                    <img
                      className="w-full h-full object-cover"
                      src={item.image}
                      alt={item.name}
                    />
                  </div>
                  <div className="flex flex-col justify-between flex-grow min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      <h3 className="font-bold text-on-surface text-sm">
                        {item.name}
                      </h3>
                      <span
                        className={`text-[10px] font-black px-2 py-0.5 rounded-full shrink-0 ${status.class}`}
                      >
                        {status.label}
                      </span>
                    </div>
                    <div className="flex items-center justify-between mt-1">
                      <span className="text-xs text-on-surface-variant">
                        {item.date}
                      </span>
                      <span className="text-xs font-bold text-primary">
                        {item.points}
                      </span>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </main>

      <BottomNav />
    </PageShell>
  )
}
