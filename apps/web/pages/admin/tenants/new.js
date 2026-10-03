import { useState } from 'react';
import { staffLayout } from '../../../components/shell/DashboardShell';
import { Button, ButtonLink, Card, CardHeader, Field, Input, PageHeader, SecretField, Textarea } from '../../../components/ui';
import { IconArrowRight, IconKey } from '../../../components/ui/icons';
import EmbedSnippets from '../../../components/workspace/EmbedSnippets';
import { api } from '../../../lib/api';

// Staff-provisioned company (no client login). Its first API key is shown once.
export default function NewCompany() {
  const [form, setForm] = useState({ name: '', industryLabel: '', persona: '', minConfidence: '0.30' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [created, setCreated] = useState(null);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    if (!form.name.trim() || !form.industryLabel.trim()) return setError('Company name and industry are required.');
    setBusy(true);
    setError('');
    try {
      setCreated(await api.createTenant({
        name: form.name.trim(),
        industryLabel: form.industryLabel.trim(),
        persona: form.persona.trim() || undefined,
        minConfidence: form.minConfidence !== '' ? Number(form.minConfidence) : undefined
      }));
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  if (created) {
    return (
      <>
        <PageHeader title={`${created.name} created`} description="Copy the API key now — it's shown only this once." />
        <Card className="border-brand-400/25 shadow-glow">
          <CardHeader icon={<IconKey className="h-4 w-4" />} title="First API key" description={`Sent as X-Tenant-Api-Key to POST /api/v1/tenant-chat/${created.slug}/chat, or used in the embed snippet.`} />
          <div className="space-y-4 p-5">
            <SecretField value={created.apiKey} label="API key" />
            <EmbedSnippets slug={created.slug} apiKey={created.apiKey} />
            <ButtonLink href={`/admin/tenants/${created.id}`} variant="primary">Open company <IconArrowRight className="h-4 w-4" /></ButtonLink>
          </div>
        </Card>
      </>
    );
  }

  return (
    <>
      <PageHeader title="New company" description="Provision a company directly. It gets an API key but no dashboard login — companies that sign up themselves get both." />
      <Card className="max-w-2xl">
        <form onSubmit={submit} className="space-y-5 p-6" noValidate>
          <Field label="Company name" htmlFor="c-name"><Input id="c-name" value={form.name} onChange={set('name')} placeholder="Acme Retail Co" /></Field>
          <Field label="Industry / role" htmlFor="c-ind" hint={'Shown to the model as its role, e.g. "support assistant for Acme Retail Co (Retail Customer Support)".'}>
            <Input id="c-ind" value={form.industryLabel} onChange={set('industryLabel')} placeholder="Retail Customer Support" />
          </Field>
          <Field label="Extra persona / rules (optional)" htmlFor="c-persona">
            <Textarea id="c-persona" value={form.persona} onChange={set('persona')} className="min-h-[90px]" placeholder="e.g. Always mention our 24/7 support line when a customer sounds frustrated." />
          </Field>
          <Field label="Support confidence gate" htmlFor="c-gate" hint="0–1. Below this match score the Support Bot hands off instead of answering. 0.30 is a good default.">
            <Input id="c-gate" type="number" min="0" max="1" step="0.05" value={form.minConfidence} onChange={set('minConfidence')} className="max-w-[140px]" />
          </Field>
          {error && <p className="rounded-lg border border-rose-400/25 bg-rose-500/10 px-3 py-2 text-[13px] text-rose-100" role="alert">{error}</p>}
          <Button type="submit" variant="primary" loading={busy}>Create company</Button>
        </form>
      </Card>
    </>
  );
}
NewCompany.getLayout = staffLayout;
