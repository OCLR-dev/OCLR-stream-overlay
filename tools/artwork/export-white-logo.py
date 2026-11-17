"""Derive the white Showcase wordmark from the website's current winter SVG.

Usage: python3 tools/artwork/export-white-logo.py /path/to/oclr-s11-winter-banner.svg
Only the three logo layers are copied; photographic artwork is excluded.
"""
import argparse
from copy import deepcopy
from pathlib import Path
import xml.etree.ElementTree as ET

NS = 'http://www.w3.org/2000/svg'
ET.register_namespace('', NS)
ROOT = Path(__file__).resolve().parents[2]


def white(node, inside_mask=False):
    inside_mask = inside_mask or node.tag == f'{{{NS}}}mask'
    # Black/white mask values encode geometry, rather than visible colors.
    if not inside_mask:
        for key in ('fill', 'stroke', 'color', 'stop-color', 'flood-color'):
            if key in node.attrib and node.get(key) != 'none':
                node.set(key, '#fff')
    for child in node:
        white(child, inside_mask)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source', type=Path)
    args = parser.parse_args()
    source = ET.parse(args.source).getroot()
    layers = [e for e in source if e.tag == f'{{{NS}}}svg']
    expected = ('40 60 1000 430', '1036 292 184 100', '970 70 100 100')
    selected = []
    for viewport in expected:
        matches = [e for e in layers if e.get('viewBox') == viewport]
        if len(matches) != 1:
            raise ValueError(f'Expected exactly one logo layer: {viewport}')
        selected.append(deepcopy(matches[0]))
    if not any(e.get('stroke-opacity') == '0.4' for e in selected[0].iter()):
        raise ValueError('Source must contain the reviewed translucent R fill')
    root = ET.Element(f'{{{NS}}}svg', {
        'viewBox': '150 120 690 240', 'width': '690', 'height': '240',
        'color': '#fff', 'role': 'img', 'aria-labelledby': 'title desc',
    })
    ET.SubElement(root, f'{{{NS}}}title', {'id': 'title'}).text = 'OCLR S11'
    ET.SubElement(root, f'{{{NS}}}desc', {'id': 'desc'}).text = (
        'White OCLR S11 wordmark derived from the website SVG. '
        'Solid OCL lettering, translucent slider R and centered tail star.'
    )
    # Keep the existing Showcase baseline, not the banner's lower season label.
    selected[1].set('y', '236')
    for layer in selected:
        white(layer)
        root.append(layer)
    ET.indent(root, space='  ')
    ET.ElementTree(root).write(ROOT / 'ui/assets/oclr-s11-logo-white.svg',
                               encoding='utf-8', xml_declaration=True)
    # The match header uses just the four letters, with no season or subtitle.
    wordmark = ET.Element(f'{{{NS}}}svg', {
        'viewBox': '48 104 980 304', 'width': '980', 'height': '304',
        'color': '#fff', 'role': 'img', 'aria-labelledby': 'title desc',
    })
    ET.SubElement(wordmark, f'{{{NS}}}title', {'id': 'title'}).text = 'OCLR'
    ET.SubElement(wordmark, f'{{{NS}}}desc', {'id': 'desc'}).text = (
        'White OCLR letters with translucent slider R and centered tail star.'
    )
    wanted = ('O-angular', 'C-angular', 'L-angular', 'R-reference-slider')
    copied = 0
    for element in selected[0]:
        if element.tag == f'{{{NS}}}defs':
            wordmark.append(deepcopy(element))
        elif element.tag == f'{{{NS}}}g':
            group = ET.Element(element.tag, element.attrib)
            for child in element:
                if any(child.get('id', '').endswith(name) for name in wanted):
                    group.append(deepcopy(child))
                    copied += 1
            if len(group):
                wordmark.append(group)
    if copied != 4:
        raise ValueError('Expected exactly four OCLR letter groups')
    ET.indent(wordmark, space='  ')
    ET.ElementTree(wordmark).write(ROOT / 'ui/assets/oclr-logo-white.svg',
                                   encoding='utf-8', xml_declaration=True)
    print('Exported white Showcase and four-letter header logos; masks and alpha preserved.')


if __name__ == '__main__':
    main()
