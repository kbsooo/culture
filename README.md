# 문화 기록 📊

영화와 책 기록을 자동으로 관리하는 GitHub Pages 기반 정적 웹사이트.

## 사용법

### 영화 기록
1. GitHub Issues → **New Issue** → **🎬 영화 기록** 선택
2. 제목, 별점, 한줄 후기, 시청 날짜 입력
3. Issue **Close** → GitHub Actions가 자동으로:
   - TMDB에서 포스터 및 메타데이터 가져옴
   - `data/movies.json` 업데이트
   - GitHub Pages 재배포

### 책 기록
1. GitHub Issues → **New Issue** → **📚 책 기록** 선택
2. 제목, 별점, 한줄 후기, 시작일, 완독일 입력
3. Issue **Close** → GitHub Actions가 자동으로:
   - Open Library에서 표지 및 메타데이터 가져옴
   - `data/books.json` 업데이트
   - GitHub Pages 재배포

## 초기 설정 (최초 1회)

### 1. GitHub Secrets 추가
- Settings → Secrets and variables → Actions → **New repository secret**
- Name: `TMDB_API_KEY`, Value: TMDB API 키

### 2. GitHub Pages 설정
- Settings → Pages → Source: **GitHub Actions**

### 3. GitHub Actions 권한 설정
- Settings → Actions → General → Workflow permissions: **Read and write permissions**

### 4. Issue 라벨 생성
- Issues → Labels → `movie` (파란색), `book` (초록색)

### 5. astro.config.mjs 수정
- `src/astro.config.mjs`에서 `site`와 `base`를 실제 GitHub 정보로 수정:
  ```js
  site: 'https://{USERNAME}.github.io',
  base: '/{REPO_NAME}',
  ```

## 기술 스택

| 역할 | 기술 |
|------|------|
| 정적 사이트 | Astro 4 + Tailwind CSS 3 |
| 한국어 폰트 | Pretendard Variable |
| 히트맵 | cal-heatmap 4 |
| 영화 메타데이터 | TMDB API v3 |
| 책 메타데이터 | Open Library API (인증 불필요) |
| 자동화 | GitHub Actions |
| 호스팅 | GitHub Pages |

## 파일 구조

```
├── .github/
│   ├── ISSUE_TEMPLATE/     # 영화/책 기록 템플릿
│   └── workflows/
│       ├── process-issue.yml  # Issue → JSON 업데이트
│       └── deploy.yml         # GitHub Pages 배포
├── data/
│   ├── movies.json         # 영화 기록 데이터
│   └── books.json          # 책 기록 데이터
├── scripts/
│   ├── process-movie.mjs   # TMDB API 호출 스크립트
│   └── process-book.mjs    # Open Library API 호출 스크립트
└── src/                    # Astro 프로젝트
    └── src/
        ├── pages/          # 홈, 영화, 책 페이지
        └── components/     # 카드, 히트맵, 통계 컴포넌트
```
