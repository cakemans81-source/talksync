# TalkSync M1 벤치 하네스

로컬 스트리밍 ASR(sherpa-onnx)과 MT(llama.cpp)를 같은 조건에서 비교하기 위한 스캐폴드.
측정: 자막 지연(P95 <= 2 s, 블록 임계 3.5 s), WER/CER, chrF(MT 품질 대리 지표), CPU/RSS.
의존성 없음(Node 22 ESM, `node:test`). 실제 엔진은 어댑터로 꽂는다.

## 구조

```
tools/bench/
  run.mjs                 CLI 러너 (runBench도 export)
  make-sample-data.mjs    합성 WAV 생성 (data/sample/*.wav)
  manifests/*.jsonl       데이터셋 매니페스트 (커밋 대상)
  adapters/               types.md(계약), asr-dummy, mt-dummy
  lib/                    manifest, wav, stream, metrics, sysmon, report
  tests/                  node:test
  data/, results/         gitignore (오디오, 실행 결과)
```

## 실행

```
node tools/bench/make-sample-data.mjs          # 샘플 WAV 생성 (최초 1회)
node tools/bench/run.mjs --manifest manifests/sample.jsonl --asr dummy --mt dummy --tgt ko [--fast]
```

옵션: `--chunk-ms 100`, `--out <dir>`, `--data-dir <dir>`, `--asr-opt k=v`, `--mt-opt k=v`(반복 가능), `--final-timeout-ms 10000`.
`--fast`는 1x 페이싱을 끈다(테스트/스모크용). 실제 지연 측정은 반드시 페이싱 켠 상태로.
상대 경로는 cwd 기준, 없으면 `tools/bench/` 기준으로 해석한다. `npm run test:bench`로 테스트.

## 결과

`results/<timestamp>/` (기본값, `--out`으로 변경):
`segments.jsonl`(세그먼트별 원자료), `summary.json`, `summary.md`(언어별 표: n, WER/CER, chrF, L_asr/L_first/L_sub P50/P95, CPU/RSS 피크, 2 s P95 / 3.5 s 판정).
지연 정의와 앵커는 `adapters/types.md` 참고. 백분위는 nearest-rank, chrF는 chrF2(char n=6, beta=2, 공백 제거).

## 데이터셋 매니페스트 추가

JSONL, 한 줄에 세그먼트 하나. 오디오는 `tools/bench/data/` 하위 상대 경로(WAV: PCM16/24/32, float, mono/stereo, 임의 샘플레이트 — 16 kHz mono로 자동 변환).

```json
{"id":"set-001","set":"mydata","lang":"en","audio":"mydata/a.wav","startSec":null,"endSec":null,"refText":"...","refTranslations":{"ko":"...","en":"..."},"license":"CC-BY-4.0","source":"URL 또는 출처"}
```

`startSec/endSec`는 긴 파일에서 구간만 잘라 쓸 때(없으면 null). `refTranslations[tgt]`가 있어야 chrF 계산.
잘못된 줄은 `파일명:줄번호`와 함께 오류로 보고된다. 라이선스가 불분명한 오디오는 `data/`에만 두고 커밋하지 않는다.

## 어댑터 추가

1. `adapters/asr-<name>.mjs` 또는 `adapters/mt-<name>.mjs` 작성 (default export = 어댑터 객체, `adapters/types.md` 계약 준수).
2. `--asr <name>` / `--mt <name>` 으로 실행 (모델 경로 등은 `--asr-opt model=...`).
3. 외부 경로도 가능: `--asr ./path/to/adapter.mjs`.

## M1에서 추가할 것

- 실제 ASR/MT 어댑터 (sherpa-onnx, llama.cpp 등).
- out-of-process 엔진용 CPU/RSS 샘플링 (`lib/sysmon.mjs`의 `probe` 훅, utilityProcess/자식 PID 기준).
- 실데이터 매니페스트(FLEURS 등)와 데이터 다운로드/정리 스크립트.
