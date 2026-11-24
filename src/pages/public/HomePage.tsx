import React, { useState } from 'react';
import {
  ArrowRight,
  CheckCircle2,
  ChevronDown,
  Cpu,
  CreditCard,
  Fingerprint,
  PhoneCall,
  ShieldCheck,
  Smartphone,
  Truck,
  Users,
} from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useLanguage } from '../../contexts/LanguageContext';
import { useRouter } from '../../router/RouterContext';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { AnimatedAtmosphere } from '../../components/yegna/AnimatedAtmosphere';
import {
  InfoFeatureCard,
  TrustHighlightCard,
} from '../../components/yegna/DomainCards';
import { OperatorLogoTiles } from '../../components/yegna/OperatorLogoTiles';

export function HomePage() {
  const { language } = useLanguage();
  const { firebaseUser } = useAuth();
  const { navigate } = useRouter();
  const [openFaq, setOpenFaq] = useState<number>(0);

  const steps = [
    {
      eyebrow: '01 · Operator',
      title: 'Choose Ethio telecom or Safaricom',
      description:
        'Select your preferred Ethiopian network operator and confirm whether your order is a new eSIM line.',
      icon: <Cpu className="h-4 w-4" />,
    },
    {
      eyebrow: '02 · Device Check',
      title: 'Confirm eSIM compatibility (*#06#)',
      description:
        'Verify your unlocked handset shows an EID number by dialing *#06# or browsing our device catalog.',
      icon: <Smartphone className="h-4 w-4" />,
    },
    {
      eyebrow: '03 · Fayda KYC',
      title: 'Verify subscriber identity',
      description:
        'Provide subscriber Fayda identity consent personally. Login authentication stays separate from telecom KYC.',
      icon: <Fingerprint className="h-4 w-4" />,
    },
    {
      eyebrow: '04 · Reserve & Pay',
      title: 'Pick your number & settle via Chapa',
      description:
        'Lock your preferred available number cleanly without duplicates, then complete server-verified ETB checkout.',
      icon: <CreditCard className="h-4 w-4" />,
    },
  ];

  const faqs = [
    {
      q: 'What is Yene Tele (የእኔ ቴሌኮም)?',
      a: 'Yene Tele is an Ethiopia-focused digital telecom reseller and eSIM management platform. We are not a mobile network operator; we partner with authorized Ethiopian operators to simplify buying, verifying, and installing eSIM profiles.',
    },
    {
      q: 'Which services are integrated into Yene Tele?',
      a: 'Yene Tele connects Ethio telecom and Safaricom Ethiopia eSIM ordering, Fayda identity consent verification, Chapa ETB checkout, and Klick handset delivery tracking in one mobile-first platform.',
    },
    {
      q: 'How can I check if my phone supports eSIM before ordering?',
      a: 'Dial *#06# on your phone keypad. If a 32-digit EID (Embedded Identity Document) appears alongside your IMEI, and your phone is carrier-unlocked, your device is eSIM-capable. Note that mainland China iPhone and Samsung variants generally omit hardware eSIM.',
    },
    {
      q: 'Why can an agent not submit my Fayda KYC on my behalf?',
      a: 'Telecom subscriber registration belongs strictly to the end customer. While authorized Yene Tele agents can refer customers using an attribution code, Fayda verification and subscriber consent must be completed by the subscriber directly.',
    },
  ];

  return (
    <div className="bg-white dark:bg-[#0B1220] text-[#111827] dark:text-[#F8FAFC]">
      {/* HERO SECTION — Exact Royal Blue + White Identity Preserved */}
      <section className="relative overflow-hidden border-b border-[#E5E7EB] dark:border-[#24344D] bg-gradient-to-b from-[#EEF3FF]/65 via-white to-white dark:from-[#0E1A35] dark:via-[#0B1220] dark:to-[#0B1220]">
        <AnimatedAtmosphere variant="hero" />

        <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-12 pb-16 sm:pt-16 sm:pb-24">
            <div className="max-w-3xl space-y-6">
              <p className="text-xs font-semibold uppercase tracking-wider text-[#1A73E8] dark:text-[#60A5FA]">
                Yene Tele · <span lang="am">የእኔ ቴሌኮም</span> · Ethiopia eSIM Platform
              </p>

              <h1
                className="font-bold tracking-tight text-[#202124] dark:text-[#F8FAFC] leading-[1.08]"
                style={{ fontSize: 'clamp(2.25rem, 4.2vw, 3.6rem)' }}
              >
                {language === 'am'
                  ? 'ግንኙነትዎ ቀላል ሆነ።'
                  : 'Your connection, made simple.'}
              </h1>

              <p className="text-base sm:text-lg text-[#5F6368] dark:text-[#CBD5E1] leading-relaxed max-w-xl">
                {language === 'am'
                  ? 'የኢትዮ ቴሌኮም እና የሳፋሪኮም ኢትዮጵያ eSIM መስመርዎን በየኔ ቴሌ በቀላሉ ይምረጡ፣ ማንነትዎን ያረጋግጡ እና በፍጥነት ይጫኑ።'
                  : 'Discover and purchase your eSIM through Yene Tele. Choose your Ethiopian network, verify device compatibility, reserve your number, and install digitally without visiting a branch.'}
              </p>

              <div className="flex flex-wrap items-center gap-3 pt-1">
                <Button
                  size="lg"
                  className="rounded-full"
                  rightIcon={<ArrowRight className="h-4 w-4" />}
                  onClick={() => navigate('/buy-esim')}
                >
                  Buy eSIM
                </Button>
                <Button
                  variant="secondary"
                  size="lg"
                  className="rounded-full"
                  onClick={() => navigate('/how-it-works')}
                >
                  How It Works
                </Button>
                {firebaseUser && (
                  <Button
                    variant="tertiary"
                    size="lg"
                    className="rounded-full"
                    onClick={() => navigate('/app/esims')}
                  >
                    My eSIMs →
                  </Button>
                )}
              </div>

              <div className="pt-2 flex flex-wrap items-center gap-x-6 gap-y-2 text-xs sm:text-sm text-[#5F6368] dark:text-[#CBD5E1]">
                <span className="inline-flex items-center gap-1.5">
                  <CheckCircle2 className="h-4 w-4 text-[#1A73E8] dark:text-[#60A5FA] shrink-0" />
                  Ethio telecom &amp; Safaricom Ethiopia
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <CheckCircle2 className="h-4 w-4 text-[#34A853] dark:text-[#4ADE80] shrink-0" />
                  Fayda KYC Consent Boundary
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <CheckCircle2 className="h-4 w-4 text-[#1A73E8] dark:text-[#60A5FA] shrink-0" />
                  Encrypted QR &amp; LPA Vault
                </span>
              </div>
          </div>
        </div>
      </section>

      {/* SECTION 1: CHOOSE YOUR OPERATOR */}
      <section className="py-14 sm:py-16 px-4 sm:px-6 lg:px-8 bg-[#F8FAFD] dark:bg-[#111C2E] border-b border-[#DADCE0] dark:border-[#24344D]">
        <div className="max-w-3xl mx-auto space-y-6 text-center">
          <div>
            <h2 className="text-xl sm:text-2xl font-bold tracking-tight text-[#202124] dark:text-[#F8FAFC]">
              {language === 'am' ? 'ኦፕሬተርዎን ይምረጡ' : 'Choose your Operator'}
            </h2>
          </div>

          <OperatorLogoTiles onSelect={(op) => navigate(`/buy-esim?operator=${op}`)} />
        </div>
      </section>

      {/* SECTION 2: HOW eSIM WORKS */}
      <section className="py-16 sm:py-20 px-4 sm:px-6 lg:px-8 bg-white dark:bg-[#0B1220] border-b border-[#DADCE0] dark:border-[#24344D]">
        <div className="max-w-7xl mx-auto">
          <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 mb-10">
            <div className="max-w-2xl">
              <p className="text-xs font-semibold uppercase tracking-wider text-[#1A73E8] dark:text-[#60A5FA]">
                How eSIM Works
              </p>
              <h2 className="mt-1.5 text-2xl sm:text-3xl font-bold tracking-tight text-[#202124] dark:text-[#F8FAFC]">
                Six structured safeguards from selection to activation.
              </h2>
            </div>
            <Button variant="secondary" className="rounded-full" onClick={() => navigate('/how-it-works')}>
              Full Step-by-Step Guide
            </Button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
            {steps.map((step) => (
              <InfoFeatureCard
                key={step.eyebrow}
                eyebrow={step.eyebrow}
                title={step.title}
                description={step.description}
                icon={step.icon}
              />
            ))}
          </div>
        </div>
      </section>

      {/* SECTION 3: DEVICE COMPATIBILITY & TRUST */}
      <section className="py-16 sm:py-20 px-4 sm:px-6 lg:px-8 bg-[#F8FAFD] dark:bg-[#111C2E] border-b border-[#DADCE0] dark:border-[#24344D]">
        <div className="max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
          <div className="lg:col-span-6 space-y-5">
            <p className="text-xs font-semibold uppercase tracking-wider text-[#1A73E8] dark:text-[#60A5FA]">
              Device Compatibility Check
            </p>
            <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-[#202124] dark:text-[#F8FAFC]">
              Confirm your device supports eSIM before paying.
            </h2>
            <p className="text-sm sm:text-base text-[#5F6368] dark:text-[#CBD5E1] leading-relaxed">
              Every smartphone sold across markets behaves differently. Always verify your phone is
              carrier-unlocked and displays a 32-digit EID when you dial{' '}
              <strong className="text-[#202124] dark:text-[#F8FAFC] tabular-nums">*#06#</strong>.
            </p>

            <Card padding="sm" variant="highlight" className="space-y-2">
              <p className="text-xs font-semibold text-[#1A73E8] dark:text-[#60A5FA] inline-flex items-center gap-1.5">
                <PhoneCall className="h-3.5 w-3.5" />
                Quick 5-Second Check
              </p>
              <p className="text-sm text-[#202124] dark:text-[#F8FAFC]">
                Open your phone dialer → enter <strong className="tabular-nums">*#06#</strong> →
                confirm an <strong>EID</strong> barcode/number is shown.
              </p>
            </Card>

            <Button className="rounded-full" onClick={() => navigate('/supported-devices')}>
              Check Supported Devices Directory
            </Button>
          </div>

          <div className="lg:col-span-6 space-y-3">
            <TrustHighlightCard
              title="Strict Separation of Login & Subscriber KYC"
              description="Your Yene Tele email/Google login only manages your portal access. Telecom KYC uses the dedicated Fayda subscriber consent step."
            />
            <TrustHighlightCard
              title="Server-Verified Chapa Settlement"
              description="Payment redirects are never trusted alone. Provisioning runs only after server verification or HMAC-validated webhook confirmation."
            />
            <TrustHighlightCard
              title="Encrypted Activation Credentials"
              description="SM-DP+ addresses, activation codes, and LPA strings are encrypted at rest with AES-256-GCM and exposed strictly to the verified order owner."
            />
          </div>
        </div>
      </section>

      {/* SECTION 4: SECONDARY PHONES & AGENT DISTRIBUTION (PROPORTIONAL TO PRIORITY) */}
      <section className="py-16 sm:py-20 px-4 sm:px-6 lg:px-8 bg-white dark:bg-[#0B1220] border-b border-[#E5E7EB] dark:border-[#24344D]">
        <div className="max-w-7xl mx-auto grid grid-cols-1 md:grid-cols-2 gap-6">
          <InfoFeatureCard
            eyebrow="Priority 3 · Authorized Distribution"
            title="Become an Authorized Yene Tele Agent"
            description="Individual agents, retail phone shops, and corporate partners can apply for manual staff review to earn attribution codes and track verified eSIM commissions."
            icon={<Users className="h-4 w-4" />}
            actionLabel="Explore Agent Programme"
            onAction={() => navigate('/agent-programme')}
          />
          <InfoFeatureCard
            eyebrow="Priority 4 · Secondary Hardware"
            title="eSIM-Capable Phones & Bulk Orders via Klick"
            description="Need eSIM-ready handsets for yourself or your organization? Browse verified models with individual and bulk order support, structured for Klick delivery integration."
            icon={<Truck className="h-4 w-4" />}
            actionLabel="Browse Phone Marketplace"
            onAction={() => navigate('/phones')}
          />
        </div>
      </section>

      {/* SECTION 5: FAQ */}
      <section className="py-16 sm:py-20 px-4 sm:px-6 lg:px-8 bg-[#F8FAFC] dark:bg-[#111C2E] border-b border-[#E5E7EB] dark:border-[#24344D]">
        <div className="max-w-4xl mx-auto">
          <div className="mb-8">
            <p className="text-xs font-semibold uppercase tracking-wider text-[#0A2DB8] dark:text-[#60A5FA]">
              Clarity &amp; Transparency
            </p>
            <h2 className="mt-1.5 text-2xl sm:text-3xl font-bold tracking-tight text-[#111827] dark:text-[#F8FAFC]">
              Frequently asked questions
            </h2>
          </div>

          <div className="space-y-3">
            {faqs.map((item, idx) => {
              const isOpen = openFaq === idx;
              return (
                <Card key={item.q} padding="none" variant="default">
                  <button
                    type="button"
                    aria-expanded={isOpen}
                    onClick={() => setOpenFaq(isOpen ? -1 : idx)}
                    className="w-full px-5 py-4 flex items-center justify-between gap-4 text-left cursor-pointer"
                  >
                    <span className="text-sm sm:text-base font-semibold text-[#111827] dark:text-[#F8FAFC]">
                      {item.q}
                    </span>
                    <ChevronDown
                      className={`h-4 w-4 text-[#64748B] dark:text-[#94A3B8] shrink-0 transition-transform duration-150 ${
                        isOpen ? 'rotate-180 text-[#0A2DB8] dark:text-[#60A5FA]' : ''
                      }`}
                      aria-hidden="true"
                    />
                  </button>
                  {isOpen && (
                    <div className="px-5 pb-4 text-sm text-[#64748B] dark:text-[#CBD5E1] leading-relaxed border-t border-[#E5E7EB] dark:border-[#24344D] pt-3">
                      {item.a}
                    </div>
                  )}
                </Card>
              );
            })}
          </div>
        </div>
      </section>

      {/* FINAL CTA */}
      <section className="relative overflow-hidden py-16 sm:py-20 px-4 sm:px-6 lg:px-8 bg-[#EEF3FF] dark:bg-[#13254A] text-[#111827] dark:text-white border-t border-[#C7D6FE] dark:border-[#2B4C8C]">
        <AnimatedAtmosphere variant="subtle" />

        <div className="relative z-10 max-w-5xl mx-auto flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div className="max-w-2xl space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wider text-[#0A2DB8] dark:text-[#93C5FD]">
              Yene Tele · <span lang="am">የእኔ ቴሌኮም</span>
            </p>
            <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-[#111827] dark:text-white">
              Ready to get started with your Ethiopian eSIM?
            </h2>
            <p className="text-sm sm:text-base text-[#64748B] dark:text-[#CBD5E1]">
              Step through operator selection, device verification, Fayda KYC consent, and digital
              installation in minutes.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3 shrink-0">
            <Button
              size="lg"
              variant="primary"
              onClick={() => navigate('/buy-esim')}
              rightIcon={<ArrowRight className="h-4 w-4" />}
            >
              Buy eSIM Now
            </Button>
          </div>
        </div>
      </section>
    </div>
  );
}
