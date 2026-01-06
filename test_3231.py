!pip install yfinance pandas numpy matplotlib ta

import yfinance as yf
import pandas as pd
import numpy as np
import matplotlib.pyplot as plt
from ta.momentum import RSIIndicator, StochasticOscillator
from scipy.stats import linregress

# --- 1. 資料抓取 ---
ticker = "3231.TW"
print(f"正在下載 {ticker} 歷史資料...")
df = yf.download(ticker, start="2019-01-01", end="2025-12-31")

# 資料清洗
if isinstance(df.columns, pd.MultiIndex):
    df.columns = df.columns.get_level_values(0)
df = df.dropna()

# --- 2. 指標計算 ---

# A. 動態斜率 (60日) & PR值
def get_slope(series):
    y = series.values
    x = np.arange(len(y))
    slope, _, _, _, _ = linregress(x, y)
    return slope

df['Slope_60'] = df['Close'].rolling(window=60).apply(get_slope, raw=False)
df['Slope_PR'] = df['Slope_60'].rolling(window=252).rank(pct=True) * 100

# B. MA 月線 (20MA) - 3231 使用 MA20
df['MA20'] = df['Close'].rolling(window=20).mean()
df['MA20_Slope'] = df['MA20'].diff()
df['Bias_20'] = (df['Close'] - df['MA20']) / df['MA20'] * 100
# 保留 MA60 用於顯示（如果需要）
df['MA60'] = df['Close'].rolling(window=60).mean()

# C. FIBO 波段 (3231: 20日箱型，不要求最低點在最高點之前)
def calculate_fibo_levels_3231(window_df):
    """3231: 計算 FIBO 位階：20日內找最高點和最低點（不要求順序）"""
    if len(window_df) < 5:
        return [np.nan] * 3  # 只返回 l500, l786, ext1272
    
    closes = window_df['Close'].values
    max_price = closes.max()
    min_price = closes.min()
    
    range_val = max_price - min_price
    if range_val <= 0:
        return [np.nan] * 3
    
    return [
        max_price - range_val * 0.5,    # l500
        max_price - range_val * 0.786,  # l786
        max_price + range_val * 0.272   # ext1272
    ]

# 計算 FIBO 位階（3231: 20日回溯）
fibo_data = []
for i in range(len(df)):
    if i < 19:
        fibo_data.append([np.nan] * 3)
    else:
        window = df.iloc[i-19:i+1]
        fibo_vals = calculate_fibo_levels_3231(window)
        fibo_data.append(fibo_vals)

fibo_df = pd.DataFrame(fibo_data, columns=['Fibo_l500', 'Fibo_l786', 'Fibo_ext1272'], index=df.index)
df = pd.concat([df, fibo_df], axis=1)

# 計算 FIBO 範圍和驗證有效性（3231: 門檻 5%）
df['Fibo_MaxPrice'] = df['Close'].rolling(window=20).max()
df['Fibo_MinPrice'] = df['Close'].rolling(window=20).min()
df['Fibo_Range'] = df['Fibo_MaxPrice'] - df['Fibo_MinPrice']
df['Fibo_Valid'] = (df['Fibo_Range'] / df['Fibo_MinPrice']) >= 0.05  # 門檻 5%

# D. RSI & KD
rsi_ind = RSIIndicator(close=df['Close'], window=14)
df['RSI'] = rsi_ind.rsi()

kd_ind = StochasticOscillator(high=df['High'], low=df['Low'], close=df['Close'], window=9, smooth_window=3)
df['K'] = kd_ind.stoch()
df['D'] = kd_ind.stoch_signal()

# E. MACD (12, 26, 9)
def calculate_ema(series, period):
    return series.ewm(span=period, adjust=False).mean()

df['EMA12'] = calculate_ema(df['Close'], 12)
df['EMA26'] = calculate_ema(df['Close'], 26)
df['MACD_DIF'] = df['EMA12'] - df['EMA26']
df['MACD_DEM'] = calculate_ema(df['MACD_DIF'], 9)
df['MACD_OSC'] = df['MACD_DIF'] - df['MACD_DEM']  # 柱狀體

# F. DMI (14日) - 使用與 temp.jsx 相同的平滑方式
def smooth_dmi(arr):
    """平滑函數：與 temp.jsx 相同 (res[i-1]*13 + arr[i])/14"""
    res = [arr[0]]
    for i in range(1, len(arr)):
        res.append((res[i-1] * 13 + arr[i]) / 14)
    return res

# 計算 TR, +DM, -DM
tr_list = [0]
pdm_list = [0]
mdm_list = [0]

for i in range(1, len(df)):
    h = df.iloc[i]['High']
    l = df.iloc[i]['Low']
    c_prev = df.iloc[i-1]['Close']
    
    tr = max(h - l, abs(h - c_prev), abs(l - c_prev))
    tr_list.append(tr)
    
    h_prev = df.iloc[i-1]['High']
    l_prev = df.iloc[i-1]['Low']
    move_up = h - h_prev
    move_down = l_prev - l
    
    if move_up > move_down and move_up > 0:
        pdm_list.append(move_up)
    else:
        pdm_list.append(0)
    
    if move_down > move_up and move_down > 0:
        mdm_list.append(move_down)
    else:
        mdm_list.append(0)

# 平滑處理
str_smooth = smooth_dmi(tr_list)
spdm_smooth = smooth_dmi(pdm_list)
smdm_smooth = smooth_dmi(mdm_list)

# 計算 +DI, -DI, ADX
pdi_list = [100 * spdm_smooth[i] / (str_smooth[i] if str_smooth[i] != 0 else 1) for i in range(len(str_smooth))]
mdi_list = [100 * smdm_smooth[i] / (str_smooth[i] if str_smooth[i] != 0 else 1) for i in range(len(str_smooth))]
dx_list = [100 * abs(pdi_list[i] - mdi_list[i]) / (pdi_list[i] + mdi_list[i] if (pdi_list[i] + mdi_list[i]) != 0 else 1) for i in range(len(pdi_list))]
adx_list = smooth_dmi(dx_list)

df['PDI'] = pdi_list
df['MDI'] = mdi_list
df['ADX'] = adx_list

# G. Bollinger Bands (20日, 2倍標準差)
df['BB_Mid'] = df['Close'].rolling(window=20).mean()
df['BB_Std'] = df['Close'].rolling(window=20).std()
df['BB_Upper'] = df['BB_Mid'] + 2 * df['BB_Std']
df['BB_Lower'] = df['BB_Mid'] - 2 * df['BB_Std']
df['BB_pctB'] = (df['Close'] - df['BB_Lower']) / (df['BB_Upper'] - df['BB_Lower'] + 1e-10)
df['BB_BandWidth'] = (df['BB_Upper'] - df['BB_Lower']) / (df['BB_Mid'] + 1e-10)

# H. Volume MA
df['VolMA5'] = df['Volume'].rolling(window=5).mean()
df['VolMA20'] = df['Volume'].rolling(window=20).mean()

# I. ATR (14日)
def calculate_atr(highs, lows, closes, period=14):
    tr_list = []
    for i in range(1, len(closes)):
        tr = max(highs[i] - lows[i], abs(highs[i] - closes[i-1]), abs(lows[i] - closes[i-1]))
        tr_list.append(tr)
    tr_series = pd.Series(tr_list)
    atr = tr_series.ewm(alpha=1/period, adjust=False).mean()
    return atr

atr_values = []
for i in range(len(df)):
    if i < 14:
        atr_values.append(np.nan)
    else:
        window = df.iloc[i-13:i+1]
        atr = calculate_atr(window['High'].values, window['Low'].values, window['Close'].values, 14)
        atr_values.append(atr.iloc[-1] if len(atr) > 0 else np.nan)

df['ATR'] = atr_values

# --- 3. 評分邏輯 (買入 & 賣出) - 線性給分 ---

# 線性映射函數
def linear_map(val, in_min, in_max, out_min, out_max):
    """線性映射：將 val 從 [in_min, in_max] 映射到 [out_min, out_max]"""
    if in_max == in_min:
        return out_min
    val = max(min(val, max(in_min, in_max)), min(in_min, in_max))
    return out_min + (val - in_min) * (out_max - out_min) / (in_max - in_min)

# 計算斜率動能（需要前一天的斜率值）
df['Slope_Prev'] = df['Slope_60'].shift(1)

def calculate_buy_score(row):
    """3231 緯創：短線波段版買入評分（總分 100）"""
    score = 0
    idx_pos = df.index.get_loc(row.name)
    p = row['Close']
    
    # === FIBO 評分 (5分) - 階梯式給分 ===
    b_Fibo = 0
    if row['Fibo_Valid'] and pd.notna(row['Fibo_l500']):
        if p > row['Fibo_l500']:
            b_Fibo = 0  # 上半部壓力區，無成本優勢
        elif p > row['Fibo_l786']:
            b_Fibo = 3  # 下半部安全區，具備基礎安全邊際
        else:
            b_Fibo = 5  # 底部超跌區，極具反彈潛力
    score += b_Fibo
    
    # === 動態斜率 (0分) - 3231 不列入評分 ===
    b_Hist = 0
    score += b_Hist
    
    # === MA 月線 (10分) - MA20 ===
    b_MA = 0
    if pd.notna(row['MA20']) and pd.notna(row['Bias_20']):
        bias = row['Bias_20']
        if bias < -6:
            b_MA = 10  # 急跌超賣區，滿分
        elif bias < -3:
            b_MA = 6   # 顯著負乖離
        elif bias <= 0:
            b_MA = 3   # 回測支撐
        # bias > 0 給 0 分
    score += min(10, b_MA)
    
    # === KD (25分) ===
    b_KD = 0
    if pd.notna(row['K']):
        b_KD_Pos = 0
        if row['K'] < 20:
            b_KD_Pos = 15  # 極度超賣區
        elif row['K'] < 30:
            b_KD_Pos = 5   # 超賣邊緣
        # K >= 30 給 0 分
        
        b_KD_Sig = 0
        if idx_pos > 0:
            prev_row = df.iloc[idx_pos - 1]
            if pd.notna(prev_row['K']) and pd.notna(prev_row['D']) and pd.notna(row['D']):
                if prev_row['K'] < prev_row['D'] and row['K'] > row['D']:  # 金叉
                    if row['K'] < 50:
                        b_KD_Sig = 10  # 低檔金叉確認
                    # K >= 50 給 0 分
        
        # 背離加分（優先級最高，直接滿分）
        if idx_pos >= 22:
            lookback = df.iloc[idx_pos-22:idx_pos-2]
            if len(lookback) > 0:
                min_price = lookback['Close'].min()
                min_k = lookback['K'].min()
                if pd.notna(row['K']):
                    if p < min_price and row['K'] > min_k:
                        b_KD = 25  # 背離直接滿分
                        b_KD_Pos = 0  # 重置位階分數
                        b_KD_Sig = 0  # 重置訊號分數
        
        if b_KD == 0:  # 沒有背離時才計算位階+訊號
            b_KD = min(25, b_KD_Pos + b_KD_Sig)
    score += b_KD
    
    # === RSI (25分) ===
    b_RSI = 0
    if pd.notna(row['RSI']):
        b_RSI_Pos = 0
        if row['RSI'] < 30:
            b_RSI_Pos = 15  # 極度超賣區
        elif row['RSI'] < 45:
            b_RSI_Pos = 5   # 弱勢整理區
        # RSI >= 45 給 0 分
        
        # 底背離加分（優先級最高，直接滿分）
        if idx_pos >= 22:
            lookback = df.iloc[idx_pos-22:idx_pos-2]
            if len(lookback) > 0:
                min_price = lookback['Close'].min()
                min_rsi = lookback['RSI'].min()
                if p < min_price and row['RSI'] > min_rsi:
                    b_RSI = 25  # 背離直接滿分
                    b_RSI_Pos = 0  # 重置位階分數
        
        if b_RSI == 0:  # 沒有背離時才看位階分數
            b_RSI = b_RSI_Pos
    score += min(25, b_RSI)
    
    # === MACD (5分) ===
    b_MACD = 0
    if idx_pos > 0:
        prev_row = df.iloc[idx_pos - 1]
        if pd.notna(prev_row['MACD_OSC']) and pd.notna(row['MACD_OSC']):
            goldCross = 0
            redConverge = 0
            
            # 黃金交叉（優先級最高）
            if prev_row['MACD_OSC'] < 0 and row['MACD_OSC'] > 0:
                goldCross = 5  # 滿分
            
            # 紅柱收斂（止跌訊號）
            if row['MACD_OSC'] < 0 and row['MACD_OSC'] > prev_row['MACD_OSC']:
                redConverge = 3  # 基礎分
            
            b_MACD = max(goldCross, redConverge)  # 取最大值
    score += min(5, b_MACD)
    
    # === DMI (0分) - 3231 不列入評分 ===
    b_DMI = 0
    score += b_DMI
    
    # === BB (30分) - 線性給分 ===
    b_BB = 0
    if pd.notna(row['BB_pctB']):
        pb = row['BB_pctB']
        if pb < 0:
            b_BB = 30  # 跌破下軌，超跌：滿分
        elif pb < 0.1:
            # 0 <= %B < 0.1：從 30 到 25 分線性映射
            b_BB = linear_map(pb, 0, 0.1, 30, 25)
        elif pb < 0.3:
            # 0.1 <= %B < 0.3：從 25 到 10 分線性映射
            b_BB = linear_map(pb, 0.1, 0.3, 25, 10)
        # %B >= 0.3 給 0 分
    score += min(30, max(0, b_BB))

    return min(100, score)

def calculate_sell_score(row):
    """3231 緯創：短線波段版賣出評分（總分 100）"""
    score = 0
    idx_pos = df.index.get_loc(row.name)
    p = row['Close']
    
    # === FIBO 評分 (5分) - 階梯式給分 ===
    s_Fibo = 0
    if row['Fibo_Valid'] and pd.notna(row['Fibo_ext1272']):
        if row['High'] >= row['Fibo_ext1272']:
            s_Fibo = 5  # 短線噴出，強烈建議賣出
        elif row['High'] >= row['Fibo_MaxPrice']:
            s_Fibo = 3  # 創新高，完成一個波段
        # 價格 < maxPrice 給 0 分
    score += s_Fibo
    
    # === 動態斜率 (0分) - 3231 不列入評分 ===
    s_Hist = 0
    score += s_Hist
    
    # === MA 月線 (10分) - MA20 ===
    s_MA = 0
    if pd.notna(row['MA20']) and pd.notna(row['Bias_20']):
        bias = row['Bias_20']
        biasScore = 0
        if bias > 8:
            biasScore = 10  # 急漲超買區，滿分
        elif bias > 4:
            biasScore = 6   # 獲利警戒區
        # bias <= 4% 給 0 分
        
        # 跌破分數（停利/停損）
        brokenScore = 0
        if p < row['MA20']:  # 今日收盤價 < MA20
            brokenScore = 3  # 至少給 3 分
        
        s_MA = max(biasScore, brokenScore)
    score += min(10, s_MA)
    
    # === KD (25分) ===
    s_KD = 0
    if pd.notna(row['K']):
        s_KD_Pos = 0
        if row['K'] > 80:
            s_KD_Pos = 25  # 極度超買區，直接滿分
        elif row['K'] > 70:
            s_KD_Pos = 15  # 警戒區
        # K <= 70 給 0 分
        
        # 3231 不等待死叉，不設訊號分數，也不設鈍化保護
        s_KD = s_KD_Pos  # 只看位階分數
    score += min(25, s_KD)
    
    # === RSI (25分) ===
    s_RSI = 0
    if pd.notna(row['RSI']):
        s_RSI_Pos = 0
        if row['RSI'] > 75:
            s_RSI_Pos = 25  # 極度超買區，直接滿分
        elif row['RSI'] > 60:
            s_RSI_Pos = 10  # 相對高檔
        # RSI <= 60 給 0 分
        
        # 頂背離加分（優先級最高，直接滿分）
        if idx_pos >= 22:
            lookback = df.iloc[idx_pos-22:idx_pos-2]
            if len(lookback) > 0:
                max_price = lookback['Close'].max()
                max_rsi = lookback['RSI'].max()
                if p > max_price and row['RSI'] < max_rsi:
                    s_RSI = 25  # 背離直接滿分
                    s_RSI_Pos = 0  # 重置位階分數
        
        if s_RSI == 0:  # 沒有背離時才看位階分數
            s_RSI = s_RSI_Pos
    score += min(25, s_RSI)
    
    # === MACD (5分) ===
    s_MACD = 0
    if idx_pos > 0:
        prev_row = df.iloc[idx_pos - 1]
        if pd.notna(prev_row['MACD_OSC']) and pd.notna(row['MACD_OSC']):
            deathCross = 0
            greenConverge = 0
            
            # 死亡交叉（優先級最高）
            if prev_row['MACD_OSC'] > 0 and row['MACD_OSC'] < 0:
                deathCross = 5  # 滿分
            
            # 綠柱收斂（上攻無力）
            if row['MACD_OSC'] > 0 and row['MACD_OSC'] < prev_row['MACD_OSC']:
                greenConverge = 3  # 基礎分
            
            s_MACD = max(deathCross, greenConverge)  # 取最大值
    score += min(5, s_MACD)
    
    # === DMI (0分) - 3231 不列入評分 ===
    s_DMI = 0
    score += s_DMI
    
    # === BB (30分) - 線性給分 ===
    s_BB = 0
    if pd.notna(row['BB_pctB']):
        pb = row['BB_pctB']
        if pb > 1.0:
            s_BB = 30  # 突破上軌：滿分
        elif pb > 0.9:
            # 0.9 < %B <= 1.0：從 25 到 30 分線性映射
            s_BB = linear_map(pb, 0.9, 1.0, 25, 30)
        # %B <= 0.9 給 0 分（但可能被假突破覆蓋）
        
        # 假突破（最高價 > 上軌 且 收盤價 < 上軌）
        if pd.notna(row['High']) and pd.notna(row['BB_Upper']):
            if row['High'] > row['BB_Upper'] and p < row['BB_Upper']:
                s_BB = max(s_BB, 20)  # 假突破至少 20 分
        
        # 注意：3231 移除開口爆量保護機制
    score += min(30, max(0, s_BB))
            
    return max(0, min(100, score))

# 應用評分
df['Buy_Score'] = df.apply(calculate_buy_score, axis=1)
df['Sell_Score'] = df.apply(calculate_sell_score, axis=1)

# --- 4. 視覺化繪圖 ---
# --- 修正後的視覺化繪圖 (Adjusted Thresholds) ---
plt.figure(figsize=(16, 12))

# 1. 股價圖
ax1 = plt.subplot(3, 1, 1)
ax1.plot(df.index, df['Close'], label='Price (3231)', color='black')
ax1.plot(df.index, df['MA20'], label='20 MA', color='orange', linestyle='--')
ax1.set_title('3231 Wistron: Price Trend', fontsize=14)
ax1.legend(loc='upper left')
ax1.grid(True, alpha=0.3)

# 2. 買入評分 (線性給分標準: 20 / 40 / 50)
ax2 = plt.subplot(3, 1, 2, sharex=ax1)
ax2.plot(df.index, df['Buy_Score'], label='Buy Score', color='#00CC00')

# 根據 temp.jsx 的門檻：>50強力買進, 40~50分批布局, 20~40中性觀察, <20觀望
ax2.axhline(y=20, color='blue', linestyle='--', alpha=0.5, label='中性觀察 (20)')
ax2.axhline(y=40, color='cyan', linestyle='--', label='分批佈局 (40)')
ax2.axhline(y=50, color='red', linestyle='--', label='強力買進 (50)')

ax2.fill_between(df.index, df['Buy_Score'], 50, where=(df['Buy_Score'] >= 50), color='green', alpha=0.4, label='強力買進區')
ax2.fill_between(df.index, df['Buy_Score'], 40, where=(df['Buy_Score'] >= 40) & (df['Buy_Score'] < 50), color='lightgreen', alpha=0.3, label='分批佈局區')
ax2.fill_between(df.index, df['Buy_Score'], 20, where=(df['Buy_Score'] >= 20) & (df['Buy_Score'] < 40), color='lightblue', alpha=0.2, label='中性觀察區')
ax2.set_ylabel('Buy Score')
ax2.set_title('Buy Signals (Linear Scoring: 20 / 40 / 50)', fontsize=12)
ax2.legend(loc='upper left', fontsize=8)
ax2.grid(True, alpha=0.3)

# 3. 賣出評分 (線性給分標準: 40 / 55)
ax3 = plt.subplot(3, 1, 3, sharex=ax1)
ax3.plot(df.index, df['Sell_Score'], label='Sell Score', color='#FF3333')

# 根據 temp.jsx 的門檻：>55清倉賣出, 40~55調節警戒, <=40續抱
ax3.axhline(y=40, color='orange', linestyle='--', label='調節警戒 (40)')
ax3.axhline(y=55, color='darkred', linestyle='--', label='清倉賣出 (55)')

ax3.fill_between(df.index, df['Sell_Score'], 55, where=(df['Sell_Score'] >= 55), color='red', alpha=0.4, label='清倉賣出區')
ax3.fill_between(df.index, df['Sell_Score'], 40, where=(df['Sell_Score'] >= 40) & (df['Sell_Score'] < 55), color='orange', alpha=0.3, label='調節警戒區')
ax3.set_ylabel('Sell Score')
ax3.set_title('Sell Signals (Linear Scoring: 40 / 55)', fontsize=12)
ax3.legend(loc='upper left', fontsize=8)
ax3.grid(True, alpha=0.3)

plt.tight_layout()
plt.show()