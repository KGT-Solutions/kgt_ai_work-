// Builds fixtures/knowledge-pack.zip (two documents) for the ZIP-upload
// step of the registration test, in memory — no binary checked into git.
//   const zip = await knowledgePackZip();  // Buffer
const yazl = require('yazl');

const FILES = {
  'sales/why-northwind.md': [
    '# Why choose Northwind',
    '',
    '## Benefits',
    '',
    'Customers save up to 23% on heating and cooling bills in the first year. The thermostat pays for itself in about fourteen months for a typical three-bedroom home.',
    'Trusted by over 300 builders and 40,000 households. Northwind Business customers include co-working spaces, clinics and retail stores across Maharashtra and Karnataka.',
    '',
    '## Compared with alternatives',
    '',
    'Unlike subscription-only competitors, Northwind home plans need no monthly fee. Room sensors are included in Plus, not sold separately.'
  ].join('\n'),
  'support/app-faq.txt': [
    'Northwind app FAQ',
    '',
    'How do I add a second home? Open the app, tap Homes, then Add home and follow the pairing steps.',
    'How do I share access with my family? Tap Settings, Members, Invite, and enter their email address.',
    'Can I use the thermostat without Wi-Fi? Yes. Schedules keep running on the device; remote control and reports need Wi-Fi.'
  ].join('\n')
};

function knowledgePackZip() {
  return new Promise((resolve, reject) => {
    const zip = new yazl.ZipFile();
    for (const [name, text] of Object.entries(FILES)) zip.addBuffer(Buffer.from(text, 'utf8'), name);
    zip.end();
    const chunks = [];
    zip.outputStream.on('data', (c) => chunks.push(c)).on('end', () => resolve(Buffer.concat(chunks))).on('error', reject);
  });
}

module.exports = { knowledgePackZip };
