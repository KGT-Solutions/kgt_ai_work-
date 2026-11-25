import { useEffect, useRef } from 'react';
import { Card, Segmented, Chip, Input, OrbMark, IconFile, IconSend, IconUpload, cx } from '..';

// Test-chat card: bot toggle (Support / Sales) + language toggle, the live
// transcript, suggested starters, image attachment and the ask box.
// Presentational — the page owns the threads and the API calls.
// props: bot, onBot, lang, onLang, messages, pending, suggested, generating,
//        onRefresh, input, onInput, image, imgError, onPickImage, onRemoveImage,
//        onSend, onStarter, onFollowUp

function Message({ m, isLast, onFollowUp }) {
  if (m.role === 'visitor') {
    return (
      <div className="flex justify-end">
        <div className="max-w-[80%] rounded-2xl rounded-br-md bg-orb-subtle px-4 py-2.5">
          {m.image && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={m.image} alt="" className="mb-1.5 max-h-40 max-w-full rounded-lg" />
          )}
          {m.text && <p className="orb-body text-orb-ink">{m.text}</p>}
        </div>
      </div>
    );
  }
  return (
    <div className="flex gap-2.5">
      <OrbMark size={28} />
      <div className="min-w-0 max-w-[86%]">
        <p className={cx('rounded-2xl rounded-tl-md border px-4 py-2.5 orb-body',
          m.error ? 'whitespace-pre-wrap border-orb-yellow bg-orb-yellow/40 text-orb-ink' : 'border-orb-hairline bg-orb-white text-orb-ink')}>
          {m.text}
        </p>
        {m.source && (
          <span className="mt-2 flex items-center gap-1.5 orb-small text-orb-secondary"><IconFile size={14} />{m.source}</span>
        )}
        {isLast && !m.error && m.meta?.followUps?.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-2">
            {m.meta.followUps.map((q) => <Chip key={q} onClick={() => onFollowUp(q)}>{q}</Chip>)}
          </div>
        )}
      </div>
    </div>
  );
}

export default function TestChatCard({
  bot = 'support', onBot, lang = 'en', onLang, messages = [], pending, suggested = [], generating, onRefresh,
  input = '', onInput, image, imgError, onPickImage, onRemoveImage, onSend, onStarter, onFollowUp
}) {
  const fileRef = useRef(null);
  const scrollRef = useRef(null);
  useEffect(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' }); }, [messages, pending]);
  const botName = bot === 'sales' ? 'Sales' : 'Support';

  return (
    <Card
      title="Test chat"
      subtitle="Not saved and not counted in your results"
      headerRight={(
        <div className="flex items-center gap-2">
          <Segmented ariaLabel="Bot" value={bot} onChange={onBot} options={[{ value: 'support', label: 'Support' }, { value: 'sales', label: 'Sales' }]} />
          <Segmented ariaLabel="Language" value={lang} onChange={onLang} options={[{ value: 'en', label: 'English' }, { value: 'hi', label: 'Hindi' }]} />
        </div>
      )}
    >
      <div ref={scrollRef} className="orb-scrollbar flex max-h-[420px] flex-col gap-5 overflow-y-auto">
        {messages.length === 0 && !pending && (
          <p className="py-6 text-center orb-body text-orb-secondary">Ask the {botName} bot what a patient would ask.</p>
        )}
        {messages.map((m, i) => <Message key={i} m={m} isLast={i === messages.length - 1} onFollowUp={onFollowUp} />)}
        {pending && (
          <div className="flex gap-2.5">
            <OrbMark size={28} />
            <div className="flex gap-1 rounded-2xl rounded-tl-md border border-orb-hairline bg-orb-white px-4 py-3" aria-label="Thinking">
              {[0, 150, 300].map((d) => <span key={d} className="size-1.5 animate-bounce rounded-full bg-orb-tertiary" style={{ animationDelay: `${d}ms` }} />)}
            </div>
          </div>
        )}
      </div>

      {messages.length === 0 && (
        <div className="mt-6 mb-[120px]">
          <div className="mb-2 flex items-center justify-between gap-3">
            <p className="orb-small text-orb-secondary">{generating ? 'Writing suggested questions from your content…' : 'Suggested from your knowledge'}</p>
            <button type="button" onClick={onRefresh} disabled={generating}
              className="orb-small-medium text-orb-ink hover:underline focus:outline-none disabled:opacity-45">Refresh</button>
          </div>
          <div className="flex flex-wrap gap-2">
            {suggested.map((q) => <Chip key={q} onClick={() => onStarter(q)}>{q}</Chip>)}
          </div>
        </div>
      )}

      {(image || imgError) && (
        <div className="mt-4 flex items-center gap-3 rounded-[10px] border border-orb-hairline px-3 py-2">
          {image ? (
            <>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={image} alt="" className="size-10 shrink-0 rounded-md object-cover" />
              <span className="min-w-0 flex-1 truncate orb-small text-orb-secondary">Image attached</span>
              <button type="button" onClick={onRemoveImage} className="shrink-0 orb-small-medium text-orb-secondary hover:text-orb-ink focus:outline-none">Remove</button>
            </>
          ) : <span className="orb-small text-orb-ink">{imgError}</span>}
        </div>
      )}

      <form className="mt-4 flex items-center gap-2" onSubmit={(e) => { e.preventDefault(); onSend?.(); }}>
        <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" className="hidden"
          onChange={(e) => { onPickImage?.(e.target.files?.[0]); e.target.value = ''; }} />
        <button type="button" onClick={() => fileRef.current?.click()} aria-label="Attach image"
          className="flex size-11 shrink-0 items-center justify-center rounded-lg border border-orb-stroke text-orb-secondary transition-colors hover:text-orb-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-orb-ink">
          <IconUpload size={16} />
        </button>
        <div className="relative min-w-0 flex-1">
          <Input value={input} onChange={(e) => onInput?.(e.target.value)} placeholder="Ask Orb what a patient would ask…" className="h-11 pr-12" />
          <button type="submit" aria-label="Send" disabled={pending || (!input.trim() && !image)}
            className="absolute right-2 top-1/2 flex size-7 -translate-y-1/2 items-center justify-center rounded-lg bg-orb-ink text-orb-white transition-opacity focus:outline-none focus-visible:ring-2 focus-visible:ring-orb-ink disabled:opacity-40">
            <IconSend size={15} />
          </button>
        </div>
      </form>
    </Card>
  );
}
