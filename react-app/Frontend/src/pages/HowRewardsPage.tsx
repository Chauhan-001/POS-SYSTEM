import { PageShell } from '../components/layout/PageShell'
import { BottomNav } from '../components/layout/BottomNav'
import ShaderBackgroundWebGL from '../components/background/ShaderBackgroundWebGL'

const steps = [
  {
    span: 'md:col-span-4',
    icon: 'qr_code_scanner',
    badge: 'Step 01',
    badgeClass: 'bg-secondary-fixed text-on-secondary-fixed-variant',
    iconClass: 'bg-secondary-container text-on-secondary-container',
    title: 'Scan at Counter',
    body: 'Open your Chaish app at checkout. Simply scan your unique loyalty ID before you pay to track your visit.',
    cta: 'Get started with Scan',
    image: undefined as string | undefined,
  },
  {
    span: 'md:col-span-8',
    icon: 'stars',
    badge: 'Step 02',
    badgeClass: 'bg-primary-fixed text-on-primary-fixed-variant',
    iconClass: 'bg-primary-container text-on-primary',
    title: 'Earn Points Daily',
    body: 'For every ₹100 you spend, you earn 10 points. Watch your progress grow as you unlock premium tiers—from Silver Chai-Lover to Gold Elixir status.',
    cta: undefined,
    progress: { value: '650 / 1000 Pts', note: 'Gold Tier Near!' },
    image:
      'https://lh3.googleusercontent.com/aida-public/AB6AXuBu_CxyKhRSG9cCFvXDkLbQITqYBIXIc4OHTljtaj25tsx4LjZXwCDKvfDHiQspAwe8AhWOlbuW4serpV-VKF_eEh2MjylRR2NGJlBZjwDpsJ9WqZbnhHKxqiwXNQXI3piwzcpFv1HUBD5LAfBaxS_dtojv6zSb7Ga1zxc9lPdVN_zE0ZsePYl4Cnahw8zqG-Qsbzf27CtiQOULGAKHhs7KdhjWlKCp6l6iDczeUfwbyhFysfY_Nxy1UOHi62blw3AtSzL1vqfNWHYQ',
  },
  {
    span: 'md:col-span-7',
    icon: 'redeem',
    badge: 'Step 03',
    badgeClass: 'bg-secondary-container text-on-secondary-container',
    iconClass: 'bg-warm-cream text-secondary',
    title: 'Redeem & Indulge',
    body: 'Exchange your earned points for free drinks, artisanal snacks, or exclusive limited-edition merchandise. The more you visit, the better it tastes.',
    cta: undefined,
    image:
      'https://lh3.googleusercontent.com/aida-public/AB6AXuD2xujjmfFnibdw8k5zAP5E9Dcak2TV73vbYZkmfaAvSoxGunI45-mHM64VWm86aH2ztrcVj6VAnYSQUFaEorq6_Q8LwRMGn-ULTeOwtq2YQ_wS2bWuk_azkxbaZr7tuh8nNCkRzBcfNxLBZO7og1xiRdYU48FgJM80RcsCBbkoVjX4bDZ8T3KG2NpdugyKPw2Ol5ApvNR-dDPE99wwtc2ee4MmciBT9eQ2LIuIfdglBiFbhLkmTOx_LVWXrDI-CJtDksO79_gtyzAE',
  },
  {
    span: 'md:col-span-5',
    icon: 'local_activity',
    badge: 'Current Offers',
    badgeClass: 'text-primary',
    iconClass: '',
    title: undefined,
    body: undefined,
    cta: undefined,
    offers: true,
  },
]

const offers = [
  {
    name: 'Free Masala Chai',
    points: '250 Points',
    icon: 'coffee',
    iconClass: 'bg-primary-fixed text-primary',
    locked: false,
  },
  {
    name: 'Signature Mawa Cake',
    points: '500 Points',
    icon: 'cake',
    iconClass: 'bg-secondary-fixed text-secondary',
    locked: true,
  },
]

const benefits = [
  {
    title: 'Birthday Treats',
    body: 'Surprise rewards and a free dessert on your special day.',
  },
  {
    title: 'Member-Only Access',
    body: 'Get first dibs on seasonal blends and limited launch events.',
  },
  {
    title: 'Fast-Track Checkout',
    body: 'Skip the line and order ahead via the app for priority pickup.',
  },
]

export default function HowRewardsPage() {
  return (
    <PageShell withBottomNav className="relative overflow-x-hidden">
      <ShaderBackgroundWebGL opacity={0.06} />

      {/* Header Navigation Shell */}
      <header className="py-4 md:py-6 px-container-margin flex justify-center items-center relative z-10">
        <div className="w-24 h-24 md:w-40 md:h-40 flex items-center justify-center">
          <img
            alt="Chaish Logo"
            className="w-full h-full object-contain"
            src="https://lh3.googleusercontent.com/aida-public/AB6AXuDSyn7GeumPteMfxUmERH34PO79exCuC_ocC-Nzt15PWttFFk1iJOs6lII4jZJ0ZBuTZ2VpOB0q7t03iLIEwxD6qWjzHNwkzQmgsfVSVvU9r8HiVdudy-wFlYU1ozr2UaSWnIMplCfAlyTM_X2pky6SExnuvWmBmnkcVgpQ-86SOEv9MzhnRjPgbNbJmzS9IC35FtspVdRWZCsDMwUm0uNoDSQS3OwzAGCmZYgFcn6SRCC136mtwCq27fdIvgk_ZsSw3m_8I1HB5swU"
          />
        </div>
      </header>

      <main className="pb-32 relative z-10">
        <div className="max-w-[1200px] mx-auto px-container-margin">
          {/* Hero Title */}
          <section className="mb-section-gap text-center warm-glow">
            <h1 className="font-headline-xl text-headline-xl text-on-background mb-3 md:mb-4">
              How Rewards Work
            </h1>
            <p className="font-body-lg text-body-lg text-on-surface-variant max-w-2xl mx-auto">
              Turn every sip into a celebration. Experience our tiered loyalty
              program designed to reward your daily rituals with exclusive
              boutique perks.
            </p>
          </section>

          {/* Bento Grid - Step by Step */}
          <div className="grid grid-cols-1 md:grid-cols-12 gap-3 md:gap-gutter">
            {steps.map((step) => {
              if (step.offers) {
                return (
                  <div
                    key="offers"
                    className="md:col-span-5 glass-card rounded-[32px] p-8 flex flex-col premium-shadow hover-lift"
                  >
                    <h4 className="font-title-md text-title-md text-on-background mb-6 flex items-center gap-2">
                      <span className="material-symbols-outlined text-primary">
                        {step.icon}
                      </span>
                      {step.badge}
                    </h4>
                    <div className="space-y-4">
                      {offers.map((offer) => (
                        <div
                          key={offer.name}
                          className={[
                            'flex items-center gap-4 p-4 rounded-2xl bg-surface-container hover:bg-surface-container-high transition-colors cursor-pointer border border-outline-variant/30',
                            offer.locked ? 'opacity-70' : '',
                          ].join(' ')}
                        >
                          <div
                            className={[
                              'w-12 h-12 rounded-full flex items-center justify-center',
                              offer.iconClass,
                            ].join(' ')}
                          >
                            <span className="material-symbols-outlined">
                              {offer.icon}
                            </span>
                          </div>
                          <div className="flex-1">
                            <p className="font-label-md text-on-surface">
                              {offer.name}
                            </p>
                            <p className="text-xs text-on-surface-variant">
                              {offer.points}
                            </p>
                          </div>
                          {offer.locked ? (
                            <span className="material-symbols-outlined text-on-surface-variant">
                              lock
                            </span>
                          ) : (
                            <button className="px-4 py-2 bg-primary text-white text-label-sm font-label-sm rounded-full">
                              Unlock
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                    <div className="mt-auto pt-6">
                      <button className="w-full py-4 bg-rich-black text-white rounded-2xl font-label-md hover:shadow-lg transition-all flex items-center justify-center gap-2">
                        <span>Explore Reward Store</span>
                        <span className="material-symbols-outlined text-sm">
                          arrow_outward
                        </span>
                      </button>
                    </div>
                  </div>
                )
              }

              if (step.image && step.cta === undefined) {
                // Step 03 - image card
                return (
                  <div
                    key={step.title}
                    className={[
                      step.span,
                      'h-[300px] md:h-[400px] relative rounded-[24px] md:rounded-[32px] overflow-hidden premium-shadow group',
                    ].join(' ')}
                  >
                    <div
                      className="absolute inset-0 bg-cover bg-center transition-transform duration-700 group-hover:scale-110"
                      style={{ backgroundImage: `url('${step.image}')` }}
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-rich-black/80 via-transparent to-transparent" />
                    <div className="absolute bottom-0 left-0 p-8 w-full">
                      <div className="flex items-center gap-4 mb-4">
                        <div className="w-12 h-12 rounded-xl bg-warm-cream flex items-center justify-center">
                          <span className="material-symbols-outlined text-secondary text-2xl icon-fill">
                            {step.icon}
                          </span>
                        </div>
                        <span
                          className={[
                            'px-3 py-1 rounded-full text-label-sm font-label-sm',
                            step.badgeClass,
                          ].join(' ')}
                        >
                          {step.badge}
                        </span>
                      </div>
                      <h3 className="font-headline-lg text-headline-lg text-white mb-2">
                        {step.title}
                      </h3>
                      <p className="font-body-md text-white/80 max-w-md">
                        {step.body}
                      </p>
                    </div>
                  </div>
                )
              }

              // Step 01 / Step 02 cards
              return (
                <div
                  key={step.title}
                  className={[
                    step.span,
                    'glass-card rounded-[32px] overflow-hidden flex flex-col md:flex-row premium-shadow hover-lift',
                  ].join(' ')}
                >
                  <div className="md:w-1/2 p-8 flex flex-col justify-center">
                    <div
                      className={[
                        'w-16 h-16 rounded-2xl flex items-center justify-center mb-6',
                        step.iconClass,
                      ].join(' ')}
                    >
                      <span className="material-symbols-outlined text-4xl icon-fill">
                        {step.icon}
                      </span>
                    </div>
                    <div>
                      <span
                        className={[
                          'inline-block px-3 py-1 rounded-full text-label-sm font-label-sm mb-3',
                          step.badgeClass,
                        ].join(' ')}
                      >
                        {step.badge}
                      </span>
                      <h3 className="font-headline-lg-mobile text-headline-lg-mobile text-on-background mb-3">
                        {step.title}
                      </h3>
                      <p className="font-body-md text-body-md text-on-surface-variant">
                        {step.body}
                      </p>
                      {step.cta && (
                        <div className="mt-6 flex items-center gap-2 text-primary font-label-md cursor-pointer">
                          <span>{step.cta}</span>
                          <span className="material-symbols-outlined text-sm">
                            arrow_forward
                          </span>
                        </div>
                      )}
                    </div>
                    {step.progress && (
                      <div className="mt-8">
                        <div className="h-4 w-full bg-surface-container-high rounded-full overflow-hidden">
                          <div className="h-full w-2/3 bg-gradient-to-r from-primary to-sunset-orange rounded-full" />
                        </div>
                        <div className="flex justify-between mt-2">
                          <span className="text-label-sm font-label-sm text-on-surface-variant">
                            {step.progress.value}
                          </span>
                          <span className="text-label-sm font-label-sm text-primary">
                            {step.progress.note}
                          </span>
                        </div>
                      </div>
                    )}
                  </div>
                  {step.image && (
                    <div
                      className="md:w-1/2 min-h-[300px] bg-cover bg-center"
                      style={{ backgroundImage: `url('${step.image}')` }}
                    />
                  )}
                </div>
              )
            })}
          </div>

          {/* Program Benefits */}
          <section className="mt-section-gap">
            <div className="glass-card rounded-[24px] md:rounded-[40px] p-5 md:p-10 xl:p-16 relative overflow-hidden premium-shadow paper-grain">
              <div className="relative z-10 grid grid-cols-1 md:grid-cols-2 gap-12 items-center">
                <div>
                  <h2 className="font-headline-lg text-headline-lg text-on-background mb-6">
                    Exclusive Benefits for Every Member
                  </h2>
                  <ul className="space-y-6">
                    {benefits.map((benefit) => (
                      <li key={benefit.title} className="flex gap-4">
                        <div className="mt-1 flex-shrink-0 w-6 h-6 rounded-full bg-deep-teal/20 flex items-center justify-center">
                          <span className="material-symbols-outlined text-deep-teal text-sm">
                            check
                          </span>
                        </div>
                        <div>
                          <p className="font-title-md text-title-md text-on-background leading-tight">
                            {benefit.title}
                          </p>
                          <p className="font-body-md text-on-surface-variant">
                            {benefit.body}
                          </p>
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="flex justify-center">
                  <div className="relative w-full max-w-[320px] aspect-[4/5] rounded-[48px] bg-white p-4 shadow-2xl rotate-3">
                    <div className="w-full h-full rounded-[36px] bg-gradient-to-br from-primary via-primary to-sunset-orange p-8 flex flex-col justify-between text-white relative overflow-hidden">
                      <div className="absolute -top-10 -right-10 w-40 h-40 opacity-20 bg-white/20 rounded-full blur-2xl" />
                      <div>
                        <div className="w-12 h-12 rounded-full bg-white/20 backdrop-blur-md mb-6 flex items-center justify-center">
                          <span className="material-symbols-outlined text-white">
                            loyalty
                          </span>
                        </div>
                        <p className="font-headline-lg-mobile text-headline-lg-mobile font-extrabold leading-none">
                          GOLD
                          <br />
                          STATUS
                        </p>
                      </div>
                      <div>
                        <p className="text-xs font-label-sm tracking-widest opacity-80 uppercase mb-1">
                          Membership ID
                        </p>
                        <p className="font-title-md tracking-tighter">
                          CS - 8820 - 4192
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </section>
        </div>
      </main>

      <BottomNav />
    </PageShell>
  )
}
