import Head from 'next/head';
import Link from 'next/link';
import { Logo } from '../ui';

// Centered auth card on the grid-and-glow backdrop. Used by sign-in (client
// and staff) and the forgot-password flow.
export default function AuthShell({ title, heading, subheading, children, footer }) {
  return (
    <div className="relative min-h-screen overflow-hidden bg-obsidian">
      <Head><title>{`${title} — KGT AI Hub`}</title></Head>
      <div className="bg-grid pointer-events-none absolute inset-0" aria-hidden="true" />
      <div className="pointer-events-none absolute left-1/2 top-[-12rem] h-[28rem] w-[48rem] -translate-x-1/2 rounded-full bg-gradient-to-r from-cyan-500/20 via-sky-500/10 to-violet-500/20 blur-3xl" aria-hidden="true" />

      <header className="relative mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
        <Link href="/" aria-label="KGT AI Hub home"><Logo /></Link>
      </header>

      <main className="relative flex justify-center px-4 pb-16 pt-6 sm:pt-12">
        <div className="w-full max-w-[400px] animate-fade-up">
          <div className="mb-6 text-center">
            <h1 className="text-2xl font-semibold tracking-tight text-fg">{heading}</h1>
            {subheading && <p className="mt-2 text-sm text-fg-2">{subheading}</p>}
          </div>
          <div className="glass p-6 sm:p-7">{children}</div>
          {footer && <div className="mt-6 text-center text-sm text-fg-3">{footer}</div>}
        </div>
      </main>
    </div>
  );
}
