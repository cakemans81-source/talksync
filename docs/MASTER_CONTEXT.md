================================================================================
TALKSYNC — MASTER CONTEXT
현재 확정 기획·기술·제품 운영 기준
기준일: 2026-07-18
================================================================================

0. 문서 목적
--------------------------------------------------------------------------------
이 문서는 TalkSync의 현재 확정된 기획, 기술 방향, 무료·유료 상품 구조,
Windows 오디오 드라이버 전략, 오픈소스 엔진 후보, 출시 순서와 보호 경계를
새 채팅창이나 다른 AI가 한 번에 이어받도록 정리한 마스터 컨텍스트다.

새 작업을 시작할 때 이 문서를 기준으로 상태를 복원한다.

주의:
- 모델 가격, API 상태, 오픈소스 라이선스, Windows 드라이버 정책은
  시점에 따라 바뀔 수 있으므로 실제 구현 직전에 공식 출처로 재확인한다.
- 이 문서는 자동 구현 명령이 아니다.
- 사용자가 명시적으로 티켓 발행 또는 구현을 요청하기 전에는
  코드·드라이버·결제·API 키·프로덕션 환경을 변경하지 않는다.


================================================================================
1. 프로젝트 정의
================================================================================

TalkSync는 Windows에서 사용자가 선택한 브라우저 탭, 회의 앱,
Discord, 게임 음성 채널 등의 오디오를 실시간으로 번역하는 통역 시스템이다.

단순 자막 번역기가 아니라 최종적으로 다음 경험을 목표로 한다.

[Rx — 상대방이 말하는 방향]

상대방 음성
→ TalkSync가 선택 앱의 오디오를 캡처
→ 사용자가 선택한 언어로 번역
→ 번역 자막 또는 번역된 AI 음성으로 출력


[Tx — 내가 말하는 방향]

내 마이크
→ TalkSync가 내 음성을 캡처
→ 상대방 언어로 번역
→ TalkSync Virtual Microphone
→ 회의 앱·Discord·게임 앱에 번역 음성 송출


[최종 목표]

1. 사용자는 상대방 원음을 음소거하거나 볼륨을 조절할 수 있다.
2. 사용자는 번역된 AI 음성 또는 자막으로 상대방 말을 이해한다.
3. 상대방에게는 사용자의 원본 음성 대신 번역된 AI 음성이 전달된다.
4. 통역은 사용자가 선택한 앱·프로세스·브라우저 탭에만 적용된다.
5. 원본 음성과 번역 음성 간 에코·하울링·재번역 루프를 차단한다.


================================================================================
2. 제품의 핵심 가치와 해자
================================================================================

TalkSync의 장기 해자는 번역 모델 자체가 아니다.

상용 번역 모델은 빠르게 범용화될 수 있으므로, 방어 가능한 가치는 다음이다.

1. Windows OS 레벨 앱별 오디오 라우팅
2. TalkSync Virtual Microphone / Virtual Speaker
3. Discord·게임·회의 앱 등 임의의 데스크톱 앱 호환성
4. 원본 음성과 번역 음성의 안정적인 격리
5. 낮은 종단 지연과 에코·하울링 방지
6. 회의·게임·비즈니스별 용어집과 번역 보정
7. Free 로컬 엔진과 Pro 상용 API를 교체 가능한 provider 구조
8. 사용량·예산·세션을 사용자가 통제할 수 있는 과금 안전장치

제품 전략의 핵심 문장:

번역 모델은 교체할 수 있어야 한다.
TalkSync의 오디오 라우팅과 보정 계층은 제품 자산으로 남아야 한다.


================================================================================
3. 전체 제품 모드
================================================================================

3.1 Browser Tab / Window Mode
--------------------------------------------------------------------------------

브라우저 탭 또는 창의 오디오를 사용자가 직접 선택한다.

브라우저 탭 오디오
→ TalkSync
→ ASR·번역 또는 상용 Live Translate
→ 자막 또는 번역 음성
→ 사용자의 이어폰

적용 대상:
- Google Meet 웹
- Teams 웹
- Zoom 웹
- YouTube
- 웹 세미나
- 브라우저 기반 회의

장점:
- 가상 오디오 드라이버 없이 Rx 기능을 먼저 검증할 수 있다.
- ASR·번역·자막 UX와 API 품질을 빠르게 확인할 수 있다.
- Windows 커널 드라이버 문제와 통역 엔진 문제를 분리할 수 있다.

한계:
- 데스크톱 Discord·Teams·Zoom 앱의 완전한 앱별 라우팅은 별도다.
- Tx 번역 음성 송출에는 Virtual Microphone이 필요하다.
- 브라우저 보안 정책에 따라 사용자가 캡처 대상을 직접 선택해야 한다.


3.2 Target App Mode
--------------------------------------------------------------------------------

사용자가 실행 중인 Windows 앱 또는 프로세스를 선택한다.

선택 앱 오디오
→ 프로세스별 오디오 캡처
→ TalkSync 통역 엔진
→ 번역 자막·이어폰·Virtual Microphone 출력

적용 대상:
- Discord 데스크톱
- Teams 데스크톱
- Zoom 데스크톱
- 게임 음성 채널
- 기타 Windows 음성 앱

중요:
- 일반적인 시스템 전체 loopback만으로 끝내지 않는다.
- 특정 앱·프로세스 오디오 캡처 경로를 별도로 검증한다.
- 앱의 자식 프로세스와 오디오 세션 변화도 고려한다.


3.3 Full Voice Replacement Mode
--------------------------------------------------------------------------------

TalkSync의 최종형이다.

[Rx]

선택 앱 출력
→ TalkSync Virtual Speaker 또는 앱별 캡처
→ AI 통역
→ 실제 이어폰에 번역 음성 출력

[Tx]

실제 마이크
→ AI 통역
→ TalkSync Virtual Microphone
→ 선택 앱의 마이크 입력

목표:
- 상대방 원음과 번역 음성의 독립 볼륨 제어
- 내 원본 음성이 상대방에게 직접 전달되지 않음
- 번역 음성만 앱으로 전달
- 에코·하울링 방지
- 상대방도 통역기를 사용할 때 통역-of-통역 루프 방지


================================================================================
4. 확정된 상품 구조
================================================================================

4.1 Free — Local Relay
--------------------------------------------------------------------------------

Free v1은 완전한 양방향 음성 통역이 아니다.

확정 구조:

[Tx — 내가 말하는 방향]

내 한국어 음성
→ 로컬 ASR 또는 직접 음성 번역
→ 영어 텍스트
→ 용어·문체 보정
→ TalkSync 고정 중립 영어 음성
→ TalkSync Virtual Microphone
→ 상대방에게 영어 음성 송출


[Rx — 상대방이 말하는 방향]

상대방 영어 원음
→ 사용자가 원음을 볼륨 조절하여 청취
→ 로컬 영어 ASR
→ 영어→한국어 번역
→ 한국어 자막 표시

Free의 사용자 가치:
- API 요금 없음
- 가능한 범위에서 로컬 처리
- 프라이버시
- 내 한국어를 상대방에게 영어 음성으로 전달
- 상대방 영어는 원음과 한국어 자막으로 이해
- 사용자 목소리 복제 없음
- PC 성능에 따라 Lite / Quality 모드 선택 가능

Free를 다음과 같이 홍보하지 않는다.

금지 표현:
- 완전한 양방향 실시간 음성 통역
- 사람 통역사 수준
- 내 목소리를 그대로 보존하는 무료 통역
- 모든 PC에서 동일한 초저지연 보장

권장 표현:

무료 로컬 통역
보내기: 한국어 → 영어 AI 음성
받기: 영어 원음 + 한국어 자막


4.2 Pro BYOK
--------------------------------------------------------------------------------

사용자가 자신의 Gemini·OpenAI 또는 지원 provider API 키를 연결한다.

구조:
- TalkSync는 클라이언트·오디오 라우팅·UX를 제공
- API 사용료는 사용자 provider 계정에서 직접 청구
- TalkSync 구독료와 API 사용료는 분리 가능

장점:
- TalkSync가 API 원가와 사용량 위험을 직접 떠안지 않는다.
- 고사용량 사용자에게 유리하다.
- 사용자가 자신의 provider와 예산을 통제할 수 있다.

필수 보안:
- API 키 평문 저장 금지
- 로그·분석 이벤트에 API 키 노출 금지
- 키 검증 실패 시 명확한 오류 표시
- provider별 사용량·가격 차이 고지


4.3 Pro Managed
--------------------------------------------------------------------------------

API 발급과 설정을 어려워하는 사용자를 위한 관리형 요금제다.

구조:
- TalkSync 서버가 공식 provider API를 호출
- 사용자별 사용량을 계량
- TalkSync가 사용자에게 원화 또는 정해진 단위로 과금
- 외부 API 원가, 결제 수수료, 장애·환불·악용 위험을 포함해 가격 책정

Managed 가격은 단순 API 원가와 동일하게 책정하지 않는다.

Managed 플랜 필수 안전장치:
- 세션 최대 시간
- 1시간 사용 경고
- 1시간 후 자동 중지 선택 토글
- 자동 중지 기본 ON 검토
- 재개 시 사용자 명시적 확인
- 월간 원화 예산 한도
- 50% / 80% / 100% 사용량 경고
- 하드 비용 상한
- 사용자별 동시 세션 제한
- 비정상 사용 탐지
- 서버 측 사용량 계량
- 청구 근거 확인 화면

금지:
- 여러 API 키를 돌려 provider 쿼터를 우회하는 운영
- 사용자 구분 없이 하나의 키를 클라이언트에 배포
- 클라이언트에서 Managed API 비밀키 직접 호출
- 사용량 상한 없는 무제한 Managed 요금제 조기 출시

필요 시:
- provider 공식 쿼터 증설
- 기업 계약
- 공식 리셀·상업 사용 조건 문의
- provider별 장애 전환 정책


4.4 Enterprise
--------------------------------------------------------------------------------

Enterprise 후보:
- 회사별 용어집
- 업종별 번역 보정
- 회의·콜센터·게임방송 특화 프로필
- 감사 로그와 관리자 정책
- 온프레미스 또는 사설 서버
- 고객 소유 provider 계정
- 전용 API 계약
- 전용 음성
- 동의 기반 전용 모델
- 데이터 저장 금지 정책
- 사용자·부서별 비용 제한


================================================================================
5. Free Local v1 세부 UX
================================================================================

5.1 Safe Push-to-Talk — 기본값
--------------------------------------------------------------------------------

사용자가 Push-to-Talk 버튼을 누름
→ 한국어 발화
→ 버튼을 놓으면 문장 확정
→ 인식된 한국어 문장 표시
→ 영어 번역
→ 필요 시 송출 전 취소
→ 영어 TTS 생성
→ Virtual Microphone으로 송출

Safe Mode를 기본으로 정한 이유:
- 한국어는 핵심 동사가 뒤에 오는 경우가 많다.
- 문장이 끝나기 전에 영어 음성을 내보내면 의미가 뒤집힐 수 있다.
- 이미 송출된 TTS는 나중에 수정할 수 없다.
- 사용자가 오역을 확인하거나 취소할 수 있다.
- 미완성 문장과 원치 않는 음성 송출을 줄일 수 있다.


5.2 Live Mode — Experimental / Beta
--------------------------------------------------------------------------------

연속 발화
→ VAD와 endpointing
→ 1~2초 의미 단위로 분할
→ 부분 번역
→ TTS 큐
→ 순차 송출

Live Mode는 다음 조건을 충족한 뒤 검토한다.
- 부분 결과가 과도하게 뒤집히지 않음
- 영어 음성 큐가 누적되지 않음
- 지연 상한을 유지
- 취소·중단 처리 가능
- 에코와 재인식 루프 없음

초기 공개 시:
- Experimental 또는 Beta 표시
- 오역·문장 누락 가능성 고지
- Safe Mode로 즉시 돌아갈 수 있어야 함


5.3 Rx 자막 UX
--------------------------------------------------------------------------------

원어 음성 볼륨:
- 100%
- 40% 권장
- 0% 음소거

자막:
- 영어 원문
- 한국어 번역문
- 처리 중 / 확정 상태
- 인식 불확실 표시
- 최근 문장 기록
- 복사
- 용어 수정 또는 사용자 피드백

권장 동작:

상대방이 발화 중:
- 원어 음성을 선택한 볼륨으로 재생
- 영어 부분 자막 표시

문장이 안정화되면:
- 한국어 번역 자막 확정

신뢰도가 낮으면:
- “인식 불확실” 표시
- 영어 원문 병기
- 번역 내용을 사실처럼 확정 표시하지 않음


================================================================================
6. Free 엔진 후보 — 확정이 아닌 벤치마크 대상
================================================================================

현재 후보는 실제 Windows 벤치마크 전까지 확정 엔진이 아니다.


6.1 Track A — Direct Speech Translation
--------------------------------------------------------------------------------

한국어 음성
→ Whisper medium/large translate
→ 영어 텍스트
→ 영어 TTS
→ Virtual Microphone

장점:
- ASR과 번역 단계를 줄일 수 있다.
- 구조가 단순하다.
- 중간 한국어 텍스트 오류 전파를 줄일 가능성이 있다.

단점:
- 용어집과 문체 제어가 어렵다.
- 오류 원인 분리가 어렵다.
- 고품질 모델은 연산량이 크다.
- TalkSync의 보정 계층을 적용하기 불리할 수 있다.

역할:
- 비교 기준선
- 저사양 기본 엔진으로 사전 확정하지 않음


6.2 Track B — Lite Cascade
--------------------------------------------------------------------------------

Tx:
sherpa-onnx
→ OPUS-MT 또는 직접 번역 비교
→ Kokoro
→ Virtual Microphone

Rx:
sherpa-onnx
→ OPUS-MT
→ 한국어 자막

목표:
- CPU 중심
- 낮은 설치·메모리 부담
- Free Lite 후보
- 품질보다 실행 가능 범위와 안정성 우선


6.3 Track C — Quality Cascade
--------------------------------------------------------------------------------

Tx:
faster-whisper
→ Hy-MT2 1.8B
→ Chatterbox-Turbo
→ TalkSync 권리 확보 고정 영어 음성
→ Virtual Microphone

Rx:
faster-whisper
→ Hy-MT2 1.8B
→ 한국어 자막

목표:
- GPU 권장
- Free Quality 후보
- 높은 번역 품질과 명확한 영어 음성
- 용어집·문체 보정 가능성 검증


6.4 Experimental Korean TTS
--------------------------------------------------------------------------------

영어 음성
→ 영어 ASR
→ 영어→한국어 번역
→ Chatterbox Multilingual 등 검증 모델
→ 한국어 음성 출력

현재 판단:
- 한국어 로컬 TTS가 기술적으로 불가능한 것은 아니다.
- Free v1 기본값에는 포함하지 않는다.
- 지연·연산량·에코·다운로드 크기·장시간 안정성이 불리하다.
- 원어 화자의 실제 감정과 억양을 잃을 수 있다.
- GPU 환경에서 별도 벤치마크를 통과한 경우에만 Experimental 후보다.

Rx 자막은 기술적 실패가 아니라 의도적인 제품 최적화다.


6.5 Argos Translate 위치
--------------------------------------------------------------------------------

Argos Translate는 기본 번역 엔진으로 확정하지 않는다.

역할:
- 호환성 실험
- 패키징 비교
- 오프라인 fallback 가능성 조사

이유:
- 프레임워크와 언어 패키지 라이선스가 다를 수 있다.
- 한국어↔영어 실시간 대화체 품질 근거가 부족하다.
- 최신 전용 번역 모델과 직접 비교해야 한다.


6.6 현재 제품 제외 후보
--------------------------------------------------------------------------------

제품에 그대로 포함하지 않는 후보:
- 비상업 전용 가중치
- CC-BY-NC 계열 제품 가중치
- F5-TTS 비상업 가중치
- XTTS 비상업 조건 모델
- OmniVoice 공개 비상업 가중치
- 라이선스 출처가 불명확한 음성·모델
- 사용자 동의 없는 voice cloning
- 타인의 참조 음성
- 상용 API 결과를 경쟁 모델 학습 데이터로 사용하는 distillation

무료 제공 기능이어도 TalkSync라는 상업 제품의 사용자 확보·서비스 기능이므로,
비상업 라이선스를 편의적으로 해석하지 않는다.


================================================================================
7. Free 음성 정책
================================================================================

Free의 성공 기준에 사용자 목소리 유사도를 포함하지 않는다.

우선순위:

1. 상대방이 의미를 정확히 이해할 수 있는가
2. 지연이 대화를 심각하게 방해하지 않는가
3. 환각·누락·치명적 오역이 적은가
4. 영어 발음이 명확하고 장시간 듣기 편한가
5. 사용자 목소리와 닮았는가

Free는 TalkSync가 사용 권리를 확보한 고정 중립 영어 음성을 사용한다.

고정 음성 기준:
- 명확한 영어 발음
- 빠른 생성
- 일정한 음량
- 과도한 감정 표현 없음
- 사용자 또는 타인 음성 복제 없음
- AI 합성 음성임을 사용자에게 고지

사용자 음성 복제는 Free 기본 기능으로 추가하지 않는다.


================================================================================
8. 상용 Live Translate / Provider 전략
================================================================================

Gemini Live Translate 계열은 TalkSync의 품질 기준선과 Pro 후보로 사용한다.

하지만 특정 preview API 하나에 제품 전체를 종속시키지 않는다.

필수 구조:

TalkSync Audio Session
→ 공통 Provider Adapter
   ├─ Gemini Live Translate
   ├─ OpenAI Realtime 또는 다른 대체 provider
   └─ 향후 자체·온프레미스 provider

provider 추상화 범위:
- 연결
- 세션 시작·종료
- 입력 오디오 스트리밍
- 출력 오디오 스트리밍
- 언어 설정
- 세션 재개
- 사용량 계량
- 오류·재시도
- provider 전환
- 비용 추정
- 사용 가능 상태

주의:
- preview API의 세션 제한·가격·기능·SLA는 변경될 수 있다.
- 구현 직전에 공식 문서로 다시 확인한다.
- 자동 provider 전환은 중복 과금과 중복 송출을 막아야 한다.
- retry·resume·idempotency 정책은 별도 고위험 설계가 필요하다.


================================================================================
9. Windows 오디오 드라이버 전략
================================================================================

현재 상태:
- EV 코드서명 인증서 확보 완료
- USB 토큰 기반
- 기존 자체 가상 오디오 드라이버가 존재
- 초기 개발 시점에 제작되어 간헐적 동작 실패 경험이 있음
- Code 52 또는 서명 신뢰 문제가 원인일 가능성을 검토 중

확정 방향:
- EV 인증서만으로 최신 Windows 커널 신뢰를 직접 완성한다고 가정하지 않는다.
- Microsoft Hardware Dev Center / Partner Center 제출 경로를 검토한다.
- 사용자 직접 설치형 제품은 Attestation Signing을 우선 검토한다.
- 최신 Windows 정책은 제출 직전에 공식 문서로 재검증한다.

필요 검증:
1. 드라이버 INF / SYS / PDB 패키징
2. CAB 생성과 제출 서명
3. Microsoft 서명 결과물 다운로드
4. Windows 11 24H2 이상 실제 로드
5. Code 52 발생 여부
6. 설치·재부팅·제거·재설치
7. Discord·Zoom·Teams에서 장치 인식
8. 60분 이상 장시간 오디오 안정성
9. 장치 기본값 변경 시 복구
10. 앱 종료·크래시 후 오디오 경로 원복

Virtual Microphone:
- TalkSync 영어 번역 음성을 회의 앱에 마이크처럼 전달

Virtual Speaker 또는 캡처 계층:
- 상대방 앱 오디오를 TalkSync가 캡처
- 사용자의 실제 출력 장치로 원음 또는 번역음을 전달

장기적으로 상용 가상 오디오 SDK 구매도 검토할 수 있다.

판단 기준:
- 자체 드라이버 유지보수 비용
- BSOD·레이스·오디오 버퍼 리스크
- 드라이버 서명·Windows 업데이트 대응
- SDK 사용료
- 장치 브랜드와 설치 UX 통제 가능성


================================================================================
10. 지연시간은 제품 존폐 기준
================================================================================

지연은 단순 최적화 항목이 아니다.

특히 Full Voice Replacement는 양방향에서 처리 지연이 발생하고,
상대방 응답과 번역 음성이 겹치면 자연 대화가 무너질 수 있다.

현재 벤치마크 목표값:

[Rx 한국어 자막]
- 목표: P95 2초 이내
- 차단 검토: P95 3.5초 초과

[Tx 영어 음성 시작]
- 목표: 발화 종료 후 P95 3초 이내
- 차단 검토: P95 5초 초과

[TTS]
- Real-Time Factor 1.0 미만

[품질]
- 핵심 대화 샘플 의미 보존: 사람 평가 4/5 이상
- 치명적 오역률: 3% 이하
- 환각·문장 누락 별도 측정

[안정성]
- 60분 연속 실행 중 크래시 없음
- 오디오 루프 없음
- 메모리 증가가 통제 범위
- 장치 연결 해제 후 복구 가능

이 수치는 초기 POC 판정 기준이며 실제 사용자 테스트 후 조정할 수 있다.

자연스러운 양방향 대화가 불가능할 정도의 지연이 확인되면:
- Full Voice Replacement를 무리하게 약속하지 않는다.
- Rx 자막·보조 청취와 Safe Push-to-Talk 중심으로 제품 포지션을 조정한다.


================================================================================
11. 멀티 스피커·에코·재번역 위험
================================================================================

반드시 검토할 기술 위험:

1. Discord·게임 채널의 여러 화자가 동시에 말하는 경우
2. 화자 분리와 화자별 자막 연결
3. TTS가 다시 ASR에 입력되는 자기 인식
4. 상대방 음성 → 번역 음성 → 다시 캡처되는 루프
5. 상대방도 통역기를 사용할 때 번역-of-번역 발생
6. 시스템 기본 장치가 변경될 때 라우팅 붕괴
7. 이어폰 연결 해제 시 스피커로 원음·번역음 누출
8. 앱이 자식 프로세스로 오디오 세션을 새로 만드는 경우
9. 회의 앱 자체 AEC와 TalkSync 라우팅 간 충돌

필수 원칙:
- 입력·출력 장치와 세션을 명시적으로 구분
- 동일 TalkSync 출력의 재입력 차단
- TTS 오디오에 내부 세션 식별자 또는 라우팅 격리 적용
- 긴급 정지 버튼 제공
- 앱 종료 시 원래 장치로 안전 복구


================================================================================
12. 보안·법적·동의 기준
================================================================================

상용화 전에 반드시 별도 정책 검토가 필요하다.

검토 대상:
- 타인 음성 캡처와 번역
- 합성 음성 주입
- 통화·회의 참가자의 고지와 동의
- 국가·지역별 녹음 및 감청 관련 법률
- 음성의 개인정보·생체정보 취급 가능성
- Discord·Zoom·Teams 등 플랫폼 약관
- AI 음성 고지
- 저장 여부와 보관 기간
- 오류 로그에 원문 음성이 포함되는지 여부
- Managed API가 외부 provider로 음성을 전송한다는 고지

현재 제품 원칙:
- voice cloning은 기본 기능으로 제공하지 않음
- 타인의 음성을 참조 음성으로 사용하지 않음
- 음성 저장은 기본 전제로 두지 않음
- 필요 없는 원본 오디오를 서버로 업로드하지 않음
- Managed API는 외부 provider 전송 사실을 명시
- AI 합성 음성임을 적절한 UI와 정책으로 고지
- SynthID 같은 기술적 표식만으로 법적 동의를 대체하지 않음


================================================================================
13. 출시 및 개발 순서
================================================================================

현재 권장 순서:

Phase 1 — Browser Tab Live Translate Rx MVP
- 상태: 완료
- 브라우저 탭/창 오디오 캡처 완료
- Gemini 3.5 Live Translate 연결 완료
- generationConfig.translationConfig.targetLanguageCode 정합 완료
- 내가 들을 언어 기준 Rx 음성 출력 smoke PASS
- 드라이버 없이 Browser Tab Rx 사용 가능

남은 후속:
- Rx 자막 패널 고도화
- 원어 볼륨 조절
- 세션 기록/다운로드
- 장시간 안정성 테스트

Phase 2 — Driver Attestation + Code 52 해소
- 상태: 진행 중
- attestation readiness pipeline 완료
  (ORCA-TALKSYNC-DRIVER-ATTESTATION-READINESS-PIPELINE-1,
   app main commit b507fb8, 판정 PASS_WITH_WARNINGS)
- 제출 후보 INF+SYS+talksync.cat 패키지 준비 완료
  경로: C:\Users\user\Desktop\TalkSync_Driver\package_attestation_ready_20260718
- HW ID Root\talksync_TalkSyncAudio / service TalkSyncAudio
- endpoints: TalkSync Virtual Speaker (Rx), TalkSync Virtual Microphone (Tx)
- current signer: WDKTestCert (dev) — Code 52 미해소
- EV signing / Hardware Dev Center attestation 제출은 사람 승인 게이트
- Microsoft-signed package 수령 후 clean VM smoke 예정
- driver tree local-only: TabletAudioSample.vcxproj B3 packaging fix
  (app repo 밖; samples 별도 git 관리)

Phase 3 — Free Local Asymmetric Benchmark
- 상태: 보류 (드라이버 제출 게이트 이후)
- Direct / Lite / Quality 후보 비교
- CPU·GPU 환경 비교
- 번역·TTS·자막 지연 측정
- 라이선스 manifest 작성

Phase 4 — Free Closed Alpha
- Safe Push-to-Talk 중심
- 실제 한국어 사용자 테스트
- 회의·Discord·게임 상황별 피드백
- 오역·지연·장시간 안정성 측정

Phase 5 — Free 공개 출시
- Local Relay로 명확히 포지셔닝
- 지원 PC 사양과 제한 고지
- 자동 업데이트·오류 보고 체계 검토

Phase 6 — Pro BYOK
- 사용자 API 키 연결
- 고품질 양방향 음성 통역
- provider abstraction 검증

Phase 7 — Pro Managed
- 서버 프록시
- 사용자별 계량
- 원화 예산·세션 제한
- 과금·환불·악용 방지
- 공식 provider 상업 사용 조건 확인

Phase 8 — Target App Mode
- 데스크톱 앱별 오디오 캡처
- 앱·프로세스 선택 UX
- Discord·Zoom·Teams 검증

Phase 9 — Full Voice Replacement
- Virtual Speaker + Virtual Microphone
- 원본 음성 대체
- 양방향 에코·턴테이킹
- 최종 제품화 판단
  (Code 52 해소·clean VM smoke·종단 지연 검증 이후)


================================================================================
14. 현재 확정된 것과 미확정인 것
================================================================================

[확정]

- Free v1은 비대칭 로컬 통역이다.
- Tx는 한국어 → 영어 AI 음성 송출이다.
- Rx는 영어 원음 + 한국어 자막이다.
- Free 기본 모드는 Safe Push-to-Talk다.
- Live Mode는 Experimental/Beta다.
- Free에서 사용자 voice cloning을 제공하지 않는다.
- TalkSync가 권리를 확보한 고정 중립 영어 음성을 사용한다.
- 한국어 TTS는 Free v1 기본값에서 제외한다.
- Free는 저품질 Pro가 아니라 로컬·무료·프라이버시 상품이다.
- Pro는 BYOK와 Managed 선택지를 둔다.
- Managed에는 시간·예산·자동 중지 안전장치가 필요하다.
- Argos Translate를 기본 엔진으로 사전 확정하지 않는다.
- 비상업 모델 가중치를 제품에 포함하지 않는다.
- provider 추상화를 둔다.
- 드라이버는 제품 해자이며 조기 실증이 필요하다.


[미확정]

- Free Lite 최종 ASR
- Free Lite 최종 번역 모델
- Free Quality 최종 ASR
- Hy-MT2의 한국어 대화체 실제 품질
- Kokoro와 Chatterbox-Turbo의 실제 Windows 지연
- CPU 전용 지원 최소 사양
- GPU Quality 모드 최소 VRAM
- 최종 설치 용량
- Virtual Microphone 종단 지연
- 60분 이상 장시간 안정성
- 한국어 TTS Experimental 채택 여부
- Gemini·OpenAI 등 최종 Pro provider
- Pro Managed 가격
- Enterprise 온프레미스 범위
- 기존 자체 드라이버 재사용 또는 상용 SDK 구매 여부


================================================================================
15. 보호 경계
================================================================================

- 벤치마크 전 특정 엔진을 제품 기본값으로 확정하지 않는다.
- 비상업 모델과 라이선스 불명 모델을 제품에 포함하지 않는다.
- 사용자·타인 음성을 무단 복제하지 않는다.
- 상용 API 출력을 경쟁 모델 학습 데이터로 사용하지 않는다.
- API 키 여러 개로 쿼터를 우회하지 않는다.
- Managed API 키를 클라이언트에 노출하지 않는다.
- 실제 지연 검증 없이 “실시간” 품질을 보장하지 않는다.
- 드라이버 서명·로드 검증 없이 설치 프로그램에 포함하지 않는다.
- 에코·원음 누출·장치 복구 테스트 없이 Full Replacement를 출시하지 않는다.
- 범위를 임의로 확장하지 않는다.
- DB·결제·Auth·저장·삭제 작업은 별도의 고위험 티켓으로 분리한다.
- 구현 AI와 독립 QA AI를 가능하면 분리한다.


================================================================================
16. 티켓 운영 기준
================================================================================

우선순위:
- 다음 티켓의 우선순위와 방향 결정은 ChatGPT 오케스트레이터가 담당한다.
- 사용자가 명시적으로 다른 우선순위를 지정하면 사용자 지시를 우선한다.
- 한 번에 다음 티켓 하나만 발행한다.

일반 ChatGPT 티켓:
- 필요 시 담당 AI와 작업 강도를 명시한다.
- 조사/구현/QA/commit/push/smoke를 분리할 수 있다.
- QA는 가능하면 독립 read-only로 수행한다.
- commit/push는 selective staging 기준으로 수행한다.
- git add -A 금지.

Orca 오케스트레이션 티켓:
- AI 역할별 담당자를 티켓에 명시하지 않는다.
- Orca Orchestration Skill이 조사/구현/QA/commit/push/smoke를 자동 분리한다.
- ChatGPT는 목표, 범위, 보호 경계, phase, PASS/FAIL 기준, 최종 보고 형식만 작성한다.
- EV PIN, EV signing, HDC 제출, 드라이버 설치/제거, bcdedit 변경은 자동 실행하지 않는다.

공통 보호:
- API key, EV PIN, service_role 등 secret은 묻거나 기록하지 않는다.
- DB/Auth/결제/드라이버/서명/삭제 작업은 고위험으로 분리한다.
- production 또는 driver store 변경은 명시 승인 없이는 수행하지 않는다.
- 범위 외 변경이 발생하면 즉시 중단하고 보고한다.


================================================================================
17. 현재 작업 상태
================================================================================

결과:
PASS_WITH_PENDING

Git 상태:
- app repo: C:\Users\user\Desktop\AI 툴\수익화프로젝트\talksync
- branch: main
- HEAD == origin/main
- latest HEAD: b507fb88a32c9a0b873ce66167fde25a427da2c9
  (chore: TalkSync 드라이버 attestation 제출 준비)
- tracked product code diff: 없음
- 잔여 문서/미추적 항목은 별도 범위로 관리
  (예: docs/qa-isolation-hard-gate-report.md dirty,
   docs/project-structure-report.md, .codex/, UpdateAudioDriver.bat, scratch/)

완료:
- Supabase/Auth/API key 저장
- Gemini 3.5 Live Translate 모델 적용
- Browser Tab Audio Capture
- Browser Tab Live Translate Rx 구현
- Gemini Live v1beta WebSocket 정합
- generationConfig.translationConfig.targetLanguageCode 반영
- Browser Tab Rx 사람 smoke PASS
- Browser Tab Rx commit/push 완료
- VirtualCableGuard dead code cleanup 완료
- VB-CABLE A/B endpoint Windows OK 확인
- Driver attestation readiness pipeline 완료
  (ORCA-TALKSYNC-DRIVER-ATTESTATION-READINESS-PIPELINE-1)
- driver readiness docs/checklist/smoke/QA report main push 완료 (b507fb8)
- package readiness smoke PASS
- submission readiness docs/checklist PASS
- prepare-attestation-package.ps1 M1/M2 ship 전 수정 완료

현재 미해결:
- TalkSync 자체 드라이버 Code 52 / Error / Unknown
- current driver signer는 WDKTestCert (개발용)
- EV signing 미수행
- Hardware Dev Center attestation 제출 미수행
- Microsoft-signed package 미수령
- clean VM 설치 smoke 미수행
- Full Voice Replacement 실제 종단 smoke 미완료
- Virtual Microphone Tx 종단 지연 미측정
- Free Local 엔진 Windows 벤치마크 미수행

남은 warnings (attestation readiness):
- M3 OPEN: staged package_manifest.json 부가 필드 vs script 생성 스키마 차이
- M4 OPEN: InfVerif/ApiValidator 비활성 및 /FORCE:MULTIPLE로 로컬 InfVerif 미통과 가능

driver tree local-only (app repo 밖):
- source: C:\Users\user\Desktop\TalkSync_Driver\Windows-driver-samples\audio\sysvad
- TabletAudioSample.vcxproj B3 packaging fix (Extension/Apo 제외)
- package: package_attestation_ready_20260718 (INF+SYS+talksync.cat)
- samples 별도 git tree면 별도 관리 필요

현재 판단:
- VB-CABLE은 임시 fallback 또는 진단용으로 유지
- 우선순위는 TalkSync 자체 드라이버 EV signing + HDC attestation 제출
- Free Local Benchmark는 드라이버 제출 게이트 이후로 보류


================================================================================
18. 다음 티켓 — 하나만 실행
================================================================================

HUMAN-TALKSYNC-DRIVER-EV-SIGN-AND-HDC-SUBMISSION-1

[목표]
사람이 EV USB token/PIN을 직접 관리하면서 TalkSync attestation-ready
driver package를 EV 서명하고, Microsoft Hardware Dev Center attestation
제출을 진행한다.
Orca/AI는 준비 문서와 체크리스트 안내만 보조하고 PIN을 묻거나 기록하지 않는다.
실제 제출 후 Microsoft-signed package 수령 여부를 확인한다.

참고 문서:
- docs/talksync/driver-attestation-submission-checklist.md
- docs/talksync/driver-attestation-readiness.md
- package: C:\Users\user\Desktop\TalkSync_Driver\package_attestation_ready_20260718

사람 승인 필요:
1. EV USB token 연결
2. EV PIN 입력
3. EV signing 실행
4. HDC attestation submission
5. Microsoft-signed package 다운로드
6. 제출 실패 시 에러 로그 공유 범위 결정

자동 실행 금지:
- EV PIN 요청/기록
- 사용자를 대신한 HDC 제출
- 현재 PC 드라이버 설치/제거
- pnputil/devcon/bcdedit
- Secure Boot/Test Mode 변경

PASS 후 다음 티켓:
SMOKE-TALKSYNC-MICROSOFT-SIGNED-DRIVER-CLEAN-VM-1

BLOCKED/PARTIAL 후 다음 티켓:
FIX-TALKSYNC-DRIVER-ATTESTATION-BLOCKERS-1

(보류) Free Local Bench는 드라이버 제출 게이트 이후:
SPIKE-TALKSYNC-FREE-LOCAL-ASYMMETRIC-BENCH-1


================================================================================
19. 복원용 최종 요약
================================================================================

현재 TalkSync는 Browser Tab Live Translate Rx MVP를 완료했다.
브라우저 탭/창 오디오를 Gemini 3.5 Live Translate로 보내고,
내가 들을 언어로 AI 음성을 듣는 경로가 구현·검증·push됐다.

제품 해자는 번역 모델이 아니라:
- Windows 앱별 오디오 라우팅
- Virtual Mic/Speaker
- 에코·지연 제어
- 용어집·보정 계층
이다.

다음 병목은 Tx/Full Voice를 위한 TalkSync 자체 Virtual Microphone/Speaker다.
attestation-ready package(INF+SYS+talksync.cat)는 준비됐고
app main에 readiness docs가 push됐다(b507fb8).
그러나 Code 52는 아직 해소되지 않았다.
해소 판단은 EV signing + Microsoft Hardware Dev Center attestation
+ clean VM smoke 이후다.

Free v1 제품 포지션(비대칭 로컬 통역, Safe PTT, 고정 영어 음성)은
유지하되, Free Local Benchmark 실행은 드라이버 제출 게이트 뒤로 미룬다.

다음 작업은 Free Local Benchmark가 아니라:
HUMAN-TALKSYNC-DRIVER-EV-SIGN-AND-HDC-SUBMISSION-1
이다.
================================================================================
