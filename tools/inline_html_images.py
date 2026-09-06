"""리포트 HTML 의 <img src="상대경로"> 를 base64 data URI 로 인라인해서
단일 파일(첨부/공유해도 안 깨지는) HTML 을 만든다.

리포트를 남에게 보낼 때 HTML 만 보내면 상대경로 이미지가 전부 깨진다.
`피드백_테스트/피드백_리포트.html` 이 실제로 그래서 깨졌고, 그래서 그 파일은
지금 인라인본이고 상대경로 원본은 `피드백_리포트_소스.html` 로 남겨뒀다.
스크린샷을 추가·교체했으면 소스를 고친 뒤 이 스크립트를 다시 돌려라.

    python3 tools/inline_html_images.py \\
        피드백_테스트/피드백_리포트_소스.html \\
        피드백_테스트/피드백_리포트.html \\
        /tmp/inline_webp

PNG 를 그대로 넣으면 base64 오버헤드까지 4MB 가 넘으므로 WebP 로 재인코딩한다.
(1440px 스크린샷 → 화면 표시는 1000px 이라 화질 손실이 보이지 않는다)
cwebp 필요: brew install webp
"""
import base64
import re
import subprocess
import sys
from pathlib import Path

if len(sys.argv) < 3:
    sys.exit(__doc__)

SRC = Path(sys.argv[1])
OUT = Path(sys.argv[2])
TMP = Path(sys.argv[3]) if len(sys.argv) > 3 else Path("/tmp/inline_html_images")
TMP.mkdir(parents=True, exist_ok=True)

html = SRC.read_text(encoding="utf-8")
base = SRC.parent
total_in = total_out = 0
missing = []


def encode(path: Path) -> tuple[str, int, int]:
    """(data URI, 원본 바이트, 인코딩 후 바이트)"""
    global total_in, total_out
    raw = path.stat().st_size
    if path.suffix.lower() in (".png", ".jpg", ".jpeg"):
        webp = TMP / (path.stem + ".webp")
        subprocess.run(
            ["cwebp", "-q", "82", "-m", "6", "-quiet", str(path), "-o", str(webp)],
            check=True,
        )
        data, mime = webp.read_bytes(), "image/webp"
    else:
        data, mime = path.read_bytes(), "image/png"
    total_in += raw
    total_out += len(data)
    print(f"  {path.name}: {raw/1024:.0f}KB → {len(data)/1024:.0f}KB")
    return f"data:{mime};base64,{base64.b64encode(data).decode()}", raw, len(data)


def repl(m: re.Match) -> str:
    src = m.group(1)
    if src.startswith(("data:", "http:", "https:")):
        return m.group(0)
    p = (base / src).resolve()
    if not p.exists():
        missing.append(src)
        return m.group(0)
    uri, _, _ = encode(p)
    return f'src="{uri}"'


print("이미지 인라인 중…")
html = re.sub(r'src="([^"]+)"', repl, html)

# lazy 로딩은 data URI 에선 의미 없고, 일부 메일 뷰어에서 이미지가 안 뜨는 원인이 된다
html = html.replace(' loading="lazy"', "")

OUT.write_text(html, encoding="utf-8")
print(f"\n원본 이미지 {total_in/1024/1024:.2f}MB → 인코딩 {total_out/1024/1024:.2f}MB")
print(f"결과: {OUT}  ({OUT.stat().st_size/1024/1024:.2f}MB)")
if missing:
    print("!! 못 찾은 이미지:", missing)
