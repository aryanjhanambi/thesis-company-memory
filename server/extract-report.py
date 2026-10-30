"""Run inside a short-lived Daytona sandbox. Output source text, never execute it."""
import io
import ipaddress
import json
import socket
import sys
import urllib.parse
import urllib.request
from html.parser import HTMLParser

MAX_BYTES = 10 * 1024 * 1024


def validate_url(url, allowed_hosts):
    parsed = urllib.parse.urlparse(url)
    if parsed.scheme != 'https' or parsed.username or parsed.password or parsed.port not in (None, 443):
        raise ValueError('Only public HTTPS report URLs on port 443 are supported')
    if parsed.hostname not in allowed_hosts:
        raise ValueError('Report host is not in REPORT_HOSTS')
    addresses = socket.getaddrinfo(parsed.hostname, 443, type=socket.SOCK_STREAM)
    if not addresses or any(not ipaddress.ip_address(a[4][0]).is_global for a in addresses):
        raise ValueError('Private network addresses are not allowed')
    return url


class SafeRedirect(urllib.request.HTTPRedirectHandler):
    def __init__(self, hosts):
        self.hosts = hosts

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        validate_url(newurl, self.hosts)
        return super().redirect_request(req, fp, code, msg, headers, newurl)


class ReadableHTML(HTMLParser):
    def __init__(self):
        super().__init__()
        self.parts = []
        self.hidden = 0

    def handle_starttag(self, tag, attrs):
        if tag in ('script', 'style', 'noscript'):
            self.hidden += 1
        if tag in ('p', 'div', 'tr', 'h1', 'h2', 'h3', 'li', 'br'):
            self.parts.append('\n')

    def handle_endtag(self, tag):
        if tag in ('script', 'style', 'noscript'):
            self.hidden = max(0, self.hidden - 1)

    def handle_data(self, data):
        if not self.hidden and data.strip():
            self.parts.append(data.strip() + ' ')


def main():
    with open('/tmp/thesis-job.json', encoding='utf-8') as handle:
        job = json.load(handle)
    validate_url(job['url'], job['allowedHosts'])
    opener = urllib.request.build_opener(SafeRedirect(job['allowedHosts']))
    request = urllib.request.Request(job['url'], headers={'User-Agent': 'ThesisResearch/1.0 (public investor report retrieval)'})
    with opener.open(request, timeout=30) as response:
        raw = response.read(MAX_BYTES + 1)
        content_type = response.headers.get('Content-Type', '')
        final_url = response.url
    if len(raw) > MAX_BYTES:
        raise ValueError('Report exceeds 10 MB')
    if raw.startswith(b'%PDF'):
        from pypdf import PdfReader
        reader = PdfReader(io.BytesIO(raw))
        if len(reader.pages) > 200:
            raise ValueError('Report exceeds 200 pages')
        text = '\n\n'.join(page.extract_text() or '' for page in reader.pages)
    elif 'html' in content_type or raw.lstrip().startswith(b'<'):
        parser = ReadableHTML()
        parser.feed(raw.decode('utf-8', errors='replace'))
        text = ''.join(parser.parts)
    else:
        text = raw.decode('utf-8', errors='replace')
    text = text.strip()[:600000]
    if not text:
        raise ValueError('No readable text found; scanned reports require OCR')
    print(json.dumps({'text': text, 'sourceUrl': final_url, 'extraction': 'Daytona sandbox · PDF/HTML/text'}, ensure_ascii=False))


if __name__ == '__main__':
    try:
        main()
    except Exception as exc:
        print(json.dumps({'error': str(exc)}))
        sys.exit(1)
