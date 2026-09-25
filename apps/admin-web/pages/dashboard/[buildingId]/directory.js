import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/router';
import AdminLayout from '../../../components/AdminLayout';
import { ui, gridClass } from '../../../components/ui';
import { api } from '../../../lib/api';
import { colors, radius } from '../../../lib/theme';

const EMERGENCY_CATEGORIES = new Set(['ambulance', 'police', 'fire']);

const CATEGORY_META = {
  ambulance: { emoji: '🚑', tint: '#FFF0EB' },
  police: { emoji: '👮', tint: '#E8F0FA' },
  fire: { emoji: '🔥', tint: '#FFF4E6' }
};

const DEFAULT_EMERGENCY = [
  { id: 'default-ambulance', name: 'Ambulance', phone: '108', category: 'ambulance' },
  { id: 'default-police', name: 'Police', phone: '100', category: 'police' },
  { id: 'default-fire', name: 'Fire', phone: '101', category: 'fire' }
];

function ContactRow({ item, onEdit, onDelete }) {
  const meta = CATEGORY_META[item.category] || { emoji: '📞', tint: '#F5F5F5' };
  const editable = !String(item.id).startsWith('default-');

  return (
    <div style={row}>
      <div style={{ ...rowIcon, background: meta.tint }}>{meta.emoji}</div>
      <div style={rowBody}>
        <div style={rowTitle}>{item.name}</div>
        <div style={rowPhone}>{item.phone}</div>
      </div>
      <a href={`tel:${item.phone.replace(/\s/g, '')}`} style={callBtn} aria-label={`Call ${item.name}`}>📞</a>
      {editable && onEdit && (
        <button type="button" style={editBtn} onClick={() => onEdit(item)}>Edit</button>
      )}
      {editable && onDelete && (
        <button type="button" style={deleteBtn} onClick={() => onDelete(item.id)}>Delete</button>
      )}
    </div>
  );
}

function ContactSection({ title, items, onEdit, onDelete }) {
  if (!items.length) return null;
  return (
    <section style={section}>
      <h3 style={sectionLabel}>{title}</h3>
      <div style={card}>
        {items.map((item, index) => (
          <div key={item.id}>
            <ContactRow item={item} onEdit={onEdit} onDelete={onDelete} />
            {index < items.length - 1 && <div style={divider} />}
          </div>
        ))}
      </div>
    </section>
  );
}

export default function DirectoryPage() {
  const router = useRouter();
  const { buildingId } = router.query;
  const [contacts, setContacts] = useState([]);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [editingId, setEditingId] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const load = async () => {
    if (!buildingId) return;
    try {
      setContacts(await api.getDirectoryContacts(buildingId));
    } catch (e) {
      setError(e.message);
    }
  };

  useEffect(() => {
    if (!buildingId) return;
    load();
  }, [buildingId]);

  const { emergency, society } = useMemo(() => {
    const emergencyItems = [];
    const societyItems = [];
    contacts.forEach((contact) => {
      if (EMERGENCY_CATEGORIES.has(contact.category)) emergencyItems.push(contact);
      else societyItems.push(contact);
    });
    DEFAULT_EMERGENCY.forEach((fallback) => {
      if (!emergencyItems.some((item) => item.category === fallback.category)) {
        emergencyItems.push(fallback);
      }
    });
    emergencyItems.sort((a, b) => {
      const order = ['ambulance', 'police', 'fire'];
      return order.indexOf(a.category) - order.indexOf(b.category);
    });
    societyItems.sort((a, b) => String(a.name).localeCompare(String(b.name)));
    return { emergency: emergencyItems, society: societyItems };
  }, [contacts]);

  const resetForm = () => {
    setName('');
    setPhone('');
    setEditingId(null);
  };

  const startEdit = (item) => {
    setEditingId(item.id);
    setName(item.name || '');
    setPhone(item.phone || '');
    setError('');
    window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
  };

  const saveContact = async (e) => {
    e.preventDefault();
    if (!name.trim() || !phone.trim()) return;
    setLoading(true);
    setError('');
    try {
      const payload = { name: name.trim(), phone: phone.trim() };
      if (editingId) {
        await api.updateDirectoryContact(buildingId, editingId, payload);
      } else {
        await api.createDirectoryContact(buildingId, payload);
      }
      resetForm();
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const removeContact = async (contactId) => {
    if (!window.confirm('Delete this contact? It will also disappear from the resident app.')) return;
    setError('');
    try {
      await api.deleteDirectoryContact(buildingId, contactId);
      if (editingId === contactId) resetForm();
      await load();
    } catch (err) {
      setError(err.message);
    }
  };

  if (!buildingId) return null;

  return (
    <AdminLayout buildingId={buildingId} title="Directory" error={error}>
      <div className="admin-directory">
        <section className="admin-directory-hero">
          <div className="admin-directory-sos" aria-hidden="true">SOS</div>
          <div className="admin-directory-hero-copy">
            <h2 className="admin-directory-hero-title">Emergency help</h2>
            <p className="admin-directory-hero-caption">
              Residents see this directory in the app. Emergency numbers stay visible; society contacts you add here appear below.
            </p>
            <div className="admin-directory-info">
              <span aria-hidden="true">ℹ️</span>
              <div>
                <div className="admin-directory-info-title">SOS will alert security and trusted contacts</div>
                <div className="admin-directory-info-caption">Location is shared from the resident app.</div>
              </div>
            </div>
          </div>
        </section>

        <div className="admin-directory-grid">
          <ContactSection title="Emergency services" items={emergency} />
          <ContactSection
            title="Society contacts"
            items={society}
            onEdit={startEdit}
            onDelete={removeContact}
          />
        </div>
        {society.length === 0 && (
          <div className="admin-directory-empty">
            No society contacts yet. Add any name and number below — residents will see them in the app.
          </div>
        )}

        <form onSubmit={saveContact} style={ui.form}>
          <h3 style={ui.formTitle}>{editingId ? 'Edit contact' : 'Add society contact'}</h3>
          <p style={ui.hint}>
            Emergency numbers (108, 100, 101) are always shown. Add any person or service — the name and phone you enter are what residents see.
          </p>
          <div className={gridClass.two} style={ui.row}>
            <input
              style={ui.input}
              placeholder="Contact name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
            <input
              style={ui.input}
              placeholder="Phone number"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              required
            />
          </div>
          <div className="admin-form-actions" style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <button type="submit" style={ui.btn} disabled={loading}>
              {loading ? 'Saving…' : editingId ? 'Update contact' : 'Add contact'}
            </button>
            {editingId && (
              <button type="button" style={ui.btnSecondary} onClick={resetForm}>
                Cancel edit
              </button>
            )}
          </div>
        </form>
      </div>
    </AdminLayout>
  );
}

const section = { marginBottom: 0 };
const sectionLabel = {
  fontSize: 12, fontWeight: 600, color: colors.textMuted, textTransform: 'uppercase',
  letterSpacing: '0.08em', margin: '0 0 12px'
};
const card = {
  background: colors.card, borderRadius: radius.md, border: `1px solid ${colors.border}`, overflow: 'hidden'
};
const row = { display: 'flex', alignItems: 'center', gap: 12, padding: '14px 16px' };
const rowIcon = {
  width: 40, height: 40, borderRadius: 12, display: 'flex', alignItems: 'center',
  justifyContent: 'center', fontSize: 18, flexShrink: 0
};
const rowBody = { flex: 1, minWidth: 0 };
const rowTitle = { fontSize: 14, fontWeight: 600, color: colors.primary };
const rowPhone = { fontSize: 13, color: colors.textMuted, marginTop: 2 };
const callBtn = {
  width: 36, height: 36, borderRadius: '50%', background: colors.background,
  border: `1px solid ${colors.border}`, display: 'inline-flex', alignItems: 'center',
  justifyContent: 'center', textDecoration: 'none', flexShrink: 0
};
const editBtn = {
  background: 'transparent', border: 'none', color: colors.primary, fontSize: 12,
  fontWeight: 600, cursor: 'pointer', padding: '4px 8px', flexShrink: 0
};
const deleteBtn = {
  background: 'transparent', border: 'none', color: colors.error, fontSize: 12,
  fontWeight: 600, cursor: 'pointer', padding: '4px 8px', flexShrink: 0
};
const divider = { height: 1, background: colors.border, marginLeft: 72 };
