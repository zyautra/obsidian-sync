# Obsidian Sync 워크스페이스

이 저장소는 Obsidian 동기화를 위한 두 프로젝트를 함께 관리합니다.

- `obsidian-auto-sync-plugin`: Obsidian에서 파일 변경을 감지하고 WebSocket으로 동기화하는 플러그인
- `obsidian-sync-server`: NestJS + Prisma 기반 WebSocket 중심 동기화 서버

이 저장소는 단일 모노레포로 관리됩니다 (루트 Git 저장소 1개, 프로젝트별 패키지 경계 분리).

> 배포 안내: 이 프로젝트는 관리형 클라우드 동기화 서비스를 제공하지 않습니다. 사용자가 직접 `obsidian-sync-server`를 호스팅하고, 플러그인을 해당 서버로 연결해야 합니다.

## 저장소 구조

```text
.
├── locales/                      # 루트 워크스페이스 다국어 문서
├── obsidian-auto-sync-plugin/    # 클라이언트 플러그인
├── obsidian-sync-server/         # 동기화 서버
└── tools/                        # 워크스페이스 헬퍼 스크립트
```

## 현재 상태

- 텍스트 파일 중심 핵심 동기화 흐름은 구현되어 있습니다.
- 바이너리/청크 업로드 경로는 존재하지만 end-to-end 기준으로는 아직 추가 검증이 필요합니다.
- 서버 관련 상세 주의사항은 아래 문서를 참고하세요.
  - `obsidian-sync-server/README.md`
  - `obsidian-sync-server/locales/README.ko.md`

## 빠른 시작

### 1) 서버 실행 (`obsidian-sync-server`)

```bash
cd obsidian-sync-server
npm install
cp .env.example .env
npx prisma generate
npx prisma db push
npm run start:dev
```

기본 WebSocket 주소: `ws://localhost:3001`

### 2) 플러그인 빌드 (`obsidian-auto-sync-plugin`)

```bash
cd obsidian-auto-sync-plugin
npm install
npm run build
```

빌드 후 생성되는 `main.js`, `manifest.json`을 Obsidian 플러그인 디렉터리로 복사해 사용합니다.

## 공통 개발 명령

각 프로젝트 디렉터리에서 실행:

- 빌드: `npm run build`
- 테스트: `npm test`
- 린트/포맷 (서버): `npm run lint`, `npm run format`
- 플러그인 통합 테스트: `npm run test:integration`

루트 워크스페이스에서 실행(npm workspaces):

- 전체 의존성 설치: `npm run install:all`
- 전체 빌드: `npm run build:all`
- 전체 테스트: `npm run test:all`
- 서버 스토리지/DB 메타데이터 정합성 점검(선택): `./tools/reconcile-storage-to-db.sh --dry-run`

`tools` 스크립트를 써야 하는 상황:
- 서버 스토리지에 파일을 수동 복사했는데 초기 동기화에서 내려오지 않을 때
- 이유: 서버 `request-sync`는 파일시스템 직접 스캔이 아니라 DB `File` 메타데이터 기준으로 응답하기 때문
- 항상 dry-run부터 실행: `./tools/reconcile-storage-to-db.sh --dry-run`
- 상세 운영 가이드: `tools/README.md`

## 문서 안내

- 루트 문서(영문): `README.md`
- 플러그인 상세: `obsidian-auto-sync-plugin/README.md`
- 서버 상세(영문): `obsidian-sync-server/README.md`
- 서버 상세(한글): `obsidian-sync-server/locales/README.ko.md`
