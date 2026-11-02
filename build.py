"""Gera os arquivos do Apps Script (src/) e a demonstração (docs/index.html) a partir de dev/.
Uso: python3 dev/build.py"""
import pathlib, re, shutil
D = pathlib.Path(__file__).parent; R = D.parent
logica = (D / 'Logica.js').read_text(encoding='utf-8')
assert '<script' not in logica.lower() and '</script' not in logica.lower(), 'Logica.js não pode conter tags de script'
html = (D / 'Index.src.html').read_text(encoding='utf-8').replace('/*@@LOGICA@@*/', logica).replace('<!--@@HEAD@@-->\n', '')
bad = [hex(ord(c)) for c in html if ord(c) in (0xFEFF, 0x2028, 0x2029)]
assert not bad, f'caracteres invisíveis encontrados: {bad}'
(R / 'src/Index.html').write_text(html, encoding='utf-8')
(R / 'src/Logica.gs').write_text(logica, encoding='utf-8')
shutil.copy(D / 'Codigo.gs', R / 'src/Codigo.gs')
(R / 'docs/index.html').write_text(html, encoding='utf-8')
print('ok:', len(re.findall(r'<script\b', html)), 'blocos de script ·', len(html), 'bytes')
