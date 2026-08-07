import { useQuery } from '@tanstack/react-query'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  LineChart, Line, AreaChart, Area,
} from 'recharts'
import { Card, CardHeader, CardTitle } from '../components/ui/Card'
import { Skeleton } from '../components/ui/Skeleton'
import { ErrorPage } from '../components/ui/ErrorPage'
import { getAnalytics } from '../api/analytics'

export default function Analytics() {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['analytics'],
    queryFn: getAnalytics,
  })

  if (error) return <ErrorPage message={(error as any).message} onRetry={() => refetch()} />

  const chartCard = (title: string, children: React.ReactNode) => (
    <Card className="col-span-1">
      <CardHeader><CardTitle>{title}</CardTitle></CardHeader>
      <div className="h-72">{children}</div>
    </Card>
  )

  const LoadingChart = () => <div className="flex h-72 items-center justify-center"><Skeleton className="h-64 w-full" /></div>

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-surface-900 dark:text-surface-100">Analytics</h1>
        <p className="mt-1 text-sm text-surface-500 dark:text-surface-400">Platform analytics and insights</p>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {chartCard('Restaurant Growth',
          isLoading ? <LoadingChart /> : (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={data?.restaurantGrowth || []}>
                <defs>
                  <linearGradient id="colorGrowth" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#6366f1" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="name" tick={{ fontSize: 12 }} stroke="#94a3b8" />
                <YAxis tick={{ fontSize: 12 }} stroke="#94a3b8" />
                <Tooltip />
                <Area type="monotone" dataKey="value" stroke="#6366f1" fillOpacity={1} fill="url(#colorGrowth)" />
              </AreaChart>
            </ResponsiveContainer>
          )
        )}

        {chartCard('Daily Logins',
          isLoading ? <LoadingChart /> : (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data?.dailyLogins || []}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="name" tick={{ fontSize: 12 }} stroke="#94a3b8" />
                <YAxis tick={{ fontSize: 12 }} stroke="#94a3b8" />
                <Tooltip />
                <Bar dataKey="value" fill="#6366f1" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )
        )}

        {chartCard('Subscriptions',
          isLoading ? <LoadingChart /> : (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={data?.subscriptions || []}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="name" tick={{ fontSize: 12 }} stroke="#94a3b8" />
                <YAxis tick={{ fontSize: 12 }} stroke="#94a3b8" />
                <Tooltip />
                <Line type="monotone" dataKey="value" stroke="#22c55e" strokeWidth={2} dot={{ fill: '#22c55e' }} />
              </LineChart>
            </ResponsiveContainer>
          )
        )}

        {chartCard('AI Usage',
          isLoading ? <LoadingChart /> : (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={data?.aiUsage || []}>
                <defs>
                  <linearGradient id="colorAI" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#f59e0b" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="name" tick={{ fontSize: 12 }} stroke="#94a3b8" />
                <YAxis tick={{ fontSize: 12 }} stroke="#94a3b8" />
                <Tooltip />
                <Area type="monotone" dataKey="value" stroke="#f59e0b" fillOpacity={1} fill="url(#colorAI)" />
              </AreaChart>
            </ResponsiveContainer>
          )
        )}
      </div>

      <Card>
        <CardHeader><CardTitle>Most Active Restaurants</CardTitle></CardHeader>
        <div className="h-72">
          {isLoading ? <LoadingChart /> : (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data?.mostActiveRestaurants || []} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis type="number" tick={{ fontSize: 12 }} stroke="#94a3b8" />
                <YAxis dataKey="name" type="category" tick={{ fontSize: 12 }} stroke="#94a3b8" width={120} />
                <Tooltip />
                <Bar dataKey="value" fill="#6366f1" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </Card>
    </div>
  )
}
