// Tenant-agnostic benefit highlighting for the Sales Bot: pulls any
// "${tagPrefix}:*" tag off the chunks actually retrieved for an answer and
// turns the slug into a human label by title-casing it — no hardcoded
// lookup table, so it works for any tenant's own tags with zero per-tenant
// configuration. Lives in services/shared/ (not domains/) because nothing
// about it is tenant- or industry-specific.
//
// A tenant admin adds a tag the same way any chunk gets one: a
// "<!-- tags: benefit:zero_setup_fees -->" comment on the line right after
// a "## Heading" in a TenantDocument's content (see
// engine/knowledgeLoader.parseIntoChunks) — the Documents Tab editor is
// exactly where that gets typed in.

function labelFromSlug(slug) {
  return slug
    .split('_')
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(' ');
}

/**
 * @param {Array<{ chunk: { tags?: string[] } }>} rankedChunks
 * @param {string} tagPrefix e.g. "benefit"
 * @param {number} [cap]
 * @returns {string[]}
 */
function extractTaggedHighlights(rankedChunks, tagPrefix, cap = 4) {
  const prefix = `${tagPrefix}:`;
  const seen = new Set();
  const labels = [];

  for (const { chunk } of rankedChunks) {
    for (const tag of chunk.tags || []) {
      if (!tag.startsWith(prefix) || seen.has(tag)) continue;
      seen.add(tag);
      const slug = tag.slice(prefix.length);
      if (slug) labels.push(labelFromSlug(slug));
      if (labels.length >= cap) return labels;
    }
  }

  return labels;
}

module.exports = { extractTaggedHighlights, labelFromSlug };
