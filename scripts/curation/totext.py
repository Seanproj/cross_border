# HTML -> 텍스트 변환 (스크립트/스타일 제거, 공백 정리)
import sys, html.parser, re
class P(html.parser.HTMLParser):
    def __init__(s): super().__init__(); s.out=[]; s.skip=0
    def handle_starttag(s,t,a):
        if t in('script','style','noscript'): s.skip+=1
        if t in('p','div','li','h1','h2','h3','h4','br','tr','dt','dd'): s.out.append('\n')
    def handle_endtag(s,t):
        if t in('script','style','noscript') and s.skip: s.skip-=1
    def handle_data(s,d):
        if not s.skip: s.out.append(d)
raw=open(sys.argv[1],'rb').read()
try: txt=raw.decode('utf-8')
except UnicodeDecodeError: txt=raw.decode('latin-1')
p=P(); p.feed(txt)
t=''.join(p.out); t=re.sub(r'[ \t\r]+',' ',t); t=re.sub(r'\n\s*\n+','\n',t)
print(t.strip())
