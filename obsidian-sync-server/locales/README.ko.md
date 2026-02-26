# Obsidian Sync Server

NestJS + TypeScript로 작성된 Obsidian용 WebSocket 중심 동기화 서버입니다.

이 프로젝트는 데이터를 다음과 같이 분리해서 저장합니다.
- 파일 메타데이터: SQLite (Prisma)
- 파일 본문: 로컬 디스크 `STORAGE_PATH`

## 현재 범위

- WebSocket 기반 실시간 동기화
- 디바이스 등록 및 볼트 단위 격리
- 파일 작업: 생성/수정, 삭제, 이름 변경
- 충돌 검사(해시/타임스탬프 기반)
- 만료 기반 파일 락 API
- 초기 동기화(`request-sync`) 응답
- 일자별 구조화 로그

## 구현 상태

- 텍스트 파일 핵심 동기화 플로우는 비교적 안정적입니다.
- `binary-file-change`, chunk-upload 메시지 타입은 존재합니다.
- Chunk 업로드 경로는 현재 부분 구현 상태이며 end-to-end 통합이 완전하지 않습니다.
- rename/binary 경로는 프로덕션 중요 워크로드 전에 추가 검증이 필요합니다.

## 아키텍처

- 런타임: Node.js + NestJS application context (HTTP 서버 부트스트랩 없음)
- 전송: `ws` WebSocket 서버
- 저장소:
  - SQLite: vault/device/file 메타데이터, lock 상태, sync operation
  - Filesystem: 실제 파일 내용 (`STORAGE_PATH/<vaultId>/...`)

상위 흐름:
1. 클라이언트 연결 후 `register-device` 전송
2. 파일 작업 메시지 전송
3. 서버가 검증 후 트랜잭션으로 DB 반영 + 파일 저장
4. 동일 vault의 다른 클라이언트로 브로드캐스트

## 요구 사항

- Node.js 18+
- SQLite (Prisma를 통한 파일 기반 DB)

## 빠른 시작

```bash
# 1) 설치
npm install

# 2) 환경 변수
cp .env.example .env
# .env 수정

# 3) Prisma
npx prisma generate
npx prisma db push

# 4) 실행
npm run start:dev
# 또는
npm start
```

기본 WebSocket 주소: `ws://localhost:3001`

## 환경 변수

| 변수 | 기본값 | 필수 | 설명 |
|---|---:|:---:|---|
| `DATABASE_URL` | `file:./sqlite.db` | 예 | Prisma DB URL (기본 SQLite) |
| `WS_PORT` | `3001` | 아니오 | WebSocket 포트 |
| `STORAGE_PATH` | `./obsidian` | 아니오 | 볼트 파일 저장 루트 경로 |
| `MAX_FILE_SIZE` | `52428800` (50MB) | 아니오 | 저장 시 파일 크기 제한 |
| `RATE_LIMIT_WINDOW` | `30000` | 아니오 | 레이트리밋 윈도우(ms) |
| `RATE_LIMIT_MAX_MESSAGES` | `100` | 아니오 | 윈도우당 클라이언트 최대 메시지 수 |
| `FILE_LOCK_EXPIRATION` | `30000` | 아니오 | 파일 락 만료 시간(ms) |
| `HEARTBEAT_INTERVAL` | `30000` | 아니오 | ping 주기(ms) |
| `LOG_LEVEL` | `info` | 아니오 | `error`, `warn`, `info`, `debug`, `verbose` |
| `NODE_ENV` | `development` | 아니오 | `development`, `production`, `test` |

## WebSocket 메시지 타입

클라이언트 -> 서버:
- `register-device`
- `file-change`
- `binary-file-change`
- `file-delete`
- `file-rename`
- `request-lock`
- `request-sync`
- `resolve-conflict`
- `chunk-upload-start`
- `chunk-data`
- `chunk-upload-complete`
- `heartbeat`

서버 -> 클라이언트:
- `register-device-response`
- `file-change`
- `file-delete`
- `file-rename`
- `file-change-response`
- `lock-acquired`, `lock-denied`
- `sync-response`
- `initial-sync-complete`
- `chunk-upload-response`
- `heartbeat-response`
- `error`

## 데이터베이스 모델

`prisma/schema.prisma`의 주요 모델:
- `Vault`
- `Device`
- `File` (메타데이터만 저장)
- `FileLock`
- `SyncOperation`
- `FileOperation`

## 스크립트

```bash
npm run build
npm start
npm run start:dev
npm run start:debug

npm test
npm run test:watch
npm run test:e2e
npm run test:cov

npm run lint
npm run format
```

백그라운드 실행 보조 스크립트:
```bash
./scripts/start.sh
./scripts/stop.sh
./scripts/restart.sh
./scripts/status.sh
```

워크스페이스 보조 스크립트(저장소 루트에서 실행):
```bash
./tools/reconcile-storage-to-db.sh --dry-run
```

이 보조 스크립트를 써야 하는 상황:
- `STORAGE_PATH/<vaultId>/...`에는 파일이 있는데 클라이언트 초기 동기화에서 내려오지 않을 때
- 클라이언트 경로가 아닌 서버 디스크에 직접 파일을 반입/복사했을 때
- 스토리지 데이터 이관 후 DB `File` 메타데이터 정합성을 맞춰야 할 때

원인 설명:
- `request-sync` 응답은 파일시스템 직접 스캔이 아니라 DB 기준으로 생성됩니다.
- 따라서 디스크에만 있고 DB에 없는 파일은 동기화 응답에 포함되지 않습니다.

권장 절차:
1. `./tools/reconcile-storage-to-db.sh --dry-run`
2. `./tools/reconcile-storage-to-db.sh --vault <vaultId>` (또는 전체 스캔)
3. 클라이언트 재연결 또는 `Force Sync Now` 실행

`--prune` 주의:
- `--prune`는 디스크에 없는 파일의 DB 레코드를 삭제합니다. 의도된 삭제인지 확인 후 사용하세요.

상세 운영 가이드:
- `tools/README.md`

## 로그

로그는 일자별 폴더에 저장되며 현재 로그 심볼릭 링크를 제공합니다.
- `logs/application.log`
- `logs/error.log`
- `logs/YYYY/MM/DD/application.log`
- `logs/YYYY/MM/DD/error.log`

## 참고/주의 사항

- 애플리케이션은 WebSocket 전용(`createApplicationContext`)으로 부팅되며 HTTP REST 서버를 띄우지 않습니다.
- 소스에 `VaultController`가 존재하지만 현재 런타임 모듈 그래프에는 연결되어 있지 않습니다.
- Chunk 업로드 및 일부 binary/rename 엣지 케이스는 베타 수준 동작으로 보는 것이 안전합니다.

## 라이선스

`UNLICENSED` (`package.json` 기준)
