# 백엔드 규칙 (app/, tests/)
루트 AGENTS.md 에 덧붙는 규칙이다. 충돌하면 이 파일을 따른다.

## 계층
- app/main.py: create_app() 팩토리, 라우터 등록, 예외 핸들러
- app/api/routers/: 경로 함수. 입력 검증, 권한 확인, 응답 변환을 맡는다
- app/models/: SQLAlchemy 2.x 모델. 새 모델은 app/models/__init__.py 에서 import 해 메타데이터에 등록한다
- app/schemas/: Pydantic 요청·응답 스키마
- app/core/: 설정(config.py), 보안·세션(security.py, session.py), 외부 연동(kakao.py, portone.py, S3), 순수 계산·규칙(compatibility.py, recommendations.py, market_model.py, catalog_schema.py 등)
- app/db/database.py: 엔진(build_engine), 세션(SessionLocal), get_db 의존성(session_dependency), 관리 스크립트 엔진(script_engine)
- app/scripts/: 사람이 실행하는 관리 스크립트(`python -m app.scripts.<도구>`, 미리보기 → --yes). 앱·라우터·core 는 이 폴더를 import 하지 않는다(스크립트끼리는 된다)
- 데이터 파일: app/catalog/(상품 카탈로그), app/market_events.json(시장 일정)
- 새 라우터는 app/main.py 의 create_app() 에 include_router 로 등록한다. app/ 바로 아래에는 main.py 외의 파이썬 파일을 두지 않는다

## 응답 형식
- 성공과 실패 모두 `{"code": <HTTP 상태>, "message": <문자열>, "result": <데이터 또는 null>}`
- 오류는 HTTPException(status_code, detail) 으로 던진다. app/main.py 의 핸들러가 형식을 맞춘다
- 비밀번호 해시, 토큰, 외부 키 같은 내부 값은 응답 스키마에 넣지 않는다

## 인증과 권한
- 로그인 사용자는 app/core/session.py 의 get_current_subject 의존성으로 얻는다. 토큰 발급·해석은 app/core/security.py 의 create_access_token·access_token_subject 만 쓴다(jwt 를 직접 부르지 않는다)
- 관리자 API 는 app/core/session.py 의 get_admin_subject 의존성을 쓴다(user_profiles.role == "admin", 비로그인 401·관리자 아님 403). 관리자는 사람이 `python -m app.scripts.set_admin`(미리보기 → --yes)으로 정한다. 관리자 응답에도 이메일·이름 같은 개인정보는 넣지 않는다(subject 만)
- 쿠키로 인증하면서 상태를 바꾸는 API(POST/PATCH/DELETE)에는 Origin 검사를 붙인다. app/api/deps.py 의 require_allowed_origin 을 `dependencies=[Depends(require_allowed_origin)]` 로 붙인다(questions.py, cart.py, orders.py 참고)
- 보호 API 테스트: 비로그인 401, 남의 리소스 403 또는 404, 정상 요청 성공을 각각 1개 이상 쓴다

## 설정과 외부 연동
- 환경변수는 app/core/config.py 에서만 읽는다(tests/test_config.py 가 검사). 읽기는 도우미 셋으로 한다: _env_str(공백 제거, 비면 기본값), _env_raw(비밀번호·키·빈 값에 뜻이 있는 값, 그대로), _env_int(정수, 틀리면 변수 이름을 담은 ValueError 로 시작을 멈춤). 새 변수는 .env.example 에 예시값과 함께 추가한다
- 허용 출처는 config.FRONTEND_ORIGINS(CORS, app/main.py)와 config.ALLOWED_ORIGINS(= 프런트 + API 호스트, Origin 검사 app/api/deps.py) 한 곳에서 정한다
- 의존성: 실행에 필요한 것은 requirements.txt(운영 서버가 설치), 테스트·검사 도구는 requirements-dev.txt
- 외부 서비스(PortOne, Kakao, S3)는 테스트에서 monkeypatch 나 가짜 객체로 바꾼다. 테스트에서 실제로 호출하지 않는다
- 사용자 이벤트(POST /events)는 app/core/event_store.py 의 EventStore 가 MongoDB `events` 에 쓴다(MONGODB_URI 가 없거나 실패하면 LOG_DIR/events-fallback.jsonl, LOG_DIR 도 없으면 표준 출력 moa.event). create_app(event_store=...) 로 바꿔 넣고, 테스트는 tests/fake_mongo.py 의 가짜 컬렉션만 쓴다(실제 MongoDB 접속 금지)
- 이벤트 type 은 app/schemas/event.py 의 EVENT_TYPES(37개). 새 type 은 spec 표 → EVENT_TYPES → tests/test_events.py 의 SPEC_EVENT_TYPES 순서로 더한다. schema_version 은 클라이언트가 보내는 값(1~5, 없으면 1)을 저장한다. 계약을 바꾸면 CURRENT_SCHEMA_VERSION 을 올린다
- 상품 상세 추천(docs/specs/2026-11-03-product-recommendations.md): 학습 계산은 app/core/recommendations.py(순수 함수, scikit-learn Item-CF + 기본 점수), 저장·서빙은 app/core/recommendation_store.py, API 는 GET /products/{id}/recommendations 와 app/api/routers/admin_recommendations.py(학습·기록·비교). 이벤트 읽기는 EventStore.product_views(MongoDB 만, 대체 저장으로 돌아가지 않고 503). 테스트는 tests/fake_mongo.py 가짜 컬렉션의 documents 에 문서를 넣고 find 로 읽는다
- 가격 추적(2026-11-05): 가격 추세는 app/core/price_trends.py(순수 계산 + 집계 쿼리, 프로세스 캐시 키 = 엔진·서울 오늘·max(history.id)·행 수. GET 에서 DB 에 쓰지 않는다)가 만들고 ProductSummary.price_trend·장바구니 줄·GET /products 의 dropping·near_low·store_lowest·정렬 drop_desc·GET /products/price-summary·상세 store_prices 가 쓴다. 목표가 알림은 /alerts(price_alerts), 알림은 /notifications(notifications, app/core/notifications.py): price_target·price_low 는 pricing.change_store_price 안에서, answer·quote 는 답변·견적 댓글을 만드는 라우터에서 같은 트랜잭션으로 넣는다(자기 글에는 넣지 않는다). change_store_price 가 이 두 테이블을 쓰므로 app/scripts/import_catalog.py 의 CATALOG_TABLES 에도 들어 있다(새 DB 에서도 시드·가져오기가 돈다). 그 밖에 GET /user/me/posts, POST /products/{id}/price-match(price_match_requests)
- 시각은 app/core/clock.py 의 clock.utc_now()·seoul_today() 로만 얻는다(datetime.now·DB 의 NOW() 를 새로 쓰지 않는다). 로컬 시뮬레이션에서는 SIM_CLOCK_FILE 로 가상 시각이 된다(docs/specs/2026-11-01-virtual-clock.md). 실제 시각이어야 하는 곳(로그인 토큰, S3 업로드 만료)만 실제 시각을 쓴다
- 로그 파일은 LOG_DIR·LOG_RETENTION_DAYS(app/core/log_files.py: access.jsonl, uvicorn-access.log, uvicorn-error.log, events-fallback.jsonl). 클라이언트 IP·X-Request-ID 헤더는 TRUSTED_PROXY_IPS 에서 직접 온 요청만 믿는다(app/core/trusted_proxy.py). tests/conftest.py 가 LOG_DIR·MONGODB_URI·TRUSTED_PROXY_IPS 를 비운다

## DB
- 운영 DB 는 RDS MariaDB 이고, 앱 시작 시 create_all 로 없는 테이블만 만든다(마이그레이션 도구 없음)
- 접속 정보는 환경변수 DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD, DB_SSL_CA 로 받는다. DATABASE_URL 이 있으면 개별 값보다 우선한다(app/core/config.py)
- 커넥션 풀은 DB_POOL_SIZE·DB_MAX_OVERFLOW·DB_POOL_TIMEOUT·DB_POOL_RECYCLE(config.DB_POOL → build_engine). 풀 대기 시간이 넘으면 app/main.py 가 503 으로 답한다
- 관리 스크립트(python -m app.scripts.<도구>)의 main(argv, engine=None) 은 `script_engine(engine)` 으로 엔진을 얻는다(테스트가 넘긴 엔진, 없으면 앱과 같은 접속 설정)
- 인덱스는 모델에 정의한다(단일 열은 index=True, 복합은 __table_args__ 의 Index("ix_<테이블>_<요약>", ...)). 이미 있는 테이블에는 create_all 이 인덱스를 만들지 않으므로 `python -m app.scripts.sync_indexes`(미리보기 → --yes)로 맞춘다. 인덱스를 모델에서 빼면 app/scripts/sync_indexes.py 의 OBSOLETE_INDEXES 에 이름을 넣고, tests/test_database.py 의 EXPECTED_INDEXES 를 고친다
- 시드(app/scripts/seed_products.py)는 products 가 비어 있을 때만 넣는다. 이미 있는 DB 의 빈 thumbnail_url 은 `python -m app.scripts.sync_product_images`(미리보기 → --yes)로 채운다(이름이 카탈로그 상품과 같고 값이 빈 상품만)
- 상품 데이터의 원본은 카탈로그 app/catalog/<category>.json(형식·검증 app/core/catalog_schema.py)이다. 시드는 카탈로그 전체를 넣고, 이미 있는 DB 는 `python -m app.scripts.import_catalog`(미리보기 → --yes)로 맞춘다(이름이 같은 상품은 판매가·재고를 바꾸지 않는다). 출시 전 상품(released_on > clock.seoul_today())은 없는 상품처럼 다루므로 상품을 고르는 새 코드는 app/core/product_release.py 의 released()·is_released() 를 쓴다(docs/specs/2026-11-01-product-catalog.md)
- 부품 호환성·병목 규칙은 app/core/compatibility.py(순수 함수, DB 없음)에 있고 product_attributes.attributes·product_benchmarks 를 읽는다. API 는 POST /compatibility/check(상품 SELECT 3개). 규칙·문구를 바꾸면 docs/specs/2026-11-01-compatibility-rules.md 와 tests/test_compatibility_rules.py 를 함께 고친다
- 예전 SQLite 파일 app.db 는 자동 이관하거나 수정하지 않는다
- 기존 테이블의 컬럼 추가·변경은 운영 데이터에 영향을 준다. spec 의 "데이터 변경" 절에 적고 사람 승인을 받은 뒤 진행한다. 승인된 컬럼 추가는 NULL 허용으로 모델에 더하고 app/scripts/sync_columns.py 의 ADDED_COLUMNS 에 넣는다. 이미 있는 DB 는 `python -m app.scripts.sync_columns`(미리보기 → --yes, sync_indexes 보다 먼저)로 컬럼·인덱스·외래 키를 더한다

## 테스트 (tests/)
- 클라이언트 픽스처는 tests/test_auth.py 의 client 픽스처를 따른다: `sqlite://` + StaticPool + `create_app(test_session, create_schema=False)`
- 파일 이름은 tests/test_<도메인>.py
- 실행: `.\.venv\Scripts\python.exe -m pytest -q`
