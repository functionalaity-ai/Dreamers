# Single-file build of the game for the artifact page: every ES module becomes a function in
# __defs, imports become __req() lookups and exports are copied onto __exp at the end of the module.
# Usage: python3 tools/bundle.py . out.html   (run from shooter/)
import os, re, sys
ROOT, OUT = sys.argv[1], sys.argv[2]

def resolve(spec, frm):
    if spec == 'three': return 'vendor/three/three.module.js'
    if spec.startswith('three/addons/'): return 'vendor/three/addons/' + spec[len('three/addons/'):]
    return os.path.normpath(os.path.join(os.path.dirname(frm), spec)).replace(os.sep, '/')

IMP_NS = re.compile(r'^import\s+\*\s+as\s+(\w+)\s+from\s+[\'"]([^\'"]+)[\'"]\s*;?[ \t]*$', re.M)
IMP_NAMED = re.compile(r'^import\s*\{([^}]*)\}\s*from\s*[\'"]([^\'"]+)[\'"]\s*;?[ \t]*$', re.M)
IMP_BARE = re.compile(r'^import\s+[\'"]([^\'"]+)[\'"]\s*;?[ \t]*$', re.M)
EXP_DECL = re.compile(r'^export\s+((?:async\s+)?function\*?|class|const|let|var)\s+(\w+)', re.M)
EXP_LIST = re.compile(r'^export\s*\{([^}]*)\}\s*;?[ \t]*$', re.M)

mods, order = {}, []
def load(path):
    if path in mods: return
    src = open(os.path.join(ROOT, path), encoding='utf-8').read()
    if re.search(r'^export\s+default|^export\s+\*|\bimport\s*\(|import\.meta', src, re.M):
        sys.exit('unsupported module syntax in ' + path)
    mods[path] = None
    deps, exports = [], []
    def ns(m):
        p = resolve(m.group(2), path); deps.append(p)
        return 'const %s = __req("%s");' % (m.group(1), p)
    def named(m):
        p = resolve(m.group(2), path); deps.append(p)
        names = [n.strip() for n in m.group(1).replace('\n', ' ').split(',') if n.strip()]
        parts = [(lambda a: '%s: %s' % (a[0].strip(), a[1].strip()) if len(a) == 2 else a[0].strip())(n.split(' as ')) for n in names]
        return 'const { %s } = __req("%s");' % (', '.join(parts), p)
    def bare(m):
        p = resolve(m.group(1), path); deps.append(p)
        return '__req("%s");' % p
    src = IMP_NS.sub(ns, src)
    src = IMP_NAMED.sub(named, src)
    src = IMP_BARE.sub(bare, src)
    def decl(m):
        exports.append((m.group(2), m.group(2)))
        return m.group(1) + ' ' + m.group(2)
    src = EXP_DECL.sub(decl, src)
    def lst(m):
        for n in [n.strip() for n in m.group(1).replace('\n', ' ').split(',') if n.strip()]:
            a = n.split(' as ')
            exports.append((a[-1].strip(), a[0].strip()))
        return ''
    src = EXP_LIST.sub(lst, src)
    if re.search(r'^\s*(import|export)\s', src, re.M):
        bad = re.search(r'^\s*(import|export)\s.*$', src, re.M).group(0)
        sys.exit('leftover module statement in %s: %s' % (path, bad[:120]))
    tail = ''.join('\n__exp.%s = %s;' % (e, l) for e, l in exports)
    mods[path] = '__defs["%s"] = function(__req, __exp){\n%s\n%s\n};\n' % (path, src.rstrip('\n'), tail)
    order.append(path)
    for d in deps: load(d)

load('src/main.js')
js = '(function(){\nconst __defs = {};\nconst __cache = {};\nfunction __req(id){\n  if (__cache[id]) return __cache[id].exports;\n  const exp = {}; __cache[id] = { exports: exp };\n  __defs[id](__req, exp);\n  return exp;\n}\n' + ''.join(mods[p] for p in order) + '__req("src/main.js");\n})();\n'

html = open(os.path.join(ROOT, 'index.html'), encoding='utf-8').read()
head = html[html.index('<head>') + 6: html.index('</head>')]
body = html[html.index('<body>') + 6: html.index('</body>')]
links = [l.strip() for l in head.splitlines() if l.strip().startswith('<link') and 'stylesheet' not in l or ('fonts.googleapis.com/css2' in l)]
css = []
for m in re.finditer(r'<link[^>]+href="(css/[^"]+)"[^>]*>', head): css.append(open(os.path.join(ROOT, m.group(1)), encoding='utf-8').read())
body = re.sub(r'<script[^>]*src="src/main.js"[^>]*>\s*</script>', '', body)
out = '<title>Iron Meridian</title>\n<style>:root { color-scheme: dark; }</style>\n' + '\n'.join(links) + '\n<style>\n' + '\n'.join(css) + '\n</style>\n' + body.strip() + '\n<script>\n' + js.replace('</script', '<\\/script') + '</script>\n'
open(OUT, 'w', encoding='utf-8').write(out)
print(len(order), 'modules,', len(out), 'bytes;', 'css files:', len(css))
