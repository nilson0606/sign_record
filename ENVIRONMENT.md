# sign_record 獨立環境

建立日期：2026-09-25。UI 改版須先與使用者討論，目前維持還原點的版面及音訊處理行為。

## 啟動與停止

在本專案目錄執行：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\start-local.ps1
```

只啟動、不開啟瀏覽器可加 `-NoOpen`。本機頁面為 http://localhost:4273/，專用 helper 為 http://127.0.0.1:4274；也可使用 https://nilson0606.github.io/sign_record/ 並按「檢查本機工具」。

結束錄音、下載與分離工作後再停止：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\stop-local.ps1
```

啟停腳本核對程序路徑與埠號歸屬；不停止占用埠號的其他專案。本專案不使用原專案的 4174 helper。

## 執行資源與資料

- `.runtime/venv` 與 `.runtime/models` 是獨立複本，沒有共享連結。Python 啟動器已重建為此目錄。
- 此機器已驗證 Python 3.12.14、Node 24.19.0、FFmpeg／ffprobe、PyTorch 2.5.1+cu124 與 RTX 4060 Laptop GPU。
- Python 基礎直譯器仍使用電腦原已安裝的 Python；虛擬環境套件位於本目錄。換機時請執行 `setup-local.ps1`，不要直接搬移 venv。
- 歌曲庫位置沿用此機器既有 `.runtime/library-settings.json` 設定；歌曲與錄音本身未複製、搬移或修改。此設定不進 Git。
- 新舊專案可連到同一歌曲庫；使用介面的保存／刪除會作用於該實際資料夾。設定歌曲库不是備份。
- 原專案只作來源參考，禁止寫入、推送或停止其服務。

## 發布範圍

新 GitHub 儲存庫為 `nilson0606/sign_record`，Pages 透過 `.github/workflows/pages.yml` 發布 `_site`；打包器只輸出 HTML、CSS、前端模組與 `.nojekyll`。

歌曲、音訊、錄音、影片、模型、venv、工作暫存、診斷日誌與本機路徑設定都不發布。`.gitignore` 已排除常見音訊與模型副檔名。

本機保留來源歷史供比較；新遠端以目前原始碼快照起始，不推送來源歷史或來源標籤。

## 已驗證

- `npm test`：52 項通過。
- Python 網路與音訊管線測試：7＋12 項通過。
- 錄音／後製瀏覽器測試、錄音搬存瀏覽器測試通過；使用合成音訊及隔離測試資料。
- `pip check` 無依賴衝突；GPU tensor 計算成功。
- 11 個模型檔案與来源 SHA256 一致。
- 新服務啟動、重複啟動、停止、重新啟動與健康檢查通過，原服務保持運行。
- 真實麥克風、演唱聽感及長曲模型分離尚待使用者驗收。

來源還原標籤：`restore-important-20260925-scoring`；來源程式及文件 commit：`aad5409f39c5c35d67fb6323d99d041df6576922`。
