# 프런트엔드 규칙 (frontend/)
루트 AGENTS.md 에 덧붙는 규칙이다. 충돌하면 이 파일을 따른다.
화면 패턴과 예시 코드는 frontend/docs/ui-guide.md 에 있다. 새 화면·컴포넌트를 만들기 전에 읽는다.

## 구조
| 위치 | 내용 | 파일 이름 |
| --- | --- | --- |
| src/api/ | 백엔드 호출 함수. axios·fetch 는 여기서만 쓴다(fetch 는 이벤트 keepalive 전송 `eventApi.js` 만) | `<도메인>Api.js` |
| src/stores/ | 검증·상태 계산·오류 문구·이동을 맡는 순수 함수(Pinia 아님). 공용 상태는 로그인 상태(`authSession.js`), 헤더 숫자·토스트(`siteStatus.js`), 이벤트 추적(`tracking.js`) 세 모듈만 | `<도메인>ViewModel.js` |
| src/components/ | 재사용 UI. props 로 받고 emit 으로 알린다. API 를 부르지 않는다 | `<도메인><역할>.vue` + index.js·README.md 표에 추가 |
| src/views/ | 화면 하나 = 파일 하나. api 와 stores 를 연결한다 | `<도메인><역할>.vue` |
| src/router/index.js | 경로 해석 함수(vue-router 미사용). 숫자가 아닌 id(주문은 형식이 틀린 payment_id)는 null | `resolve<도메인>Route` |
| src/App.vue | 경로 → 화면 전환(v-if 체인). 구체적인 경로를 먼저 | |
| src/assets/ | 전역 토큰 style.css, 기능별 CSS `<기능>.css`(클래스 접두사) | |
| ui-check/scenarios.mjs | 화면 점검 시나리오(상태별 가짜 응답) | |
| src/testing/, scripts/ | 테스트 도구·검사기(하네스). 수정하지 않는다 | |

## 화면 (경로 → src/views)
| 경로 | 화면 | active-page |
| --- | --- | --- |
| (모든 화면) | SiteLayout(디자인 헤더: 로고·주요 메뉴 상품 /products·가격 추적 /my?tab=alerts·커뮤니티, 가운데 검색 GET /products, 비교·장바구니 아이콘 배지, 알림 아이콘 빨간 점 /my?tab=notifications, 비회원 "로그인" / 회원 첫 글자 동그라미 → 프로필 메뉴(마이페이지·장바구니·주문 내역·관리자 링크·로그아웃). 760px 아래는 메뉴·비교·장바구니 아이콘을 숨기고 하단 탭 막대 `nav "하단 메뉴"`(상품·커뮤니티·비교·장바구니·마이). 바닥글, siteStatus 토스트(아래 가운데, role=status)) | 화면이 넘긴다 |
| `/`, `/products`, `/products/{id}` | ProductCatalog.vue(홈: 히어로 + GET /products/price-summary 숫자 3칸(보조 영역), 필터 없는 1쪽에서만 "30일 하락폭 큰 부품" 가로 줄(ProductDropList, dropping + drop_desc 10개), 카테고리 칩, 필터 사이드바(브랜드·가격대·스위치 3개 dropping·near_low·store_lowest, 주소 query 에 `=1`, 760px 아래는 "필터" 버튼으로 연다), 정렬(하락폭순 drop_desc 포함), 카드(사진·배지·추세선·30일 변동·1년 최저가 문구·타몰 비교 문구·카드 링크 밖 "+ 비교"·"담기" button), 노출·클릭 이벤트), ProductDetail.vue(빵부스러기, 가격 카드(1년 최저가·30일 평균·지금 살 때? 칸, 타몰 비교 줄, 구매 영역, 비교함 담기/빼기, 목표가 알림 패널: 회원만 GET /alerts → PUT·DELETE /alerts/{id}), 가격 추이(기간 1주·1달·3달·1년 → price-history days, 점선 1년 최저가, 포인터·←/→ 툴팁, 표는 details 안), 판매처 비교(store_prices, MOA 가 최저가가 아니면 최저가 매칭 요청 POST /products/{id}/price-match), 상세 스펙, "이 부품에 대한 질문"(GET /questions?product_id=, 비면 숨김), "함께 보는 부품" 보조 영역: 본문을 받은 뒤 GET /products/{id}/recommendations?limit=6, 카드는 ProductRecommendations(사진·이름 h3 링크·가격·추세선·근거 배지 "함께 본 상품"/"비슷한 가격대"), 로딩·빈 목록·오류 → 다시 시도, 노출·클릭은 list `recommendation`. 시뮬레이터가 상세의 첫 h1·모든 dt 를 읽으므로 추천 영역에 h1·dl/dt 금지, 목록 이름 `ul aria-label="추천 상품"`은 " 목록"으로 끝나지 않게, 리뷰, 체류 시간 이벤트). 두 화면 아래 가운데에 떠 있는 비교 트레이(ProductCompareBar, 760px 아래는 하단 탭 위) | products |
| `/compare`, `/compare?ids={id,id}` | ProductCompare.vue(비교함(localStorage `moa.compare`, 최대 4개·같은 카테고리)의 상품마다 GET /products/{id}: 비어 있음·로딩·오류 → 다시 시도·404 상품 빼기 안내·1개 안내, 표(열 = 상품, 행 = 가격·30일 추이·1년 최저 대비·타몰 비교·평점·성능 점수·가성비 지수·출시일·specs 합집합, 배지 "가장 저렴"·"최고"는 글자, 열마다 "장바구니 담기" → siteStatus 토스트), 표는 자기 영역 안에서만 가로 스크롤. 이 화면에는 비교 트레이가 없다. `?ids=` 공유 링크는 그 상품으로 비교함을 채우고 주소를 /compare 로 바꾼다) | compare(헤더 비교 아이콘·하단 탭 "비교") |
| `/cart` | CartPage.vue(상품 목록 아래 "부품 호환성" 영역: 받은 뒤·수량 변경·삭제 뒤 POST /compatibility/check, 카테고리 1개면 숨김, 주문하기는 어떤 상태에서도 그대로. 견적에서 담은 줄(item.build)에 "견적에서 담음" 배지 — 견적 글 /community/posts/{post_id} 링크, post_id 가 null 이면 글자만. 줄의 첫 링크는 상품 이름 링크 그대로(시뮬레이터). 수량 select 양옆 −/+ 버튼, 줄마다 담은 뒤 가격 변동 줄(price_change_krw), 합계 옆 타몰 최저가 대비 절약(external_saving_krw), "이 구성으로 견적 의견 받기" 링크 → /community/build/new?from=cart. 응답마다 siteStatus.setCartCount(item_count)) | cart |
| `/checkout`, `/checkout?product={id}&quantity={n}` | CheckoutPage.vue(장바구니 전체 / 바로 구매. 배송지 → POST /orders → PortOne 결제창(응답 provider 가 "mock" 이면 건너뜀) → POST /orders/confirm → 주문 상세) | cart |
| `/payments/complete` | PaymentComplete.vue(PortOne 모바일 redirect. `?paymentId=` 로 결제 확인, `?code=` 면 실패 안내) | orders |
| `/orders`, `/orders/{payment_id}` | OrderList.vue, OrderDetail.vue(PAID·`returnable` 있음·기한(`return_deadline`, "YYYY년 M월 D일 HH:mm 까지") 전이면 "반품 신청" 영역: 상품별 수량 select(0~서버 신청 가능 수량)·사유 라디오 5개·자세한 내용·변심 배송비 안내(표시만)·저장 중. 기한이 지나면 안내. "반품 내역": 상태 글자 배지·환불 금액(서버 값)·거절 사유·REQUESTED 면 "신청 철회"(InlineConfirm). 시뮬레이터가 상품 표 링크를 읽으므로 반품 영역에는 표·상품 링크를 두지 않는다) | orders |
| `/admin/returns`, `/admin/returns?status={상태}` | AdminReturns.vue(관리자 반품 관리. GET /admin/returns 401 은 로그인 안내, 403 은 "관리자만 볼 수 있습니다." 상태 탭(전체·신청·환불 대기·환불 완료·거절·철회, 주소 ?status=)·쪽 이동(20개)·요청 경합. 신청마다 주문·상품·사유·금액(차감 표시)·상태·refund_error, REQUESTED 는 "승인하고 환불"·"거절"(사유 입력 + 확인), APPROVED 는 "다시 환불". 승인·다시 환불은 그 카드 안 InlineConfirm "환불 N원을 승인할까요?"(N = 서버 refund_amount_krw)에서 "예"일 때만 요청. 한 번에 하나만 처리, 결과는 목록 위 role=status/alert. 헤더 프로필 메뉴의 "반품 관리"는 /user/me 의 role 이 admin 일 때만) | 없음(빈 값 `""`) |
| `/admin/recommendations` | AdminRecommendations.vue(관리자 추천 학습, spec docs/specs/2026-11-03-product-recommendations.md. GET /admin/recommendations/models 401 은 "로그인한 관리자만 볼 수 있습니다." + 로그인 링크, 403 은 "관리자만 볼 수 있습니다." ① 학습: fieldset "학습에 쓸 이벤트" 라디오 전체(기본)/이 시각 이후 + datetime-local(기본값 = server_time 의 서울 시각, 보낼 때 +09:00) → POST /admin/recommendations/train, "학습 중..."·fieldset 잠금, 성공 role=status 뒤 ②·③ 다시 부르기, 실패(409·422·503) role=alert 서버 문구·입력 유지 ② 학습 기록 표(최근 5개, 0개면 기본 추천 안내) ③ 상품별 순위 비교(상품 번호 기본 1, 현재/이전 표, 현재 표에 ▲n·▼n·새로 글자, 404 "상품을 찾을 수 없습니다. 번호를 확인해 주세요.", 표는 자기 영역 안에서만 가로 스크롤, 요청 경합). 프로필 메뉴 "추천 학습"은 "반품 관리" 아래, role admin 일 때만) | 없음(빈 값 `""`) |
| `/questions/*` | QuestionList.vue(줄마다 답변 수 알약·제목·관련 부품 이름(없으면 "부품 미지정")·첨부·채택 표시·글쓴이·조회 N(view_count)·날짜, 번호 쪽 이동·검색), QuestionDetail.vue(관련 부품 카드, 채택된 답변이 맨 위 "채택된 답변" 배지, 질문 작성자에게 답변마다 채택하기/채택 취소(POST·DELETE .../answers/{id}/accept, 한 번에 하나)), QuestionEditor.vue("관련 부품 (선택)" 검색 → product_id, `?product={id}` 로 미리 고른다. 수정은 바뀌었을 때만 product_id, null 은 연결 해제). 모두 CommunityShell(active questions) 안. 시뮬레이터가 쓰는 구조(li > a > h2 뒤 글쓴이 span, "답변 남기기"·"답변 등록")는 바꾸지 않는다 | questions(헤더는 community 와 같이 "커뮤니티"를 강조한다) |
| `/community` | CommunityHome.vue(CommunityShell(왼쪽 240px 사이드바, 760px 아래는 알약 줄) 안에 "최근 글 중 견적을 기다리는 요청 N건" 띠 + 게시판 3개의 최신 글 5개 미리보기, 견적은 상태 알약·용도·예산. 게시판마다 로딩·오류·다시 시도) | community |
| `/community/free`, `/community/build`, `/community/build?purpose={용도}` | CommunityPostList.vue(자유: 제목 [댓글] · 글쓴이 · 날짜. 견적: 용도 필터 칩(purpose, 주소 ?purpose= 로도 연다) + 상태 알약(quote_count) · 제목 · "글쓴이 · 선호 사항" · 용도 · 예산 · 날짜. 번호 쪽 이동·검색. 모르는 게시판은 "찾을 수 없음") | community |
| `/community/{free\|build}/new`, `/community/posts/{id}/edit` | CommunityPostEditor.vue(자유: "자유 게시판 글쓰기". 견적: "견적 요청하기" — 예산(50~500만 원 슬라이더 + 만 원 입력 + 빠른 선택 칩 → budget_krw)·용도 라디오 칩·선호 사항 체크 칩(preferences)·모니터 해상도 select(monitor_resolution)·제목·요청 내용. `?from=cart` 는 회원의 장바구니로 제목·내용을 채운다. 수정은 바뀐 필드만 PATCH) | community |
| `/community/posts/{id}` | CommunityPostDetail.vue(자유: 게시판 링크·제목·글쓴이·날짜·댓글 수 줄·본문·목록/수정/삭제·댓글. 견적: 견적 요청서 카드(예산·용도·모니터·선호 4칸) → 받은 견적(부품 목록이 있는 댓글: 합계·예산 사용 막대·budget_gap_krw 배지·호환성 요약 CompatibilityPanel quote_card·부품 줄·"전체 장바구니에 담기"(POST /cart/builds, 비로그인은 로그인 안내, 카드마다 담는 중·결과 status·실패 alert + 다시 시도, 401 은 새 탭 로그인)·"핵심 부품 비교"(CPU·그래픽카드·메인보드 중 합계가 가장 큰 카테고리로 비교함을 바꾸고 /compare)) → 댓글 → "견적 보내기 · 댓글"(CommunityPartsPicker, 상품은 GET /products 카테고리별 50개, "장바구니 구성으로 견적 보내기", 고른 부품이 바뀌면 0.4초 모아 호환성 확인)) | community |
| `/login`, `/login?mode=signup` | LoginPage.vue(AuthDialog inline = 디자인 로그인 카드: 로고 64px·"MOA Parts 로그인"·안내. `?mode=signup` 이면 회원가입 창으로 연다. 가입은 "사용 목적(선택)" select → purpose, 선택 안 함 = null. 로그인 성공 뒤 authSession.refresh()·siteStatus.refresh()) | auth(하단 탭 "마이") |
| `/my`, `/my?tab={notifications\|alerts\|posts}` | MyPage.vue(마이페이지. 로그인 확인 중 role=status, 비로그인·탭 요청 401 은 "로그인이 필요해요" + /login 링크·"로그인 상태 다시 확인", 확인 실패는 오류 + 다시 시도. 머리말: 첫 글자 동그라미·"이름님"·"추적 중 N개 · 읽지 않은 알림 N개"·로그아웃. 탭(aria-pressed 버튼, 바꾸면 replaceState): 알림 GET /notifications(종류 아이콘·"읽지 않음" 글자·상대 시각, 누르면 POST /notifications/{id}/read 뒤 대상 상품·질문·글로 이동, "모두 읽음" POST /notifications/read-all, 20개 쪽 이동) / 가격 추적 GET /alerts(사진·이름 링크·현재가·목표가·진행도 막대 role=img·"목표가까지 N원"·30일 배지, × 추적 해제 DELETE /alerts/{id} → 토스트) / 내 글 GET /user/me/posts(질문·자유·견적 요청 배지·제목 링크·답글 수·날짜). 탭마다 로딩·빈 목록·오류 → 다시 시도. 계산은 stores/myPageViewModel.js) | my, 가격 추적 탭은 alerts |

## 코드
- `<script setup>` 과 ref·computed·onMounted 를 쓴다. Options API, 새 라이브러리(vue-router, Pinia, UI 키트)를 들이지 않는다
- 이동은 `<a href>`. 코드에서 이동할 때는 stores 의 함수(location 을 인자로 받는 goToQuestion 같은)를 쓴다
- 가격·권한은 서버 응답을 그대로 쓴다(is_owner 등). 금액을 계산해 서버로 보내지 않는다
- 결제: PortOne 결제창은 `src/api/portonePayment.js` 의 `launchPortOnePayment` 로만 연다. 모의 결제(로컬 시뮬레이션, `isMockPayment`)는 결제창 없이 바로 확인한다. 결제 금액은 POST /orders 응답의 `total_amount` 를 그대로 쓴다. 결제창이 `code` 를 돌려주면 취소·실패이고, 확인(POST /orders/confirm)이 실패하면 새로 결제시키지 말고 같은 주문의 확인만 다시 시도하게 한다

## 백엔드 호출 (src/api)
- 주소는 `baseUrl(apiBaseUrl)` 로 만들고 함수 마지막 인자로 `{ apiBaseUrl }` 를 받는다. 개발 기본 주소 `http://127.0.0.1:8000` 을 바꾸지 않는다
- 경로에 넣는 값은 `encodeURIComponent()`, 검색어·페이지는 axios `params`
- 로그인이 필요한 요청은 `withCredentials: true`
- 응답 `{code, message, result}` 에서 result 를 돌려준다. 오류는 던지고 화면이 stores 의 `<도메인>Error(error, fallback)` 로 문구를 만든다
- 필드 이름은 spec 의 API 계약 그대로. 백엔드 응답이 계약과 다르면 프런트를 맞추지 말고 보고한다

## 화면 상태 (데이터를 불러오는 모든 화면)
- 로딩 `role="status"` / 오류 `role="alert"` + "다시 시도" 버튼 / 404 는 목록 링크 / 빈 목록은 다음 행동 안내
- 비로그인(401)과 권한 없음(403)은 다른 문구. 로그인 링크를 준다
- 저장 중: 버튼 비활성화 + "저장 중..." + `fieldset :disabled`, 두 번 제출 방지, 실패해도 입력값 유지
- 목록을 다시 부르는 화면은 요청 경합을 막는다(늦게 온 이전 응답 무시, ui-guide 3절)
- 상세 안의 보조 영역(가격 이력·리뷰처럼 따로 부르는 API)은 본문을 불러온 뒤 부르고, 영역마다 로딩·오류·다시 시도를 갖는다. 실패해도 본문은 보인다(stores 의 `getSectionState`, ui-guide 4절)
- 삭제 확인은 브라우저 `confirm` 대신 `InlineConfirm`(화면 안 "삭제할까요? 예/아니요")을 쓴다(질문·답변·리뷰·커뮤니티 글·댓글 삭제)
- 수정(PATCH)은 바뀐 필드만 보낸다(서버는 빈 본문·null 을 422 로 거절한다)

## 로그인 상태 (src/stores/authSession.js)
- GET /user/me 를 화면·컴포넌트에서 직접 부르지 않는다. `await authSession.load()` → `{ status: 'loading'|'member'|'guest'|'error', profile, error }`. 페이지에서 한 번만 부르고(진행 중이면 같은 Promise) 레이아웃과 화면이 나눠 쓴다. reject 하지 않는다
- 401 만 `guest`(로그인 안내), 그 밖의 실패는 `error`(오류 + 다시 시도. 문구는 `<도메인>Error(state.error, fallback)`). 로그인 사용자 정보는 `memberProfile(state)`
- "다시 시도"·"로그인 상태 다시 확인"·로그인 성공 뒤에는 `authSession.refresh()`, 로그아웃은 `authSession.logout()`(성공하면 다시 부른다, 실패하면 던진다)
- 계속 보여 주는 곳(레이아웃)은 `subscribe(listener)` 로 받고 `onBeforeUnmount` 에서 해제한다
- 테스트: `compileSfc(경로, { authSession: createAuthSession({ fetchCurrentUser, logout }) })` 로 가짜 API 를 넣고 `beforeEach` 에서 `authSession.reset()`

## 헤더 숫자·토스트 (src/stores/siteStatus.js)
- 상태 `{ cartCount, compareCount, unreadCount, toast }`. SiteLayout 이 `subscribe` 하고 `load()`(회원이면 GET /cart·GET /notifications/unread-count 를 페이지에서 한 번, 실패해도 0)로 채운다. 화면은 API 를 다시 부르지 않고 응답을 받은 뒤 숫자만 맞춘다: `setCartCount(cart.item_count)`·`setCompareCount(n)`·`setUnreadCount(n)`, 짧은 안내는 `showToast('장바구니에 담았어요')`(SiteLayout 이 그린다). 로그인 뒤 `refresh()`
- 테스트: compileSfc deps 로 `siteStatus` 가짜(jest.fn) 또는 `createSiteStatus({ session, fetchCart, fetchUnreadCount, compareCount })` 를 넣는다

## 이벤트 (src/stores/tracking.js)
- 화면은 `track(type, props)` 만 부른다. type 은 spec(docs/specs/2026-10-30-event-logging.md) 이벤트 표의 37개(`EVENT_TYPES`, 2026-11-01 `compatibility_check` 추가, 같은 날 docs/specs/2026-11-01-event-enrichment.md 가 노출·클릭·체류·비교함·커뮤니티 11개, docs/specs/2026-11-01-build-id-purpose.md 가 `build_add_to_cart` 1개와 `signup` 의 purpose, docs/specs/2026-11-01-returns-refunds.md 가 `return_request`·`return_withdraw` 2개 추가)이고 모르는 type 은 버려진다. 새 type 은 spec 표와 백엔드 허용 목록부터 바꾼다
- 이벤트마다 `schema_version`(지금 5, `SCHEMA_VERSION`. 5 는 docs/specs/2026-11-03-product-recommendations.md: 새 type 없이 추천 칸 노출·클릭에 source_product_id·model_version 추가)을 추적기가 싣는다. 화면은 넣지 않는다
- 페이지를 떠날 때 보내야 하는 값(체류 시간, 1초 묶음으로 기다리는 노출)은 `onExit(callback)`(→ 해제 함수)로 등록한다. 추적기가 탭 숨김(reason hidden)·페이지 떠남(leave) 때 keepalive 전송 전에 부른다
- 노출·클릭은 `src/stores/impressionTracker.js`(목록 결과마다 `start()` → 새 list_view_id, IntersectionObserver 가 없으면 노출을 보내지 않음. 상품 목록은 list `catalog`, 상품 상세 추천 칸은 list `recommendation` 이고 추천을 받을 때마다 `start({ page: 1, source_product_id, model_version })`: start 의 추가 값은 그 결과의 노출·클릭 props 에 함께 실린다(기본 추천이면 model_version null)), 체류 시간은 `src/stores/dwellTracker.js`, 비교함은 `src/stores/compareViewModel.js` 의 `createCompareBox`(규칙·저장·compare_add/remove/clear). 브라우저 객체(IntersectionObserver·document·localStorage·시계)는 인자로 받으니 화면 테스트는 compileSfc deps 로 이 함수들을 감싸 가짜를 넣는다
- 언제: 서버 응답을 받아 화면에 반영한 뒤, 성공했을 때만(실패·늦게 온 이전 응답은 남기지 않는다). 사용자 행동(바로 구매·필터 변경·결제창 열기)은 이동·요청 직전
- 무엇을: id·코드·숫자·상태. 값은 서버 응답 그대로(가격·개수·평점·쪽). 비어 있는 조건은 `null`. 목록(product_ids 등)은 `MAX_PROP_LIST_LENGTH`(20)개로 자른다. 이벤트 하나가 계약을 어기면 서버가 묶음 전체를 422 로 거절한다
- 개인정보 금지: 이름·이메일·전화·주소·리뷰·질문·답변 본문(제목 포함)을 넣지 않는다. 사용자 id 도 보내지 않는다(서버가 쿠키로 판단). 추적기도 그런 이름의 키(name, email, phone, address, content, title, memo 등)는 버린다
- 추적은 화면에 영향을 주지 않는다: `track` 은 던지지 않으니 기다리거나 try/catch 하지 않는다. 묶음(10개·3초, 한 요청 50개·60KB 이하)·페이지를 떠날 때 keepalive(text/plain 이라 CORS 사전 요청 없음)·네트워크 오류와 5xx 만 한 번 다시 시도(422·413·403 은 버림)는 추적기가 한다
- 테스트: compileSfc deps 로 `track: jest.fn()` 을 넘겨 type·props 를 확인한다(src/trackingView.test.mjs). 넘기지 않으면 Jest 에서는 아무것도 보내지 않는다(빌드 모드 production·development 에서만 전송)
- 화면 점검: 모든 시나리오에 `POST /events` 202 가짜 응답이 있어야 한다. 공통 `guest`·`member` 에 들어 있고, api 를 직접 적는 시나리오는 `...events` 를 넣는다

## 접근성·디자인
- 입력마다 `<label for>`(숨길 때 class="sr-only"), 버튼에 `type`, 이미지에 `alt`, 아이콘만 있는 버튼에 `aria-label`
- 새 탭 링크는 `rel="noopener noreferrer"`. `v-html` 금지. `div`·`li` 에 `@click` 금지
- 색은 `:root` 토큰(`--brand` 등)을 쓰고 스타일은 `<style scoped>`. 375px 폭에서 가로 스크롤이 없어야 한다
- 그래프는 라이브러리 없이 SVG 로 그리고 `role="img"` + `aria-label` 텍스트 대안과 같은 내용의 표를 함께 둔다. 색만으로 구분하지 않는다(선 모양·범례). 좌표 계산은 stores 순수 함수로 테스트한다
- 문구는 존댓말(`~합니다/~해 주세요`), 오류 문구에는 다음 행동을 적는다

## 테스트 (Jest, node 환경, `src/<대상>.test.mjs`)
- api: `jest.spyOn(axios, 'get')` 으로 URL·메서드·본문·withCredentials 검증 (예: src/questionApi.test.mjs)
- stores: 검증·상태 계산·오류 문구를 `test.each` 로 (예: src/productViewModel.test.mjs, src/cartViewModel.test.mjs)
- 화면·컴포넌트: `src/testing/sfc.mjs` 의 `compileSfc` + `mount` 로 상태별 렌더링과 클릭·입력·제출 (예: src/testing/sfc.test.mjs)
- 상태마다 1개 이상: 로딩, 성공, 빈 목록, 오류 → 다시 시도, 401/403

## 검사 (verify 에 포함)
- 규칙 검사 `node frontend/scripts/check-frontend.mjs`: 이 파일의 규칙 중 코드로 확인되는 것. 실패하면 출력의 "고치는 법"대로 코드를 고친다. 기준선(frontend-rules.baseline.json)은 고치지 않는다
- 화면 점검 `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/verify.ps1 -UI`: 빌드한 화면을 브라우저로 열어 상태별 스크린샷을 .agent-loop/ui/ 에 남긴다
  - 새 화면은 ui-check/scenarios.mjs 에 상태마다 시나리오를 추가한다
  - 실패한 화면은 스크린샷을 view_image 로 열어 보고 고친다. 통과시키려고 시나리오의 expect 를 지우지 않는다
  - 샌드박스 때문에 브라우저 실행이 막히면 권한 상승을 요청하거나, 사람에게 실행을 부탁하고 보고한다
- 개발 서버(npm run dev)는 띄우지 않는다. 화면 확인은 화면 점검으로 한다
