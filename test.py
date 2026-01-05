!pip install yfinance pandas numpy matplotlib ta

import yfinance as yf
import pandas as pd
import numpy as np
import matplotlib.pyplot as plt
from ta.momentum import RSIIndicator, StochasticOscillator
from scipy.stats import linregress

# --- 1. 資料抓取 ---
ticker = "6669.TW"
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

# B. MA 季線 (60MA)
df['MA60'] = df['Close'].rolling(window=60).mean()
df['MA60_Slope'] = df['MA60'].diff()
df['Bias_60'] = (df['Close'] - df['MA60']) / df['MA60'] * 100

# C. FIBO 波段 (120日滾動回溯，找最高點和最低點)
def calculate_fibo_levels(window_df):
    """計算 FIBO 位階：找最高點，然後找最高點前的最低點"""
    if len(window_df) < 5:
        return [np.nan] * 7
    
    closes = window_df['Close'].values
    # 找最高點索引
    max_idx = np.argmax(closes)
    max_price = closes[max_idx]
    
    # 找最高點前的最低點
    if max_idx < 5:
        # 如果最高點太前面，往前再找（最多200日）
        if len(window_df) > 200:
            extended_window = window_df.tail(200)
            min_price = extended_window['Close'].min()
        else:
            min_price = window_df['Close'].min()
    else:
        before_max = window_df.iloc[:max_idx+1]
        min_price = before_max['Close'].min()
    
    range_val = max_price - min_price
    if range_val <= 0:
        return [np.nan] * 7
    
    return [
        max_price - range_val * 0.236,  # l236
        max_price - range_val * 0.382,  # l382
        max_price - range_val * 0.5,    # l500
        max_price - range_val * 0.618,  # l618
        max_price - range_val * 0.786,  # l786
        max_price + range_val * 0.272,  # ext1272
        max_price + range_val * 0.618   # ext1618
    ]

# 計算 FIBO 位階（使用循環）
fibo_data = []
for i in range(len(df)):
    if i < 119:
        fibo_data.append([np.nan] * 7)
    else:
        window = df.iloc[i-119:i+1]
        fibo_vals = calculate_fibo_levels(window)
        fibo_data.append(fibo_vals)

fibo_df = pd.DataFrame(fibo_data, columns=['Fibo_l236', 'Fibo_l382', 'Fibo_l500', 'Fibo_l618', 'Fibo_l786', 'Fibo_ext1272', 'Fibo_ext1618'], index=df.index)
df = pd.concat([df, fibo_df], axis=1)

# 計算 FIBO 範圍和驗證有效性
df['Fibo_MaxPrice'] = df['Close'].rolling(window=120).max()
df['Fibo_MinPrice'] = df['Close'].rolling(window=120).min()
df['Fibo_Range'] = df['Fibo_MaxPrice'] - df['Fibo_MinPrice']
df['Fibo_Valid'] = (df['Fibo_Range'] / df['Fibo_MinPrice']) >= 0.1  # 門檻 10%

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
    score = 0
    
    # === FIBO 評分 (35分) - 線性給分 ===
    b_Fibo = 0
    if row['Fibo_Valid'] and pd.notna(row['Fibo_l236']):
        p = row['Close']
        max_price = row['Fibo_MaxPrice']
        
        # 線性給分
        base_score = 0
        if p > row['Fibo_l236']:
            # 高檔追價區間：從 l236 到 maxPrice，分數從 5 到 10
            base_score = linear_map(p, row['Fibo_l236'], max_price, 5, 10)
        elif p > row['Fibo_l382']:
            # 強勢接力區間：從 l382 到 l236，分數從 20 到 25
            base_score = linear_map(p, row['Fibo_l382'], row['Fibo_l236'], 20, 25)
        elif p > row['Fibo_l500']:
            # 合理價值區間：從 l500 到 l382，分數從 15 到 20
            base_score = linear_map(p, row['Fibo_l500'], row['Fibo_l382'], 15, 20)
        elif p >= row['Fibo_l618']:
            # 防守觀察區間：從 l618 到 l500，分數從 10 到 15
            base_score = linear_map(p, row['Fibo_l618'], row['Fibo_l500'], 10, 15)
        # 破線: base_score = 0
        
        # K線型態修正
        modifier = 0
        if pd.notna(row['Open']):
            # 止跌確認：收紅且價格上漲
            idx_pos = df.index.get_loc(row.name)
            prev_close = df.iloc[idx_pos - 1]['Close'] if idx_pos > 0 else row['Close']
            if row['Close'] > row['Open'] and row['Close'] > prev_close:
                modifier += 10  # 止跌確認
            
            body_len = abs(row['Close'] - row['Open'])
            lower_shadow = min(row['Close'], row['Open']) - row['Low']
            if lower_shadow > body_len and pd.notna(row['Fibo_l382']) and row['Low'] <= row['Fibo_l382']:
                modifier += 8  # 下影線
            
            # 量縮加分
            if pd.notna(row['VolMA5']) and row['Volume'] < (row['VolMA5'] * 0.7):
                modifier += 5  # 量縮
            
            # 殺盤扣分
            if row['Close'] < row['Open'] and pd.notna(row['ATR']) and body_len > (row['ATR'] * 1.5):
                modifier -= 10  # 殺盤
        
        b_Fibo = min(35, max(0, base_score + modifier))
    
    score += b_Fibo
    
    # === 動態斜率 (20分) - 線性給分 ===
    b_Hist = 0
    if pd.notna(row['Slope_PR']):
        sPerc = row['Slope_PR']
        b_Slope_Rank = 0
        
        if sPerc < 10:
            # 極度超跌區間：從 0% 到 10%，分數從 15 到 10
            b_Slope_Rank = linear_map(sPerc, 0, 10, 15, 10)
        elif sPerc < 25:
            # 價值區間：從 10% 到 25%，分數從 10 到 5
            b_Slope_Rank = linear_map(sPerc, 10, 25, 10, 5)
        elif sPerc < 40:
            # 初步區間：從 25% 到 40%，分數從 5 到 0
            b_Slope_Rank = linear_map(sPerc, 25, 40, 5, 0)
        
        # 動能加分
        b_Slope_Mom = 0
        if pd.notna(row['Slope_Prev']) and pd.notna(row['Slope_60']):
            if row['Slope_60'] > row['Slope_Prev']:
                b_Slope_Mom = 5
        
        b_Hist = b_Slope_Rank + b_Slope_Mom if b_Slope_Rank > 0 else 0
    
    score += b_Hist
    
    # === MA 季線 (7分) ===
    # 檢查是否破位（最近3天都在季線下）
    is_broken = False
    idx_pos = df.index.get_loc(row.name)
    if idx_pos >= 2:
        last3_days = df.iloc[idx_pos-2:idx_pos+1]
        if len(last3_days) == 3:
            is_broken = all(last3_days['Close'] < last3_days['MA60'])
    
    b_MA = 0
    if not is_broken:
        if pd.notna(row['MA60_Slope']) and row['MA60_Slope'] > 0:
            b_MA += 3
        if pd.notna(row['Bias_60']):
            if 0 < row['Bias_60'] <= 5:
                b_MA += 4
            elif 5 < row['Bias_60'] <= 10:
                b_MA += 2
            elif row['Bias_60'] < 0 and row['MA60_Slope'] > 0:
                b_MA += 1
    score += min(7, b_MA)
    
    # === KD (10分) ===
    b_KD_Pos = 0
    if pd.notna(row['K']):
        if row['K'] < 20:
            b_KD_Pos = 4
        elif row['K'] < 40:
            b_KD_Pos = 2
    
    b_KD_Sig = 0
    idx_pos = df.index.get_loc(row.name)
    if idx_pos > 0:
        prev_row = df.iloc[idx_pos - 1]
        if pd.notna(prev_row['K']) and pd.notna(prev_row['D']) and pd.notna(row['K']) and pd.notna(row['D']):
            if prev_row['K'] < prev_row['D'] and row['K'] > row['D']:  # 金叉
                if row['K'] < 20:
                    b_KD_Sig = 6
                elif row['K'] < 50:
                    b_KD_Sig = 3
    
    # 背離加分（檢查過去20天）
    if idx_pos >= 22:
        lookback = df.iloc[idx_pos-22:idx_pos-2]
        if len(lookback) > 0:
            min_price = lookback['Close'].min()
            min_k = lookback['K'].min()
            if pd.notna(row['Close']) and pd.notna(row['K']):
                if row['Close'] < min_price and row['K'] > min_k:
                    b_KD_Pos = 10  # 背離直接滿分
    
    b_KD = min(10, b_KD_Pos + b_KD_Sig)
    score += b_KD
    
    # === RSI (10分) ===
    b_RSI = 0
    if pd.notna(row['RSI']):
        if row['RSI'] < 30:
            b_RSI = 7
        elif row['RSI'] < 50:
            b_RSI = 5
        elif row['RSI'] < 60:
            b_RSI = 2
        
        # 突破50加分
        idx_pos = df.index.get_loc(row.name)
        if idx_pos > 0:
            prev_row = df.iloc[idx_pos - 1]
            if pd.notna(prev_row['RSI']) and prev_row['RSI'] <= 50 and row['RSI'] > 50:
                b_RSI += 2
        
        # 底背離加分（檢查過去20天）
        if idx_pos >= 22:
            lookback = df.iloc[idx_pos-22:idx_pos-2]
            if len(lookback) > 0:
                min_price = lookback['Close'].min()
                min_rsi = lookback['RSI'].min()
                if pd.notna(row['Close']) and pd.notna(row['RSI']):
                    if row['Close'] < min_price and row['RSI'] > min_rsi:
                        b_RSI += 3
    
    score += min(10, b_RSI)
    
    # === MACD (7分) ===
    b_MACD = 0
    idx_pos = df.index.get_loc(row.name)
    if idx_pos > 0:
        prev_row = df.iloc[idx_pos - 1]
        if pd.notna(prev_row['MACD_OSC']) and pd.notna(row['MACD_OSC']):
            if prev_row['MACD_OSC'] < 0 and row['MACD_OSC'] > prev_row['MACD_OSC']:
                b_MACD += 3  # 紅收斂
            if prev_row['MACD_OSC'] < 0 and row['MACD_OSC'] > 0:
                b_MACD += 2  # 金叉
            
            # 底背離
            if idx_pos >= 22:
                lookback = df.iloc[idx_pos-22:idx_pos-2]
                if len(lookback) > 0:
                    min_price = lookback['Close'].min()
                    min_osc = lookback['MACD_OSC'].min()
                    if pd.notna(row['Close']) and pd.notna(row['MACD_OSC']):
                        if row['Close'] < min_price and row['MACD_OSC'] > min_osc and row['MACD_OSC'] < 0:
                            b_MACD += 2
    
    score += min(7, b_MACD)
    
    # === DMI (6分) ===
    b_DMI = 0
    idx_pos = df.index.get_loc(row.name)
    if pd.notna(row['PDI']) and pd.notna(row['MDI']) and row['PDI'] > row['MDI']:
        b_DMI += 2
        if idx_pos > 0:
            prev_row = df.iloc[idx_pos - 1]
            if pd.notna(prev_row['PDI']) and pd.notna(prev_row['MDI']):
                if prev_row['PDI'] <= prev_row['MDI'] and row['PDI'] > row['MDI']:
                    b_DMI += 1  # 金叉
            if pd.notna(prev_row['ADX']) and pd.notna(row['ADX']):
                if row['ADX'] > 25 and row['ADX'] > prev_row['ADX']:
                    b_DMI += 3
                elif row['ADX'] < 25 and row['ADX'] > prev_row['ADX']:
                    b_DMI += 1
        if pd.notna(row['ADX']) and row['ADX'] > 50:
            b_DMI -= 1
    
    score += max(0, min(6, b_DMI))
    
    # === BB (5分) ===
    b_BB = 0
    if pd.notna(row['BB_pctB']):
        pb = row['BB_pctB']
        if pb < 0:
            b_BB = 3
        elif pb < 0.1:
            b_BB = 2
        
        # 中軌回測
        idx_pos = df.index.get_loc(row.name)
        if idx_pos > 0 and pd.notna(row['BB_Mid']):
            prev_row = df.iloc[idx_pos - 1]
            if pd.notna(prev_row['BB_Mid']) and row['BB_Mid'] != 0:
                mid_slope = row['BB_Mid'] - prev_row['BB_Mid']
                dist_to_mid = abs((row['Close'] - row['BB_Mid']) / row['BB_Mid'])
                if mid_slope > 0 and dist_to_mid < 0.01:
                    b_BB = 2
    
    score += min(5, b_BB)

    return min(100, score)

def calculate_sell_score(row):
    score = 0
    
    # === FIBO 評分 (35分) ===
    s_Fibo = 0
    if row['Fibo_Valid'] and pd.notna(row['Fibo_ext1618']):
        if row['High'] >= row['Fibo_ext1618']:
            s_Fibo = 35  # 獲利滿足
        elif row['High'] >= row['Fibo_ext1272']:
            s_Fibo = 28  # 第一壓力
        elif row['Close'] > row['Fibo_MaxPrice']:
            s_Fibo = 15  # 解套賣壓
        if pd.notna(row['Fibo_l618']) and row['Close'] < row['Fibo_l618']:
            s_Fibo = 35  # 停損
    
    score += s_Fibo
    
    # === 動態斜率 (20分) - 線性給分 ===
    s_Hist = 0
    if pd.notna(row['Slope_PR']):
        sPerc = row['Slope_PR']
        s_Slope_Rank = 0
        
        if sPerc > 90:
            # 極度過熱區間：從 90% 到 100%，分數從 10 到 15
            s_Slope_Rank = linear_map(sPerc, 90, 100, 10, 15)
        elif sPerc > 75:
            # 警戒區間：從 75% 到 90%，分數從 5 到 10
            s_Slope_Rank = linear_map(sPerc, 75, 90, 5, 10)
        elif sPerc > 60:
            # 初步區間：從 60% 到 75%，分數從 0 到 5
            s_Slope_Rank = linear_map(sPerc, 60, 75, 0, 5)
        
        # 動能扣分
        s_Slope_Mom = 0
        if pd.notna(row['Slope_Prev']) and pd.notna(row['Slope_60']):
            if row['Slope_60'] < row['Slope_Prev']:
                s_Slope_Mom = 5
        
        s_Hist = s_Slope_Rank + s_Slope_Mom if s_Slope_Rank > 0 else 0
    
    score += s_Hist
    
    # === MA 季線 (7分) ===
    # 檢查是否破位（最近3天都在季線下）
    is_broken = False
    idx_pos = df.index.get_loc(row.name)
    if idx_pos >= 2:
        last3_days = df.iloc[idx_pos-2:idx_pos+1]
        if len(last3_days) == 3:
            is_broken = all(last3_days['Close'] < last3_days['MA60'])
    
    s_MA = 0
    if pd.notna(row['MA60_Slope']) and row['MA60_Slope'] < 0:
        s_MA += 3
    if pd.notna(row['Bias_60']):
        if row['Bias_60'] > 25:
            s_MA += 4
        elif row['Bias_60'] > 15:
            s_MA += 2
    if is_broken:
        s_MA = max(s_MA, 3)
    score += min(7, s_MA)
    
    # === KD (10分) ===
    s_KD_Pos = 0
    if pd.notna(row['K']):
        if row['K'] > 80:
            s_KD_Pos = 3
        elif row['K'] > 70:
            s_KD_Pos = 1
    
    s_KD_Sig = 0
    if idx_pos > 0:
        prev_row = df.iloc[idx_pos - 1]
        if pd.notna(prev_row['K']) and pd.notna(prev_row['D']) and pd.notna(row['K']) and pd.notna(row['D']):
            if prev_row['K'] > prev_row['D'] and row['K'] < row['D']:  # 死叉
                if row['K'] > 80:
                    s_KD_Sig = 7
                elif row['K'] > 50:
                    s_KD_Sig = 4
    
    s_KD = min(10, s_KD_Pos + s_KD_Sig)
    
    # 鈍化保護：如果最近3天 K > 80 且都在漲 (K>D)，不給分
    if idx_pos >= 2 and pd.notna(row['K']) and row['K'] > 80:
        last3_days = df.iloc[idx_pos-2:idx_pos+1]
        if len(last3_days) == 3:
            last3_k = last3_days['K'].values
            last3_d = last3_days['D'].values
            if all(k > 80 for k in last3_k if pd.notna(k)) and all(k > d for k, d in zip(last3_k, last3_d) if pd.notna(k) and pd.notna(d)):
                s_KD = 0
    
    score += s_KD
    
    # === RSI (10分) ===
    s_RSI = 0
    if pd.notna(row['RSI']):
        if row['RSI'] > 80:
            s_RSI = 7
        elif row['RSI'] > 70:
            s_RSI = 5
        elif row['RSI'] > 60:
            s_RSI = 2
        
        # 跌破50加分
        if idx_pos > 0:
            prev_row = df.iloc[idx_pos - 1]
            if pd.notna(prev_row['RSI']) and prev_row['RSI'] >= 50 and row['RSI'] < 50:
                s_RSI += 2
    
    score += min(10, s_RSI)
    
    # === MACD (7分) ===
    s_MACD = 0
    if idx_pos > 0:
        prev_row = df.iloc[idx_pos - 1]
        if pd.notna(prev_row['MACD_OSC']) and pd.notna(row['MACD_OSC']):
            if prev_row['MACD_OSC'] > 0 and row['MACD_OSC'] < prev_row['MACD_OSC']:
                s_MACD += 3  # 綠收斂
            if prev_row['MACD_OSC'] > 0 and row['MACD_OSC'] < 0:
                s_MACD += 2  # 死叉
    
    score += min(7, s_MACD)
    
    # === DMI (6分) ===
    s_DMI = 0
    if pd.notna(row['PDI']) and pd.notna(row['MDI']) and row['MDI'] > row['PDI']:
        s_DMI += 2
        if idx_pos > 0:
            prev_row = df.iloc[idx_pos - 1]
            if pd.notna(prev_row['ADX']) and pd.notna(row['ADX']):
                if row['ADX'] > 25 and row['ADX'] > prev_row['ADX']:
                    s_DMI += 3
    
    score += min(6, s_DMI)
    
    # === BB (5分) ===
    s_BB = 0
    if pd.notna(row['BB_pctB']):
        pb = row['BB_pctB']
        if pb > 1.1:
            s_BB = 3
        elif pb > 1.0:
            s_BB = 1
        
        # 假突破
        if pd.notna(row['High']) and pd.notna(row['BB_Upper']) and pd.notna(row['Close']):
            if row['High'] > row['BB_Upper'] and row['Close'] < row['BB_Upper']:
                s_BB = 2
        
        # 開口爆量保護
        if idx_pos > 0:
            prev_row = df.iloc[idx_pos - 1]
            if pd.notna(prev_row['BB_BandWidth']) and pd.notna(row['BB_BandWidth']) and pd.notna(row['VolMA5']):
                bw_open = row['BB_BandWidth'] > prev_row['BB_BandWidth']
                vol_exp = pd.notna(row['Volume']) and row['Volume'] > (row['VolMA5'] * 1.5)
                if bw_open and vol_exp and s_BB > 0:
                    s_BB = 0
    
    score += min(5, s_BB)
            
    return max(0, min(100, score))

# 應用評分
df['Buy_Score'] = df.apply(calculate_buy_score, axis=1)
df['Sell_Score'] = df.apply(calculate_sell_score, axis=1)

# --- 4. 視覺化繪圖 ---
# --- 修正後的視覺化繪圖 (Adjusted Thresholds) ---
plt.figure(figsize=(16, 12))

# 1. 股價圖
ax1 = plt.subplot(3, 1, 1)
ax1.plot(df.index, df['Close'], label='Price (6669)', color='black')
ax1.plot(df.index, df['MA60'], label='60 MA', color='orange', linestyle='--')
ax1.set_title('6669 Wiwynn: Price Trend', fontsize=14)
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