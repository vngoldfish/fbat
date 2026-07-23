import json, sys

har_path = sys.argv[1]
entry_idx = int(sys.argv[2])

with open(har_path, 'r', encoding='utf-8', errors='ignore') as f:
    har = json.load(f)

entry = har['log']['entries'][entry_idx]
req = entry['request']
res = entry['response']

print(f"=== Entry [{entry_idx}] ===")
print(f"Method: {req['method']}")
print(f"URL: {req['url']}")
print(f"Status: {res['status']}")
print()

# Headers
print("=== REQUEST HEADERS ===")
for h in req.get('headers', []):
    print(f"  {h['name']}: {h['value'][:100]}")

print()
print("=== POST DATA ===")
pd = req.get('postData', {})
if pd:
    print(f"mimeType: {pd.get('mimeType', '')}")
    params = pd.get('params', [])
    if params:
        print(f"params ({len(params)}):")
        for p in params:
            val = str(p.get('value', ''))
            fname = p.get('fileName', '')
            ctype = p.get('contentType', '')
            print(f"  {p.get('name','')}: value={val[:100]} fileName={fname} contentType={ctype}")
    text = pd.get('text', '')
    if text:
        print(f"text (first 500): {text[:500]}")

print()
print("=== RESPONSE ===")
print(f"Status: {res['status']} {res.get('statusText','')}")
content = res.get('content', {})
print(f"mimeType: {content.get('mimeType','')}")
print(f"size: {content.get('size', 0)}")
text = content.get('text', '')
if text:
    clean = text
    if clean.startswith('for (;;);'):
        clean = clean[9:]
    try:
        rd = json.loads(clean)
        print(f"Parsed JSON: {json.dumps(rd, indent=2, ensure_ascii=False)[:2000]}")
    except:
        print(f"Raw text (first 1000): {text[:1000]}")
