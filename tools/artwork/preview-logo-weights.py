"""Generate inward-only R outline candidates without changing active artwork."""
from copy import deepcopy
from pathlib import Path
import xml.etree.ElementTree as ET

NS = 'http://www.w3.org/2000/svg'
ET.register_namespace('', NS)
ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / '.local/logo-weights'
VARIANTS = [('original', '原版', 9), ('a', 'A · 2 倍', 18),
            ('b', 'B · 3 倍', 27), ('c', 'C · 4 倍', 36)]


def adjust(root, thickness):
    inner = 163 - 2 * thickness
    ratio = inner / 145
    for node in root.iter():
        name = node.get('id', '')
        if name.endswith('r-inner-r-track'):
            node.set('stroke-width', str(inner))
        elif name.endswith(('r-inner-r-head-cap', 'r-inner-r-tail-cap')):
            node.set('r', str(82.25 - thickness))
        elif name.endswith('r-fill-mask'):
            for child in node:
                if child.tag == f'{{{NS}}}use':
                    child.set('stroke-width', str(inner))
                elif child.tag == f'{{{NS}}}circle':
                    child.set('r', str(82.25 - thickness))
        elif name.endswith('r-fill-soften'):
            node.find(f'{{{NS}}}feGaussianBlur').set('stdDeviation', f'{25 * ratio:.4f}')
        elif name.endswith('r-fill-shading'):
            for child in node:
                if child.tag == f'{{{NS}}}use':
                    child.set('stroke-width', f'{36 * ratio:.4f}')
    return root


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    rows = []
    for key, label, thickness in VARIANTS:
        for name in ('oclr-logo-white', 'oclr-s11-logo-white'):
            root = adjust(ET.parse(ROOT / f'ui/assets/{name}.svg').getroot(), thickness)
            ET.ElementTree(root).write(OUT / f'{key}-{name}.svg', encoding='utf-8', xml_declaration=True)
            if name == 'oclr-logo-white':
                zoom = deepcopy(root)
                zoom.set('viewBox', '790 110 230 300')
                zoom.set('width', '230')
                zoom.set('height', '300')
                ET.ElementTree(zoom).write(OUT / f'{key}-r.svg', encoding='utf-8', xml_declaration=True)
        px = thickness * (260 / 580.911648326) * (160 / 980)
        rows.append(f'''<section><div class="label"><h2>{label}</h2><p>顶部描边约 {px:.2f}px</p><small>渐变区域缩至 {(163-2*thickness)/145:.0%}</small></div>
        <div class="sample"><small>顶部 · 160px</small><img width="160" src="{key}-oclr-logo-white.svg"></div>
        <div class="sample"><small>直播缩至 720p · 107px</small><img width="107" src="{key}-oclr-logo-white.svg"></div>
        <div class="sample"><small>R 放大</small><img width="110" src="{key}-r.svg"></div>
        <div class="sample season"><small>Showcase · 388px</small><img width="388" src="{key}-oclr-s11-logo-white.svg"></div></section>''')
    html = '''<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>OCLR · R 轮廓粗细对比</title>
    <style>*{box-sizing:border-box}body{margin:0;background:#100a20;color:#f4efff;font:14px system-ui}header{padding:22px 30px;background:#211331;position:sticky;top:0;z-index:2;border-bottom:1px solid #604875}h1{margin:0 0 10px;font-size:22px}header p{margin:0 0 12px;color:#d4c5e4}button{padding:7px 16px;border:1px solid #9f83b6;border-radius:6px;background:#352249;color:#fff;cursor:pointer;margin-right:8px}main{--bg:linear-gradient(120deg,#20103d,#130b26);padding:14px 24px}section{display:grid;grid-template-columns:175px 190px 155px 135px minmax(390px,1fr);gap:15px;align-items:center;min-height:205px;padding:14px 20px;margin-bottom:12px;border:1px solid #57406f;border-radius:8px;background:var(--bg)}h2{font-size:20px;margin:0 0 8px}.label p{margin:5px 0}.label small{opacity:.75}.sample{display:flex;flex-direction:column;align-items:center;gap:22px}.sample small{color:#c5b4d8}.sample img{display:block;height:auto;max-width:none}.season img{opacity:.9;filter:drop-shadow(0 0 14px #8b5cf640)}@media(max-width:1150px){main{overflow-x:auto}section{min-width:1130px}}</style>
    <header><h1>R 向内加粗 · 4 档对比</h1><p>外轮廓、星点和透明度保持一致；描边向内增厚，内部渐变宽度与柔化半径同比收窄。请优先比较 160px / 107px 两列。</p><button onclick="document.querySelector('main').style.setProperty('--bg','linear-gradient(120deg,#20103d,#130b26)')">直播深紫</button><button onclick="document.querySelector('main').style.setProperty('--bg','#000')">纯黑</button><button onclick="document.querySelector('main').style.setProperty('--bg','#595565')">中灰</button></header><main>'''+''.join(rows)+'''</main></html>'''
    (OUT / 'index.html').write_text(html)
    print(OUT / 'index.html')


if __name__ == '__main__':
    main()
