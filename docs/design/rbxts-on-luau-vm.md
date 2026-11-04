# roblox-ts 프리뷰를 Luau VM에서 실행하기 (포트 없는 백엔드)

상태: P0 스파이크 통과, P1 기능 구현 (2026-11-04). 결과는 §8과 §9에 있습니다. P1 성능은 다시 재야 합니다.

## 1. 목표와 원칙

roblox-ts 프로젝트를 브라우저에서 JS로 흉내 내지 않습니다. **실제 rbxtsc가 만드는 Luau를 loom의 Luau VM에서 그대로 실행**합니다.

- **라이브러리는 포트하지 않습니다. 엔진만 포트합니다.** Ripple, React-Lua, ui-labs, Promise처럼 Luau로 배포되는 것은 원본 Luau가 그대로 돕니다. loom이 계속 구현하는 것은 Roblox 엔진 쪽(`@loom-dev/runtime`의 Instance/서비스, `@loom-dev/luau` bindings, layout, renderer)뿐입니다.
- 지금 TS 경로가 주는 것은 하나도 잃지 않는 것이 목표입니다. 대응표는 §3에 있습니다.
- 전환 기간에는 두 백엔드를 `loomPreview({ runtime: "luau" | "js" })`로 함께 둡니다. 동등성이 확인되면 기본값을 바꾸고 compat를 삭제합니다.

## 2. 없어지는 근사치

지금 TS 경로는 "roblox-ts 코드를 JS로 실행"하려고 다음을 손으로 맞추고 있습니다. 새 경로에서는 전부 필요 없습니다.

| 지금 있는 것 | 이유 | 새 경로 |
|---|---|---|
| `preview/src/compat/ripple*`, `react-ripple.ts` | Ripple에 JS가 없음 | 원본 Ripple Luau 실행 |
| `compat/react.ts`, `jsx-runtime.ts`, `refs.ts` | React-Lua 의미(콜백 ref, `Change`/`Event`, `Tag`) 흉내 | 실제 React-Lua(`@rbxts-js/react`) 실행 |
| `compat/ui-labs.ts` | ui-labs는 Luau만 있음 | 원본 실행, 실제 스토리 포맷까지 지원 가능 |
| `transform.ts` (`import =`, `.size()`·`.get()` 정규식) | roblox-ts 매크로 흉내 | rbxtsc가 직접 변환 |
| `resolver.ts`의 `.luau` main 폴백, Luau 전용 패키지 오류 | 브라우저가 Luau를 못 읽음 | 패키지의 Luau를 그대로 로드 |
| `injectRobloxPromise` | roblox-ts Promise 의미 | `include/Promise.lua` 실행 |

compat 디렉터리만 테스트를 포함해 약 3.9k줄입니다.

## 3. 잃는 것이 없는지: 대조표

| 지금 (JS 경로) | 새 경로 | 비고 |
|---|---|---|
| 편집하면 **full reload** (`gallery-shell.ts`가 자기 패치를 막음) | **모듈 핫스왑**: 페이지 리로드 없이 VM을 유지한 채 다시 마운트 | 지금보다 낫습니다. §4.5 |
| esbuild 변환이 ms 단위 | rbxtsc 증분 컴파일 | **유일하게 확실히 느려지는 부분.** 지연 컴파일과 캐시로 완화합니다. §4.1, §4.4 |
| JS 소스맵 | 문장 단위 TS↔Luau 라인 맵 | §4.6 |
| Chrome DevTools 브레이크포인트 | TS 소스 기준 VS Code 디버깅(DAP) | 방식이 바뀌는 유일한 항목. §4.7 |
| 콘솔 출력 | `print`/`warn`/에러 → 콘솔, TS 위치로 매핑 | |
| 정적 갤러리 빌드, prerender | 같은 VM으로 빌드와 prerender | §4.8 |
| Astro/Next 임베드 | 변경 없음 | 둘 다 갤러리를 자기 Vite 인스턴스나 iframe으로 띄웁니다 |
| rbxtsc가 거부하는 코드도 돌아감 | 실제 빌드처럼 거부 | 의도된 변화입니다. 프리뷰가 실제 결과와 같아집니다 |

## 4. 구조

```
Vite dev server (Node)
 ├─ rbxts 컴파일 서비스   roblox-ts 3 내부 API, 상주 ts.Program, 파일 단위 transform
 │     → 모듈별 Luau + 라인 맵 + 진단
 ├─ Luau 컴파일 서비스    같은 luau-vm.wasm을 Node에서 실행 → 바이트코드, 해시 캐시
 ├─ Rojo 트리 빌더        luau-project.ts 재사용, out/ 대신 메모리 결과를 겹쳐 씀
 └─ 디버그 어댑터         DAP(VS Code) ↔ VM 명령 채널
          │  manifest + /@loom/luau/<hash>  (+ HMR 이벤트)
Browser
 ├─ gallery shell (JS 그대로: 크롬, 사이드바, 디버그 패널)
 └─ LuauVM + bindings + runtime + world → layout → renderer   (Luau 프로젝트 경로와 동일)
       target ModuleScript → React-Lua root (ScreenGui 아래)
```

### 4.1 rbxts 컴파일 서비스

roblox-ts 3.0은 CLI 말고도 라이브러리로 쓸 수 있습니다. `roblox-ts/out/Project`가 `createProjectData`, `createProjectProgram`, `VirtualProject`를 export합니다. 플레이그라운드용 `VirtualProject.compileSource`의 흐름은 다음과 같고, 이걸 실제 프로젝트와 실제 FS에서 그대로 따라 하면 됩니다.

`ts.createProgram` → `getPreEmitDiagnostics` → `new TransformState(...)` → `transformSourceFile` → `renderAST`

- **`out/`에 쓰지 않습니다.** 결과는 메모리에만 둡니다. 사용자가 따로 돌리는 `rbxtsc -w`와 충돌하지 않습니다.
- **지연 컴파일**: 타깃을 열면 그 타깃의 import 클로저만 transform합니다. Program은 한 번 만들고 변경이 있을 때 이전 Program을 재사용해 증분으로 갱신합니다.
- **버전**: 프로젝트에 설치된 `roblox-ts`를 우선 씁니다. 실제 빌드와 의미가 같아야 하기 때문입니다. 내부 API라서 얇은 어댑터 층을 두고 지원 버전 범위를 검사합니다.
- **진단**: TS나 roblox-ts 오류는 Vite 에러 오버레이에 띄우고, 마지막으로 성공한 출력은 계속 서빙합니다.

### 4.2 실행 모델과 Rojo 트리

- 프로젝트의 `default.project.json`은 `luau-project.ts`로 읽습니다. `$path`가 `out`을 가리키는 노드는 메모리 결과로 바꿉니다.
- `include/`(RuntimeLib.lua, Promise.lua)는 roblox-ts 패키지에서 가져옵니다. `node_modules/@rbxts/*`와 `@rbxts-js/*`는 이미 Luau이므로 그대로 읽습니다. 지금 `luau-project.ts`는 디렉터리를 순회할 때 `node_modules`를 건너뛰므로, Rojo가 명시적으로 매핑한 경로는 따라가도록 고쳐야 합니다.
- React는 실제 `@rbxts/react`입니다. 이 패키지의 `init.lua`가 `@rbxts-js/react`(React-Lua 17)를 require합니다. 마운트는 `@rbxts/react-roblox`의 `createRoot`로 PlayerGui 아래 ScreenGui에 합니다.
- 실행에 필요한 엔진 API(RunService, TweenService, UserInputService, TextService 등)가 실제 라이브러리 기준으로 부족하면 runtime이나 bindings에 채웁니다. 이것이 앞으로 loom이 유지할 유일한 "포트"입니다.

### 4.3 갤러리 타깃

- `*.loom.tsx` 형식은 그대로 둡니다. `export const preview = { render, title }`를 rbxtsc가 ModuleScript로 컴파일하면 테이블을 반환합니다.
- 셸은 JS로 남습니다. 타깃 마운트는 Luau 쪽 하니스(`loom_mount(preview, gui)`)가 맡습니다. 이 하니스가 React-Lua root와 Luau 에러 바운더리를 만들고, 오류를 JS 셸에 넘겨 지금과 같은 빨간 패널을 그리게 합니다. 이미 있는 `luauPreview`를 확장하는 형태입니다.
- 사이드바 제목: 지금은 모듈을 idle 시간에 로드해 읽습니다. 새 경로에서는 그러려면 컴파일이 필요하므로, 서버가 TS AST에서 `title` 리터럴을 정적으로 뽑습니다.
- 부수 효과로 ui-labs, Hoarcekat, Flipbook 스토리(`*.story.ts(x)`)를 원본 라이브러리로 지원할 수 있게 됩니다.

### 4.4 바이트코드와 캐시

- bridge에 `lb_load_bytecode`를 추가합니다. Node에서 같은 wasm으로 `luau_compile`을 돌려 바이트코드를 만들고, 브라우저는 그 바이트코드를 로드만 합니다. wasm이 같으므로 바이트코드 버전도 항상 일치합니다.
- 콘텐츠 해시를 키로 디스크 캐시(`node_modules/.loom/luau/`)에 둡니다. React-Lua처럼 큰 패키지는 한 번만 컴파일됩니다.
- 브라우저에는 해시 URL과 immutable 캐시 헤더로 보냅니다. 콜드 스타트 비용은 TS 쪽 증분 transform만 남습니다.

### 4.5 HMR: 리로드 없는 모듈 교체

1. 파일이 바뀌면 그 파일만 다시 transform합니다.
2. `ws.send({ type: "custom", event: "loom:luau-update", modules })`로 브라우저에 알립니다.
3. VM 쪽 `require` 캐시(bindings가 소유)에서 바뀐 모듈과, 그 모듈에서 타깃까지 올라가는 의존 모듈을 무효화합니다.
4. React root를 unmount하고 타깃을 다시 require한 뒤 다시 마운트합니다. wasm, VM, 로드된 React-Lua는 그대로 유지되고, 갤러리 선택과 스크롤도 유지됩니다.
5. 하나라도 실패하면 지금처럼 full reload로 돌아갑니다.

- 상태를 보존하는 Fast Refresh는 확장 목표입니다. React-Lua reconciler에 React 17의 hot reloading 훅(`scheduleRefresh`)이 이식돼 있는지 먼저 확인해야 합니다.

### 4.6 소스맵

roblox-ts는 소스맵을 내지 않습니다. 대신 끼워 넣을 지점이 있습니다. `transformStatementList`가 각 문장마다 `state.getLeadingComments(statement)`를 결과에 넣습니다.

- `TransformState.prototype.getLeadingComments`를 감싸서 각 문장 앞에 `--@loom:L<tsLine>` 마커 주석을 넣습니다. `removeComments`가 켜져 있어도 마커는 넣습니다.
- `renderAST` 출력을 한 번 훑어 Luau 줄 → TS 줄 표를 만들고 마커를 지웁니다. 렌더러를 고칠 필요가 없고, 정밀도는 문장 단위입니다.
- chunkname을 TS 파일 경로로 둡니다. `LuauError` traceback의 줄 번호를 TS 위치로 바꿔 오버레이와 콘솔에 보여 주고, Vite의 `/__open-in-editor` 링크를 붙입니다.
- 장기적으로는 roblox-ts 업스트림에 소스맵 PR을 내는 것도 고려합니다. 그러면 이 훅이 필요 없어집니다.

### 4.7 디버거 (DevTools 대체)

Chrome DevTools는 WASM 안의 Luau를 볼 수 없습니다. 그래서 이 부분만 방식이 바뀝니다.

- **VM 쪽**: Luau 디버그 API를 씁니다. `lua_breakpoint`, `lua_singlestep`, `debugbreak`/`debugstep` 콜백, `lua_getinfo`/`lua_getlocal`입니다. 로컬 변수 이름까지 보려면 컴파일 `debugLevel`을 지금의 1에서 2로 올립니다(dev 빌드만).
- **일시정지 방식 A (1차, 권장)**: 브레이크 콜백 안에서 dev server로 **동기 XHR 명령 루프**를 돌립니다. "변수 조회 → 응답 → 다음 명령"을 continue가 올 때까지 반복합니다. 멈춰 있는 동안 페이지도 멈추는데, 실제 디버거와 같은 체감입니다. Worker나 COOP/COEP가 필요 없습니다.
- **일시정지 방식 B (나중)**: VM, runtime, layout을 Worker로 옮기고 `Atomics.wait`로 멈춥니다. 메인 스레드는 멈추지 않지만 COOP/COEP가 필요하고 구조 변경이 큽니다.
- **연결**: VS Code ↔ (DAP, TCP) ↔ Vite plugin ↔ (동기 XHR) ↔ VM. TS 줄에 건 브레이크포인트는 라인 맵을 거꾸로 써서 Luau 줄로 바꿉니다.
- **클라이언트**: debug type `loom`을 등록하는 작은 VS Code 확장이 필요합니다. 그 전에는 갤러리 디버그 패널에 간이 UI를 둡니다.
- **REPL**: 콘솔에서 `loom.eval("...")`로 VM에서 Luau를 평가합니다. 지금은 없는 기능입니다.

### 4.8 정적 빌드, prerender, 임베드

- **build**: 모든 타깃 클로저를 바이트코드 에셋과 manifest로 내보내고 VM wasm을 에셋으로 함께 냅니다. 실행할 때 서버가 필요 없습니다. Luau 엔트리의 `vite build`는 아직 지원되지 않으므로, 이 작업이 그 지원도 겸합니다.
- **prerender**: Node(happy-dom)에서 같은 VM으로 타깃을 실행하고 `Image`를 수집합니다. VM은 이미 node 환경 vitest에서 돌고 있습니다.
- **Astro/Next**: 변경이 없습니다.

### 4.9 성능: 가장 큰 미지수

React-Lua가 WASM 위의 Luau 인터프리터에서 돌고, Instance 프로퍼티를 쓸 때마다 JS와 WASM 경계를 넘습니다. 숫자로 확인하기 전에는 기본값 전환을 하지 않습니다.

## 5. 단계 계획

| 단계 | 내용 | 통과 기준 |
|---|---|---|
| **P0 스파이크** | gallery-demo를 rbxtsc로 컴파일 → 기존 Luau 프로젝트 경로로 실행 → CardScene과 RippleScene을 실제 React-Lua와 실제 Ripple로 렌더 | 렌더 결과 일치. 콜드 스타트 ≤ 1.5s(바이트코드 캐시 있음). 스프링 애니메이션 프레임당 ≤ 4ms. 한 파일 수정의 증분 컴파일 ≤ 300ms. **넘지 못하면 중단하고 재검토** |
| P1 | 컴파일 서비스(메모리 출력, 증분, 진단 오버레이), Rojo 오버레이, `node_modules` 매핑 | gallery-demo 전체 타깃이 `runtime: "luau"`로 열림 |
| P2 | 바이트코드 파이프라인과 캐시, 정적 빌드, prerender | `loom build` 결과가 서버 없이 동작 |
| P3 | Luau 하니스(에러 바운더리, 제목 정적 추출), 스토리 포맷 | 셸 UX가 JS 경로와 같음 |
| P4 | 모듈 핫스왑 HMR | 수정 후 리로드 없이 반영 |
| P5 | 라인 맵, 에러와 콘솔 위치 매핑, open-in-editor | 스택이 TS 파일과 줄로 표시 |
| P6 | DAP 디버거(방식 A)와 VS Code 확장 | TS 줄 브레이크포인트, 스텝, 로컬 변수 확인 |
| P7 | 동등성 하니스: 두 백엔드의 Scene IR 스냅샷 비교 → 기본값 전환 → compat 삭제 | 모든 데모 타깃의 스냅샷 일치 |

P0만 성패를 가르는 단계입니다. 나머지는 구현량 문제입니다.

## 6. 열린 결정

1. **디버거 클라이언트**: VS Code 확장을 만들지, 갤러리 내장 UI만 둘지.
2. **JS 백엔드**: 전환 후 삭제할지, 빠른 폴백(`runtime: "js"`)으로 남길지. 남기면 compat 유지비도 남습니다.
3. **roblox-ts 버전**: 프로젝트에 설치된 것을 쓸지, loom이 번들할지. 이 문서는 프로젝트 것 우선을 제안합니다.
4. **`@loom-dev/luau` 공개 시점**: 이 작업 전체가 여기에 의존합니다. 기존 DEV-72에서 이미 열려 있는 질문입니다.

## 7. 검증하지 않은 가정

- React-Lua 렌더링 성능이 WASM 위 Luau에서 충분한지 (P0).
- roblox-ts 내부 API(`TransformState`, `transformSourceFile`)를 버전 범위 안에서 안정적으로 쓸 수 있는지.
- 실제 React-Lua와 Ripple이 요구하는 엔진 API를 runtime이 얼마나 갖췄는지.
- React-Lua reconciler에 hot reloading 훅이 있는지.
- 동기 XHR 명령 루프가 최신 Chrome에서 계속 허용되는지(지원 중단 경고는 뜨지만 아직 동작함).

## 8. P0 결과 (2026-11-04)

**판정: 진행(Go).** 수치 기준 세 개를 모두 통과했습니다. 단, 증분 컴파일은 `rbxtsc -w`로는 통과하지 못하고 §4.1의 컴파일 서비스 방식으로만 통과합니다.

### 방법

- gallery-demo의 `CardScene`, `RippleScene`을 유효한 roblox-ts로 옮겼습니다(§8.3). roblox-ts 3.0.0으로 컴파일했고, 실제 `@rbxts/react` 17.3.7(React-Lua), `@rbxts/react-ripple` 3.0.1, `@rbxts/ripple` 0.10.x를 썼습니다.
- 컴파일 결과(`out/`, `include/`, `node_modules/@rbxts*`)를 Rojo 프로젝트로 묶어 기존 Luau 프로젝트 경로(`@loom-dev/luau/entry`)로 실행했습니다. compat 모듈은 하나도 로드되지 않습니다.
- 비교 대상은 같은 TS 소스를 지금의 JS 경로로 띄운 페이지입니다.
- 측정은 헤드리스 Chromium(1024×768)에서 했습니다. 앱 안 브라우저 패널은 숨겨진 상태라 rAF와 타이머가 스로틀되어 측정에서 제외했습니다(§8.4).

### 8.1 수치

| 항목 | Luau VM | JS 경로 | 기준 | 결과 |
|---|---|---|---|---|
| 렌더 결과 | 트리, 크기, 위치, 색 모두 동일 (두 씬 모두) | — | 일치 | 통과 |
| 프레임당 비용 (rAF 콜백, 412프레임, 호버 + 접기) | 평균 1.32 / p95 1.5 / 최대 1.7 ms | 1.21 / 1.4 / 1.8 ms | ≤ 4 ms | 통과 |
| 콜드 스타트 (페이지 시작 → 씬이 DOM에 등장, 데워진 dev 서버) | 673 / 399 / 401 ms | 205 / 116 / 113 ms | ≤ 1.5 s | 통과 |
| 같은 측정, 브라우저 HTTP 캐시 있음 | 142 ms | 50 ms | | |
| 한 파일 수정 후 증분 컴파일, `rbxtsc -w` | 520–880 ms | — | ≤ 300 ms | **실패** |
| 같은 것, 라이브러리 방식 + 세션 내내 유지하는 호스트 | 118–168 ms | — | ≤ 300 ms | 통과 |

- 상호작용도 원본 라이브러리로 동작합니다. 펼치기와 접기는 `useMotion`, 호버는 `useSpring`과 `useTween`이 처리합니다.
- **콜드 스타트에서 가장 큰 비용**은 dev에서 9.5MB로 전송되는 Luau 프로젝트 모듈입니다. Luau 소스 260개 파일(1.65MB)을 JSON으로 인라인한 것입니다. §4.4의 바이트코드 에셋으로 바꾸면 줄어듭니다. 캐시가 있을 때 wasm 도착 이후 씬 등장까지는 약 60ms(Luau 컴파일과 React-Lua 첫 렌더)입니다.
- **`rbxtsc -w`가 느린 이유**: 변경할 때마다 컴파일러 호스트를 새로 만들어 `@rbxts/types`의 .d.ts 약 5MB를 다시 파싱합니다. 호스트와 이전 Program을 유지하면 Program 갱신이 3–23ms로 줄고, 남는 것은 파일 하나의 타입 검사와 변환(108–162ms)입니다. 서비스 쪽에서 `RojoResolver`와 노드 모듈 매핑을 캐시하면 더 줄일 여지가 있습니다.
- 전체 컴파일: CLI 콜드 3.6s. 라이브러리 방식은 Program 생성 372ms + 전 파일 변환 338ms.

### 8.2 메운 엔진 차이 (라이브러리 포트 아님)

실제 라이브러리를 돌리면서 드러난 엔진 쪽 구멍입니다. 모두 범용 수정이고, 테스트를 붙여 working tree에 반영했습니다(아직 커밋하지 않음).

1. **Rojo 리더** (`preview/src/luau-project.ts`): `default.project.json`이 있는 디렉터리는 그 프로젝트로 동기화하고, 인스턴스 이름은 프로젝트의 `name`을 씁니다. `@rbxts/react`가 `@rbxts-js`에서 `.React`를 찾기 때문입니다. pnpm 심볼릭 링크도 따라갑니다.
2. **`_G`와 `shared`** (`luau/src/vm.ts`, `mount.ts`): 샌드박스 뒤에도 쓰기 가능한, 스크립트들이 공유하는 테이블로 둡니다. roblox-ts RuntimeLib이 `_G[module] = TS`로 자신을 등록합니다. 범용 VM은 그대로 두고 `sharedTables` 옵션으로 Roblox VM만 켭니다.
3. **`ReflectionService:GetClasses()`** (`runtime/src/services.ts`): `@rbxts/react`가 JSX 태그 표(`screengui` → `ScreenGui`)를 여기서 만듭니다.
4. **문자열 require** (`luau/src/bindings.ts`, `prelude.ts`): `@self/`, `./`, `../`, `@game/`을 지원합니다. Ripple 0.10이 `require("@self/config")`를 씁니다. 호출한 스크립트는 `getfenv(2).script`로 찾습니다.
5. **`debug.profilebegin`/`profileend`/메모리 카테고리** (`prelude.ts`): Ripple이 Heartbeat마다 프로파일 레이블을 겁니다. loom에는 프로파일러가 없으므로 아무것도 하지 않습니다.

### 8.3 발견한 것

- **gallery-demo 타깃은 유효한 roblox-ts가 아닙니다.** `UDim2.new(...)`, JSX의 `Name` prop, 식별자 `next`, 타입이 없는 바인딩 `.map` 인자(`any`), React import 누락이 있습니다. JS 경로는 이걸 받아 줬습니다. 전환하면 타깃을 고쳐야 하며, §3에서 말한 "실제 빌드처럼 거부"가 실제로 확인된 것입니다. 스파이크에서는 `new UDim2(...)`, `key=`, 이름 변경, 타입 주석으로 고쳤습니다.
- **VM 예산 버그 (고침)**: 엔트리마다 주는 5초 예산이 벽시계 기준이라, 페이지가 스로틀되면(숨겨진 패널) 모듈 로드 중에 엉뚱하게 "script exceeded its time budget"이 나고 페이지가 멈췄습니다. 이제 예산은 Luau 세이프포인트 사이의 시간을 재고, 50ms가 넘는 간격(탭 정지, 긴 호스트 호출, 컴파일)은 최대 50ms까지만 차감합니다(`native/bridge.cpp`의 `interrupt`). 무한 루프와 느린 호출을 도는 루프는 여전히 잡힙니다. 숨겨진 패널에서 반복 로드해도 더 이상 재현되지 않습니다.
- **호스트 핸들 경쟁 (고친 것으로 판단)**: 숨겨진 패널에서 한 번, 호스트 `__index` 안에서 `count of undefined`가 났습니다. 새 userdata를 할당하면서 GC 단계가 같은 객체의 이전 userdata를 마무리하면, 핸들이 0이 되어 지워진 뒤에 카운트를 올리던 순서 문제와 맞아떨어집니다. 이제 할당 전에 카운트를 올립니다(`vm.ts`의 `pushHost`). 결정적으로 재현하지는 못했습니다.
- **프로젝트 판별 순서**: `findEntry`가 `default.project.json`보다 TS 엔트리를 먼저 고릅니다. 그래서 스파이크는 Luau 전용 실행 디렉터리를 따로 만들어야 했습니다. P1에서 `runtime: "luau"` 스위치로 바뀌는 부분입니다.

### 8.4 확인하지 않은 것

- 실제 규모의 컴포넌트 라이브러리(예: `rbxts-react-clean-ui`)에서의 수치.
- 브라우저 패널이 보이는 상태의 실측. 이번 수치는 헤드리스 Chromium 기준입니다.
- Studio와의 대조. 이번에는 두 loom 경로끼리만 비교했습니다.
- §7의 나머지 가정(HMR 훅, 동기 XHR).

## 9. P1: 컴파일 서비스 (2026-11-04)

`loom preview --runtime luau` 또는 `loomPreview({ runtime: "luau" })`를 쓰면, roblox-ts 프로젝트를 rbxtsc 없이 Luau VM에서 실행합니다.

- **컴파일 서비스** (`packages/preview/src/rbxts-compiler.ts`): 프로젝트에 설치된 roblox-ts를 라이브러리로 씁니다. `compileFiles`의 변환 루프를 그대로 따라 하되 출력은 메모리에만 둡니다. 세션 동안 컴파일러 호스트 하나를 유지하고, 편집이 생기면 그 파일과 그 파일을 import하는 파일(`getChangedFilePaths`)만 다시 컴파일합니다.
- **Rojo 오버레이**: Rojo 리더가 `ProjectFs`로 파일 시스템을 받습니다. `out/`은 컴파일 결과, `include/`는 roblox-ts 런타임, `src/`의 `.lua(u)`는 복사본으로 보입니다. 디스크에는 아무것도 쓰지 않으므로, 옆에서 돌리는 `rbxtsc -w`와 부딪히지 않습니다.
- **roblox-ts 찾기**: 프로젝트나 그 위쪽의 `node_modules`에 있는 roblox-ts만 씁니다. `pnpm exec`가 NODE_PATH를 스토어로 가리키기 때문에, 일반적인 resolve를 쓰면 프로젝트가 고르지 않은 버전을 집어 옵니다.
- **편집**: 다시 컴파일한 뒤 전체 리로드합니다. 타입 오류나 roblox-ts 오류는 Vite 오류 오버레이에 TS 파일과 줄로 표시하고, 페이지는 마지막으로 성공한 출력을 유지합니다. 첫 빌드의 오류는 페이지 로드를 실패시킵니다.
- **검증**: npm으로 설치한 스파이크 프로젝트(실제 React-Lua, Ripple)를 디스크의 `out/`과 `include/` 없이 실행해 P0와 같은 트리를 얻었습니다. 테스트 6개는 메모리 컴파일, VM 실행, 의존 파일 재컴파일, 오류 시 이전 출력 유지, 소유 판정, roblox-ts가 없을 때의 안내를 다룹니다.
- **아직 없는 것**: 갤러리 타깃(P3), 핫스왑(P4), tsconfig transformer 플러그인, `vite build`.

### 9.1 성능: 다시 재야 함

편집에서 화면 반영까지 5.5–7s, 재컴파일 2.4–4.2s가 나왔습니다. 하지만 측정 중 머신의 load average가 30에서 260까지 올라갔고, 같은 작업이 96ms에서 3.5s 사이를 오갔습니다. 그래서 이 수치로는 판단할 수 없습니다. 조용한 머신에서 다시 재야 합니다.

구조적으로 남는 비용은 리로드입니다. 리로드할 때마다 9.5MB 프로젝트 모듈을 다시 받고 Luau 약 250개 모듈을 다시 컴파일합니다. 이 비용은 P2(바이트코드 에셋과 캐시)와 P4(리로드 없는 모듈 교체)가 없앱니다.
