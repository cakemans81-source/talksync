# 어댑터 인터페이스 계약

어댑터는 ESM 모듈이며 **default export가 어댑터 객체**다. 시각은 모두 `performance.now()`(ms, 단조 시계) 기준 wall time.
`run.mjs --asr <name|경로> --mt <name|경로>`: `<name>` → `adapters/asr-<name>.mjs` / `adapters/mt-<name>.mjs`, 경로(`./x.mjs`)는 그대로 import.
`--asr-opt k=v`, `--mt-opt k=v` (반복 가능)로 지정한 값이 `init(opts)`에 객체로 전달된다 (숫자/true/false는 자동 변환).

## ASR 어댑터

```ts
interface AsrAdapter {
  name: string;
  init(opts: Record<string, unknown>): Promise<void>;     // 모델 로드. 벤치 시간 밖
  createStream(ctx?: { refText?: string }): AsrStream;    // 세그먼트당 1개. ctx는 더미 전용 힌트
}
interface AsrStream {
  acceptAudio(samples: Float32Array, audioTimeSec: number): void; // 16 kHz mono, audioTimeSec=청크 시작
  flush(): void | Promise<void>;   // 입력 종료. 남은 final을 모두 방출한 뒤 resolve (void면 즉시 완료로 간주)
  onEvent(cb: (e: AsrEvent) => void): void;
}
type AsrEvent = { type: 'partial' | 'final'; text: string; audioTimeSec: number; wallTimeMs: number };
```

- `final`이 여러 번 나오면 텍스트는 공백으로 이어 붙이고, L_asr은 **마지막 final** 기준.
- `flush()`가 resolve된 뒤에도 `--final-timeout-ms`(기본 10000) 내에 final이 하나도 없으면 "no final"로 기록.

## MT 어댑터 (스트리밍 형태 선택)

```ts
interface MtAdapter {
  name: string;
  init(opts: Record<string, unknown>): Promise<void>;
  translate(text: string, o: { src: string; tgt: string; context?: string[] }):
    AsyncIterable<{ token: string; wallTimeMs: number }>;
}
```

- 토큰이 도착할 때마다 yield하고 `wallTimeMs`를 찍는다. 첫 토큰 시각 → L_first, 이터레이션 종료 시각 → L_sub.
- 비스트리밍 엔진은 전체 결과를 토큰 1개로 yield (L_first == L_sub).
- 번역문 = 모든 `token`을 이어 붙인 문자열 (토큰에 공백 포함).
- `context`: 같은 set의 직전 ASR final 텍스트(최대 2개), 문맥 활용 엔진용.

## 지연 정의 (run.mjs)

anchor = 해당 세그먼트의 **마지막 오디오 청크가 방출된 wall time** (`acceptAudio` 호출 직전 — 인라인 디코드 시간도 지연에 포함).

- `L_asr   = lastFinal.wallTimeMs − anchor` (음수는 0으로 클램프)
- `L_first = firstMtToken.wallTimeMs − anchor`
- `L_sub    = MT 완료 wall time − anchor`
