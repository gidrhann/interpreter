# 即時口譯 Web App：執行計劃

> 給 Claude Code 的交接文件。請先讀完整份文件，再依階段順序執行。
> 如果 repo 裡有 CLAUDE.md，先讀並遵守它的規則。

## 0. 工作規則

- 對話、程式註解、commit message、文件一律使用**台灣繁體中文**，必要時可以用英文術語。
- 不確定的 API 細節，先查 Google 官方文件（ai.google.dev），不要憑印象寫。
- 每完成一個階段就 commit 一次，訊息寫清楚做了什麼。
- 只有在出現已確認的專案規則、已驗證的 bug 修正、穩定的部署流程時，才更新 CLAUDE.md，而且只做最小補充。

## 1. 專案目標

做一個**手機用**的即時口譯網頁 app，給診所看診時醫師（中文）和外籍病患溝通用。

- 語音輸入，即時輸出翻譯字幕和翻譯語音
- 雙向翻譯：中文 ↔ 對方語言，自動判斷是誰在說話
- **不另外付費**：使用 Gemini API 免費方案
- 支援 iPhone Safari 和 Android Chrome

## 2. 目前狀態

repo 根目錄已經有 `interpreter.html`，是一個不需要建置的單一 HTML 檔，HTML、CSS、JS 都寫在裡面。

已完成：
- 設定面板：API key、我的語言、對方語言、翻譯方向、是否播放語音、模型名稱。設定存在 localStorage。
- 麥克風串流：用 AudioWorklet 降頻到 16kHz PCM16，每 100ms 送一包。不支援時退回 ScriptProcessor。
- 雙向模式：同時開兩條 WebSocket，一條的目標語言是對方語言，一條是我的語言。`echoTargetLanguage: false`，所以輸入已經是目標語言時，模型應該保持安靜。
- 字幕泡泡：分成「我 → 對方」和「對方 → 我」兩種，點一下會全螢幕放大。
- 翻譯語音播放：24kHz PCM16 依序排程播放。播放期間送靜音給 API，避免翻譯聲被麥克風收進去再翻一次。
- 收到 `goAway` 會自動重連，斷線會重試。啟用 Wake Lock 讓螢幕保持常亮。

**還沒做過的事：** 這個檔案只通過 `node --check` 語法檢查，**從來沒有真的連上 API，也沒有在手機上跑過**。第一件事就是實測。

## 3. 已查證的 API 規格（2026-11-06，來源：ai.google.dev）

- 模型：`gemini-3.5-live-translate-preview`，Google 定價頁標示免費方案的輸入和輸出都是 "Free of charge"。
- WebSocket：`wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=API_KEY`
- setup 訊息：
  ```json
  {"setup":{"model":"models/gemini-3.5-live-translate-preview",
    "generationConfig":{"responseModalities":["AUDIO"],
      "inputAudioTranscription":{},"outputAudioTranscription":{},
      "translationConfig":{"targetLanguageCode":"zh-Hant","echoTargetLanguage":false}}}}
  ```
- 沒有來源語言的設定欄位，模型會自動偵測。逐字稿訊息裡會帶 `languageCode`。
- 輸入：只接受音訊，不接受文字。格式是 16-bit PCM、16kHz、mono、little-endian，用 `{"realtimeInput":{"audio":{"data":<base64>,"mimeType":"audio/pcm;rate=16000"}}}` 送出。
- 輸出：24kHz PCM16，放在 `serverContent.modelTurn.parts[].inlineData.data`。
- 逐字稿：`serverContent.inputTranscription.text` 和 `serverContent.outputTranscription.text`。
- 中文代碼：`zh-Hant`（繁體）和 `zh-Hans`（簡體）。沒有 `zh-TW`。
- 官方列出的限制：遇到重口音、相近語言或快速切換語言時，語言偵測可能出錯；語音音色可能不一致；背景噪音不一定能完全濾掉。

**還需要再確認：**
- ephemeral token 要用哪個 endpoint？一份資料說 `v1alpha`，另一份說 `v1beta`。
- 免費方案的同時連線數上限。雙向模式一個人就佔 2 條連線，請到 AI Studio 的 rate-limit 頁面查。
- 單一 Live session 的時間上限，以及 session resumption 的用法。

## 4. 執行階段

### 階段 1：實測與除錯（最優先）

1. 在本機用 HTTPS 或 `localhost` 起一個靜態伺服器，例如 `npx serve`。電腦用 localhost 就能開麥克風；手機要用 HTTPS 才行，可以用 Cloudflare Tunnel 或 ngrok。
2. 加一個除錯模式：網址帶 `#debug` 時，在畫面上顯示原始的 server 訊息和 WebSocket close 的 code 與 reason。
3. 用真的 API key 確認以下幾點：
   - [ ] 有收到 `setupComplete`，模型名稱和欄位都正確
   - [ ] 說中文時，有收到英文的字幕和語音
   - [ ] 對方說英文時，有收到中文字幕，而且是**繁體**
   - [ ] 雙向模式下，「不該翻」的那條連線真的保持安靜。如果它還是輸出內容，就要改判斷邏輯，例如用 `inputTranscription.languageCode` 過濾。
4. 如果 API 規格和第 3 節不一樣，以實際回應為準，修好程式，再把正確規格寫進 CLAUDE.md。

**完成標準：** 電腦 Chrome 上可以完成一段中英雙向對話。

> ✅ 2026-11-06 完成。四個檢查項目都用真實 API 確認過（`tools/live-test.mjs`）；
> 桌機沒有麥克風，改在 iPhone Safari（透過 Cloudflare Tunnel）完成中英雙向對話。
> 實測發現的規格差異與伺服器行為記在 CLAUDE.md。

### 階段 2：修正已知風險

- **逐字稿殘留：** 保持安靜的那條連線會一直累積 `inText`，要等 1.8 秒沒動靜才清掉。兩人講話接得很快時，泡泡上的「原文」可能混到上一句。改法：收到 `turnComplete` 或確定這句不需要翻譯時，就立刻清掉。
- **連線時間上限：** 查官方文件的 session 時長限制，實作 session resumption 或定時無縫換線，確保連續使用 30 分鐘以上不會斷。
- **重試：** 現在最多重試 5 次，每次間隔遞增，但沒有上限提示。超過次數要停下來，並清楚告訴使用者原因。
- **錯誤訊息：** 把常見錯誤翻成中文提示，例如 key 無效、超過額度、模型不存在、網路斷線。
- **免費額度用完（429 或 RESOURCE_EXHAUSTED）：** 顯示明確提示。可考慮提供「單向模式」只開 1 條連線，節省額度。

> ✅ 2026-11-06 完成（用假伺服器測過 goAway 換線、斷線重試 5 次後停止、無效 key、額度用完、handle 失效；
> 真實 API 做了 13 分鐘耐久測試，第 9 分鐘換線成功、翻譯不中斷）。
> 單向模式沿用既有的「只翻成對方語言／只翻成我的語言」，額度用完的提示會建議改用。
> 尚未驗證：真的免費額度用完時伺服器回傳的訊息格式；手機上連續 30 分鐘以上的實際使用。

### 階段 3：手機相容性

在 **iPhone Safari** 和 **Android Chrome** 上逐項測試：

- [ ] 麥克風權限、AudioContext 的 resume（iOS 一定要由使用者點擊觸發）
- [ ] iOS 開著麥克風時，聲音常會改從聽筒小聲播放，要確認音量和輸出路徑。必要時提示使用者接藍牙喇叭，或改成只看字幕。
- [ ] AudioWorklet 搭配 blob URL 在 iOS 上能不能用；不能用時，ScriptProcessor 備援要正常
- [ ] 切到背景再切回來，是否能恢復收音和播放
- [ ] Wake Lock 是否有效

**完成標準：** 兩種手機上都能完整跑完一段 5 分鐘的雙向對話。

### 階段 4：部署

1. 選一種方式：GitHub Pages，或放在 gidrhann.com 底下的一個路徑。必須是 HTTPS。
2. 加上 PWA 的 `manifest.json` 和 icon，讓 app 可以「加入主畫面」。service worker 只用來快取 app 外殼，**不要**快取 API 回應。
3. 把部署流程寫進 CLAUDE.md。

### 階段 5：使用體驗（實測穩定後再做）

- 一鍵對調「我的語言」和「對方語言」
- 字幕字級調整（長輩病患需要大字）
- 「複製全部紀錄」按鈕，不存到伺服器
- 備援的「按住說話」模式，給吵雜環境使用
- 常用語言放在選單最上面：英文、越南文、印尼文、泰文、菲律賓文、日文
- **字幕潤飾**（2026-11-06 使用者提出）：同步口譯模型會照原文語序邊聽邊翻，譯文生硬。
  例：「Is the audio clear now when you speak English?」被翻成「音訊現在清楚了嗎，當你說英語的時候？」，
  自然的說法是「當你說英文的時候，音訊聽起來清楚嗎？」。翻譯模型沒有任何風格或指示設定可調。
  做法：每句結束後，把原文（inputTranscription）送給一般的 Gemini 文字模型，重翻成自然的台灣繁中（或對方語言），
  泡泡大字顯示潤飾版、小字保留即時版；設定裡可開關。限制：語音改不了、字幕晚 1～2 秒、多用文字模型額度。
  實作前先查官方文件確認免費方案可用的文字模型名稱與額度。

### 階段 6（選做）：保護 API key

現在的做法是 key 存在使用者自己手機的 localStorage，自己用沒問題。如果要讓診所其他人使用：
- 用 Cloudflare Worker 之類的服務簽發 ephemeral token，把 key 留在伺服器端，`translationConfig` 鎖在 token 裡。
- 先確認第 3 節裡 v1alpha 和 v1beta 的問題。

## 5. 隱私提醒（請寫進 app 畫面和 README）

依 Google 條款，Gemini API 免費方案的內容可能會被用來改善 Google 的產品。**不要用免費方案翻譯可辨識病人身分的資訊**，例如姓名、身分證號、病歷號。如果要正式用在臨床，應該改用付費方案，並確認資料處理條款。

## 6. 不要做的事

- 不要改用需要建置的框架，例如 React 或 Vite，除非單一檔案真的維護不下去。保持部署簡單。
- 不要把 API key 寫死在程式碼裡，也不要 commit 進 repo。
- 不要存任何對話內容到伺服器。
