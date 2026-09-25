function normalizePhone(phone) {
  if (!phone) return null;
  const trimmed = String(phone).trim();
  const digits = trimmed.replace(/\D/g, '');
  if (digits.length === 10) return `+91${digits}`;
  if (digits.length === 12 && digits.startsWith('91')) return `+${digits}`;
  if (trimmed.startsWith('+') && digits.length >= 10) return `+${digits}`;
  if (digits.length >= 10) return `+${digits}`;
  return null;
}

module.exports = { normalizePhone };
