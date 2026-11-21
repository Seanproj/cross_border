# 데이터 검증: 출처 인용문이 스냅샷 원문에 그대로 있는지, 템플릿 구조 규칙(docs/DATA_SPEC.md)을 지키는지 확인합니다.
# usage: python3 -I scripts/curation/verify_data.py <repo_root> <snapshot_dir>
import sys, yaml, glob, re, hashlib, os, collections
repo, pages = sys.argv[1], sys.argv[2]
MAP = {  # source_key -> snapshot name
 'bund.portal.wohnsitz_anmelden':'vb_anm_fed','berlin.service.anmeldung':'berlin_anmeldung',
 'berlin.lea.laengerer_aufenthalt':'berlin_longstay','berlin.lea.beschaeftigung':'berlin_lea_employment',
 'bund.portal.eat_frankfurt':'vb_ffm_eat','bund.anerkennung.portal':'anerkennung',
 'berlin.service.kita_gutschein':'berlin_kita','bzst.idnr':'bzst_idnr','rundfunkbeitrag.start':'rundfunk',
 'bmg.gkv':'bmg_gkv','drv.korea':'drv_korea','bnetza.prepaid_ident':'bnetza_prepaid',
 'berlin.service.fahrerlaubnis_drittstaat':'berlin_license','bund.portal.fahrerlaubnis_frankfurt':'vb_ffm_license'}
norm = lambda s: re.sub(r'\s+',' ',s).strip()
errors, warns = [], []
sources = {s['source_key']: s for s in yaml.safe_load(open(f'{repo}/data/sources/sources.yaml'))}
hashes = {}
for k in sources:
    t = open(f'{pages}/{MAP[k]}.txt', encoding='utf-8').read()
    hashes[k] = hashlib.sha256(norm(t).encode()).hexdigest()
templates = []
for f in sorted(glob.glob(f'{repo}/data/templates/*.yaml')):
    templates += yaml.safe_load(open(f))
keys = [t['template_key'] for t in templates]
for k,c in collections.Counter(keys).items():
    if c>1: errors.append(f'duplicate template_key {k}')
byk = {t['template_key']:t for t in templates}
excerpt_ok = excerpt_total = 0
for t in templates:
    k = t['template_key']
    sup = collections.defaultdict(set)
    for s in t['sources']:
        if s['source_key'] not in sources: errors.append(f'{k}: unknown source {s["source_key"]}'); continue
        sup[s['source_key']] |= set(s['supports'])
        excerpt_total += 1
        txt = norm(open(f'{pages}/{MAP[s["source_key"]]}.txt', encoding='utf-8').read())
        if norm(s['excerpt']) in txt: excerpt_ok += 1
        else: errors.append(f'{k}: excerpt not found in {s["source_key"]}: {s["excerpt"][:70]}')
    if t['verification_status']=='verified' and not any('existence' in v for v in sup.values()):
        errors.append(f'{k}: verified without existence source')
    if t['verification_status']=='needs_review' and not t['sources']:
        errors.append(f'{k}: needs_review requires at least one source (else draft)')
    d = t.get('deadline_rule')
    if d and 'deadline' not in sup.get(d['source_key'], set()):
        errors.append(f'{k}: deadline_rule source lacks supports=deadline')
    for doc in t['required_documents']:
        sk = doc.get('source_key')
        if sk and 'documents' not in sup.get(sk,set()): errors.append(f'{k}: document source {sk} lacks supports=documents')
    for p in t['prerequisites']:
        if p['template_key'] not in byk: errors.append(f'{k}: unknown prerequisite {p["template_key"]}')
# cycle check
state = {}
def dfs(k, path):
    state[k]=1
    for p in byk[k]['prerequisites']:
        q=p['template_key']
        if q not in byk: continue
        if state.get(q)==1: errors.append('cycle: '+' -> '.join(path+[q]))
        elif q not in state: dfs(q, path+[q])
    state[k]=2
for k in byk:
    if k not in state: dfs(k,[k])
st = collections.Counter(t['verification_status'] for t in templates)
cat = collections.Counter(t['category'] for t in templates)
print(f'templates={len(templates)} status={dict(st)}')
print(f'categories={dict(cat)}')
print(f'excerpts verbatim match: {excerpt_ok}/{excerpt_total}')
print('content_hash:'); [print(f'  {k}: {h}') for k,h in hashes.items()]
print('ERRORS:' if errors else 'ERRORS: none'); [print('  '+e) for e in errors]
sys.exit(1 if errors else 0)
