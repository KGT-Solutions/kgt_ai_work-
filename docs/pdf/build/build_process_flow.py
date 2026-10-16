#!/usr/bin/env python3
"""Build the End-to-End Process Flow PDF. See README.md."""
from brandpdf import build

build({
    'source': 'docs/PROCESS_FLOW.md',
    'prefix': 'process-flow',
    'doc_title': 'KGT AI Hub — End-to-End Process Flow',
    'kicker': 'KGT AI Hub &middot; Platform Documentation',
    'title_lines': ('End-to-End', 'Process', 'Flow'),
    'lede': 'How a company goes from first visit to two trained bots answering its '
            'customers &mdash; every stage, every decision point, and the data written at each step.',
    'meta': [('Document', 'Process Flow'), ('Version', '1.0'),
             ('Date', __import__('datetime').date.today().strftime('%d %B %Y')),
             ('Audience', 'Engineering, Product, Support')],
    'contents_sub': 'Seven stages, plus the cross-cutting flows that run through all of them.',
    'back': {
        'heading': 'Two bots. One knowledge base.<br>Grounded, or handed to a person.',
        'body': "Every company's documents are split into sections and scoped to the Support bot, the "
                'Sales bot, or both. Retrieval produces a confidence score; below the threshold the bot '
                'does not answer &mdash; it offers a follow-up and files a ticket.',
        'cards': [('Companion docs', 'Specifications &middot; Developer Guide &middot; Integration Guide'),
                  ('Reference', 'DOCUMENTATION.md &middot; TESTING.md'),
                  ('Platform', 'ai.kgt.solutions')],
        'foot': 'KGT AI Hub &mdash; Process Flow v1.0'
    }
})
