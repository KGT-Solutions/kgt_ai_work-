#!/usr/bin/env node
// Toggle an operator's access from the command line. Operators are seed-managed
// and there is no self-serve operator console, so this is how staff access is
// revoked or restored out of band:
//
//   node scripts/operator-admin.js deactivate     <email>
//   node scripts/operator-admin.js activate        <email>
//   node scripts/operator-admin.js reset-password  <email> <newPassword>
//
// In Docker:
//   docker exec kgt-ai-hub-api node scripts/operator-admin.js deactivate admin@acme.com
//
// Enforcement is in middleware/operatorAuth.js: a deactivated account, or a token
// older than a password reset, is refused on its very next request.
require('dotenv').config();
const prisma = require('../src/lib/prisma');
const { changeOperatorPassword, setOperatorActive } = require('../src/services/operatorAccount');

function usage() {
  console.error('Usage: node scripts/operator-admin.js <deactivate|activate|reset-password> <email> [newPassword]');
}

async function main() {
  const [action, rawEmail, newPassword] = process.argv.slice(2);
  if (!action || !rawEmail) { usage(); process.exitCode = 2; return; }

  const email = rawEmail.trim().toLowerCase();
  const operator = await prisma.operator.findUnique({ where: { email } });
  if (!operator) {
    console.error(`[operator-admin] No operator found for ${email}.`);
    process.exitCode = 1;
    return;
  }

  switch (action) {
    case 'deactivate':
      await setOperatorActive(operator.id, false);
      console.log(`[operator-admin] Deactivated ${email}. Any existing token is refused on its next request.`);
      break;
    case 'activate':
      await setOperatorActive(operator.id, true);
      console.log(`[operator-admin] Activated ${email}.`);
      break;
    case 'reset-password':
      if (!newPassword) { console.error('[operator-admin] reset-password needs a new password (>= 10 characters).'); process.exitCode = 2; return; }
      await changeOperatorPassword(operator.id, newPassword);
      console.log(`[operator-admin] Password reset for ${email}. All existing sessions are signed out.`);
      break;
    default:
      usage();
      process.exitCode = 2;
  }
}

main()
  .catch((err) => { console.error(err); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
