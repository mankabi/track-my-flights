# Track My Flights

[English](README.md) · **한국어**

원래는 어떤 분이 운영하는 웹 서비스에 비행 기록을 남기고 있었습니다.<br>
잘 쓰긴 했는데, 이 사이트가 어느날 갑자기 문을 닫으면 10년 넘게 모아온 기록이 한 순간에 날아가지는 않을지 걱정이 되기도 했습니다.<br>
그래서 직접 만들었습니다. 제 아이디어를 바탕으로 Claude Code로 구현했습니다.<br>
회원가입은 물론이고 인터넷 연결도 필요 없이 완전히 오프라인으로 동작합니다.

![대시보드 — 누적 통계와 지금까지 날아온 모든 노선의 세계 지도](images/dashboard.png)

**로컬에서 직접 돌리는 비행 기록**입니다. 탄 비행기를 전부 기록하고, 세계 지도에서 훑어보고, 통계를 받아보세요 — 지구 몇 바퀴에 해당하는 총 비행거리, 최다 노선, 최장·최속 구간, 좌석 등급과 자리 분포까지. 데이터는 내 컴퓨터의 SQLite 파일 하나에 들어 있습니다.

## 기능

- **빠른 입력** — 공항·항공사 자동완성(코드, 도시, 이름 무엇으로든 검색), 편명으로 항공사 자동 채움, 대권거리와 타임존·서머타임을 반영한 비행시간 자동 계산.
- **대시보드와 세계 지도** — 오프라인 벡터 지도 위의 노선 곡선, 확대·이동 지원, 예정된 비행과 최근 비행.
- **통계** — 누적, 기록, 노선·공항·항공사·기종 Top 10, 연도별 표, 등급·좌석·탑승 역할 분포.
- **내 데이터, 내 손에** — 클릭 한 번으로 JSON/CSV 내보내기, JSON 가져오기, MyFlightRadar24 CSV 가져오기, DB는 그냥 복사하면 되는 파일 하나.
- **한국어·영어 UI**, km/mi 및 12/24시간 표시 설정(브라우저 로케일 기준 기본값). 언어 추가는 JSON 파일 하나면 됩니다.

### 화면 둘러보기

**비행 목록** — 검색과 연도 필터, 그리고 장거리 기록에 실제로 필요한 날짜 오프셋 표시.

![비행 목록](images/flights.png)

**통계** — 누적과 기록, Top 10 분석을 연도별 또는 전체 기간으로.

![통계](images/stats.png)

**비행 추가** — 공항 코드 두 개와 편명만 입력하면 거리, 비행시간, 항공사가 알아서 채워집니다.

![비행 추가 화면](images/add-flight.png)

*(스크린샷은 샘플 데이터입니다.)*

## 요구 사항

- **Node.js 20 이상, npm** — [nodejs.org](https://nodejs.org/)에서 설치하세요(Windows/macOS는 설치 프로그램, Linux는 평소 쓰는 패키지 매니저로).
- **C++ 빌드 도구는 폴백으로만 필요합니다.** `better-sqlite3`(SQLite 드라이버)는 대부분의 플랫폼·Node 버전에 미리 빌드된 바이너리를 제공하므로 `npm install` 한 번이면 대개 그걸로 끝입니다 — SQLite 자체를 따로 설치할 필요는 **없습니다**, better-sqlite3가 SQLite를 내장하고 있습니다. 내 환경에 딱 맞는 빌드가 없을 때만 npm이 소스에서 직접 컴파일하는데, 이때는 컴파일러가 필요합니다:
  - **Windows**: 가장 쉬운 방법은 [Visual Studio Build Tools](https://visualstudio.microsoft.com/downloads/)("Tools for Visual Studio" 아래) 설치 — 설치 중 **"Desktop development with C++"**를 체크하세요. [Chocolatey](https://chocolatey.org/)가 있다면 한 줄로 끝납니다: `choco install python visualstudio2022-workload-vctools -y`.
  - **macOS**: `xcode-select --install`.
  - **Linux**: C/C++ 툴체인 하나면 됩니다(예: Debian/Ubuntu는 `sudo apt install build-essential`) — 보통 이미 깔려 있습니다.

## 빠른 시작

```bash
npm install
npm run seed     # 번들된 공항·항공사 참조 데이터를 SQLite에 적재
npm run build
npm start        # → http://localhost:7470
```

개발용으로는 `npm run dev` (Vite가 :5173, API는 :7470으로 프록시).

서버는 `127.0.0.1`에만 바인딩됩니다. 포트 변경은 `MFM_PORT=8080 npm start`, DB 경로는 `MFM_DB_PATH=/path/flights.db`.

## 기존 비행 기록 가져오기

다른 서비스에 비행 기록이 있다면 내보낸 뒤 [docs/MIGRATION.md](docs/MIGRATION.md)에 설명된 JSON 형식으로 정리해서 넣으면 됩니다:

```bash
npm run import:json -- my-flights.json
```

**MyFlightRadar24**를 쓰고 있다면 설정 페이지에서 CSV로 내보낸 파일을 바로 넣을 수 있습니다 — 공항·항공사는 내장 참조 데이터로 해석되고, 대권거리 계산과 (비행시간으로부터의) 도착일 추정까지 자동입니다:

```bash
npm run import:fr24 -- my-flights.csv
```

해석할 수 없는 행(참조 데이터에 없는 공항, 못 읽는 값)은 추측으로 채우지 않고 건너뛴 뒤 리포트로 알려줍니다. 열·값 매핑 전체는 [docs/MIGRATION.md](docs/MIGRATION.md)를 보세요. 솔직한 범위 고지: 이 임포터는 FR24가 문서화한 내보내기 형식대로 손으로 만든 합성 CSV로만 검증했습니다 — 실제 내려받은 파일이 깨끗하게 안 들어가면 이슈를 열어주세요.

원한다면 예전 시스템이 보여주던 통계(총 비행거리, 최다 노선 등)를 `migration/anchors.json`에 적어두고(`migration/anchors.example.json`에서 시작하세요) `npm run verify`를 돌려보세요. 가져온 데이터베이스를 그 숫자들과 대조해서, 옮기는 과정에서 아무것도 잃지 않았음을 *확인*시켜 줍니다. 이 검증 루프가 이 프로젝트의 핵심입니다 — 숫자는 이사를 견뎌야 합니다.

## 백업과 복원

기록 전체가 `data/flights.db` 하나입니다. 이 파일을 아무 데나 복사해두면 됩니다(WAL 모드라서 서버를 먼저 멈추거나, 켜둔 채라면 `sqlite3 data/flights.db ".backup 'backup.db'"`를 쓰세요 — Windows에는 이 CLI가 기본으로 안 깔려 있으니, SQLite의 [Precompiled Binaries for Windows](https://www.sqlite.org/download.html)에서 받거나, 그냥 서버를 멈추고 파일만 복사하면 별도 도구 없이도 됩니다). 복원은 파일을 제자리에 돌려놓기만 하면 됩니다. JSON 내보내기·가져오기도 손실 없이 왕복합니다(`설정 → 내보내기` 후 `npm run import:json`).

## 계속 띄워두기 (macOS 예시)

`examples/launchd.plist.example`이 LaunchAgent 템플릿입니다(부팅 시 자동 시작, 죽으면 재시작). 자리표시자 경로를 채운 뒤:

```bash
cp examples/launchd.plist.example ~/Library/LaunchAgents/com.yourname.trackmyflights.plist
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.yourname.trackmyflights.plist
```

Linux라면 `npm start`를 실행하는 systemd user unit으로 똑같이 하면 됩니다.

## 참조 데이터

공항 데이터는 [OurAirports](https://ourairports.com/data/), 항공사 데이터는 [OpenFlights](https://openflights.org/data.html)에서 가져와 `data/reference/`에 스냅숏으로 넣어두었습니다. 갱신하려면 해당 파일을 교체하고 `npm run seed`를 다시 돌리세요(기록한 비행에 직접 적어둔 항공사 이름 표기가 참조 데이터의 이름보다 우선합니다). 데이터 라이선스는 [NOTICE.md](NOTICE.md)를 보세요.

## 개발

```bash
npm test            # 단위 테스트 (거리, 비행시간/서머타임, 편명 정규화)
npm run i18n:check  # i18n 카탈로그를 우회하는 UI 문자열이 있으면 실패
npx tsc --noEmit
```

UI 문자열은 `web/src/i18n/{ko,en}.json`에 있습니다(플랫 키이고, 두 파일의 키는 컴파일 시점에 서로 대조합니다). 언어를 추가하려면 `en.json`을 원하는 로케일로 복사해 번역한 뒤 `web/src/i18n/index.tsx`에 등록하세요.

솔직한 범위 고지: import/verify 파이프라인은 딱 한 사람의 108편짜리 기록으로만 검증했습니다. 다른 형태의 데이터에서 엣지 케이스가 나오는 건 예상된 일입니다 — 이슈와 PR 환영합니다.

## 라이선스

[MIT](LICENSE). 참조 데이터와 번들된 폰트는 각자의 라이선스를 따릅니다 — [NOTICE.md](NOTICE.md)를 보세요.
