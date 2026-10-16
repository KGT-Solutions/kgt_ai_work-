import fitz, sys

PREFIX = sys.argv[1] if len(sys.argv) > 1 else 'process-flow'
OUT = sys.argv[2] if len(sys.argv) > 2 else '../KGT-AI-Hub-Process-Flow.pdf'
TITLE = sys.argv[3] if len(sys.argv) > 3 else 'KGT AI Hub — End-to-End Process Flow'

doc = fitz.open()
bleed, body = fitz.open(f'{PREFIX}-bleed.pdf'), fitz.open(f'{PREFIX}-body.pdf')

# cover · contents + sections · back cover
doc.insert_pdf(bleed, from_page=0, to_page=0)
doc.insert_pdf(body)
doc.insert_pdf(bleed, from_page=1, to_page=1)

doc.set_metadata({
    'title': TITLE,
    'author': 'KGT Solutions',
    'subject': 'Platform documentation: the end-to-end process flow, signup to follow-up',
    'keywords': 'KGT AI Hub, process flow, support bot, sales bot, ai.kgt.solutions',
    'creator': 'KGT Solutions'
})

# Section headings are the only 17pt text in the document. The fonts embed as
# Type3, so the bold flag is unreliable — size is what identifies them.
toc, n = [[1, 'Cover', 1], [1, 'Contents', 2]], 0
for page in doc:
    for block in page.get_text('dict')['blocks']:
        for line in block.get('lines', []):
            for span in line['spans']:
                if 16.5 <= span['size'] < 17.5:
                    text = span['text'].strip()
                    if text and text != 'Contents':
                        n += 1
                        toc.append([1, f'{n}. {text}', page.number + 1])
toc.append([1, 'ai.kgt.solutions', doc.page_count])
doc.set_toc(toc)

out = OUT
doc.save(out, deflate=True, garbage=4)
print(f'{out}: {doc.page_count} pages, {n} sections bookmarked')
