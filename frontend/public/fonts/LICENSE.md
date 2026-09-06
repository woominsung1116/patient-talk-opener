# 자체 호스팅 웹폰트

두 서체 모두 **SIL Open Font License 1.1** 이다. OFL 은 재배포와 웹 임베딩을
허용하므로 이 저장소에 담아 배포해도 된다(상업적 사용 포함). 서체 파일 자체를
판매하지 않는 한 제약이 없다.

| 서체 | 용도 | 저작자 | 라이선스 |
| --- | --- | --- | --- |
| Jua | 제목·버튼 | Woowahan Brothers | SIL OFL 1.1 |
| Gowun Dodum | 본문 | Jeong Ui-hun (구름) | SIL OFL 1.1 |

- 출처: Google Fonts (`https://fonts.googleapis.com/css2?family=Jua&family=Gowun+Dodum&display=swap`)
- 받은 날: 2026-08-02
- 파일: `.woff2` 182개 (합계 1.84 MiB) + `fonts.css`

## 왜 자체 호스팅인가

네트워크가 없는 실습실에서 글꼴이 통째로 깨졌기 때문이다. Draco 디코더는
이미 벤더링해 두었는데 폰트만 외부 요청으로 남아 있어, 오프라인 완결성이
거기서 무너지고 있었다.

## 파일이 왜 182개인가

한글은 글자 수가 많아 Google Fonts 가 유니코드 구간별로 서브셋을 쪼개
내려준다. `fonts.css` 의 `unicode-range` 선언이 그대로 남아 있으므로 브라우저는
**실제로 화면에 쓰는 글자가 속한 서브셋만** 내려받는다 — 1.84 MiB 를 전부
받는 것이 아니다. 서브셋을 합치면 오히려 첫 로딩이 느려진다.

## 갱신 방법

```bash
curl -A "Mozilla/5.0 ... Chrome/120.0 Safari/537.36" \
  "https://fonts.googleapis.com/css2?family=Jua&family=Gowun+Dodum&display=swap" -o gf.css
# gf.css 안의 https://fonts.gstatic.com/... woff2 를 전부 내려받아 이 폴더에 두고,
# CSS 의 해당 URL 만 /fonts/<파일명> 으로 치환한다.
```

⚠ User-Agent 를 넣지 않으면 Google 이 woff2 대신 구형 포맷(ttf)을 내려준다.
