import { useState } from 'react';
import { useRouter } from 'next/router';
import OperatorLayout from '../../components/OperatorLayout';
import { ui, colors, radius } from '../../components/ui';
import { api } from '../../lib/api';

export default function NewTenantPage() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [industryLabel, setIndustryLabel] = useState('');
  const [persona, setPersona] = useState('');
  const [minConfidence, setMinConfidence] = useState('0.30');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [created, setCreated] = useState(null); // holds the one-time apiKey reveal

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    if (!name.trim() || !industryLabel.trim()) {
      setError('Name and industry are required.');
      return;
    }
    setLoading(true);
    try {
      const tenant = await api.createTenant({
        name: name.trim(),
        industryLabel: industryLabel.trim(),
        persona: persona.trim() || undefined,
        minConfidence: minConfidence !== '' ? Number(minConfidence) : undefined
      });
      setCreated(tenant);
    } catch (e2) {
      setError(e2.message);
    } finally {
      setLoading(false);
    }
  };

  if (created) {
    return (
      <OperatorLayout title="Tenant created" subtitle={created.name}>
        <div style={{ ...ui.form, borderColor: '#F0B429', background: '#FFFBEB' }}>
          <p style={ui.formTitle}>Copy the API key now — it won't be shown again</p>
          <p style={ui.hint}>
            This is what the tenant's own app sends as <code>X-Tenant-Api-Key</code> when calling{' '}
            <code>POST /api/v1/tenant-chat/{created.slug}/chat</code>. If it's lost, there's no way to
            retrieve it — issue a new one from the tenant's API keys tab and revoke this one.
          </p>
          <div style={keyBox}>{created.apiKey}</div>
          <div style={{ display: 'flex', gap: 12 }}>
            <button
              type="button"
              style={ui.btnSecondary}
              onClick={() => navigator.clipboard?.writeText(created.apiKey)}
            >
              Copy to clipboard
            </button>
            <button type="button" style={ui.btn} onClick={() => router.push(`/tenants/${created.id}`)}>
              Continue to tenant →
            </button>
          </div>
        </div>
      </OperatorLayout>
    );
  }

  return (
    <OperatorLayout title="New tenant" subtitle="Provision a customer to run the chat engine on their own data." error={error}>
      <form onSubmit={submit} style={ui.form}>
        <p style={ui.formTitle}>Tenant details</p>

        <label style={label}>Company name</label>
        <input style={ui.input} value={name} onChange={(e) => setName(e.target.value)} placeholder="Acme Retail Co" />

        <label style={label}>Industry / role label</label>
        <input
          style={ui.input}
          value={industryLabel}
          onChange={(e) => setIndustryLabel(e.target.value)}
          placeholder="Retail Customer Support"
        />
        <p style={ui.hint}>Shown to the model as its role — e.g. "You are the support assistant for Acme Retail Co (Retail Customer Support)."</p>

        <label style={label}>Extra persona / rules (optional)</label>
        <textarea
          style={{ ...ui.textarea, minHeight: 90 }}
          value={persona}
          onChange={(e) => setPersona(e.target.value)}
          placeholder="e.g. Always mention our 24/7 support line when a customer sounds frustrated."
        />

        <label style={label}>Confidence gate threshold</label>
        <input
          style={{ ...ui.input, maxWidth: 140 }}
          type="number" min="0" max="1" step="0.05"
          value={minConfidence}
          onChange={(e) => setMinConfidence(e.target.value)}
        />
        <p style={ui.hint}>Below this (0–1), the bot skips the LLM and files a support ticket instead of guessing. 0.30 is a reasonable default.</p>

        <button type="submit" style={ui.btn} disabled={loading}>
          {loading ? 'Creating…' : 'Create tenant'}
        </button>
      </form>
    </OperatorLayout>
  );
}

const label = { fontSize: 12, fontWeight: 600, color: colors.textMuted, textTransform: 'uppercase', letterSpacing: '0.05em' };
const keyBox = {
  fontFamily: 'monospace', fontSize: 13, background: colors.card, border: `1px solid ${colors.border}`,
  borderRadius: radius.sm, padding: 14, wordBreak: 'break-all', marginBottom: 4
};
