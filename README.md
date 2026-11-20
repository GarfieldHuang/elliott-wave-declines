# 波浪下跌段圖鑑 · Elliott Wave Declines

用艾略特波浪理論回看 **台股加權、費城半導體 (SOX)、那斯達克 100、標普 500** 自 2000 年以來的主要下跌段，並回測「在下跌途中，用當下的資料推算低點」到底準不準。

網頁：https://garfieldhuang.github.io/elliott-wave-declines/

## 內容

- **現在的位置**：每個指數目前的下跌段、波浪數法、下方目標價，加上人工判讀（`docs/data/notes.json`，標有判讀日）。
- **歷年下跌段**：zigzag 找出的主要下跌段，自動數 A-B-C 與五波，並計算費波南希符合度。
- **即時推算回測**：每確認一個反彈高點 B，就只用到那天為止的資料推算 C = A、C = 1.618×A，再和實際低點比對。

## 重建資料

```bash
python build.py            # 從 Yahoo Finance 抓最新日線並重算
python build.py --offline  # 只用 data_raw/ 的快取
python -m http.server 8000 --directory docs
```

GitHub Actions（`.github/workflows/update.yml`）每個交易日美股收盤後會重跑 `build.py`，並提交更新的資料。`notes.json` 的文字判讀不會自動更新。

## 免責

數浪本身很主觀，演算法挑的是「最工整」的數法，不代表市場真的照這個結構走。本專案只是技術結構的整理與回測，不構成投資建議。
