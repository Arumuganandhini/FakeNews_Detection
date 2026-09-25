"""
Build the paper as a formatted DOCX and PDF from docs/paper/paper-draft.md.

The layout follows the IEEE conference template as the IEEE Author Center
specifies it: a single-column title block over a two-column body, Times New
Roman throughout, 24pt bold title, 10pt body, 11pt bold numbered headings,
the abstract in bold italic, and a numbered reference list in citation order.

    python docs/paper/build_paper.py

Run from the repository root. Writes Paper_CO5.docx and Paper_CO5.pdf beside
the Markdown source. Kept in the repository so the documents can be rebuilt
from the source of truth rather than edited by hand and drifting from it.
"""

import io
import os
import re
import sys

from docx import Document
from docx.enum.section import WD_SECTION
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Pt, Mm

from reportlab.lib.enums import TA_CENTER, TA_JUSTIFY
from reportlab.lib.pagesizes import LETTER
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm as MM
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.lib import colors
from reportlab.platypus import (BaseDocTemplate, Frame, PageTemplate, Paragraph,
                                NextPageTemplate, FrameBreak, Spacer, Table,
                                TableStyle)


def register_times():
    """
    Use the real Times New Roman rather than reportlab's built-in Times.

    The built-in is a base-14 PostScript font in a single-byte encoding, so an
    em dash or a curly quote comes out as a black diamond — and this paper is
    full of both. The TrueType files carry the full character set. If they are
    not present (a non-Windows machine), fall back to the base-14 names and
    replace the characters that would not survive.
    """
    candidates = [
        (r'C:\Windows\Fonts\times.ttf', r'C:\Windows\Fonts\timesbd.ttf',
         r'C:\Windows\Fonts\timesi.ttf', r'C:\Windows\Fonts\timesbi.ttf'),
        ('/usr/share/fonts/truetype/liberation/LiberationSerif-Regular.ttf',
         '/usr/share/fonts/truetype/liberation/LiberationSerif-Bold.ttf',
         '/usr/share/fonts/truetype/liberation/LiberationSerif-Italic.ttf',
         '/usr/share/fonts/truetype/liberation/LiberationSerif-BoldItalic.ttf'),
    ]
    for regular, bold, italic, bolditalic in candidates:
        if not os.path.exists(regular):
            continue
        pdfmetrics.registerFont(TTFont('PaperSerif', regular))
        pdfmetrics.registerFont(TTFont('PaperSerif-Bold', bold))
        pdfmetrics.registerFont(TTFont('PaperSerif-Italic', italic))
        pdfmetrics.registerFont(TTFont('PaperSerif-BoldItalic', bolditalic))
        pdfmetrics.registerFontFamily(
            'PaperSerif', normal='PaperSerif', bold='PaperSerif-Bold',
            italic='PaperSerif-Italic', boldItalic='PaperSerif-BoldItalic')
        return ('PaperSerif', 'PaperSerif-Bold', 'PaperSerif-Italic',
                'PaperSerif-BoldItalic', True)
    return ('Times-Roman', 'Times-Bold', 'Times-Italic', 'Times-BoldItalic', False)

HERE = os.path.dirname(os.path.abspath(__file__))
SOURCE = os.path.join(HERE, 'paper-draft.md')

# IEEE: 19mm top, 17.5mm left/right/bottom, US Letter.
MARGIN_TOP = 19.0
MARGIN_SIDE = 17.5
COLUMN_GAP = 4.2


# --------------------------------------------------------------------------
# Reading the source
# --------------------------------------------------------------------------

def strip_inline(text):
    """Markdown emphasis out, plain text in. Keeps the words, drops the marks."""
    text = re.sub(r'\*\*(.+?)\*\*', r'\1', text)
    text = re.sub(r'(?<!\*)\*([^*]+?)\*(?!\*)', r'\1', text)
    text = re.sub(r'`([^`]+?)`', r'\1', text)
    text = re.sub(r'\[([^\]]+?)\]\([^)]+?\)', r'\1', text)
    return text.strip()


def parse(markdown):
    """
    Turn the Markdown into a flat list of (kind, text) blocks.

    kind is one of: title, authors, h1, h2, abstract, terms, body, bullet,
    quote, rule.
    """
    blocks = []
    lines = markdown.split('\n')
    i = 0
    in_abstract = False

    while i < len(lines):
        line = lines[i].rstrip()

        if not line.strip():
            i += 1
            continue

        if line.startswith('# '):
            blocks.append(('title', strip_inline(line[2:])))
            i += 1
            continue

        if line.startswith('## '):
            heading = strip_inline(line[3:])
            in_abstract = heading.lower() == 'abstract'
            if not in_abstract:
                blocks.append(('h1', heading))
            i += 1
            continue

        if line.startswith('### '):
            blocks.append(('h2', strip_inline(line[4:])))
            i += 1
            continue

        if line.strip() in ('---', '***'):
            i += 1
            continue

        # A fenced code block. Joined into a paragraph it became a run-on line
        # of shell with stray backticks in it, which is how the reproducibility
        # appendix first came out.
        if line.lstrip().startswith('```'):
            i += 1
            code = []
            while i < len(lines) and not lines[i].lstrip().startswith('```'):
                code.append(lines[i].rstrip())
                i += 1
            i += 1
            if code:
                blocks.append(('code', '\n'.join(code)))
            continue

        # A pipe table. Same problem: flattened, it was unreadable.
        if line.lstrip().startswith('|') and line.rstrip().endswith('|'):
            rows = []
            while i < len(lines) and lines[i].lstrip().startswith('|'):
                cells = [c.strip() for c in lines[i].strip().strip('|').split('|')]
                # The |---|---| separator carries no content.
                if not all(re.fullmatch(r':?-{2,}:?', c or '-') for c in cells):
                    rows.append([strip_inline(c) for c in cells])
                i += 1
            if rows:
                blocks.append(('table', rows))
            continue

        # Gather the paragraph: Markdown wraps hard, the document should not.
        chunk = []
        while i < len(lines) and lines[i].strip() and not lines[i].startswith(('#', '---')):
            chunk.append(lines[i].rstrip())
            i += 1
        text = ' '.join(c.strip() for c in chunk)

        if not text:
            continue

        if in_abstract and text.lstrip().startswith('*') and not text.lstrip().startswith('**'):
            blocks.append(('abstract', strip_inline(text)))
            continue

        if text.startswith('**Index Terms**'):
            blocks.append(('terms', strip_inline(text)))
            in_abstract = False
            continue

        # A wrapped list: split it back into its items.
        if re.match(r'^\s*(\d+\.|[-*])\s', chunk[0]):
            items = re.split(r'(?:^|\s)(?=(?:\d+\.|[-*])\s)', text)
            for item in items:
                item = re.sub(r'^(?:\d+\.|[-*])\s*', '', item).strip()
                if item:
                    blocks.append(('bullet', strip_inline(item)))
            continue

        if chunk[0].lstrip().startswith('>'):
            blocks.append(('quote', strip_inline(re.sub(r'^\s*>\s?', '', text))))
            continue

        # The author block sits directly under the title, and its line breaks
        # are meaningful — names, guide, department, course each get a line.
        if len(blocks) == 1 and blocks[0][0] == 'title':
            blocks.append(('authors', '\n'.join(strip_inline(c) for c in chunk if c.strip())))
            continue

        blocks.append(('body', strip_inline(text)))

    return blocks


# --------------------------------------------------------------------------
# DOCX
# --------------------------------------------------------------------------

def set_columns(section, count):
    """python-docx exposes no column API, so the property is set on the XML."""
    cols = section._sectPr.xpath('./w:cols')[0]
    cols.set(qn('w:num'), str(count))
    cols.set(qn('w:space'), str(int(COLUMN_GAP * 56.7)))  # twips


def build_docx(blocks, out_path):
    doc = Document()

    normal = doc.styles['Normal']
    normal.font.name = 'Times New Roman'
    normal.font.size = Pt(10)
    normal.paragraph_format.space_after = Pt(0)
    normal.paragraph_format.line_spacing = 1.0
    # Latin and complex scripts both, or Word substitutes for the second.
    rpr = normal.element.get_or_add_rPr()
    fonts = rpr.find(qn('w:rFonts'))
    if fonts is None:
        fonts = OxmlElement('w:rFonts')
        rpr.append(fonts)
    for attr in ('w:ascii', 'w:hAnsi', 'w:cs', 'w:eastAsia'):
        fonts.set(qn(attr), 'Times New Roman')

    section = doc.sections[0]
    section.top_margin = Mm(MARGIN_TOP)
    section.bottom_margin = Mm(MARGIN_SIDE)
    section.left_margin = Mm(MARGIN_SIDE)
    section.right_margin = Mm(MARGIN_SIDE)

    def para(text, size=10, bold=False, italic=False, align=None,
             space_before=0, space_after=6, indent=0):
        p = doc.add_paragraph()
        run = p.add_run(text)
        run.font.size = Pt(size)
        run.bold = bold
        run.italic = italic
        run.font.name = 'Times New Roman'
        p.paragraph_format.space_before = Pt(space_before)
        p.paragraph_format.space_after = Pt(space_after)
        p.paragraph_format.alignment = align or WD_ALIGN_PARAGRAPH.JUSTIFY
        if indent:
            p.paragraph_format.left_indent = Pt(indent)
        return p

    # --- Title block, single column ----------------------------------------
    set_columns(section, 1)
    title_seen = False
    index = 0
    for kind, text in blocks:
        if kind == 'title':
            para(text, size=24, bold=False, align=WD_ALIGN_PARAGRAPH.CENTER,
                 space_after=12)
            title_seen = True
        elif kind == 'authors' and title_seen:
            for line in text.split(chr(10)):
                if line.strip():
                    para(line.strip(), size=11, align=WD_ALIGN_PARAGRAPH.CENTER,
                         space_after=2)
        index += 1
        if kind == 'authors':
            break

    # --- Body, two columns --------------------------------------------------
    body = doc.add_section(WD_SECTION.CONTINUOUS)
    body.top_margin = Mm(MARGIN_TOP)
    body.bottom_margin = Mm(MARGIN_SIDE)
    body.left_margin = Mm(MARGIN_SIDE)
    body.right_margin = Mm(MARGIN_SIDE)
    set_columns(body, 2)

    for kind, text in blocks[index:]:
        if kind == 'abstract':
            p = doc.add_paragraph()
            lead = p.add_run('Abstract—')
            lead.bold = True
            lead.italic = True
            lead.font.size = Pt(9)
            rest = p.add_run(text)
            rest.bold = True
            rest.italic = True
            rest.font.size = Pt(9)
            p.paragraph_format.alignment = WD_ALIGN_PARAGRAPH.JUSTIFY
            p.paragraph_format.space_after = Pt(6)
        elif kind == 'terms':
            cleaned = re.sub(r'^Index Terms\s*[—-]\s*', '', text)
            p = doc.add_paragraph()
            lead = p.add_run('Index Terms—')
            lead.bold = True
            lead.italic = True
            lead.font.size = Pt(9)
            rest = p.add_run(cleaned)
            rest.italic = True
            rest.font.size = Pt(9)
            p.paragraph_format.alignment = WD_ALIGN_PARAGRAPH.JUSTIFY
            p.paragraph_format.space_after = Pt(10)
        elif kind == 'h1':
            para(text.upper(), size=11, bold=True, align=WD_ALIGN_PARAGRAPH.CENTER,
                 space_before=10, space_after=4)
        elif kind == 'h2':
            para(text, size=10, italic=True, align=WD_ALIGN_PARAGRAPH.LEFT,
                 space_before=8, space_after=3)
        elif kind == 'bullet':
            para('•  ' + text, indent=10, space_after=3)
        elif kind == 'quote':
            para(text, italic=True, indent=14, space_after=6)
        elif kind == 'code':
            for line in text.split(chr(10)):
                p_ = doc.add_paragraph()
                run = p_.add_run(line if line.strip() else ' ')
                run.font.name = 'Consolas'
                run.font.size = Pt(8)
                p_.paragraph_format.left_indent = Pt(8)
                p_.paragraph_format.space_after = Pt(0)
                p_.paragraph_format.alignment = WD_ALIGN_PARAGRAPH.LEFT
            para(' ', size=4, space_after=4)
        elif kind == 'table':
            rows = text
            table = doc.add_table(rows=len(rows), cols=max(len(r) for r in rows))
            table.style = 'Table Grid'
            for r, row in enumerate(rows):
                for c, cell in enumerate(row):
                    tc = table.cell(r, c)
                    tc.text = ''
                    run = tc.paragraphs[0].add_run(cell)
                    run.font.size = Pt(8)
                    run.font.name = 'Times New Roman'
                    run.bold = (r == 0)
            para(' ', size=4, space_after=4)
        else:
            para(text, space_after=6)

    doc.save(out_path)
    return out_path


# --------------------------------------------------------------------------
# PDF
# --------------------------------------------------------------------------

def build_pdf(blocks, out_path):
    ROMAN, BOLD, ITALIC, BOLDITALIC, unicode_ok = register_times()
    page_w, page_h = LETTER
    left = MARGIN_SIDE * MM
    top = MARGIN_TOP * MM
    usable_w = page_w - 2 * left
    gap = COLUMN_GAP * MM
    col_w = (usable_w - gap) / 2
    usable_h = page_h - top - MARGIN_SIDE * MM

    styles = {
        'title': ParagraphStyle('title', fontName=ROMAN, fontSize=20,
                                leading=24, alignment=TA_CENTER, spaceAfter=10),
        'authors': ParagraphStyle('authors', fontName=ROMAN, fontSize=10.5,
                                  leading=13, alignment=TA_CENTER, spaceAfter=2),
        'abstract': ParagraphStyle('abstract', fontName=BOLDITALIC, fontSize=9,
                                   leading=11, alignment=TA_JUSTIFY, spaceAfter=6),
        'terms': ParagraphStyle('terms', fontName=ITALIC, fontSize=9,
                                leading=11, alignment=TA_JUSTIFY, spaceAfter=10),
        'h1': ParagraphStyle('h1', fontName=BOLD, fontSize=10.5, leading=13,
                             alignment=TA_CENTER, spaceBefore=10, spaceAfter=4),
        'h2': ParagraphStyle('h2', fontName=ITALIC, fontSize=10, leading=12,
                             spaceBefore=8, spaceAfter=3),
        'body': ParagraphStyle('body', fontName=ROMAN, fontSize=9.5,
                               leading=11.5, alignment=TA_JUSTIFY, spaceAfter=5),
        'bullet': ParagraphStyle('bullet', fontName=ROMAN, fontSize=9.5,
                                 leading=11.5, alignment=TA_JUSTIFY, spaceAfter=3,
                                 leftIndent=10, bulletIndent=2),
        'quote': ParagraphStyle('quote', fontName=ITALIC, fontSize=9.5,
                                leading=11.5, alignment=TA_JUSTIFY, spaceAfter=5,
                                leftIndent=14),
        'code': ParagraphStyle('code', fontName='Courier', fontSize=7.4,
                               leading=9, spaceAfter=6, leftIndent=6,
                               backColor=colors.HexColor('#f4f4f4')),
        'cell': ParagraphStyle('cell', fontName=ROMAN, fontSize=7.4, leading=9),
    }

    doc = BaseDocTemplate(out_path, pagesize=LETTER,
                          leftMargin=left, rightMargin=left,
                          topMargin=top, bottomMargin=MARGIN_SIDE * MM,
                          title='Adversarially Asymmetric Evidence for Calibrated '
                                'Fake News Detection',
                          author='Mugilan K S, Nandha Kumar S, Nandhini A')

    # Page one: a full-width band for the title block, then two columns.
    #
    # Sized to the block it holds rather than guessed: a title that wraps to two
    # lines plus four author lines. At 34mm the last two author lines overflowed
    # into the left column and sat beside the abstract.
    title_lines = 2
    author_lines = sum(
        len([l for l in text.split(chr(10)) if l.strip()])
        for kind, text in blocks if kind == 'authors')
    banner_h = (14 + title_lines * 9 + author_lines * 5.2) * MM
    first = PageTemplate(
        id='first',
        frames=[
            Frame(left, page_h - top - banner_h, usable_w, banner_h, id='banner',
                  leftPadding=0, rightPadding=0, topPadding=0, bottomPadding=0),
            Frame(left, MARGIN_SIDE * MM, col_w, usable_h - banner_h, id='c1',
                  leftPadding=0, rightPadding=0, topPadding=0, bottomPadding=0),
            Frame(left + col_w + gap, MARGIN_SIDE * MM, col_w, usable_h - banner_h,
                  id='c2', leftPadding=0, rightPadding=0, topPadding=0, bottomPadding=0),
        ])
    rest = PageTemplate(
        id='rest',
        frames=[
            Frame(left, MARGIN_SIDE * MM, col_w, usable_h, id='r1',
                  leftPadding=0, rightPadding=0, topPadding=0, bottomPadding=0),
            Frame(left + col_w + gap, MARGIN_SIDE * MM, col_w, usable_h, id='r2',
                  leftPadding=0, rightPadding=0, topPadding=0, bottomPadding=0),
        ])
    doc.addPageTemplates([first, rest])

    FOLD = {'—': '--', '–': '-', '‘': "'", '’': "'",
            '“': '"', '”': '"', '…': '...', '×': 'x',
            '−': '-', '·': '.'}

    def esc(text):
        if not unicode_ok:
            for bad, good in FOLD.items():
                text = text.replace(bad, good)
        return (text.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;'))

    story = []
    index = 0
    for kind, text in blocks:
        if kind == 'title':
            story.append(Paragraph(esc(text), styles['title']))
        elif kind == 'authors':
            for line in text.split(chr(10)):
                if line.strip():
                    story.append(Paragraph(esc(line.strip()), styles['authors']))
            index += 1
            break
        index += 1

    story.append(NextPageTemplate('rest'))
    story.append(FrameBreak())

    for kind, text in blocks[index:]:
        if kind == 'abstract':
            story.append(Paragraph('<b><i>Abstract—</i></b>' + esc(text), styles['abstract']))
        elif kind == 'terms':
            cleaned = re.sub(r'^Index Terms\s*[—-]\s*', '', text)
            story.append(Paragraph('<b><i>Index Terms—</i></b>' + esc(cleaned), styles['terms']))
        elif kind == 'h1':
            story.append(Paragraph(esc(text.upper()), styles['h1']))
        elif kind == 'h2':
            story.append(Paragraph(esc(text), styles['h2']))
        elif kind == 'bullet':
            story.append(Paragraph(esc(text), styles['bullet'], bulletText='•'))
        elif kind == 'quote':
            story.append(Paragraph(esc(text), styles['quote']))
        elif kind == 'code':
            body_text = '<br/>'.join(
                esc(line).replace(' ', '&nbsp;') for line in text.split(chr(10)))
            story.append(Paragraph(body_text, styles['code']))
        elif kind == 'table':
            rows = text
            data = [[Paragraph(esc(c), styles['cell']) for c in row] for row in rows]
            width = col_w - 4
            table = Table(data, colWidths=[width / len(rows[0])] * len(rows[0]))
            table.setStyle(TableStyle([
                ('GRID', (0, 0), (-1, -1), 0.4, colors.HexColor('#888888')),
                ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#eeeeee')),
                ('VALIGN', (0, 0), (-1, -1), 'TOP'),
                ('LEFTPADDING', (0, 0), (-1, -1), 3),
                ('RIGHTPADDING', (0, 0), (-1, -1), 3),
                ('TOPPADDING', (0, 0), (-1, -1), 2),
                ('BOTTOMPADDING', (0, 0), (-1, -1), 2),
            ]))
            story.append(table)
            story.append(Spacer(1, 6))
        else:
            story.append(Paragraph(esc(text), styles['body']))

    doc.build(story)
    return out_path


def main():
    markdown = io.open(SOURCE, encoding='utf-8').read()
    blocks = parse(markdown)

    docx_path = build_docx(blocks, os.path.join(HERE, 'Paper_CO5.docx'))
    pdf_path = build_pdf(blocks, os.path.join(HERE, 'Paper_CO5.pdf'))

    kinds = {}
    for kind, _ in blocks:
        kinds[kind] = kinds.get(kind, 0) + 1
    print('blocks:', ', '.join(f'{k}={v}' for k, v in sorted(kinds.items())))
    for path in (docx_path, pdf_path):
        print(f'{os.path.basename(path)}: {os.path.getsize(path):,} bytes')


if __name__ == '__main__':
    sys.exit(main())
