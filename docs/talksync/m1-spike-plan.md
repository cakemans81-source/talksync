================================================================================
TALKSYNC — M1 무료 엔진 스파이크 계획 (10/12 ~ 10/23)
================================================================================
기준일: 2026-10-02
상태: 준비안 (오너 검토 대상)
상위 문서: docs/talksync/2026-10-roadmap.md (2.3 M1, 3장, 6장 R1·R2·R6·R7, 11장 G1)
           docs/MASTER_CONTEXT.md (6장 후보, 10장 지연 기준, 15장 보호 경계)
표시 규칙: 로드맵과 동일. "(제안)" = 이 문서가 새로 제안하는 값·절차로
           오너 승인 전까지 확정 아님. "(미검증)" = 1차 출처로 확인하지 못함.
           "(확인 필요)" = 스파이크 중 실측·재확인 대상.
범위 밖: 엔진 구현, 대용량 모델 다운로드, git 상태 변경은 이 문서 작성 범위가 아니다.
================================================================================


================================================================================
1. 목표·범위·판정 기준
================================================================================

1.1 목표
--------------------------------------------------------------------------------
- 로컬 오픈소스 Rx 파이프라인(스트리밍 ASR -> 문장 확정 -> MT -> 자막)이
  로드맵 판정 기준을 충족하는지 10/23까지 실측으로 판정한다 (G1).
- Electron 44 utilityProcess + 네이티브 애드온(ADR-005)이 설치 파일까지
  동작하는지 확인한다 (R6).
- 결과로 언어별 등급(A/B/미지원)과 지원 사양을 확정한다.

1.2 범위
--------------------------------------------------------------------------------
포함: Rx만 (상대 음성 -> 사용자 언어 자막). 원문+번역 자막 이벤트까지.
제외: TTS, Tx, 드라이버, 가상 마이크, 유료 트랙, 자막 UI 완성도, 모델 CDN 배포.
후보:
  ASR: Nemotron 3.5 ASR Streaming 0.6B (다국어),
       Nemotron Speech Streaming EN 0.6B (영어),
       Moonshine Streaming (영어, 후순위 — 4.3 참조)
  MT : Gemma 4 E2B-it, Qwen3.5-2B (llama.cpp / node-llama-cpp),
       OPUS-MT 초벌 (CTranslate2 또는 ONNX)
언어쌍 우선순위 (제안):
  P0 en->ko
  P1 ja->ko, zh->ko, de->ko, ko->en
  P2 en->ja / en->zh / en->de (출력 언어 ko/en/ja/zh/de 검증용, 시간 남을 때)

1.3 판정 기준 (로드맵 2.3·11장 G1 그대로)
--------------------------------------------------------------------------------
- 자막 P95 <= 2초 (P95 > 3.5초면 차단 검토)
- 의미 보존 4/5 (사람 평가)
- 치명적 오역 <= 3%
- CPU 점유가 회의 앱을 방해하지 않음
모든 판정은 벤치마크 세트 기준이며, 언어쌍 단위로 판정한다.
판정 하드웨어: 6.6의 "B. 중급 노트북(GPU 없음)" 결과를 기준으로 한다 (제안).
  개발 PC 결과는 상한 참고값으로만 쓴다.

1.4 Go / 범위 축소 / No-Go 루브릭
--------------------------------------------------------------------------------
언어쌍 등급 (등급 정의는 로드맵 5.1):
  A등급: 위 4개 기준 모두 충족.
  B등급: 지연 P95가 2초 초과 3.5초 이하이거나, 의미 보존·치명적 오역 중
         하나가 미달이지만 "실험적" 표시로 노출 가능하다고 오너가 판단 (제안).
         사람 평가자를 확보하지 못한 언어는 최대 B (제안).
  미지원: P95 > 3.5초, 또는 치명적 오역이 기준 미달로 오너가 노출 불가 판단,
          또는 라이선스 미승인.

판정:
  Go       : 판정 하드웨어 CPU 구성에서 en->ko A등급 + P1 중 1개 이상 A등급
             + utilityProcess 설치 파일 동작 + 사용 모델 라이선스 오너 승인.
  범위 축소: Go 조건 중 일부만 충족 — en->ko만 A(P1은 B/미지원), 또는 A등급이
             GPU(Vulkan/CUDA) 구성에서만 성립(GPU 권장 사양), 또는 utilityProcess가
             막혀 대안 (b) sidecar로 M2 전환 필요.
             -> 로드맵 R8 축소 순서(B등급 언어 -> UI 다국어 -> 체험 크레딧) 적용.
  No-Go    : en->ko가 모든 하드웨어·구성에서 A등급 미달, 또는 사용 가능한 ASR
             후보 전부 라이선스 미승인, 또는 애드온·sidecar 모두 설치 파일에서
             동작 불가. -> 로드맵 2.7 B안 (유료 + 가입 체험 크레딧).


================================================================================
2. 라이선스 검증 표 (2026-10-02, 1차 출처 직접 확인)
================================================================================
확인 방법: Hugging Face 모델 카드 YAML·본문·LICENSE 파일, HF 커밋 이력,
GitHub 저장소 LICENSE, npm 레지스트리 메타데이터를 직접 조회.
법률 자문이 아니다. 최종 승인은 오너 + 7장 법률 검토.

2.1 R2 상충 해소 — Nemotron
--------------------------------------------------------------------------------
결론: 두 저장소의 라이선스가 서로 다르며, 상충은 3.5 저장소의 초기 표기
오류에서 생긴 것으로 확인됨.
- nvidia/nemotron-3.5-asr-streaming-0.6b: 2026-06-04 커밋(3d84923842)까지 YAML은
  "nvidia-open-model-license", 본문은 "OpenMDW-1.1"로 불일치. 2026-06-05
  "Update License" 커밋 3건(41defcb14f, ab89ab0ff2, 24b151a851)으로 YAML 정정.
  현재(최신 커밋 2026-09-10) YAML·본문 모두 OpenMDW-1.1,
  "ready for commercial use", Deployment Geography: Global.
- nvidia/nemotron-speech-streaming-en-0.6b
  2025-12 ~ 2026-08 커밋 7개 시점을 확인한 결과 YAML·본문 모두 일관되게
  NVIDIA Open Model License Agreement. OpenMDW 표기는 발견되지 않음.
=> 스파이크·제품에서는 저장소별로 다른 라이선스를 적용하고,
   모델 매니페스트에 커밋 해시를 고정한다 (제안).

2.2 표
--------------------------------------------------------------------------------
[ASR 모델]
1) nvidia/nemotron-3.5-asr-streaming-0.6b — OpenMDW-1.1
   상업 사용: 가능. 사용·수정·배포 제한 없음, 출력물 제한 없음.
   의무: 배포 시 라이선스 사본 + 원 저작권·출처 고지 유지.
   제한: 특허·저작권 소송 제기 시 권리 종료. 지역 제한 없음.
   출처: https://huggingface.co/nvidia/nemotron-3.5-asr-streaming-0.6b
         https://openmdw.ai/license/1-1/
2) nvidia/nemotron-speech-streaming-en-0.6b — NVIDIA Open Model License (2025-10-24판)
   상업 사용: 가능.
   의무: 배포 시 계약서 사본 제공 + "Licensed by NVIDIA Corporation under the
         NVIDIA Open Model License" 고지.
   제한: 안전 가드레일 우회 시 권리 자동 종료, 특허·저작권 소송 시 종료,
         NVIDIA Trustworthy AI 약관 준수, 미국 수출·제재 법규 준수.
   출처: https://huggingface.co/nvidia/nemotron-speech-streaming-en-0.6b
         https://www.nvidia.com/en-us/agreements/enterprise-software/nvidia-open-model-license/
3) Moonshine Streaming (moonshine-ai/moonshine-streaming-tiny/small/medium) — MIT
   상업 사용: 가능. 의무: MIT 고지 유지.
   주의: 저장소 LICENSE상 영어 외 "레거시 비스트리밍" 모델
         (ar/ja/ko/zh/uk/vi Base·Tiny, es Base)은 비상업 Moonshine Community
         License. sherpa-onnx가 배포하는 sherpa-onnx-moonshine-base-ko/ja/zh 등은
         이 범주이므로 사용 금지 (MASTER_CONTEXT 15장).
   출처: https://github.com/moonshine-ai/moonshine/blob/main/LICENSE
         https://huggingface.co/moonshine-ai/moonshine-streaming-medium

[런타임] 모두 상업 사용 가능, 의무 = 라이선스 고지 유지 (Apache는 NOTICE·변경 표시 포함)
4) sherpa-onnx — Apache-2.0 (npm sherpa-onnx-node 1.13.8, 2026-09-10)
   https://github.com/k2-fsa/sherpa-onnx
5) onnxruntime — MIT (sherpa-onnx-win-x64에 onnxruntime.dll 1.28.2 동봉)
   https://github.com/microsoft/onnxruntime
6) node-llama-cpp 3.22.1 (2026-09-28) — MIT (@node-llama-cpp/win-x64* 프리빌드 포함)
   https://github.com/withcatai/node-llama-cpp
7) llama.cpp — MIT   https://github.com/ggml-org/llama.cpp
8) CTranslate2 — MIT, v4.8.2. 공식 Node 바인딩 없음 (npm "ctranslate2" 1.0.0은
   개인 3rd-party, 미검증)   https://github.com/OpenNMT/CTranslate2

[MT 모델]
9) google/gemma-4-E2B-it — Apache-2.0 (Gemma Terms 아님)
   HF YAML license: apache-2.0, gated 아님. Gemma Terms of Use 페이지(2026-04-01)가
   "For Gemma 4 terms, see the Gemma 4 license"로 Gemma 4를 명시적으로 제외.
   의무: Apache-2.0 사본 제공, 수정 파일 변경 표시.
   주의: Gemma Prohibited Use Policy가 Gemma 4에 구속력이 있는지는 문서상
         불명확 (미검증). 번역 용도는 해당 정책과 충돌 소지 낮음.
   출처: https://huggingface.co/google/gemma-4-E2B-it
         https://ai.google.dev/gemma/docs/gemma_4_license
         https://ai.google.dev/gemma/terms
10) Qwen/Qwen3.5-2B — Apache-2.0 (모델명 실존 확인, 저장소 LICENSE 파일 = Apache 2.0)
    201개 언어·방언 지원 표기, 기본 non-thinking 모드. 의무: Apache-2.0 고지.
    출처: https://huggingface.co/Qwen/Qwen3.5-2B/blob/main/LICENSE
11) OPUS-MT (Helsinki-NLP) — 모델별 상이
    opus-mt-tc-big-en-ko / tc-big-ko-en : CC-BY-4.0
    opus-mt-ja-en, opus-mt-de-en, opus-mt-mul-en, opus-mt-en-zh : Apache-2.0
    opus-mt-zh-en, opus-mt-en-de : CC-BY-4.0
    상업 사용: 가능. CC-BY-4.0은 저작자 표시 + 라이선스 링크 + 변경 표시
    (CT2/ONNX 변환도 변경으로 표시) 필요.
    중요: ja->ko, zh->ko, de->ko 직접 모델은 Helsinki-NLP에 없음.
          en 피벗(X->en->ko, 2단 번역) 또는 opus-mt-tc-bible-big-mul-mul
          (Apache-2.0, 카드에 "많은 언어쌍에서 동작하지 않을 수 있음" 명시)만 가능.
    주의: HF 3rd-party CT2 변환본(ooeoeo/...-ct2-float16)은 원본 CC-BY-4.0을
          apache-2.0으로 잘못 표기 -> 3rd-party 변환본 사용 금지, 직접 변환 (제안).
    출처: https://huggingface.co/Helsinki-NLP/opus-mt-tc-big-en-ko
          https://huggingface.co/Helsinki-NLP/opus-mt-tc-bible-big-mul-mul

2.3 오너 승인 요청 항목 (10/12 전)
--------------------------------------------------------------------------------
[ ] NVIDIA Open Model License 수용 (EN 모델 사용 시: 가드레일·Trustworthy AI·
    수출 조항 포함). 거부 시 영어도 Nemotron 3.5(OpenMDW)로 대체.
[ ] OpenMDW-1.1, Apache-2.0, MIT, CC-BY-4.0 고지 의무를 오픈소스 고지 화면
    (로드맵 7장)에 반영.
[ ] 모델 재배포(자사 CDN) 시 각 라이선스 사본 동봉 — 로드맵 3.4 매니페스트에
    license 필드 + 고정 커밋 해시.


================================================================================
3. Electron 44 통합 가능성
================================================================================
환경: electron 44.5.1 = Node 24.21.0, Chromium 152, NODE_MODULE_VERSION 149
(https://releases.electronjs.org/releases.json).

3.1 sherpa-onnx-node (ASR)
--------------------------------------------------------------------------------
- 프리빌드: sherpa-onnx-win-x64 1.13.8 (unpacked 23.5MB): sherpa-onnx.node(0.7MB),
  sherpa-onnx-c-api.dll(4.6MB), onnxruntime.dll(17.8MB), providers_shared.dll.
- ABI: sherpa-onnx.node가 napi_* 심볼 62개를 쓰는 N-API 애드온임을 바이너리에서
  확인 -> Electron 재빌드 불필요 추정 (실제 로드는 확인 필요).
- 모델 지원: 1.13.8 C API에 OnlineRecognizerTransducerNeMoImpl,
  GetLanguagePromptId 존재. JS streaming-asr.js의 setOption('language', ...)으로
  스트림별 언어 지정, 미지정 시 자동 감지. 변경 이력: "Add multilingual
  Nemotron-3.5 streaming ASR support (#3671)".
  Moonshine은 OfflineRecognizer(Moonshine v2)로만 존재 — 온라인 스트리밍 아님.
- 변환 모델(csukuangfj2/sherpa-onnx-nemotron-*-int8, 청크 80/160/560/1120ms 별도):
  3.5 다국어 int8 합계 약 682MB, EN int8 합계 약 662MB.
- Electron 주의:
  a) V8 메모리 케이지(Electron 21+)로 외부 ArrayBuffer 금지 ->
     "External buffers are not allowed" 오류 사례 (issue #3108).
     enableExternalBuffer=false 인자 사용 필요.
     https://www.electronjs.org/blog/v8-memory-cage
     https://github.com/k2-fsa/sherpa-onnx/issues/3108
  b) 패키징 후 "Could not find sherpa-onnx-node" 사례 (#1945, #2866) —
     addon.js가 ../sherpa-onnx-win-x64/sherpa-onnx.node 상대 경로로 로드하므로
     두 패키지를 같은 node_modules 레벨로 asarUnpack 해야 함.
- GPU: c-api에 CUDA/DirectML provider 분기 문자열 존재하나 npm 기본 빌드가
  GPU EP를 포함하는지는 미검증. ASR은 CPU 전제로 측정한다.

3.2 node-llama-cpp (MT)
--------------------------------------------------------------------------------
- 프리빌드 (3.22.1, MIT): @node-llama-cpp/win-x64 (CPU, unpacked 30.7MB),
  win-x64-vulkan (74.3MB), win-x64-cuda (176.1MB), win-x64-cuda-ext (368.0MB).
  engines node >= 20, "type": "module" (ESM 전용).
- CUDA: 공식 문서상 CUDA Toolkit 12.4+/13.1+ 대응 프리빌드, NVIDIA 드라이버 필요.
  일반 사용자 배포는 Vulkan 우선, CUDA는 선택 (제안).
  https://node-llama-cpp.withcat.ai/guide/CUDA
- Electron 문서: "main process에서만 사용 가능, renderer에서는 크래시",
  utilityProcess 언급 없음. asar에 네이티브 바이너리를 넣지 말 것,
  번들러로 묶지 말 것(외부 모듈), asar 내부에서는 소스 빌드 비활성.
  https://node-llama-cpp.withcat.ai/guide/electron
- 근거: Electron 공식 조직의 @electron/llm이 node-llama-cpp를 utility process에
  로드하는 참조 구현을 제공 (https://github.com/electron/llm).
  -> utilityProcess 동작 가능성 높음, 실측으로 확정 (확인 필요).
- 모듈 형식 충돌: electron/tsconfig.json이 module: commonjs라 tsc가
  import()를 require()로 바꿀 수 있음. 엔진 진입점은 별도 .mjs로 둔다 (제안).
- 모델 아키텍처 지원: 3.22.1에 번들된 llama.cpp가 Gemma 4 / Qwen3.5 GGUF를
  로드하는지 확인 필요 (unsloth GGUF가 존재하므로 llama.cpp 본체는 지원 추정).

3.3 utilityProcess·패키징 체크
--------------------------------------------------------------------------------
- utilityProcess는 Node + MessagePort 환경 (MessagePortMain 전달 지원).
  https://www.electronjs.org/docs/latest/api/utility-process
- 현재 package.json build 설정은 "!**/node_modules/**"로 node_modules를 제외하고
  npmRebuild: false. 엔진 애드온을 넣으려면 files 예외 + asarUnpack 필요:
    sherpa-onnx-node, sherpa-onnx-win-x64, node-llama-cpp, @node-llama-cpp/win-x64*
  (스파이크 브랜치에서만 시험, main 반영은 M2 — 제안)
- 설치 크기 추정 (unpacked): sherpa-onnx 23.5MB + node-llama-cpp 본체 39.6MB
  + win-x64 30.7MB = 약 94MB, Vulkan 추가 시 +74MB. 모델 별도.
- 서명: asarUnpack된 .node/.dll도 EV 서명 대상 (scripts/sign-win.ps1 범위 확인).

3.4 실패 시 대안 (로드맵 3.1)
--------------------------------------------------------------------------------
utilityProcess 로드 실패 -> (1) child_process.fork + ELECTRON_RUN_AS_NODE 시험
-> (2) 대안 (b) 네이티브 sidecar: NVIDIA NeMo-Speech.cpp (Apache-2.0, GGUF q8_0
Nemotron 지원 — 모델 카드 안내) 또는 sherpa-onnx C API exe + llama-server.
sidecar 전환 여부는 10/16 중간 점검에서 결정.


================================================================================
4. 벤치마크 데이터셋 계획
================================================================================
원칙:
- 평가용 로컬 사용. 저장소에는 오디오를 절대 커밋하지 않는다.
  커밋 대상: 매니페스트(JSONL) + 다운로드 절차 문서뿐.
- 비상업(NC) 라이선스 데이터는 사내 평가라도 사용하지 않는다
  (상업 제품 개발 목적 평가이므로 MASTER_CONTEXT 6.6 취지 적용, 제안).
- 목표 분량: 언어별 10~20분 (로드맵). 사람 평가용 100구간/언어쌍 (제안).

4.1 (a) 영어 회의 음성 — AMI Meeting Corpus
--------------------------------------------------------------------------------
- 라이선스: CC BY 4.0 (공식 라이선스 페이지 확인)
  https://groups.inf.ed.ac.uk/ami/corpus/license.shtml
  HF: https://huggingface.co/datasets/edinburghcstr/ami (cc-by-4.0, ihm/sdm 구성)
- 사용: test 분할 회의 2~3개에서 15분 발췌. ihm(헤드셋) + sdm(원거리 단일 마이크)
  각각 측정. 화자 겹침 구간 표시.
- ko 참조 번역 없음 -> 사람 평가 100구간만 오너가 ko 참조 작성 (제안).
  상용 API 번역을 참조로 쓰지 않는다 (편향 방지, 제안).

4.2 (b) 다국어 + ko 참조 — FLEURS (+ FLORES)
--------------------------------------------------------------------------------
- FLEURS: CC BY 4.0, 102개 언어, FLoRes dev/devtest의 2009개 n-way 병렬 문장 낭독.
  ko_kr, ja_jp, cmn_hans_cn, de_de, en_us 구성 존재.
  https://huggingface.co/datasets/google/fleurs
- ko 참조: 같은 문장의 ko_kr 전사(raw_transcription)를 참조 번역으로 사용.
  문장 대응 키는 id 필드로 추정 (미검증 — 하네스에서 en 전사 일치로 검증).
- FLORES+ (openlanguagedata/flores_plus): CC BY-SA 4.0, gated(auto).
  텍스트 참조 보강용. SA 조건 때문에 FLORES+ 텍스트는 저장소 매니페스트에
  넣지 않고 로컬 생성 (제안).
- 한계: 낭독체(위키 문장)라 회의 대화보다 낙관적. Nemotron 3.5 카드가 FLEURS로
  평가하므로 test 분할만 사용 (train 오염 가능성).

4.3 (c) ja / zh / de 대화체
--------------------------------------------------------------------------------
상업 OK + 대화체 + ko 참조를 모두 갖춘 공개 세트는 찾지 못함.
- de: facebook/voxpopuli (cc0-1.0, 의회 연설) — ASR WER용.
- zh: AISHELL/AISHELL-1 (HF 표기 apache-2.0, 낭독) — ASR CER용.
  원 배포처 조건은 미검증.
- 다국어: espnet/yodas2 (cc-by-3.0, CC 라이선스 YouTube, 자막 전사라 잡음 많음)
  — 영상별 라이선스 재확인 후 ja/zh/de 각 10분 (선택).
- 제외: facebook/covost2 (cc-by-nc-4.0), ylacombe/expresso (cc-by-nc-4.0),
  reazon-research/reazonspeech (license: other, 조건 미검증 — 법률 확인 전 제외).
=> ja/zh/de 대화체 품질은 4.4 오너 녹음이 핵심. 없으면 해당 언어는 FLEURS만으로
   판정하고 최대 B등급 (제안).

4.4 (d) 오너의 실제 웹 회의 녹음 (로드맵 "실제 웹 회의 녹음")
--------------------------------------------------------------------------------
절차 (제안):
1. 동의: 녹음 전 모든 참가자에게 목적(로컬 번역 엔진 평가), 보관 위치(오너 PC),
   보관 기간(M1 종료 + 30일), 삭제 방법을 고지하고 구두 또는 채팅으로 동의 기록.
   동의하지 않은 참가자가 있으면 녹음하지 않는다.
2. 수집: TalkSync 탭 오디오 캡처 경로 또는 OS 녹음으로 16kHz mono WAV.
   en 최소 15분, 가능한 ja/zh/de 각 10분.
3. 개인정보: 이름·회사·연락처 등 제3자 PII는 참조 전사에서 [NAME] 등으로 치환.
   원본 오디오는 tools/bench/data/local/ 에만 저장 (gitignore),
   클라우드 동기화 폴더·외부 전송 금지. 상용 API로 전사·번역하지 않는다.
4. 매니페스트: tools/bench/manifests/local-*.jsonl 로 이름 짓고 gitignore 대상 (제안).
   license 필드는 "owner-consented-internal".
5. 삭제: 보관 기한 도래 시 오디오·local 매니페스트·결과 파일 삭제, 삭제 일자를
   결과 보고에 기록.

4.5 분량 목표 (제안)
--------------------------------------------------------------------------------
언어   공개 세트                         오너 녹음   합계 목표
en     AMI 15분 + FLEURS 10분              15분       40분
ja     FLEURS 15분 (+YODAS2 10분)          10분       25~35분
zh     FLEURS 15분 + AISHELL-1 5분         10분       20~30분
de     FLEURS 15분 + VoxPopuli 5분         10분       20~30분
ko     FLEURS 15분 (ko->en 소스)           선택       15분


================================================================================
5. 매니페스트 형식 (하네스 계약 — 그대로 채택)
================================================================================
위치: tools/bench/manifests/<set>.jsonl   (한 줄 = 한 구간)
오디오: tools/bench/data/ (gitignore)      결과: tools/bench/results/ (gitignore)

{"id": string, "set": string, "lang": "en"|"ja"|"zh"|"de"|"ko"|...,
 "audio": "tools/bench/data/ 아래 상대 경로",
 "startSec": number|null, "endSec": number|null,
 "refText": string,
 "refTranslations": {"ko"?: string, "en"?: string, ...},
 "license": string, "source": string}

규칙:
- startSec/endSec가 null이면 파일 전체가 한 구간.
- endSec는 지연 측정의 "원문 구절 끝" 기준 시각이다 (6.1). 연속 회의 녹음은
  구절 단위로 endSec를 수작업 또는 강제 정렬로 기록한다.
- refTranslations는 있는 언어만. 없으면 chrF 계산에서 제외.
- license 예: "CC-BY-4.0", "CC0-1.0", "owner-consented-internal".
- source 예: "google/fleurs:ko_kr:test", "edinburghcstr/ami:ihm:test".
- 저장소에 커밋하는 매니페스트의 refText는 CC BY/CC0/Apache 세트만 (저작자 표시는
  source·license 필드로). local-*.jsonl은 커밋 금지.
- 필요 .gitignore 추가 (스파이크 시작 시, 제안):
    /tools/bench/data/
    /tools/bench/results/
    /tools/bench/manifests/local-*.jsonl


================================================================================
6. 측정 프로토콜
================================================================================

6.1 지연 정의 (모두 원문 구절 끝 t_end 기준, ms)
--------------------------------------------------------------------------------
t_end      : 매니페스트 endSec를 재생 시계로 환산한 벽시계 시각 (t0 + endSec).
L_asr      : 해당 구절의 확정 ASR 텍스트 이벤트 시각 - t_end
L_mt_first : 해당 구절의 첫 MT 토큰 시각 - t_end
L_sub      : 확정 번역 자막 이벤트 시각 - t_end   <- 판정 KPI ("자막 지연")
보조: 부분(처리 중) 자막 최초 표시 시각, OPUS-MT 초벌 표시 시각도 기록.
구절과 이벤트 대응: 확정 ASR 구간의 오디오 시간 범위가 매니페스트 구간과
가장 많이 겹치는 것으로 매칭. 미매칭(누락)·중복은 별도 집계.
문장 확정 규칙은 로드맵 3.2 그대로 (ASR 끝점 / 침묵 >= 0.5초 / 최대 8초).
침묵 0.5초 대기도 L_sub에 포함됨을 결과에 명시한다.

6.2 실시간 스트리밍 시뮬레이션
--------------------------------------------------------------------------------
- 16kHz mono PCM16을 1배속으로 20~100ms 청크 단위 주입. 기본 40ms (제안),
  20ms·100ms로 민감도 확인.
- 청크 i는 t0 + i*청크길이에 주입 (monotonic 시계, performance.now /
  process.hrtime). 주입 지연이 누적되면 경고 기록.
- 구간 사이 무음은 원본 그대로 유지 (연속 녹음). FLEURS 단일 발화는 앞뒤 1초
  무음을 붙여 이어 붙인 세션 파일로 재생 (제안).
- 모델 로드·워밍업(첫 30초)은 별도 보고하고 P95 집계에서 제외 (제안).
- ASR 청크 크기 160ms / 560ms 두 설정 측정 (모델 카드상 80/160/560/1120ms).

6.3 통계
--------------------------------------------------------------------------------
- 언어쌍 × 구성(ASR 청크, MT 모델, CPU/Vulkan/CUDA) × 하드웨어별
  P50·P95·최대, 표본 수 n, 누락률.
- 백분위수: nearest-rank 방식 (정렬 후 ceil(p*n)번째) (제안).
- P95 판정에는 언어쌍당 n >= 100 구절 필요 (제안). 미달 시 "참고값" 표기.

6.4 CPU·RAM 샘플링
--------------------------------------------------------------------------------
- 500ms 간격 (제안): 엔진 프로세스 CPU%(논리 코어 합 기준)·작업 집합 메모리,
  시스템 전체 CPU%, 가용 RAM. Electron 내부에서는 app.getAppMetrics(),
  단독 Node 하네스는 Windows 성능 카운터.
- "회의 앱 방해 없음" 운영 정의 (제안 — 오너 승인 필요):
  1) 실제 브라우저 화상회의(카메라 켬)와 동시 실행 15분,
  2) 시스템 CPU P95 <= 85%, 엔진 프로세스 평균 <= 논리 코어의 50%,
  3) 회의 앱 음성 끊김·영상 정지가 체감되지 않음 (오너 체크리스트),
  4) ASR 실시간 계수 < 1 유지 (백로그 증가 없음).
- 60분 장기 안정성은 M2 범위. M1은 15분 연속에서 메모리 단조 증가 여부만 본다.

6.5 품질 지표
--------------------------------------------------------------------------------
- ASR: en/de는 WER, ja/zh/ko는 CER. 정규화 = 소문자화, 구두점 제거,
  전각·반각 통일, 숫자 표기는 참조 기준 유지 (제안). 도구는 jiwer 등 (제안).
- MT 자동 지표: chrF (sacreBLEU chrF2 등, 제안) — refTranslations가 있는 구간만.
  캐스케이드 결과(ASR 오류 포함)와 참조 원문 입력(텍스트 MT 단독)을 둘 다 계산.
- 사람 평가 (제안): 언어쌍당 고정 표본 100구간 (층화 추출, 시드 고정),
  시스템 이름을 가린 블라인드, 1~5점:
    5 의미 완전 보존 / 4 사소한 누락·어색함, 의미 동일 /
    3 일부 의미 손실, 대략 이해 가능 / 2 핵심 의미 왜곡 / 1 무관·이해 불가
  판정: 평균 >= 4.0 (로드맵 "4/5"의 해석, 제안).
- 치명적 오역 태깅 (제안 규칙): 한 구간에 아래 중 하나라도 있으면 치명적.
  부정·긍정 반전 / 숫자·날짜·시간·금액·단위 오류 / 고유명사·사람·주체 뒤바뀜 /
  원문에 없는 사실·약속·결정 추가(환각) / 핵심 요청·결정 누락 /
  원문에 없는 욕설·모욕. 비율 = 치명 구간 수 / 평가 구간 수, 기준 <= 3%.
  누락·환각은 MASTER_CONTEXT 10장에 따라 별도 집계도 한다.

6.6 하드웨어 매트릭스
--------------------------------------------------------------------------------
A. 오너 개발 PC (조회 확인): Intel Core i7-14700F 20코어/28스레드, RAM 64GB,
   NVIDIA GeForce RTX 4060 Ti. 구성: CPU only(스레드 4·8 제한 포함), Vulkan, CUDA.
B. 중급 노트북 4~8코어, RAM 8~16GB, 외장 GPU 없음 — 판정 기준 하드웨어 (제안).
   구성: CPU only, 내장 GPU Vulkan(가능 시).
C. (선택) 저사양 4코어 / RAM 8GB — 지원 사양 "RAM 8GB 이상 권장" 확인용.
기록 항목: CPU 모델·코어/스레드·클럭, RAM 용량·속도, GPU·드라이버 버전,
Windows 빌드, 전원(AC/배터리)·전원 모드, 측정 전 온도/스로틀 여부, 동시 실행 앱,
Electron·sherpa-onnx·node-llama-cpp·onnxruntime 버전, 모델 파일 SHA256·HF 커밋,
스레드 수·청크 크기·양자화.


================================================================================
7. 일정 (10/12 ~ 10/23)
================================================================================

7.1 1주차
--------------------------------------------------------------------------------
10/12 (월) 스파이크 브랜치·.gitignore, 매니페스트 생성(FLEURS/AMI), 하네스 골격,
           모델 다운로드(로컬, 커밋 금지)·SHA256 기록.
           산출: manifests/*.jsonl, 다운로드 절차 문서.
10/13 (화) 순수 Node에서 sherpa-onnx Nemotron 3.5 / EN 스트리밍,
           1배속 시뮬레이션, L_asr·WER/CER (개발 PC).
           (여유 시 Moonshine Streaming 별도 런타임 가능성만 조사)
10/14 (수) node-llama-cpp로 Gemma 4 E2B / Qwen3.5-2B 번역 프롬프트,
           토큰 스트리밍·직전 1~2문장 문맥·프롬프트 캐시. OPUS-MT 런타임
           (CT2 vs ONNX) 결정. 텍스트 MT 단독 chrF·지연.
10/15 (목) 캐스케이드 종단 연결, L_mt_first·L_sub 분해, 청크 160/560ms 비교,
           OPUS-MT 초벌 + LLM 확정 이중 자막 시험.
10/16 (금) Electron 44 utilityProcess + MessagePort 프로토타입,
           NSIS 설치 파일 패키징(asarUnpack) 후 깨끗한 Windows에서 실행.
           중간 점검: 후보 축소, sidecar 전환 여부 결정.
           산출: 중간 결과표 (개발 PC), 패키징 시험 기록.

7.2 2주차
--------------------------------------------------------------------------------
10/19 (월) 중급 노트북 전체 매트릭스 측정 (en, ja, zh, de, ko->en).
10/20 (화) 오너 녹음 세트 측정, 회의 앱 동시 실행 CPU·RAM 시험 (6.4).
10/21 (수) 사람 평가 (언어쌍당 100구간) + 치명적 오역 태깅.
10/22 (목) 집계, 언어 등급안·지원 사양안 작성, 설치 파일 재검증,
           라이선스 고지 초안.
10/23 (금) G1 판정 회의.

7.3 10/23 판정 회의 입력물
--------------------------------------------------------------------------------
1) 언어쌍 × 구성 × 하드웨어 결과표 (L_asr/L_mt_first/L_sub P50·P95, n, 누락률)
2) 품질: WER/CER, chrF, 사람 평가 평균·분포, 치명적 오역률·사례
3) CPU·RAM 결과와 회의 앱 동시 실행 체크리스트
4) 패키징·utilityProcess 결과 (성공/실패, 크기, 대안 필요 여부)
5) 라이선스 승인 상태와 고지 초안
6) 권장 언어 등급표·지원 사양·모델 다운로드 크기
7) 1.4 루브릭에 따른 Go / 범위 축소 / No-Go 권고와 남은 리스크

7.4 오너가 해야 할 일
--------------------------------------------------------------------------------
M0 주간(10/05~10/09)까지:
- 라이선스 승인 (2.3), "회의 앱 방해 없음" 정의 승인 (6.4)
- 회의 녹음 일정·동의 문구(4.4) 준비, ja/zh/de 평가자 확보 여부 확인
스파이크 중:
- 판정용 중급 노트북 제공 (늦어도 10/16), 측정 시 전원·백그라운드 앱 통제
- 동의 받은 회의 녹음 (en 15분 이상, ja/zh/de 가능 분량, 10/16까지) 및 PII 치환 검토
- 사람 평가 (10/21, 약 하루) 또는 언어별 평가자 섭외
- 10/23 판정 승인 (사람 승인 게이트)


================================================================================
8. 스파이크 리스크와 대응
================================================================================
S1  node-llama-cpp가 utilityProcess에서 동작한다는 공식 문서 없음
    (문서는 main process만 언급).
    -> 10/16까지 실측. @electron/llm 참조 구현 활용. 실패 시 3.4 대안.
S2  Electron 메모리 케이지로 sherpa-onnx 외부 버퍼 오류
    -> enableExternalBuffer=false, 오디오는 복사 전달.
S3  패키징: 현재 build 설정이 node_modules 제외 + npmRebuild false
    -> 스파이크에서 files 예외·asarUnpack 시험, 깨끗한 Windows에서 실행 확인.
S4  모델 크기: Gemma 4 E2B Q4 GGUF가 약 3.0~3.35GB (google QAT q4_0 3.35GB,
    unsloth Q4_K_M 3.11GB)로 로드맵 3.4 가정 "MT Q4 ~1.5GB"를 초과.
    Qwen3.5-2B Q4는 약 1.2~1.3GB로 가정과 부합.
    -> RAM 8GB PC 적합성, 다운로드 이탈(R7)을 결과표에 포함. Gemma는 Quality,
       Qwen은 Lite 후보로 분리 평가 (제안).
S5  CPU LLM 지연: 침묵 0.5초 + ASR 청크 + MT 생성이 2초 예산을 잠식
    -> 160ms 청크, 짧은 출력 프롬프트, 프롬프트 캐시, OPUS-MT 초벌 선표시.
S6  OPUS-MT에 ja/zh/de->ko 직접 모델 없음 -> 피벗 2단으로 지연·오류 증가.
    -> OPUS-MT 초벌은 en<->ko 전용으로 한정 검토 (제안).
S7  벤치마크 편향: FLEURS 낭독체·학습 오염 가능성, 오너 녹음 표본 부족(n<100)
    -> test 분할만 사용, n 미달은 참고값, 회의체 결과를 우선 가중.
S8  ja/zh/de 사람 평가자 부족 -> 해당 언어 최대 B등급 (제안).
S9  zh 인식 품질: Nemotron 3.5 카드상 zh-CN은 Broad-coverage 등급,
    FLEURS CER 약 19~22% -> B등급 가능성 높음 (로드맵 5.1과 일치).
S10 node-llama-cpp 3.22.1 번들 llama.cpp의 Gemma 4 / Qwen3.5 아키텍처 지원
    미확인 -> 10/14 첫 작업으로 로드 확인, 실패 시 버전 상향 또는 다른 후보.
S11 Moonshine Streaming은 sherpa-onnx 온라인 API 미지원, 영어 전용
    -> 후순위. 영어는 Nemotron EN/3.5로 판정.
S12 노트북 발열·배터리 모드로 수치 변동 -> AC 전원·전원 모드 고정, 3회 반복 중앙값 (제안).
S13 회의 녹음의 제3자 음성·PII -> 4.4 절차, 로컬 전용, 기한 삭제.
S14 일정: 1인 + AI 에이전트 (R8) -> 10/16 중간 점검에서 P2 언어쌍·Moonshine 제외.


================================================================================
9. 추가 출처 (본문에 인라인으로 적지 않은 것)
================================================================================
https://huggingface.co/api/models/nvidia/nemotron-3.5-asr-streaming-0.6b/commits/main
https://huggingface.co/google/gemma-4-E2B-it-qat-q4_0-gguf
https://huggingface.co/unsloth/gemma-4-E2B-it-GGUF
https://huggingface.co/unsloth/Qwen3.5-2B-GGUF
https://github.com/k2-fsa/sherpa-onnx/blob/master/CHANGELOG.md
https://huggingface.co/csukuangfj2/sherpa-onnx-nemotron-3.5-asr-streaming-0.6b-560ms-int8-2026-06-11
https://www.npmjs.com/package/sherpa-onnx-node , https://www.npmjs.com/package/node-llama-cpp
https://github.com/NVIDIA/NeMo-Speech.cpp
https://huggingface.co/datasets/facebook/voxpopuli
https://huggingface.co/datasets/AISHELL/AISHELL-1
https://huggingface.co/datasets/espnet/yodas2
https://huggingface.co/datasets/facebook/covost2
================================================================================
