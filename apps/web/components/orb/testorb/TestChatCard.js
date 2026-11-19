import { Card, Segmented, Chip, Input, OrbMark, Pill, IconFile, IconSend, IconArrowRight } from '..';

// Test-chat card: language toggle, the transcript, suggested questions, and the
// ask box. Presentational; wire onSend/onSuggest/onAddAnswer later.
// props: lang, onLang, messages, suggested, onSend, onAddAnswer

function SourceLine({ children }) {
  return <span className="mt-2 flex items-center gap-1.5 orb-small text-orb-secondary"><IconFile size={14} />{children}</span>;
}

function Message({ m, onAddAnswer }) {
  if (m.role === 'visitor') {
    return (
      <div className="flex justify-end">
        <p className="max-w-[80%] rounded-2xl rounded-br-md bg-orb-subtle px-4 py-2.5 orb-body text-orb-ink">{m.text}</p>
      </div>
    );
  }
  return (
    <div className="flex gap-2.5">
      <OrbMark size={28} />
      <div className="min-w-0 max-w-[86%]">
        <p className="rounded-2xl rounded-tl-md border border-orb-hairline bg-orb-white px-4 py-2.5 orb-body text-orb-ink">{m.text}</p>
        {m.source && <SourceLine>{m.source}</SourceLine>}
        {m.ticket && (
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <Pill tone="yellow">This would become a ticket</Pill>
            <button type="button" onClick={onAddAnswer} className="flex items-center gap-1 orb-small-medium text-orb-ink hover:underline focus:outline-none">
              Add the answer now <IconArrowRight size={14} />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export default function TestChatCard({ lang = 'en', onLang, messages = [], suggested = [], onSend, onAddAnswer }) {
  return (
    <Card
      title="Test chat"
      subtitle="Not saved and not counted in your results"
      headerRight={<Segmented ariaLabel="Language" value={lang} onChange={onLang} options={[{ value: 'en', label: 'English' }, { value: 'hi', label: 'Hindi' }]} />}
    >
      <div className="flex flex-col gap-5">
        {messages.map((m, i) => <Message key={i} m={m} onAddAnswer={onAddAnswer} />)}
      </div>

      <div className="mt-6">
        <p className="mb-2 orb-small text-orb-secondary">Suggested from your knowledge</p>
        <div className="flex flex-wrap gap-2">
          {suggested.map((q) => <Chip key={q} onClick={() => onSend?.(q)}>{q}</Chip>)}
        </div>
      </div>

      <form className="relative mt-4" onSubmit={(e) => { e.preventDefault(); }}>
        <Input placeholder="Ask Orb what a patient would ask…" className="h-11 pr-12" />
        <button type="submit" aria-label="Send" className="absolute right-2 top-1/2 flex size-7 -translate-y-1/2 items-center justify-center rounded-lg bg-orb-ink text-orb-white focus:outline-none focus-visible:ring-2 focus-visible:ring-orb-ink">
          <IconSend size={15} />
        </button>
      </form>
    </Card>
  );
}
