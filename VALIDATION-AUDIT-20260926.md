# 桌機驗證稽核 — 2026-09-26

範圍：D:/sign_record 桌機版；不開發或測試手機版。此報告是本輪實際證據盤點，不是穩定性保證。

## 結果

120 項驗收情境：通過 93、部分驗證 3、未驗證 24、受阻 0。通過只限各列標示的方法與預期，不能推論實體設備或原使用者 Edge 狀態。

測試框架本輪執行：57 項 Node 單元測試、39 項 Python 管線測試、9 項 Python 監聽測試，共 105 項，全數通過；另有 9 支瀏覽器／FFmpeg 腳本最終通過。這些數字與 120 項驗收情境是不同的分類，不相加，不當作 120 項全部通過。

## 找到的缺口與本輪修改

正式產品預設維持「歌唱者加配樂」與 150 ms，完全沒有改回只錄歌聲或不錄音。評分套件中的不錄音只是隔離測試條件；recording-browser-check 另外斷言正式預設為 mix 並驗證混音內容。

- flow-check 初跑失敗：還期待 standard 預設，且基準假資料沒有回傳請求的 pitchMethod。已改成驗證 relaxed 預設，再明確選 standard 執行既有完整評分情境；假資料遵守請求。
- difficulty-browser-check 初跑失敗：預設已改混音，但假資料無伴奏，觸發正常的缺音軌保護。評分套件明確選不錄音；混音預設與缺音軌保護由錄音套件另外驗證。兩者原始失敗紀錄保留。
- 本輪只修改以上兩支測試與新增報告，沒有修改應用程式的收音、評分、錄音、播放器功能。此前播放器修正仍在工作目錄，不把它們描述為本輪新修正。
- 舊 browser-check 包含手機檢查，本輪不執行。library-browser-check 會寫入使用中的歌曲庫，本輪不執行。local-pipeline-check 會下載並寫入歌曲庫，本輪不執行。calibration-browser-check 寫死正式埠，未直接執行。
- 原使用者 Edge 關掉重開即恢復的根因仍未確認；隔離 Edge 通過不能代替原環境重現。

## 尚缺的優先驗證

1. 真實 Edge 權限／攔截／網路失敗的現場錯誤、快速連點與兩分頁競爭。
2. 完整 20 輪演唱流程與 30 分鐘資源監測；本輪未執行，不以短測試取代。
3. 真實 USB 麥克風拔插、長歌錄音、休眠喚醒與物理往返延遲。
4. 舊錄音缺原始歌聲、處理中切換／刪除來源及成品時間戳的獨立情境。

## 執行紀錄

| 套件 | 本輪結果 | 原始紀錄 |
|---|---|---|
| node-unit | 通過 | [log](D:/sign_record/test-results/audit-20260926/node-unit.log) |
| python-pipeline | 通過 | [log](D:/sign_record/test-results/audit-20260926/python-pipeline.log) |
| python-monitor | 通過 | [log](D:/sign_record/test-results/audit-20260926/python-monitor.log) |
| player-recovery-browser-check | 通過 | [log](D:/sign_record/test-results/audit-20260926/player-recovery-browser-check.log) |
| youtube-api-recovery-browser-check | 通過 | [log](D:/sign_record/test-results/audit-20260926/youtube-api-recovery-browser-check.log) |
| flow-check | 初跑失敗；修正測試後通過 | [log](D:/sign_record/test-results/audit-20260926/flow-recheck.log) |
| flow-check 初跑 | 失敗保留 | [初跑 log](D:/sign_record/test-results/audit-20260926/flow-check.log) |
| preview-browser-check | 通過 | [log](D:/sign_record/test-results/audit-20260926/preview-browser-check.log) |
| difficulty-browser-check | 初跑失敗；修正測試後通過 | [log](D:/sign_record/test-results/audit-20260926/difficulty-recheck.log) |
| difficulty-browser-check 初跑 | 失敗保留 | [初跑 log](D:/sign_record/test-results/audit-20260926/difficulty-browser-check.log) |
| recording-browser-check | 通過 | [log](D:/sign_record/test-results/audit-20260926/recording-browser-check.log) |
| voice-output-browser-check | 通過 | [log](D:/sign_record/test-results/audit-20260926/voice-output-browser-check.log) |
| recording-archive-browser-check | 通過 | [log](D:/sign_record/test-results/audit-20260926/recording-archive-browser-check.log) |
| recording-export-check | 通過 | [log](D:/sign_record/test-results/audit-20260926/recording-export-check.log) |

重跑方式：`node --test tests/*.test.mjs`；`.runtime/venv/Scripts/python.exe -m unittest discover -s tools -p test_*.py -v`；監聽 Python 將 `-s` 改為 `tests`、pattern 改為 `test_native_monitor.py`。瀏覽器套件使用獨立 PORT=4451；archive 套件使用 4276；兩支播放器重試套件只讀目前的本機網頁並攔截外部依賴。每次執行前先確認埠未占用。

## 逐項驗收表

所有未驗證項目仍是待辦；「單元／合成資料」及「隔離 Edge」明確不含真實設備或原使用者瀏覽器設定。每列有操作前提、預期與實際結果；細節證據連結到斷言原始檔及本輪 log。

### 啟動、工具連線、版本與頁面更新

| ID | 條件／操作 | 預期結果 | 實際結果／方法 | 證據 |
|---|---|---|---|---|
| A01 | 未設定歌曲庫時提出準備請求 | 拒絕準備並提示先設定位置 | 通過：單元／合成資料 | [斷言](D:/sign_record/tests/library-location.test.mjs) · [紀錄](D:/sign_record/test-results/audit-20260926/node-unit.log) |
| A02 | 歌曲庫位置保存後重建設定實例 | 仍讀到同一路徑且舊歌曲保留 | 通過：單元／合成資料 | [斷言](D:/sign_record/tests/library-location.test.mjs) · [紀錄](D:/sign_record/test-results/audit-20260926/node-unit.log) |
| A03 | 已載入歌曲時要求更換歌曲庫 | 拒絕切換且原資料不變 | 通過：單元／合成資料 | [斷言](D:/sign_record/tests/library-location.test.mjs) · [紀錄](D:/sign_record/test-results/audit-20260926/node-unit.log) |
| A04 | 取消資料夾選擇視窗 | 選取請求解除且操作按鈕恢復 | 通過：隔離 Edge／模擬依賴與合成音訊 | [斷言](D:/sign_record/tests/flow-check.mjs) · [紀錄](D:/sign_record/test-results/audit-20260926/flow-recheck.log) |
| A05 | 工具未啟動時按檢查本機工具 | 顯示未連線而非誤報未安裝 | 未驗證：未執行 | 待建立／執行 |
| A06 | 工具回應缺少必要能力時準備歌曲 | 指出版本不相容且不啟動工作 | 未驗證：未執行 | 待建立／執行 |
| A07 | 本機網路存取被拒絕後恢復權限 | 能重新連線且不需重新安裝 | 未驗證：未執行 | 待建立／執行 |
| A08 | 發布新版本後讀取 HTML 與所有相依模組 | 模組均來自同一版本並保留舊版資源 | 通過：單元／合成資料 | [斷言](D:/sign_record/tests/build-site.test.mjs) · [紀錄](D:/sign_record/test-results/audit-20260926/node-unit.log) |
| A09 | 不允許的來源與缺少權杖呼叫 helper | 拒絕請求且不建立工作 | 部分驗證：單元／合成資料；驗證了授權及參數拒絕；未在本輪單獨測實際 helper 的 Origin 拒絕。 | [斷言](D:/sign_record/tests/library-location.test.mjs) · [紀錄](D:/sign_record/test-results/audit-20260926/node-unit.log) |
| A10 | 服務關閉後重新啟動並操作現有頁面 | 失效連線可恢復且歌曲庫仍在 | 未驗證：未執行 | 待建立／執行 |

### YouTube 載入、切歌、失敗與重試

| ID | 條件／操作 | 預期結果 | 實際結果／方法 | 證據 |
|---|---|---|---|---|
| B01 | 一般網址、短網址及 Shorts 解析 | 取得正確影片 ID | 通過：單元／合成資料 | [斷言](D:/sign_record/tests/audio.test.mjs) · [紀錄](D:/sign_record/test-results/audit-20260926/node-unit.log) |
| B02 | 偽造 YouTube 網域與無效 ID | 拒絕解析 | 通過：單元／合成資料 | [斷言](D:/sign_record/tests/audio.test.mjs) · [紀錄](D:/sign_record/test-results/audit-20260926/node-unit.log) |
| B03 | API 入口程式下載失敗後重試 | 重新取得入口並成功初始化 | 未驗證：未執行 | 待建立／執行 |
| B04 | API 入口程式逾時後重試 | 恢復後可取得入口且不永久卡住 | 未驗證：未執行 | 待建立／執行 |
| B05 | 第二段 widget 程式失敗後重試 | 第二段確實再次下載且播放器就緒 | 通過：隔離 Edge／模擬依賴與合成音訊 | [斷言](D:/sign_record/tests/youtube-api-recovery-browser-check.mjs) · [紀錄](D:/sign_record/test-results/audit-20260926/youtube-api-recovery-browser-check.log) |
| B06 | 播放器初始化未回報就緒 | 逾時後按重試建立新實例 | 通過：隔離 Edge／模擬依賴與合成音訊 | [斷言](D:/sign_record/tests/player-recovery-browser-check.mjs) · [紀錄](D:/sign_record/test-results/audit-20260926/player-recovery-browser-check.log) |
| B07 | 已失敗播放器延遲送出就緒、錯誤、播放事件 | 不覆蓋新播放器的狀態 | 通過：隔離 Edge／模擬依賴與合成音訊 | [斷言](D:/sign_record/tests/player-recovery-browser-check.mjs) · [紀錄](D:/sign_record/test-results/audit-20260926/player-recovery-browser-check.log) |
| B08 | 影片回報禁止嵌入錯誤 | 顯示錯誤並可改載其他影片 | 未驗證：未執行 | 待建立／執行 |
| B09 | 影片移除或設為私人 | 顯示錯誤且不啟動錄音 | 未驗證：未執行 | 待建立／執行 |
| B10 | 瀏覽器阻擋自動播放 | 提示使用者點播放且不誤判演唱中 | 未驗證：未執行 | 待建立／執行 |
| B11 | 連續快速載入 A、B 影片 | 最後選的 B 成為唯一有效影片 | 未驗證：未執行 | 待建立／執行 |
| B12 | 初始化中取消或離開頁面 | 遲到回應不建立有效演唱工作 | 未驗證：未執行 | 待建立／執行 |
| B13 | 同一已載入歌曲再次選取 | 沿用基準不新增準備工作 | 通過：隔離 Edge／模擬依賴與合成音訊 | [斷言](D:/sign_record/tests/flow-check.mjs) · [紀錄](D:/sign_record/test-results/audit-20260926/flow-recheck.log) |
| B14 | 切換另一首歌曲 | 播放器與基準一同更新且只卸載舊工作 | 通過：隔離 Edge／模擬依賴與合成音訊 | [斷言](D:/sign_record/tests/flow-check.mjs) · [紀錄](D:/sign_record/test-results/audit-20260926/flow-recheck.log) |
| B15 | 原生播放器按播放 | 有麥克風與基準時正確開始評分 | 通過：隔離 Edge／模擬依賴與合成音訊 | [斷言](D:/sign_record/tests/flow-check.mjs) · [紀錄](D:/sign_record/test-results/audit-20260926/flow-recheck.log) |
| B16 | 原使用者 Edge 故障環境重現及修復驗證 | 先取得原始錯誤再證明修正有效 | 未驗證：未執行 | 待建立／執行 |

### 基準準備、快取、取消與分離失敗

| ID | 條件／操作 | 預期結果 | 實際結果／方法 | 證據 |
|---|---|---|---|---|
| C01 | 一般準備按鈕建立新歌請求 | 完整歌曲、RMVPE、Demucs、單次、人聲伴奏、保留音軌 | 通過：隔離 Edge／模擬依賴與合成音訊 | [斷言](D:/sign_record/tests/preview-browser-check.mjs) · [紀錄](D:/sign_record/test-results/audit-20260926/preview-browser-check.log) |
| C02 | 從歌曲庫載入舊模型／流程／四軌版本 | 沿用該版本並讀到相符試聽內容 | 通過：隔離 Edge／模擬依賴與合成音訊 | [斷言](D:/sign_record/tests/preview-browser-check.mjs) · [紀錄](D:/sign_record/test-results/audit-20260926/preview-browser-check.log) |
| C03 | 已有相同基準與音軌再次準備 | 直接回傳快取且不重新處理 | 通過：單元／合成資料 | [斷言](D:/sign_record/tests/library-location.test.mjs) · [紀錄](D:/sign_record/test-results/audit-20260926/node-unit.log) |
| C04 | 處理到分離階段 100% 但尚未保存 | 維持未就緒且試聽不可操作 | 通過：隔離 Edge／模擬依賴與合成音訊 | [斷言](D:/sign_record/tests/preview-browser-check.mjs) · [紀錄](D:/sign_record/test-results/audit-20260926/preview-browser-check.log) |
| C05 | GPU 分離失敗改 CPU | 進度重設且說明清楚 | 通過：單元／合成資料 | [斷言](D:/sign_record/tools/test_audio_pipeline.py) · [紀錄](D:/sign_record/test-results/audit-20260926/python-pipeline.log) |
| C06 | IPv6 下載連線失敗 | 一次切換 IPv4 並繼續；不更動系統設定 | 通過：單元／合成資料 | [斷言](D:/sign_record/tools/test_download_network.py) · [紀錄](D:/sign_record/test-results/audit-20260926/python-pipeline.log) |
| C07 | IPv4 與 IPv6 都失敗或伺服器拒絕存取 | 回報錯誤不無限重試 | 通過：單元／合成資料 | [斷言](D:/sign_record/tools/test_download_network.py) · [紀錄](D:/sign_record/test-results/audit-20260926/python-pipeline.log) |
| C08 | POST 準備請求尚未回覆時取消 | 遲到工作被清除且不新增演唱歷史 | 通過：隔離 Edge／模擬依賴與合成音訊 | [斷言](D:/sign_record/tests/flow-check.mjs) · [紀錄](D:/sign_record/test-results/audit-20260926/flow-recheck.log) |
| C09 | 強制重建失敗且已有舊版本 | 保留舊基準與音軌 | 通過：單元／合成資料 | [斷言](D:/sign_record/tests/library-location.test.mjs) · [紀錄](D:/sign_record/test-results/audit-20260926/node-unit.log) |
| C10 | 保存新版本失敗或遭取消 | 保留舊內容且不發布半成品 | 通過：單元／合成資料 | [斷言](D:/sign_record/tests/library.test.mjs) · [紀錄](D:/sign_record/test-results/audit-20260926/node-unit.log) |
| C11 | 缺少試聽音軌時補建 | 補建後可試聽相同歌曲 | 通過：隔離 Edge／模擬依賴與合成音訊 | [斷言](D:/sign_record/tests/preview-browser-check.mjs) · [紀錄](D:/sign_record/test-results/audit-20260926/preview-browser-check.log) |
| C12 | 重建另一音高方法 | 重用音軌且不修改來源版本 | 通過：單元／合成資料 | [斷言](D:/sign_record/tools/test_rmvpe_pitch.py) · [紀錄](D:/sign_record/test-results/audit-20260926/python-pipeline.log) |
| C13 | 真實完整長曲執行下載到分離與保存 | 15 分鐘上限內結果完整可播放 | 未驗證：未執行 | 待建立／執行 |
| C14 | 模型下載中斷、內容不完整或雜湊錯誤 | 不發布破損模型；可重試完整下載 | 通過：單元／合成資料；模型完整下載與錯誤清理已通過；雜湊檢查另見 test_rmvpe_pitch.py 同輪 Python 結果。 | [斷言](D:/sign_record/tools/test_model_download.py) · [紀錄](D:/sign_record/test-results/audit-20260926/python-pipeline.log) |

### 收音啟停、裝置切換與拔除

| ID | 條件／操作 | 預期結果 | 實際結果／方法 | 證據 |
|---|---|---|---|---|
| D01 | 第一次拒絕麥克風權限後再試 | 解除等待狀態且可重新開始 | 通過：隔離 Edge／模擬依賴與合成音訊 | [斷言](D:/sign_record/tests/flow-check.mjs) · [紀錄](D:/sign_record/test-results/audit-20260926/flow-recheck.log) |
| D02 | 找不到麥克風或裝置被占用 | 明確錯誤且演唱未被誤啟動 | 通過：隔離 Edge／模擬依賴與合成音訊 | [斷言](D:/sign_record/tests/flow-check.mjs) · [紀錄](D:/sign_record/test-results/audit-20260926/flow-recheck.log) |
| D03 | 權限視窗等待中離開前景 | 取消開始並關閉待用 AudioContext | 通過：隔離 Edge／模擬依賴與合成音訊 | [斷言](D:/sign_record/tests/flow-check.mjs) · [紀錄](D:/sign_record/test-results/audit-20260926/flow-recheck.log) |
| D04 | 正常收音後按停止 | 停止軌道並可再啟動 | 通過：隔離 Edge／模擬依賴與合成音訊 | [斷言](D:/sign_record/tests/voice-output-browser-check.mjs) · [紀錄](D:/sign_record/test-results/audit-20260926/voice-output-browser-check.log) |
| D05 | 收音中切換輸入裝置 | 停止舊輸入與監聽 | 部分驗證：隔離 Edge／模擬依賴與合成音訊；已有 devicechange 與收音模式切換；尚未逐一測所有實體輸入裝置選取。 | [斷言](D:/sign_record/tests/voice-output-browser-check.mjs) · [紀錄](D:/sign_record/test-results/audit-20260926/voice-output-browser-check.log) |
| D06 | 真實 USB 麥克風拔除並重插 | 可恢復收音且沒有重複裝置工作 | 未驗證：未執行 | 待建立／執行 |
| D07 | 以本機 PCM 模擬收音 | 音高可辨識且不額外開瀏覽器麥克風 | 通過：隔離 Edge／模擬依賴與合成音訊 | [斷言](D:/sign_record/tests/voice-output-browser-check.mjs) · [紀錄](D:/sign_record/test-results/audit-20260926/voice-output-browser-check.log) |
| D08 | 停止後原生 PCM 遲到 | 不繼續輸出音高或啟用監聽 | 部分驗證：單元／合成資料；已測 PCM 遲滯與停止回報；停止後晚到串流的完整 UI 情境未獨立驗證。 | [斷言](D:/sign_record/tests/native-mic-worklet.test.mjs) · [紀錄](D:/sign_record/test-results/audit-20260926/node-unit.log) |
| D09 | 開啟監聽調音量再關閉 | 收音維持、音量只影響監聽 | 通過：隔離 Edge／模擬依賴與合成音訊 | [斷言](D:/sign_record/tests/voice-output-browser-check.mjs) · [紀錄](D:/sign_record/test-results/audit-20260926/voice-output-browser-check.log) |
| D10 | 輸出裝置拒絕／消失或延遲開啟 | 停止監聽且收音維持 | 通過：隔離 Edge／模擬依賴與合成音訊 | [斷言](D:/sign_record/tests/voice-output-browser-check.mjs) · [紀錄](D:/sign_record/test-results/audit-20260926/voice-output-browser-check.log) |
| D11 | 原生監聽逾期命令及心跳中斷 | 停用失效工作且不影響收音位元組 | 通過：單元／合成資料；Python 期限與位元組保持通過；命令序號另由 Node native-monitor-control.test.mjs 同輪驗證。 | [斷言](D:/sign_record/tests/test_native_monitor.py) · [紀錄](D:/sign_record/test-results/audit-20260926/python-monitor.log) |
| D12 | USB 麥克風到實體喇叭完整延遲量測 | 取得可重複的端到端量測，不用緩衝數字代替 | 未驗證：未執行 | 待建立／執行 |

### 演唱、暫停、跳轉、結束與評分

| ID | 條件／操作 | 預期結果 | 實際結果／方法 | 證據 |
|---|---|---|---|---|
| E01 | 完整正確旋律與完全未唱 | 分別得到滿分與零分 | 通過：單元／合成資料 | [斷言](D:/sign_record/tests/scoring.test.mjs) · [紀錄](D:/sign_record/test-results/audit-20260926/node-unit.log) |
| E02 | 只唱單一音或重複同個樣本 | 不能灌高完整度與總分 | 通過：單元／合成資料 | [斷言](D:/sign_record/tests/scoring.test.mjs) · [紀錄](D:/sign_record/test-results/audit-20260926/node-unit.log) |
| E03 | 切換允許八度與原調模式 | 八度差依設定計算 | 通過：單元／合成資料 | [斷言](D:/sign_record/tests/scoring.test.mjs) · [紀錄](D:/sign_record/test-results/audit-20260926/node-unit.log) |
| E04 | 演唱開始後嘗試修改難度 | 本輪鎖定且結算保留實際難度 | 通過：隔離 Edge／模擬依賴與合成音訊 | [斷言](D:/sign_record/tests/difficulty-browser-check.mjs) · [紀錄](D:/sign_record/test-results/audit-20260926/difficulty-recheck.log) |
| E05 | 結算後修改下一輪難度 | 不改寫上一輪結果標籤 | 通過：隔離 Edge／模擬依賴與合成音訊 | [斷言](D:/sign_record/tests/difficulty-browser-check.mjs) · [紀錄](D:/sign_record/test-results/audit-20260926/difficulty-recheck.log) |
| E06 | 新頁面與重評預設難度 | 皆為寬鬆且不重建基準 | 通過：隔離 Edge／模擬依賴與合成音訊；預設寬鬆與單次基準重用已測；重評預設另由 recording-browser-check.mjs 同輪驗證。 | [斷言](D:/sign_record/tests/difficulty-browser-check.mjs) · [紀錄](D:/sign_record/test-results/audit-20260926/difficulty-recheck.log) |
| E07 | 暫停影片再繼續 | 暫停期間不增加演唱進度 | 通過：隔離 Edge／模擬依賴與合成音訊 | [斷言](D:/sign_record/tests/flow-check.mjs) · [紀錄](D:/sign_record/test-results/audit-20260926/flow-recheck.log) |
| E08 | 影片緩衝後恢復 | 暫停評分且恢復後可繼續 | 通過：隔離 Edge／模擬依賴與合成音訊 | [斷言](D:/sign_record/tests/flow-check.mjs) · [紀錄](D:/sign_record/test-results/audit-20260926/flow-recheck.log) |
| E09 | 從頭開始唱且 seek 延遲完成 | 回到零才正式開始 | 通過：隔離 Edge／模擬依賴與合成音訊 | [斷言](D:/sign_record/tests/flow-check.mjs) · [紀錄](D:/sign_record/test-results/audit-20260926/flow-recheck.log) |
| E10 | 影片播完自然結算 | 結算一次、釋放收音、保留基準 | 通過：隔離 Edge／模擬依賴與合成音訊 | [斷言](D:/sign_record/tests/flow-check.mjs) · [紀錄](D:/sign_record/test-results/audit-20260926/flow-recheck.log) |
| E11 | 停止收音後手動結算 | 可結算既有演唱且回到零不丟範圍 | 通過：隔離 Edge／模擬依賴與合成音訊 | [斷言](D:/sign_record/tests/flow-check.mjs) · [紀錄](D:/sign_record/test-results/audit-20260926/flow-recheck.log) |
| E12 | 基準範圍结束但影片仍播放 | 停止超範圍計分且影片不被截斷 | 通過：隔離 Edge／模擬依賴與合成音訊 | [斷言](D:/sign_record/tests/flow-check.mjs) · [紀錄](D:/sign_record/test-results/audit-20260926/flow-recheck.log) |
| E13 | 已唱範圍與整首評分比較 | 未唱尾段只在整首模式計入 | 通過：單元／合成資料 | [斷言](D:/sign_record/tests/scoring.test.mjs) · [紀錄](D:/sign_record/test-results/audit-20260926/node-unit.log) |
| E14 | 遮罩邊界、重疊與全曲遮罩 | 按正確邊界排除且無可評分音時不造分 | 通過：單元／合成資料 | [斷言](D:/sign_record/tests/masks.test.mjs) · [紀錄](D:/sign_record/test-results/audit-20260926/node-unit.log) |
| E15 | 已開始演唱後修改來源遮罩 | 本輪仍使用開始時的快照 | 通過：單元／合成資料 | [斷言](D:/sign_record/tests/masks.test.mjs) · [紀錄](D:/sign_record/test-results/audit-20260926/node-unit.log) |
| E16 | 收音停止時保存後重唱 | 新一輪獨立且不新增下載工作 | 通過：隔離 Edge／模擬依賴與合成音訊；評分重新開始與基準重用由 flow 驗證；錄音保存另由 recording-browser-check.mjs 驗證。 | [斷言](D:/sign_record/tests/flow-check.mjs) · [紀錄](D:/sign_record/test-results/audit-20260926/flow-recheck.log) |

### 錄音保存、最新選取與失敗恢復

| ID | 條件／操作 | 預期結果 | 實際結果／方法 | 證據 |
|---|---|---|---|---|
| F01 | 只測麥克風未開始演唱 | 不保存錄音 | 通過：隔離 Edge／模擬依賴與合成音訊 | [斷言](D:/sign_record/tests/recording-browser-check.mjs) · [紀錄](D:/sign_record/test-results/audit-20260926/recording-browser-check.log) |
| F02 | 新頁面錄音預設值 | 歌唱者加配樂、150 ms、自動平衡 | 通過：隔離 Edge／模擬依賴與合成音訊 | [斷言](D:/sign_record/tests/recording-browser-check.mjs) · [紀錄](D:/sign_record/test-results/audit-20260926/recording-browser-check.log) |
| F03 | 選擇只錄歌唱者 | 成品不混入配樂音軌 | 通過：隔離 Edge／模擬依賴與合成音訊 | [斷言](D:/sign_record/tests/recording-browser-check.mjs) · [紀錄](D:/sign_record/test-results/audit-20260926/recording-browser-check.log) |
| F04 | 選擇歌唱者加配樂 | 成品含人聲与伴奏 | 通過：隔離 Edge／模擬依賴與合成音訊 | [斷言](D:/sign_record/tests/recording-browser-check.mjs) · [紀錄](D:/sign_record/test-results/audit-20260926/recording-browser-check.log) |
| F05 | 四軌版本錄製混音 | 加入伴奏與和音，不加入原主唱 | 通過：隔離 Edge／模擬依賴與合成音訊 | [斷言](D:/sign_record/tests/recording-browser-check.mjs) · [紀錄](D:/sign_record/test-results/audit-20260926/recording-browser-check.log) |
| F06 | 暫停／恢復錄音 | 暫停段不多錄且時間軸正確 | 通過：隔離 Edge／模擬依賴與合成音訊 | [斷言](D:/sign_record/tests/recording-browser-check.mjs) · [紀錄](D:/sign_record/test-results/audit-20260926/recording-browser-check.log) |
| F07 | 播完與停止收音後完成保存 | 後處理及重評同步選到最新錄音 | 通過：隔離 Edge／模擬依賴與合成音訊 | [斷言](D:/sign_record/tests/recording-browser-check.mjs) · [紀錄](D:/sign_record/test-results/audit-20260926/recording-browser-check.log) |
| F08 | 停止收音後再次按結算 | 不重複保存同一筆 | 通過：隔離 Edge／模擬依賴與合成音訊 | [斷言](D:/sign_record/tests/recording-browser-check.mjs) · [紀錄](D:/sign_record/test-results/audit-20260926/recording-browser-check.log) |
| F09 | 錄音途中分段保存 | 中途記錄標為未完成，完成時正確發布 | 通過：隔離 Edge／模擬依賴與合成音訊 | [斷言](D:/sign_record/tests/recording-browser-check.mjs) · [紀錄](D:/sign_record/test-results/audit-20260926/recording-browser-check.log) |
| F10 | 儲存空間不足（模擬） | 保留救援下載與原先選取 | 通過：隔離 Edge／模擬依賴與合成音訊 | [斷言](D:/sign_record/tests/recording-browser-check.mjs) · [紀錄](D:/sign_record/test-results/audit-20260926/recording-browser-check.log) |
| F11 | 選擇不保存錄音 | 不建立 MediaRecorder | 通過：隔離 Edge／模擬依賴與合成音訊 | [斷言](D:/sign_record/tests/recording-browser-check.mjs) · [紀錄](D:/sign_record/test-results/audit-20260926/recording-browser-check.log) |
| F12 | 混音缺少所需音軌 | 拒絕錯誤混音且不產生半成品 | 通過：隔離 Edge／模擬依賴與合成音訊 | [斷言](D:/sign_record/tests/recording-browser-check.mjs) · [紀錄](D:/sign_record/test-results/audit-20260926/recording-browser-check.log) |
| F13 | 瀏覽器暫存搬存中斷／離線 | 保留來源，恢復後不覆蓋磁碟新資料 | 通過：隔離 Edge／模擬依賴與合成音訊 | [斷言](D:/sign_record/tests/recording-archive-browser-check.mjs) · [紀錄](D:/sign_record/test-results/audit-20260926/recording-archive-browser-check.log) |
| F14 | 真實長歌錄音與系統休眠／喚醒 | 量測完整性與恢復行為，未完成不可誤報成功 | 未驗證：未執行 | 待建立／執行 |

### 後處理、150 ms 校正與原檔保護

| ID | 條件／操作 | 預期結果 | 實際結果／方法 | 證據 |
|---|---|---|---|---|
| G01 | 以 0、100、負100、150 ms 渲染同一來源 | 音訊位移符合設定的總量 | 通過：隔離 Edge／模擬依賴與合成音訊 | [斷言](D:/sign_record/tests/recording-browser-check.mjs) · [紀錄](D:/sign_record/test-results/audit-20260926/recording-browser-check.log) |
| G02 | 同一原始樣本重複套相同校正重評 | 结果一致且不累加 | 通過：單元／合成資料 | [斷言](D:/sign_record/tests/recording-process.test.mjs) · [紀錄](D:/sign_record/test-results/audit-20260926/node-unit.log) |
| G03 | 重新合成后再次從原始錄音合成 | 原檔保留，新成品 ID 與來源關聯正確 | 通過：隔離 Edge／模擬依賴與合成音訊 | [斷言](D:/sign_record/tests/recording-browser-check.mjs) · [紀錄](D:/sign_record/test-results/audit-20260926/recording-browser-check.log) |
| G04 | 柔化各強度及關閉 | 強度有差異、配樂不變、原始資料不變 | 通過：隔離 Edge／模擬依賴與合成音訊 | [斷言](D:/sign_record/tests/recording-browser-check.mjs) · [紀錄](D:/sign_record/test-results/audit-20260926/recording-browser-check.log) |
| G05 | 重評改用目前載入基準 | 只使用相符影片與範圍且不改原遮罩 | 通過：單元／合成資料 | [斷言](D:/sign_record/tests/recording-process.test.mjs) · [紀錄](D:/sign_record/test-results/audit-20260926/node-unit.log) |
| G06 | 另一影片、較短或損毀基準要求重評 | 拒絕不相容基準 | 通過：單元／合成資料 | [斷言](D:/sign_record/tests/recording-process.test.mjs) · [紀錄](D:/sign_record/test-results/audit-20260926/node-unit.log) |
| G07 | 後處理變更難度並重評 | 依選擇計算且结果記住實際難度 | 通過：隔離 Edge／模擬依賴與合成音訊 | [斷言](D:/sign_record/tests/recording-browser-check.mjs) · [紀錄](D:/sign_record/test-results/audit-20260926/recording-browser-check.log) |
| G08 | 舊錄音缺少乾淨歌聲 | 不能假裝可以單獨校正或重評 | 未驗證：未執行；現有測試覆蓋缺伴奏與已刪除音訊，不足以證明所有舊錄音缺 raw 的 UI 行為。 | 待建立／執行 |
| G09 | 跳轉與重播造成多段時間軸 | 先位移音訊再對應歌中位置 | 通過：單元／合成資料 | [斷言](D:/sign_record/tests/recording-analysis.test.mjs) · [紀錄](D:/sign_record/test-results/audit-20260926/node-unit.log) |
| G10 | 輸入非法延遲數值 | 拒絕 NaN 與超界值 | 通過：單元／合成資料 | [斷言](D:/sign_record/tests/recording-process.test.mjs) · [紀錄](D:/sign_record/test-results/audit-20260926/node-unit.log) |
| G11 | 真實 FFmpeg 將合成 WAV 轉 MP3 | 可解碼、振幅合理且暫存清除 | 通過：真實 FFmpeg／合成音訊 | [斷言](D:/sign_record/tests/recording-export-check.mjs) · [紀錄](D:/sign_record/test-results/audit-20260926/recording-export-check.log) |
| G12 | 無效音訊要求轉 MP3 | 拒絕且不留下匯出暫存 | 通過：真實 FFmpeg／合成音訊 | [斷言](D:/sign_record/tests/recording-export-check.mjs) · [紀錄](D:/sign_record/test-results/audit-20260926/recording-export-check.log) |
| G13 | 重合成期間切換選取或刪除來源 | 不把晚到的成品掛到錯誤錄音 | 未驗證：未執行 | 待建立／執行 |
| G14 | 成品時間戳與同歌多筆錄音辨識 | 不同成品可明確辨識，不覆蓋同名錄音 | 未驗證：未執行 | 待建立／執行 |

### 試聽、下載、刪除與上下清單同步

| ID | 條件／操作 | 預期結果 | 實際結果／方法 | 證據 |
|---|---|---|---|---|
| H01 | 上方選取錄音後按試聽 | 播放指定內容且停止下方重疊試聽 | 通過：隔離 Edge／模擬依賴與合成音訊 | [斷言](D:/sign_record/tests/recording-browser-check.mjs) · [紀錄](D:/sign_record/test-results/audit-20260926/recording-browser-check.log) |
| H02 | 上方下載指定錄音 | 下載位元組與選定那筆一致 | 通過：隔離 Edge／模擬依賴與合成音訊 | [斷言](D:/sign_record/tests/recording-browser-check.mjs) · [紀錄](D:/sign_record/test-results/audit-20260926/recording-browser-check.log) |
| H03 | 上方按後處理 | 展開工具且聚焦該筆延遲欄位 | 通過：隔離 Edge／模擬依賴與合成音訊 | [斷言](D:/sign_record/tests/recording-browser-check.mjs) · [紀錄](D:/sign_record/test-results/audit-20260926/recording-browser-check.log) |
| H04 | 上方刪除選中錄音 | 只刪該筆，保留其他 ID | 通過：隔離 Edge／模擬依賴與合成音訊 | [斷言](D:/sign_record/tests/recording-browser-check.mjs) · [紀錄](D:/sign_record/test-results/audit-20260926/recording-browser-check.log) |
| H05 | 下方刪除上方選中的錄音 | 同步選下一筆並清除舊試聽來源 | 通過：隔離 Edge／模擬依賴與合成音訊 | [斷言](D:/sign_record/tests/recording-browser-check.mjs) · [紀錄](D:/sign_record/test-results/audit-20260926/recording-browser-check.log) |
| H06 | 刪除非目前選中的錄音 | 維持原先選取 | 通過：隔離 Edge／模擬依賴與合成音訊 | [斷言](D:/sign_record/tests/recording-browser-check.mjs) · [紀錄](D:/sign_record/test-results/audit-20260926/recording-browser-check.log) |
| H07 | 刪除最後一筆錄音 | 選取清空且四個按鈕與處理按鈕停用 | 通過：隔離 Edge／模擬依賴與合成音訊 | [斷言](D:/sign_record/tests/recording-browser-check.mjs) · [紀錄](D:/sign_record/test-results/audit-20260926/recording-browser-check.log) |
| H08 | 取消刪除確認 | 錄音與選取保持原狀 | 通過：隔離 Edge／模擬依賴與合成音訊 | [斷言](D:/sign_record/tests/recording-browser-check.mjs) · [紀錄](D:/sign_record/test-results/audit-20260926/recording-browser-check.log) |
| H09 | 歌曲人聲／伴奏／主唱試聽切換 | 實際播放位元組對應所選版本 | 通過：隔離 Edge／模擬依賴與合成音訊 | [斷言](D:/sign_record/tests/preview-browser-check.mjs) · [紀錄](D:/sign_record/test-results/audit-20260926/preview-browser-check.log) |
| H10 | 刪除歌曲一種範圍或版本 | 其他版本與歌曲保留 | 通過：單元／合成資料 | [斷言](D:/sign_record/tests/library.test.mjs) · [紀錄](D:/sign_record/test-results/audit-20260926/node-unit.log) |
| H11 | 已刪磁碟錄音仍存在舊瀏覽器副本 | 重新搬存時不能使已刪錄音復活 | 通過：隔離 Edge／模擬依賴與合成音訊 | [斷言](D:/sign_record/tests/recording-archive-browser-check.mjs) · [紀錄](D:/sign_record/test-results/audit-20260926/recording-archive-browser-check.log) |
| H12 | 清除全部錄音與清除成績 | 各自只清指定資料，不刪歌曲 | 通過：隔離 Edge／模擬依賴與合成音訊；磁碟清全部錄音由 archive 驗證；成績與錄音分離由 recording-browser-check.mjs 同輪驗證。 | [斷言](D:/sign_record/tests/recording-archive-browser-check.mjs) · [紀錄](D:/sign_record/test-results/audit-20260926/recording-archive-browser-check.log) |

### 長時間運作、連續操作與資源釋放

| ID | 條件／操作 | 預期結果 | 實際結果／方法 | 證據 |
|---|---|---|---|---|
| I01 | 完整選歌到保存換歌流程連續 20 輪 | 每輪結果正確且無遺留工作 | 未驗證：未執行 | 待建立／執行 |
| I02 | 連續 30 分鐘收音／錄音／切換測試 | 無持續資源成長且成品完整 | 未驗證：未執行 | 待建立／執行 |
| I03 | 快速連點開始／停止／準備／取消 | 不重複建立工作或留下錯誤按鈕狀態 | 未驗證：未執行 | 待建立／執行 |
| I04 | 輸出建立中停止收音 | 遲到輸出不會自行重新發聲 | 通過：隔離 Edge／模擬依賴與合成音訊 | [斷言](D:/sign_record/tests/voice-output-browser-check.mjs) · [紀錄](D:/sign_record/test-results/audit-20260926/voice-output-browser-check.log) |
| I05 | 離頁後檢查監聽與原生串流 | 關閉工作且重載不自動啟用 | 通過：隔離 Edge／模擬依賴與合成音訊 | [斷言](D:/sign_record/tests/voice-output-browser-check.mjs) · [紀錄](D:/sign_record/test-results/audit-20260926/voice-output-browser-check.log) |
| I06 | 原生輸出佇列壅塞與設備寫入停滯 | 監聽可丟過舊片段，原收音位元組不變 | 通過：單元／合成資料 | [斷言](D:/sign_record/tests/test_native_monitor.py) · [紀錄](D:/sign_record/test-results/audit-20260926/python-monitor.log) |
| I07 | 同時開兩個實際 Edge 分頁操作 | 明確處理衝突且不串用錄音／歌曲 | 未驗證：未執行 | 待建立／執行 |
| I08 | Edge 整個關閉重開後再使用 | 真實環境資料保留與服務恢復需實機確認 | 未驗證：未執行 | 待建立／執行 |

### 桌機版面收合、導覽與按鈕狀態

| ID | 條件／操作 | 預期結果 | 實際結果／方法 | 證據 |
|---|---|---|---|---|
| J01 | 桌機兩種主題檢查區塊位置 | 播放器與收音並排；其餘順序符合要求 | 通過：隔離 Edge／模擬依賴與合成音訊 | [斷言](D:/sign_record/tests/preview-browser-check.mjs) · [紀錄](D:/sign_record/test-results/audit-20260926/preview-browser-check.log) |
| J02 | 收合設定與演唱中展開收起 | 不重建播放器或中斷收音錄音 | 通過：隔離 Edge／模擬依賴與合成音訊 | [斷言](D:/sign_record/tests/preview-browser-check.mjs) · [紀錄](D:/sign_record/test-results/audit-20260926/preview-browser-check.log) |
| J03 | 鍵盤展開與導覽到遮罩／延遲區 | 對應折疊區展開且控制項可操作 | 通過：隔離 Edge／模擬依賴與合成音訊 | [斷言](D:/sign_record/tests/preview-browser-check.mjs) · [紀錄](D:/sign_record/test-results/audit-20260926/preview-browser-check.log) |
| J04 | 檢查移動後的控制項 ID 與錄音四鈕 | 無重複 ID，四鈕同橫排且作用於選定錄音 | 通過：隔離 Edge／模擬依賴與合成音訊；四鈕位置由 recording 驗證；全頁 ID 唯一性由 preview-browser-check.mjs 同輪驗證。 | [斷言](D:/sign_record/tests/recording-browser-check.mjs) · [紀錄](D:/sign_record/test-results/audit-20260926/recording-browser-check.log) |
