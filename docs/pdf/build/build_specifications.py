#!/usr/bin/env python3
"""Build the Product Specifications & Features PDF. See README.md."""
from brandpdf import build

build({
    'source': 'docs/SPECIFICATIONS.md',
    'prefix': 'specifications',
    'doc_title': 'KGT AI Hub — Product Specifications & Features',
    'kicker': 'KGT AI Hub &middot; Product Documentation',
    'title_lines': ('Specifications', '&amp;', 'Features'),
    'lede': 'The complete functional and technical specification of the KGT AI Hub platform &mdash; '
            'every feature, limit and threshold, illustrated with the live product.',
    'meta': [('Document', 'Specifications'), ('Version', '1.0'),
             ('Date', __import__('datetime').date.today().strftime('%d %B %Y')),
             ('Platform', 'ai.kgt.solutions')],
    'contents_sub': 'Features, functional and technical specifications, verified against the live platform.',
    'back': {
        'heading': 'Trained on your content.<br>Live on your site in minutes.',
        'body': 'Point the platform at a website or drop in documents. It scans, categorises, scores '
                'readiness per bot, and provisions a Support Bot and a Sales Bot behind one script tag '
                '&mdash; isolated to one company, grounded in its own words.',
        'cards': [('Try it', 'ai.kgt.solutions'),
                  ('Companion docs', 'Process Flow &middot; Integration Guide &middot; Operations Runbook'),
                  ('Document', 'Specifications &amp; Features v1.0')],
        'foot': 'KGT AI Hub &mdash; Specifications &amp; Features v1.0'
    }
})
