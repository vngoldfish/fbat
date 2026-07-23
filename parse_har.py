import json, sys

har_path = sys.argv[1] if len(sys.argv) > 1 else '/Users/nguyentuan/Desktop/fbAUTO/err.har'
print(f"=== Parsing: {har_path} ===")

with open(har_path, 'r', encoding='utf-8', errors='ignore') as f:
    har = json.load(f)

entries = har['log']['entries']
print(f"Total entries: {len(entries)}\n")

keywords = ['upload', 'vupload', 'rupload', 'react_composer', 'ComposerStory', 'saveunpublished', 'graphql']

for idx, entry in enumerate(entries):
    url = entry.get('request', {}).get('url', '')
    method = entry.get('request', {}).get('method', '')
    status = entry.get('response', {}).get('status', 0)

    if not any(kw in url for kw in keywords):
        continue
    if method == 'OPTIONS':
        continue
    if '/images/' in url or '.png' in url or '.css' in url:
        continue

    # For graphql, only show composer-related
    if 'graphql' in url:
        pd = entry.get('request', {}).get('postData', {})
        text = pd.get('text', '')
        if 'ComposerStory' not in text and 'composer' not in text.lower():
            continue

    resp_text = entry.get('response', {}).get('content', {}).get('text', '')
    resp_info = ""
    if resp_text:
        clean = resp_text[:3000]
        if clean.startswith('for (;;);'):
            clean = clean[9:]
        try:
            rd = json.loads(clean)
            if 'errorSummary' in rd:
                resp_info = f"ERROR: {rd['errorSummary']}: {rd.get('errorDescription','')[:200]}"
            elif 'error' in rd and isinstance(rd['error'], int) and rd['error'] > 0:
                resp_info = f"ERROR code={rd['error']}"
            elif 'payload' in rd:
                resp_info = f"OK payload={json.dumps(rd['payload'])[:250]}"
            elif 'data' in rd:
                resp_info = f"OK data_keys={list(rd['data'].keys())[:5]}"
            else:
                resp_info = f"keys={list(rd.keys())[:5]}"
        except:
            if 'errorSummary' in resp_text[:3000]:
                resp_info = "ERROR (in body)"
            elif '"payload"' in resp_text[:1000]:
                resp_info = "OK (has payload)"

    post_params = ""
    pd = entry.get('request', {}).get('postData', {})
    if pd:
        mime = pd.get('mimeType', '')
        text = pd.get('text', '')
        params = pd.get('params', [])

        if 'graphql' in url and text:
            from urllib.parse import parse_qs
            try:
                parsed = parse_qs(text)
                doc_id = parsed.get('doc_id', [''])[0]
                if doc_id:
                    post_params += f" doc_id={doc_id}"
                variables = parsed.get('variables', [''])[0]
                if variables:
                    vj = json.loads(variables)
                    inp = vj.get('input', {})
                    att = inp.get('attachments', [])
                    if att:
                        post_params += f" attachments={json.dumps(att)[:300]}"
                    msg = inp.get('message', {})
                    if msg:
                        post_params += f" msg={msg.get('text','')[:50]}"
                    src = inp.get('source', '')
                    if src:
                        post_params += f" source={src}"
            except:
                pass

        if params:
            for p in params:
                n = p.get('name', '')
                if n in ['source', 'profile_id', 'upload_session_id', 'video_id', 'farr', 'file_size', 'start_offset', 'end_offset']:
                    post_params += f" {n}={str(p.get('value',''))[:60]}"
        if 'multipart' in mime:
            post_params += " [multipart]"

    print(f"[{idx}] {method} {status} {url[:140]}")
    if post_params:
        print(f"  params:{post_params}")
    if resp_info:
        print(f"  resp: {resp_info}")
    print()

print("=== DONE ===")
