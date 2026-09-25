const fs = require('fs');
const path = require('path');

// Domain-agnostic markdown knowledge-base loader. Any domain profile points
// this at its own directory of .md files — the core engine never hardcodes
// a path (Requirement 2: dynamic knowledge routing). Splits each file into
// one chunk per "## " section, and optionally reads a
// "<!-- tags: a, b, c -->" comment on the line right after a heading into
// chunk.tags (used for retrieval boosting / benefit badges) — a plain
// manual with no tags comments works exactly the same, just with an empty
// tags array per chunk.

const TAGS_COMMENT = /^<!--\s*tags:\s*(.+?)\s*-->$/;

/**
 * @typedef {{ id: string, title: string, content: string, sourceFile: string, tags: string[], category?: string }} KnowledgeChunk
 * category is only set for DB-backed tenant documents (TenantDocument.category);
 * filesystem manuals leave it undefined.
 */

function parseIntoChunks(filename, raw) {
  const lines = raw.split('\n');
  const chunks = [];
  let currentTitle = 'Overview';
  let currentTags = [];
  let currentLines = [];

  function flush() {
    const content = currentLines.join('\n').trim();
    if (content) {
      chunks.push({
        id: `${filename}#${chunks.length}`,
        title: currentTitle,
        content,
        sourceFile: filename,
        tags: currentTags
      });
    }
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const heading = /^##\s+(.+)$/.exec(line);
    if (heading) {
      flush();
      currentTitle = heading[1].trim();
      currentTags = [];

      let j = i + 1;
      while (j < lines.length && lines[j].trim() === '') j++;
      const tagsMatch = TAGS_COMMENT.exec(lines[j]?.trim() || '');
      if (tagsMatch) {
        currentTags = tagsMatch[1].split(',').map((t) => t.trim()).filter(Boolean);
        i = j;
      }
      currentLines = [];
    } else if (!/^#\s+/.test(line)) {
      currentLines.push(line);
    }
  }
  flush();

  return chunks;
}

// Cache per resolved directory so two domains never collide and repeat
// requests to the same domain don't re-hit disk.
const cacheByDir = new Map();

/**
 * @param {string} baseDir absolute path to a directory of .md files
 * @returns {KnowledgeChunk[]}
 */
function loadKnowledgeBase(baseDir) {
  const resolved = path.resolve(baseDir);
  if (cacheByDir.has(resolved)) return cacheByDir.get(resolved);

  const chunks = [];
  const files = fs.readdirSync(resolved).filter((f) => f.endsWith('.md'));
  for (const filename of files) {
    const raw = fs.readFileSync(path.join(resolved, filename), 'utf8');
    chunks.push(...parseIntoChunks(filename, raw));
  }

  cacheByDir.set(resolved, chunks);
  return chunks;
}

/** Clears the cache for one directory (or all, if called with no args) — useful after editing docs without a restart. */
function reloadKnowledgeBase(baseDir) {
  if (baseDir) cacheByDir.delete(path.resolve(baseDir));
  else cacheByDir.clear();
}

module.exports = { loadKnowledgeBase, reloadKnowledgeBase, parseIntoChunks };
