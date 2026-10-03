// Renders a bot reply's small formatting subset — the same one the embed
// widget renders (apps/api/public/widgets/tenant-chat-widget.js) and the
// prompt asks for (apps/api/src/engine/promptBuilder.js "HOW TO LAY IT OUT"):
// paragraphs split by blank lines, "- " / "* " / "• " bullets, "1." steps
// and **bold**. Plain React elements only, so a reply can never inject markup.
// Anything else (a stray "#" heading) degrades to plain text.

function inline(text, keyPrefix) {
  return String(text)
    .split(/\*\*(.+?)\*\*/g) // odd indexes are the bold runs
    .map((part, i) => (i % 2
      ? <strong key={`${keyPrefix}-${i}`} className="font-semibold text-fg">{part}</strong>
      : part));
}

function toBlocks(text) {
  const blocks = [];
  let current = null;
  for (const raw of String(text || '').replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.replace(/^\s*#{1,6}\s+/, '').trim();
    const bullet = /^[-*•]\s+(.*)$/.exec(line);
    const step = bullet ? null : /^(\d+)[.)]\s+(.*)$/.exec(line);
    if (!line) {
      current = null;
    } else if (bullet || step) {
      const type = bullet ? 'ul' : 'ol';
      if (current?.type !== type) {
        current = { type, start: step ? Number(step[1]) : 1, items: [] };
        blocks.push(current);
      }
      current.items.push(bullet ? bullet[1] : step[2]);
    } else {
      if (current?.type !== 'p') {
        current = { type: 'p', items: [] };
        blocks.push(current);
      }
      current.items.push(line);
    }
  }
  return blocks;
}

export function ChatText({ text }) {
  return (
    <div className="space-y-2">
      {toBlocks(text).map((block, b) => {
        if (block.type === 'p') {
          return (
            <p key={b}>
              {block.items.map((line, i) => (
                <span key={i}>{i > 0 && <br />}{inline(line, `${b}-${i}`)}</span>
              ))}
            </p>
          );
        }
        const List = block.type;
        return (
          <List key={b} start={block.type === 'ol' && block.start !== 1 ? block.start : undefined}
            className={`space-y-1 pl-5 ${block.type === 'ul' ? 'list-disc' : 'list-decimal'} marker:text-fg-3`}>
            {block.items.map((item, i) => <li key={i} className="pl-0.5">{inline(item, `${b}-${i}`)}</li>)}
          </List>
        );
      })}
    </div>
  );
}
