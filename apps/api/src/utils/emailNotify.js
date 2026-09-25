const { isEmailConfigured, isValidEmail, sendMail, maskEmail } = require('../services/email');

function adminWebBaseUrl() {
  return String(process.env.ADMIN_WEB_URL || 'https://society-admin.kgt.solutions').replace(/\/$/, '');
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function detailRow(label, value) {
  return `
    <tr>
      <td style="padding:12px 16px;border-bottom:1px solid #d8eee3;width:34%;font-size:12px;font-weight:700;color:#7ba392;text-transform:uppercase;letter-spacing:0.04em;vertical-align:top;">
        ${escapeHtml(label)}
      </td>
      <td style="padding:12px 16px;border-bottom:1px solid #d8eee3;font-size:15px;font-weight:600;color:#06231a;vertical-align:top;">
        ${escapeHtml(value)}
      </td>
    </tr>`;
}

/**
 * Shared HTML shell for transactional emails.
 */
function buildActionEmail({
  eyebrow = 'Society App',
  title,
  intro,
  rows = [],
  ctaLabel,
  ctaUrl,
  footer = 'You’re receiving this because you’re a member of this society.'
}) {
  const detailRows = rows
    .filter((r) => r && r.value != null && String(r.value).trim() !== '')
    .map((r) => detailRow(r.label, r.value))
    .join('');

  const textLines = [
    title,
    '',
    intro,
    '',
    ...rows.filter((r) => r?.value != null && String(r.value).trim() !== '').map((r) => `${r.label}: ${r.value}`),
    ...(ctaUrl ? ['', ctaLabel ? `${ctaLabel}: ${ctaUrl}` : ctaUrl] : [])
  ];

  const ctaBlock = ctaUrl && ctaLabel
    ? `
      <table role="presentation" cellpadding="0" cellspacing="0" style="margin:28px auto 8px;">
        <tr>
          <td align="center" style="border-radius:10px;background:#059669;">
            <a href="${escapeHtml(ctaUrl)}"
               style="display:inline-block;padding:14px 28px;font-size:15px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:10px;">
              ${escapeHtml(ctaLabel)}
            </a>
          </td>
        </tr>
      </table>
      <p style="margin:16px 0 0;font-size:12px;line-height:1.5;color:#7ba392;text-align:center;">
        Or open:<br />
        <a href="${escapeHtml(ctaUrl)}" style="color:#059669;word-break:break-all;">${escapeHtml(ctaUrl)}</a>
      </p>`
    : `
      <p style="margin:24px 0 0;font-size:14px;line-height:1.5;color:#2f5c4a;text-align:center;">
        Open the <strong>Society App</strong> for full details.
      </p>`;

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)}</title>
</head>
<body style="margin:0;padding:0;background:#f3f6f4;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1f2d3a;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f6f4;padding:32px 12px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #e2e8e4;">
          <tr>
            <td style="background:linear-gradient(180deg,#34d39a 0%,#059669 100%);padding:28px 28px 24px;">
              <div style="font-size:13px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:rgba(255,255,255,0.85);">${escapeHtml(eyebrow)}</div>
              <div style="margin-top:10px;font-size:24px;font-weight:800;color:#ffffff;line-height:1.25;">${escapeHtml(title)}</div>
            </td>
          </tr>
          <tr>
            <td style="padding:28px;">
              <p style="margin:0 0 18px;font-size:15px;line-height:1.55;color:#2f5c4a;">${escapeHtml(intro)}</p>
              ${detailRows
                ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f0fdf6;border:1px solid #cbe8db;border-radius:12px;">${detailRows}</table>`
                : ''}
              ${ctaBlock}
            </td>
          </tr>
          <tr>
            <td style="padding:16px 28px 24px;border-top:1px solid #eef2f0;font-size:11px;color:#9aa4ae;text-align:center;line-height:1.5;">
              ${escapeHtml(footer)}
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  return {
    subject: title,
    text: textLines.join('\n'),
    html
  };
}

async function sendToEmails(emails, { subject, text, html }) {
  try {
    if (!isEmailConfigured()) {
      console.log('[email] Skipping — Resend not configured');
      return { sent: 0, skipped: true, reason: 'not_configured' };
    }

    const recipients = [...new Set(
      (emails || [])
        .map((e) => String(e || '').trim().toLowerCase())
        .filter((e) => isValidEmail(e))
    )];

    if (!recipients.length) {
      console.log('[email] No valid recipient emails');
      return { sent: 0, skipped: true, reason: 'no_recipients' };
    }

    let sent = 0;
    const errors = [];
    for (const email of recipients) {
      try {
        await sendMail({ to: email, subject, text, html });
        sent += 1;
        console.log(`[email] Sent to ${maskEmail(email)}`);
      } catch (e) {
        errors.push({ email: maskEmail(email), message: e.message });
        console.error(`[email] Failed for ${maskEmail(email)}:`, e.message);
      }
    }
    return { sent, skipped: false, errors };
  } catch (e) {
    console.error('[email] sendToEmails failed:', e.message);
    return { sent: 0, skipped: true, reason: 'error', error: e.message };
  }
}

async function emailUser(prisma, userId, payload) {
  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { email: true }
    });
    return sendToEmails([user?.email], payload);
  } catch (e) {
    console.error('[email] emailUser failed:', e.message);
    return { sent: 0, skipped: true, reason: 'error', error: e.message };
  }
}

async function emailFlatResidents(prisma, buildingId, flatId, payload) {
  try {
    const rows = await prisma.membership.findMany({
      where: {
        buildingId,
        flatId,
        status: 'approved',
        role: { key: 'resident' }
      },
      include: { user: { select: { email: true } } }
    });
    return sendToEmails(rows.map((r) => r.user?.email), payload);
  } catch (e) {
    console.error('[email] emailFlatResidents failed:', e.message);
    return { sent: 0, skipped: true, reason: 'error', error: e.message };
  }
}

async function emailAllResidents(prisma, buildingId, payload) {
  try {
    const rows = await prisma.membership.findMany({
      where: {
        buildingId,
        status: 'approved',
        role: { key: 'resident' }
      },
      include: { user: { select: { email: true } } }
    });
    return sendToEmails(rows.map((r) => r.user?.email), payload);
  } catch (e) {
    console.error('[email] emailAllResidents failed:', e.message);
    return { sent: 0, skipped: true, reason: 'error', error: e.message };
  }
}

async function emailBuildingAdmins(prisma, buildingId, payload) {
  try {
    const admins = await prisma.membership.findMany({
      where: {
        buildingId,
        status: 'approved',
        role: { key: { in: ['building_admin', 'committee_member'] } }
      },
      include: { user: { select: { email: true } } }
    });
    return sendToEmails(admins.map((a) => a.user?.email), payload);
  } catch (e) {
    console.error('[email] emailBuildingAdmins failed:', e.message);
    return { sent: 0, skipped: true, reason: 'error', error: e.message };
  }
}

function signupApprovalEmail({ kind, applicantName, phone, buildingName, buildingId, flatNumber }) {
  const isGuard = kind === 'guard';
  const who = isGuard ? 'guard' : 'resident';
  const ctaUrl = `${adminWebBaseUrl()}${buildingId ? `/dashboard/${buildingId}/residents` : '/buildings'}`;
  return buildActionEmail({
    title: isGuard
      ? `New guard signup — ${buildingName}`
      : `New resident signup — ${buildingName}${flatNumber ? ` · Flat ${flatNumber}` : ''}`,
    intro: `A new ${who} has signed up and is waiting for approval.`,
    rows: [
      { label: 'Society', value: buildingName },
      { label: 'Name', value: applicantName },
      { label: 'Phone', value: phone },
      ...(flatNumber ? [{ label: 'Flat', value: flatNumber }] : [])
    ],
    ctaLabel: 'Review in Resident approvals',
    ctaUrl,
    footer: 'You’re receiving this because you’re a building admin or committee member.'
  });
}

function membershipDecisionEmail({ approved, roleKey, buildingName, flatNumber }) {
  const who = roleKey === 'guard' ? 'guard' : 'resident';
  return buildActionEmail({
    title: approved ? `Welcome — ${who} access approved` : `Signup update — request not approved`,
    intro: approved
      ? `Your ${who} signup for ${buildingName} has been approved. You can sign in to the Society App now.`
      : `Your ${who} signup request for ${buildingName} was not approved. Contact your society admin if you need help.`,
    rows: [
      { label: 'Society', value: buildingName },
      ...(flatNumber ? [{ label: 'Flat', value: flatNumber }] : []),
      { label: 'Status', value: approved ? 'Approved' : 'Rejected' }
    ]
  });
}

function announcementEmail({ title, body, buildingName }) {
  return buildActionEmail({
    title: `Announcement: ${title}`,
    intro: body,
    rows: [{ label: 'Society', value: buildingName }],
    footer: 'Open the Society App → Announcements for the full notice.'
  });
}

function pollCreatedEmail({ question, daysLeft, buildingName }) {
  return buildActionEmail({
    title: 'New society poll',
    intro: `${question} — voting is open for ${daysLeft} day${daysLeft === 1 ? '' : 's'}.`,
    rows: [
      { label: 'Society', value: buildingName },
      { label: 'Status', value: 'Open for voting' }
    ]
  });
}

function pollResultsEmail({ question, buildingName, options }) {
  const summary = (options || [])
    .map((o) => `${o.label}: ${o.count} (${o.pct}%)`)
    .join(' · ');
  return buildActionEmail({
    title: 'Poll results published',
    intro: `Voting has closed for: ${question}`,
    rows: [
      { label: 'Society', value: buildingName },
      { label: 'Results', value: summary || 'No votes recorded' }
    ]
  });
}

function complaintStatusEmail({ title, statusLabel, buildingName }) {
  return buildActionEmail({
    title: `Complaint updated: ${statusLabel}`,
    intro: `"${title}" is now ${statusLabel}.`,
    rows: [
      { label: 'Society', value: buildingName },
      { label: 'Status', value: statusLabel }
    ]
  });
}

function complaintAdminEmail({ flatLabel, title, buildingId, buildingName }) {
  return buildActionEmail({
    title: 'New complaint',
    intro: `${flatLabel} raised a new complaint that needs attention.`,
    rows: [
      { label: 'Society', value: buildingName },
      { label: 'From', value: flatLabel },
      { label: 'Complaint', value: title }
    ],
    ctaLabel: 'Open complaints',
    ctaUrl: `${adminWebBaseUrl()}/dashboard/${buildingId}/complaints`,
    footer: 'You’re receiving this because you’re a building admin or committee member.'
  });
}

function ledgerEmail({ title, body, flatNumber, buildingName }) {
  return buildActionEmail({
    title,
    intro: body,
    rows: [
      { label: 'Society', value: buildingName },
      ...(flatNumber ? [{ label: 'Flat', value: flatNumber }] : [])
    ],
    footer: 'Open the Society App → Bills / Finance for your flat ledger.'
  });
}

function vehicleStatusEmail({ title, body, plate, makeModel, buildingName }) {
  return buildActionEmail({
    title,
    intro: body,
    rows: [
      { label: 'Society', value: buildingName },
      { label: 'Vehicle', value: makeModel },
      { label: 'Registration', value: plate }
    ]
  });
}

function vehicleAdminEmail({ flatNumber, plate, makeModel, buildingId, buildingName }) {
  return buildActionEmail({
    title: 'New gate pass request',
    intro: `Flat ${flatNumber} submitted a gate pass request.`,
    rows: [
      { label: 'Society', value: buildingName },
      { label: 'Flat', value: flatNumber },
      { label: 'Vehicle', value: makeModel },
      { label: 'Registration', value: plate }
    ],
    ctaLabel: 'Review vehicles',
    ctaUrl: `${adminWebBaseUrl()}/dashboard/${buildingId}/vehicles`,
    footer: 'You’re receiving this because you’re a building admin or committee member.'
  });
}

function facilityDecisionEmail({ title, body, facilityName, buildingName }) {
  return buildActionEmail({
    title,
    intro: body,
    rows: [
      { label: 'Society', value: buildingName },
      { label: 'Facility', value: facilityName }
    ]
  });
}

function facilityBookingAdminEmail({
  kind = 'request',
  residentName,
  facilityName,
  slotLabel,
  buildingId,
  buildingName
}) {
  const isCancel = kind === 'cancel';
  return buildActionEmail({
    title: isCancel ? 'Facility booking cancelled' : 'New facility booking request',
    intro: isCancel
      ? `${residentName} cancelled a facility booking.`
      : `${residentName} requested a facility booking that needs approval.`,
    rows: [
      { label: 'Society', value: buildingName },
      { label: 'Resident', value: residentName },
      { label: 'Facility', value: facilityName },
      { label: 'Slot', value: slotLabel }
    ],
    ctaLabel: isCancel ? 'Open facilities' : 'Review bookings',
    ctaUrl: `${adminWebBaseUrl()}/dashboard/${buildingId}/facilities`,
    footer: 'You’re receiving this because you’re a building admin or committee member.'
  });
}

function familyAdminEmail({ flatLabel, memberName, relation, buildingName }) {
  return buildActionEmail({
    title: 'Family member added',
    intro: `${flatLabel} added a family member with app access.`,
    rows: [
      { label: 'Society', value: buildingName },
      { label: 'Flat', value: flatLabel },
      { label: 'Name', value: memberName },
      { label: 'Relation', value: relation }
    ],
    footer: 'You’re receiving this because you’re a building admin or committee member.'
  });
}

function paymentAdminEmail({
  flatNumber,
  amount,
  method,
  note,
  advanceBalance,
  buildingId,
  buildingName
}) {
  return buildActionEmail({
    title: 'Payment received',
    intro: `A payment was recorded for Flat ${flatNumber}.`,
    rows: [
      { label: 'Society', value: buildingName },
      { label: 'Flat', value: flatNumber },
      { label: 'Amount', value: `₹${Number(amount).toLocaleString('en-IN')}` },
      ...(method ? [{ label: 'Method', value: String(method).toUpperCase() }] : []),
      ...(note ? [{ label: 'Note', value: note }] : []),
      ...(advanceBalance > 0
        ? [{ label: 'Advance now', value: `₹${Number(advanceBalance).toLocaleString('en-IN')}` }]
        : [])
    ],
    ctaLabel: 'Open Finance ledger',
    ctaUrl: `${adminWebBaseUrl()}/dashboard/${buildingId}/maintenance`,
    footer: 'You’re receiving this because you’re a building admin or committee member.'
  });
}

function sosAdminEmail({ residentName, flatNumber, buildingId, buildingName }) {
  return buildActionEmail({
    title: 'SOS alert',
    intro: flatNumber
      ? `${residentName} from Flat ${flatNumber} pressed the SOS alarm.`
      : `${residentName} pressed the SOS alarm.`,
    rows: [
      { label: 'Society', value: buildingName },
      { label: 'Resident', value: residentName },
      ...(flatNumber ? [{ label: 'Flat', value: flatNumber }] : []),
      { label: 'Priority', value: 'Immediate' }
    ],
    ctaLabel: 'Open dashboard',
    ctaUrl: `${adminWebBaseUrl()}/dashboard/${buildingId}`,
    footer: 'Urgent — respond as soon as possible.'
  });
}

function visitorResidentEmail({ visitorName, purpose, flatNumber, buildingName }) {
  return buildActionEmail({
    title: 'Visitor at gate',
    intro: `${visitorName} (${purpose}) is waiting for your approval.`,
    rows: [
      { label: 'Society', value: buildingName },
      { label: 'Flat', value: flatNumber },
      { label: 'Visitor', value: visitorName },
      { label: 'Purpose', value: purpose }
    ],
    footer: 'Open the Society App → Visitors to approve or decline.'
  });
}

function bugReportEmail({
  reference,
  reporterName,
  reporterPhone,
  roleKey,
  source,
  category,
  message,
  buildingName,
  flatNumber,
  hasScreenshot,
  ctaUrl
}) {
  return buildActionEmail({
    title: `Bug report ${reference}`,
    intro: message,
    rows: [
      { label: 'Reference', value: reference },
      { label: 'Society', value: buildingName },
      ...(flatNumber ? [{ label: 'Flat', value: flatNumber }] : []),
      { label: 'Reporter', value: reporterName },
      { label: 'Phone', value: reporterPhone },
      { label: 'Role', value: roleKey },
      { label: 'Source', value: source },
      { label: 'Category', value: category },
      ...(hasScreenshot ? [{ label: 'Screenshot', value: 'Attached — view in the bug inbox' }] : [])
    ],
    ctaLabel: 'Open bug inbox',
    ctaUrl,
    footer: 'You’re receiving this because you’re a FLATBRIZ super admin / support contact.'
  });
}

function salesLeadEmail({ clientType, query, answer, intentScore, signals }) {
  return buildActionEmail({
    eyebrow: 'FLATBRIZ Sales',
    title: `High-intent sales lead (${clientType})`,
    intro: 'A prospective client showed strong buying intent while talking to the Sales Assistant.',
    rows: [
      { label: 'Client type', value: clientType },
      { label: 'Intent score', value: String(intentScore) },
      { label: 'Signals', value: (signals || []).join(', ') },
      { label: 'Message', value: query },
      { label: 'Assistant reply', value: answer }
    ],
    footer: 'You’re receiving this because you’re a configured FLATBRIZ sales contact.'
  });
}

module.exports = {
  adminWebBaseUrl,
  buildActionEmail,
  sendToEmails,
  emailUser,
  emailFlatResidents,
  emailAllResidents,
  emailBuildingAdmins,
  signupApprovalEmail,
  membershipDecisionEmail,
  announcementEmail,
  pollCreatedEmail,
  pollResultsEmail,
  complaintStatusEmail,
  complaintAdminEmail,
  ledgerEmail,
  vehicleStatusEmail,
  vehicleAdminEmail,
  facilityDecisionEmail,
  facilityBookingAdminEmail,
  familyAdminEmail,
  paymentAdminEmail,
  sosAdminEmail,
  visitorResidentEmail,
  bugReportEmail,
  salesLeadEmail
};
