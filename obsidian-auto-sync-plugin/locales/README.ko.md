# Obsidian Auto Sync Plugin

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![Version](https://img.shields.io/badge/version-1.0.0-green.svg)
![Obsidian](https://img.shields.io/badge/obsidian-0.15.0+-purple.svg)

Obsidian 볼트의 파일 변경을 여러 기기 간에 실시간 동기화하는 플러그인입니다.
WebSocket 동기화 서버를 통해 생성/수정/삭제/이름 변경 이벤트를 전송합니다.

> 배포 안내: 이 플러그인은 사용자가 직접 호스팅하는 `obsidian-sync-server`가 필요합니다. 본 프로젝트는 관리형 클라우드 동기화 서버를 제공하지 않습니다.

## 주요 기능

- 텍스트/바이너리 파일 양방향 동기화
- 빠른 연속 편집에 대한 디바운스 배치 처리
- SHA-256 기반 충돌 검사
- 대용량 파일용 청크 업로드 경로
- 자동 재연결 및 heartbeat 모니터링
- 디바이스 등록 및 vault 단위 분리

## 빠른 시작

### 1) 서버 준비

먼저 서버 프로젝트를 실행합니다.

```bash
cd ../obsidian-sync-server
npm install
cp .env.example .env
npx prisma generate
npx prisma db push
npm run start:dev
```

기본 주소: `ws://localhost:3001`

### 2) 플러그인 빌드

```bash
npm install
npm run build
```

### 3) Obsidian 설치

Obsidian 볼트 플러그인 디렉터리에 아래 파일을 복사합니다.

- `main.js`
- `manifest.json`

그다음 커뮤니티 플러그인에서 **Auto Sync**를 활성화합니다.

## 플러그인 설정

설정 경로: `설정 -> 커뮤니티 플러그인 -> Auto Sync`

| 설정 | 기본값 | 설명 |
|---|---:|---|
| `Server URL` | `localhost` | 호스트/IP만 입력합니다. `ws://`는 넣지 않습니다. |
| `Server Port` | `3001` | WebSocket 서버 포트입니다. |
| `Vault ID` | 자동 감지 | 같은 볼트를 동기화할 기기들이 공유해야 하는 식별자입니다. |
| `Device Name` | 기기 호스트명 | 사용자 식별용 기기 이름입니다. |
| `Enable Auto Sync` | `true` | 자동 동기화 On/Off 토글입니다. |
| `Sync Interval` | `1000` ms | 큐에 쌓인 동기화 작업 flush/poll 주기입니다. |

## 사용법

- `Enable Auto Sync`를 켭니다.
- 상태바 확인:
  - `🟢 Sync`: 연결됨/동기화 활성
  - `🟡 Sync`: 연결 중/재연결 중
  - `⭕ Sync`: 비활성

명령어:
- `Toggle Auto Sync`
- `Force Sync Now`

## 개발

```bash
npm install
npm run dev
npm run build
```

## 테스트

```bash
npm test
npm run test:watch
npm run test:coverage
npm run test:integration
```

참고:
- `test:integration`은 실행 중인 동기화 서버가 필요합니다.
- 통합 테스트 세부는 `tests/README.md`를 참고하세요.

## 운영 참고

- 큰 바이너리 파일은 청크 업로드 경로를 사용해 텍스트 파일보다 완료 시간이 길 수 있습니다.
- 재연결/재시도 로직이 있어도 `Vault ID` 설정이 틀리면 기대한 결과를 보장할 수 없습니다.
- 동기화 누락 분석 시 플러그인 콘솔과 서버 로그를 함께 확인하세요.

## 문제 해결 체크리스트

연결 문제:
1. 서버 실행 여부 확인
2. `Server URL`/`Server Port` 확인
3. 방화벽 및 네트워크 경로 확인

동기화 지연:
1. 네트워크 상태 확인
2. 대용량 파일 업로드 여부 확인
3. `Sync Interval` 조정

파일 누락:
1. 기기 간 `Vault ID` 일치 확인
2. 임시/제외 파일 여부 확인
3. `Force Sync Now` 실행
4. 서버 디스크에는 있는데 여전히 누락되면, 서버 운영자에게 저장소 루트에서 `./tools/reconcile-storage-to-db.sh --dry-run` 실행을 요청하세요 (`tools/README.md` 참고).

## 라이선스

MIT
