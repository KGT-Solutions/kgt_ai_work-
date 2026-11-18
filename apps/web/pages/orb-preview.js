import Head from 'next/head';
import OrbShell from '../components/shell/OrbShell';

// Isolated preview of the new Orb Console shell + sidebar (Figma node 244:118).
// Standalone route — does NOT touch the real dashboard. Visit /orb-preview.
export default function OrbPreview() {
  return (
    <>
      <Head><title>Orb sidebar preview</title></Head>
      <OrbShell>
        <h1 className="orb-page-title text-orb-ink">Overview</h1>
        <p className="mt-2 orb-body text-orb-secondary">
          Preview of the new Orb Console sidebar, built from Figma to the design system.
          Resize below the lg breakpoint to see the mobile drawer; use the clinic switcher
          and the account row (both Headless UI menus).
        </p>
        <div className="mt-6 rounded-2xl border border-orb-hairline bg-orb-white p-6">
          <p className="orb-card-title text-orb-ink">Main content area</p>
          <p className="mt-1 orb-small text-orb-secondary">Cards and panels would render here, to the right of the rail.</p>
        </div>
      </OrbShell>
    </>
  );
}
