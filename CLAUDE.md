# CLAUDE.md

即時口譯 Web App（單一檔案 `interpreter.html`，不需建置）。完整計劃見 `PLAN.md`。

## 規則

- 對話、註解、commit message、文件一律用台灣繁體中文。
- API key 不可寫死、不可 commit。本機測試用的 key 放在 `.env`（`GEMINI_API_KEY=...`），已列入 `.gitignore`。

## 已實測確認的 API 規格（與官方翻譯指南不同處）

- **setup 欄位位置**（2026-11-06 實測，伺服器以 close 1007 回報 schema 錯誤，且在檢查 key 之前就驗證）：
  - `translationConfig` 必須在 `setup.generationConfig` 裡（放頂層會被拒）。
  - `inputAudioTranscription`、`outputAudioTranscription` 必須在 `setup` 頂層（放進 `generationConfig` 會被拒；官方翻譯指南的範例是錯的）。
  - `contextWindowCompression`、`sessionResumption` 也必須在 `setup` 頂層（放進 `generationConfig` 會被拒）。翻譯模型接受這兩個設定。
- 無效 key：close code `1007`，reason `API key not valid. Please pass a valid API key.`
- 設定 `sessionResumption: {}` 後，有語音內容時伺服器約每 1～2 秒送一次 `sessionResumptionUpdate`（`newHandle` 長度 36、`resumable: true`）；只有靜音時不會發。不設定就拿不到 handle。
- 用 handle 重連可以成功接續；handle 無效時 close `1008`，reason `BidiGenerateContent session not found`（不是致命錯誤，丟掉 handle 開新連線即可）。
- **單一連線約 9 分 50 秒**：13 分鐘耐久測試中，第 540 秒收到 `goAway: { timeLeft: "50s" }`；帶 handle 換線 0.7 秒完成，之後翻譯照常（2026-11-06 實測）。app 收到 goAway 就無縫換線（`Session.open(true)`）。
- 免費額度用完時的實際 close code / reason **尚未實測**，`explainClose()` 目前用 quota / RESOURCE_EXHAUSTED / rate limit 等字樣比對。遇到時請把除錯紀錄的 close 那行補進來。
- 專案綁了預付帳單且額度用完：close `1011`，reason `Your prepayment credits are depleted...`。付費專案不會退回免費額度，要用**沒綁帳單**的專案的 key。
- close reason 會被截斷在約 123 bytes。

## 已實測確認的伺服器行為（2026-11-06，用 `tools/live-test.mjs`）

- `inputTranscription.languageCode` 是主要語言代碼，例如中文是 `zh`，不是 `zh-Hant`；`outputTranscription.languageCode` 是目標語言代碼。比對時取主要部分（`baseLang()`）。
- 每句的 `inputTranscription` 比對應的翻譯語音早約 250ms 到，所以可以用它來決定要不要輸出。
- **`echoTargetLanguage: false` 不可靠**：輸入已經是目標語言時，有時仍會把原句（文字和語音）照念一次。app 用「輸入語言＝目標語言就略過」自己過濾（`Session.isEcho()`）。
- **`inputTranscription.languageCode` 在真人語音下也不可靠**（iPhone 實測）：同一句英文，繁中連線回報 `en`，英文連線卻回報 `zh`，結果英文連線照念英文原句。合成語音（SAPI）重現不出來。對策：兩邊語言書寫系統不同時，**看原文逐字稿的文字判斷語言**（`detectInputLang()`，漢字／拉丁字母／假名／韓文…），文字太短判斷不出來就維持原判斷，不退回伺服器代碼；書寫系統相同時才用 languageCode。備援：譯文 token 有 60% 以上出現在原文裡 → 判定照念，整句丟掉（`looksLikeEcho()`、`Session.dropTurn()`）。
- 第一句話之後，伺服器會**持續送音訊包，安靜時內容是靜音**（peak < 0.005，人聲包 peak > 0.05）。靜音包不可以延長「播放中」或泡泡計時，否則麥克風會一直被換成靜音。
- 音訊每包固定 250ms，開頭一次先送 2～3 包，之後約每 250ms 一包（即時速度）。**句中的靜音包不能丟**，否則每丟一包就少 250ms 提前量，手機上會斷斷續續、有爆音（已在手機實測遇到）。做法：句中靜音最多照排 3 包，從閒置開始播放時延後 300ms 當緩衝。
- 連續串流時不會收到 `turnComplete`，泡泡收尾靠閒置計時。
- 模型是**同步口譯**，邊聽邊翻，約 1 秒後就開始送翻譯語音。如果馬上播，播放期間麥克風會被換成靜音，說話的人後半句就會被吃掉（手機實測遇到）。所以預設用麥克風音量偵測說話，把翻譯語音暫存到說話停下來才播（設定「翻譯語音什麼時候播」，預設停 1.2 秒）。噪音底線不可以用第一包音量初始化，否則一開口就說話會永遠偵測不到。
- 換語言時，上一句的翻譯（例如英文連線）和下一句的翻譯（繁中連線）可能同時在送。**兩條連線的語音不可以排在同一個時間軸上交錯**，否則會 250ms 中、250ms 英交替，聽起來是中英夾雜加雜訊（手機實測遇到）。每條連線各自一個佇列（`Session.q`），`pump()` 一次只播一條，播完才換下一條。

## 測試小技巧

- 瀏覽器窗格沒有麥克風，也不能輸入真的 key。可以在頁面載入後用 JS 替換 `navigator.mediaDevices.getUserMedia`（OscillatorNode 當假麥克風）和 `window.WebSocket`（假伺服器），因為 app 是在按「開始」時才使用它們。
- 沒設定 session resumption 也會收到 `sessionResumptionUpdate`，另外會收到 `usageMetadata`。

## 開發與測試

- 本機伺服器：`node tools/serve.mjs 8080`，開 `http://localhost:8080/#debug` 會顯示原始 server 訊息與 close code/reason。
- 不用麥克風測 API：`node tools/live-test.mjs tools/audio/zh.wav tools/audio/en.wav`（加 `--raw` 印每則訊息）。
  測試音檔用 `tools/make-test-audio.ps1` 以 Windows 內建語音產生（腳本需存成 UTF-8 BOM，PowerShell 5.1 才讀得懂中文）。
