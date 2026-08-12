import React, { useState, useEffect, useMemo, useRef } from 'react';
import { ComposedChart, Area, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts';
import { Activity, BarChart3, RefreshCw, Info, ChevronLeft, ChevronRight, Maximize2, Minimize2, ShieldCheck, HelpCircle, X, Search, TrendingUp, AlertTriangle, Plus } from 'lucide-react';

const App = () => {
  // Tab 管理系統 - 預設兩個 tab
  const [tabs, setTabs] = useState([
    { id: '6669', symbol: '6669', data: [], loading: false, manualPrice: '', fetchError: null, visibleLayers: { ma: false, fibo: false, rsi: false, macd: false, bb: false, slope: false, dmi: false, kd: false } },
    { id: '3231', symbol: '3231', data: [], loading: false, manualPrice: '', fetchError: null, visibleLayers: { ma: false, fibo: false, rsi: false, macd: false, bb: false, slope: false, dmi: false, kd: false } },
    { id: '2301', symbol: '2301', data: [], loading: false, manualPrice: '', fetchError: null, visibleLayers: { ma: false, fibo: false, rsi: false, macd: false, bb: false, slope: false, dmi: false, kd: false } }
  ]);
  const [activeTabId, setActiveTabId] = useState('6669');
  const [isChartExpanded, setIsChartExpanded] = useState(false);
  const [activeInfo, setActiveInfo] = useState(null);
  const [loadingProgress, setLoadingProgress] = useState({
    currentProxy: 0,
    totalProxies: 0,
    retryCount: 0,
    maxRetries: 0,
    proxyName: ''
  });
  
  // 當前活動 tab 的數據（方便使用）
  const activeTab = useMemo(() => tabs.find(t => t.id === activeTabId) || tabs[0], [tabs, activeTabId]);
  const stockSymbol = activeTab?.symbol || '6669';
  const is3231 = stockSymbol === '3231'; // 組件層級的 is3231，用於 JSX 渲染
  const is2301 = stockSymbol === '2301'; // 2301 光寶科：目標持倉制（階梯加碼 + 賣訊清空）
  const is6669 = !is3231 && !is2301;      // 6669 V25：RSI 買進 + 季線乖離減碼
  // 2301 手動輸入目前持有張數（不寫入 localStorage，僅本次瀏覽有效）
  const [lots2301, setLots2301] = useState('');
  const data = activeTab?.data || [];
  const loading = activeTab?.loading || false;
  const manualPrice = activeTab?.manualPrice || '';
  const fetchError = activeTab?.fetchError || null;
  const visibleLayers = activeTab?.visibleLayers || { ma: false, fibo: false, rsi: false, macd: false, bb: false, slope: false, dmi: false, kd: false };

  const chartRef = useRef(null);
  const isDragging = useRef(false);
  const startX = useRef(0);
  const scrollLeft = useRef(0);
  // 為每個 tab 儲存 AbortController，避免切換 tab 時中止正在進行的請求
  const abortControllersRef = useRef({});
  // 使用 ref 追蹤當前的 activeTabId，避免閉包問題
  const activeTabIdRef = useRef(activeTabId);
  
  // 當 activeTabId 改變時，更新 ref
  useEffect(() => {
    activeTabIdRef.current = activeTabId;
  }, [activeTabId]);

  // 更新 tab 的輔助函數
  const updateTab = (tabId, updates) => {
    setTabs(prev => prev.map(tab => 
      tab.id === tabId ? { ...tab, ...updates } : tab
    ));
  };


  // 切換 tab
  const switchTab = (tabId) => {
    setActiveTabId(tabId);
    const tab = tabs.find(t => t.id === tabId);
    // 如果該 tab 沒有數據且沒有正在載入，則載入數據
    if (tab && tab.data.length === 0 && !tab.loading && !tab.fetchError) {
      console.log(`[切換 Tab] 載入 ${tab.symbol} (${tabId}) 的數據`);
      fetchStockData(tab.symbol, tabId);
    } else if (tab && tab.fetchError) {
      // 如果有錯誤，清除錯誤並重新載入
      console.log(`[切換 Tab] ${tab.symbol} (${tabId}) 之前有錯誤，清除錯誤並重新載入`);
      updateTab(tabId, { fetchError: null });
      fetchStockData(tab.symbol, tabId);
    }
  };

  // 定義各指標滿分權重
  const MAX_SCORES = {
    fibo: 35, slope: 20, ma: 7, rsi: 10, kd: 10, bb: 5, macd: 7, dmi: 6
  };

  const themeColors = {
    target: '#ef4444', ext1272: '#f97316', l236: '#818cf8', l382: '#6366f1', 
    l500: '#8b5cf6', l618: '#10b981', l786: '#059669', price: '#a78bfa', ma: '#3b82f6', 
    rsi: '#d946ef', macd: '#2dd4bf', dmi: '#fbbf24', bb: '#f59e0b', slope: '#818cf8',
    kd_k: '#facc15', kd_d: '#f43f5e',
    cardBg: '#18181b', 
  };

  // Helper Functions
  const calculateSMA = (data, period, key = 'price') => {
    return data.map((item, index, arr) => {
      if (index < period - 1) return null;
      const slice = arr.slice(index - period + 1, index + 1);
      const sum = slice.reduce((a, b) => a + (b[key] || 0), 0);
      return sum / period;
    });
  };

  const calculateATR = (highs, lows, closes, period = 14) => {
    let tr = [];
    for(let i = 0; i < closes.length; i++) {
      if (i === 0) {
        tr.push(highs[i] - lows[i]);
      } else {
        const hl = highs[i] - lows[i];
        const hc = Math.abs(highs[i] - closes[i-1]);
        const lc = Math.abs(lows[i] - closes[i-1]);
        tr.push(Math.max(hl, hc, lc));
      }
    }
    // Simple SMA of TR
    let atr = [];
    let sum = 0;
    for(let i = 0; i < tr.length; i++) {
        sum += tr[i];
        if (i >= period) {
            sum -= tr[i - period];
            atr.push(sum / period);
        } else {
            atr.push(sum / (i + 1));
        }
    }
    return atr;
  };

  const processMarketData = (rawItems) => {
    // 確保數據按日期升序
    const sortedItems = [...rawItems].sort((a, b) => new Date(a.fullDate) - new Date(b.fullDate));
    
    const closes = sortedItems.map(d => d.price || 0);
    const highs = sortedItems.map(d => d.high || d.price * 1.01);
    const lows = sortedItems.map(d => d.low || d.price * 0.99);
    const volumes = sortedItems.map(d => d.volume || 0);
    const opens = sortedItems.map(d => d.open || d.price);

    const calculateEMA = (values, period) => {
      const k = 2 / (period + 1);
      let emaArr = [values[0]];
      for (let i = 1; i < values.length; i++) {
        emaArr.push(values[i] * k + emaArr[i - 1] * (1 - k));
      }
      return emaArr;
    };

    const ema12 = calculateEMA(closes, 12);
    const ema26 = calculateEMA(closes, 26);
    const dif = ema12.map((e, i) => e - ema26[i]);
    const dem = calculateEMA(dif, 9);
    const osc = dif.map((d, i) => d - dem[i]);

    // KD (9,3,3)
    let kVal = 50, dVal = 50;
    const kdData = sortedItems.map((_, i) => {
        if (i < 8) return { k: 50, d: 50 };
        const windowHigh = Math.max(...highs.slice(i - 8, i + 1));
        const windowLow = Math.min(...lows.slice(i - 8, i + 1));
        const rsv = windowHigh === windowLow ? 50 : ((closes[i] - windowLow) / (windowHigh - windowLow)) * 100;
        kVal = (2/3) * kVal + (1/3) * rsv;
        dVal = (2/3) * dVal + (1/3) * kVal;
        return { k: kVal, d: dVal };
    });

    // ── 2301 專用：K5（台股 1/3 平滑，視窗 5）──
    let k5v = 50, d5v = 50;
    const k5Data = sortedItems.map((_, i) => {
        if (i < 4) return 50;
        const wh = Math.max(...highs.slice(i - 4, i + 1));
        const wl = Math.min(...lows.slice(i - 4, i + 1));
        const rsv = wh === wl ? 50 : ((closes[i] - wl) / (wh - wl)) * 100;
        k5v = (2/3) * k5v + (1/3) * rsv;
        d5v = (2/3) * d5v + (1/3) * k5v;
        return k5v;
    });

    // ── 2301 專用：Cutler RSI 多週期（與現有 rsiVal 同法：SMA 分母）──
    const cutlerRSI = (period) => closes.map((_, i) => {
      if (i < period) return null;
      let up = 0, down = 0;
      for (let j = i - period + 1; j <= i; j++) {
        const diff = closes[j] - closes[j - 1];
        if (diff > 0) up += diff; else down -= diff;
      }
      return 100 - (100 / (1 + (up / (down || 1e-9))));
    });
    const rsi5Arr = cutlerRSI(5);
    const rsi9Arr = cutlerRSI(9);
    const rsi21Arr = cutlerRSI(21);

    // DMI
    const tr = [], pdm = [], mdm = [];
    for(let i=1; i<closes.length; i++) {
        const h = highs[i], l = lows[i], c_1 = closes[i-1];
        tr.push(Math.max(h-l, Math.abs(h-c_1), Math.abs(l-c_1)));
        pdm.push(highs[i]-highs[i-1] > lows[i-1]-lows[i] ? Math.max(highs[i]-highs[i-1], 0) : 0);
        mdm.push(lows[i-1]-lows[i] > highs[i]-highs[i-1] ? Math.max(lows[i-1]-lows[i], 0) : 0);
    }
    tr.unshift(0); pdm.unshift(0); mdm.unshift(0);
    
    const smooth = (arr) => {
        let res = [arr[0]];
        for(let i=1; i<arr.length; i++) res.push((res[i-1]*13 + arr[i])/14);
        return res;
    }
    const str = smooth(tr);
    const spdm = smooth(pdm);
    const smdm = smooth(mdm);
    const pdi = spdm.map((v, i) => 100 * v / (str[i] || 1));
    const mdi = smdm.map((v, i) => 100 * v / (str[i] || 1));
    const dx = pdi.map((p, i) => 100 * Math.abs(p - mdi[i]) / (p + mdi[i] || 1));
    const adx = smooth(dx);

    // Vol MA & ATR
    const volMA5 = calculateSMA(sortedItems, 5, 'volume');
    const volMA20 = calculateSMA(sortedItems, 20, 'volume');
    const atr14 = calculateATR(highs, lows, closes, 14);

    return sortedItems.map((item, i) => {
      let ma20 = i >= 19 ? closes.slice(i - 19, i + 1).reduce((a, b) => a + b, 0) / 20 : null; // 3231 用月線
      let ma60 = i >= 59 ? closes.slice(i - 59, i + 1).reduce((a, b) => a + b, 0) / 60 : null; // 6669 用季線
      let rsiVal = null;
      if(i >= 14) {
        let up = 0, down = 0;
        for (let j = i - 13; j <= i; j++) {
          const diff = closes[j] - closes[j-1];
          if (diff > 0) up += diff; else down -= diff;
        }
        rsiVal = 100 - (100 / (1 + (up / (down || 1))));
      }
      let slopeVal = 0;
      if (i >= 60) {
        const y = closes.slice(i - 60, i + 1);
        const x = Array.from({length: y.length}, (_, idx) => idx);
        const n = y.length;
        const sumX = x.reduce((a, b) => a + b, 0);
        const sumY = y.reduce((a, b) => a + b, 0);
        const sumXX = x.reduce((a, b) => a + b * b, 0);
        const sumXY = x.reduce((a, b, idx) => a + b * y[idx], 0);
        slopeVal = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);
      }
      let upper = null, lower = null, mid = null, pctB = null, bandWidth = null;
      if (i >= 19) {
        const slice = closes.slice(i - 19, i + 1);
        mid = slice.reduce((a, b) => a + b, 0) / 20;
        const stdDev = Math.sqrt(slice.map(x => Math.pow(x - mid, 2)).reduce((a, b) => a + b) / 20);
        upper = mid + 2 * stdDev; 
        lower = mid - 2 * stdDev;
        if(upper !== lower) pctB = (closes[i] - lower) / (upper - lower);
        if(mid !== 0) bandWidth = (upper - lower) / mid;
      }
      // ── 2301 專用：MA5 / MA10 / MA120 與各期負乖離 ──
      const sma = (p) => i >= p - 1 ? closes.slice(i - p + 1, i + 1).reduce((a, b) => a + b, 0) / p : null;
      const ma5 = sma(5), ma10 = sma(10), ma120 = sma(120);
      const biasOf = (m) => (m && m !== 0) ? (closes[i] - m) / m * 100 : null;

      // ── 2301 專用：近 1/3/5 日漲跌幅（%）──
      const retN = (n) => i >= n ? (closes[i] / closes[i - n] - 1) * 100 : null;

      // ── 2301 專用：自 N 日高點回落 / 自 60 日低點反彈（%）──
      const pullback = (w) => {
        const lo_ = Math.max(0, i - w + 1);
        const pk = Math.max(...closes.slice(lo_, i + 1));
        return pk > 0 ? (pk - closes[i]) / pk * 100 : 0;
      };
      const rebound = (w) => {
        const lo_ = Math.max(0, i - w + 1);
        const tg = Math.min(...closes.slice(lo_, i + 1));
        return tg > 0 ? (closes[i] - tg) / tg * 100 : 0;
      };

      // ── 2301 專用：20 日箱型位置（0~1）──
      let box20 = null;
      if (i >= 19) {
        const w = closes.slice(i - 19, i + 1);
        const mx = Math.max(...w), mn = Math.min(...w);
        box20 = mx > mn ? (closes[i] - mn) / (mx - mn) : 0.5;
      }

      return {
        ...item, ma20, ma60, rsiVal, slopeVal, upper, lower, mid, pctB, bandWidth,
        macd: osc[i] || 0, adx: adx[i] || 0, pdi: pdi[i] || 0, mdi: mdi[i] || 0,
        k: kdData[i].k, d: kdData[i].d,
        volMA5: volMA5[i] || 0, volMA20: volMA20[i] || 0, atr: atr14[i] || 0,
        open: opens[i], volume: volumes[i],
        // ── 2301 評分所需 ──
        ma5, ma10, ma120,
        bias5: biasOf(ma5), bias10: biasOf(ma10), bias20: biasOf(ma20),
        bias60: biasOf(ma60), bias120: biasOf(ma120),
        rsi5: rsi5Arr[i], rsi9: rsi9Arr[i], rsi21: rsi21Arr[i], k5: k5Data[i],
        ret1: retN(1), ret3: retN(3), ret5: retN(5),
        pb10: pullback(10), pb20: pullback(20), pb60: pullback(60),
        rb60: rebound(60), box20,
        macdPrev: i > 0 ? (osc[i - 1] || 0) : null
      };
    });
  };

  const fetchStockData = async (symbol = "6669", tabId = null, retryCount = 0, proxyIndex = 0) => {
    const targetTabId = tabId || activeTabId;
    updateTab(targetTabId, { loading: true, fetchError: null });
    
    const maxRetries = 3;
    // 處理股票代號：如果沒有包含點號，則加上 .TW 後綴（台灣股票）
    const ticker = symbol.toUpperCase().includes('.') ? symbol.toUpperCase() : `${symbol.toUpperCase()}.TW`;
    const endTime = Math.floor(Date.now() / 1000);
    const startTime = 0;
    
    const yahooUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?period1=${startTime}&period2=${endTime}&interval=1d`;
    
    // 多個備用代理服務，提高穩定性
    const proxyServices = [
      // 主要代理：allorigins.win
      { name: 'AllOrigins (主要)', func: (url) => `https://api.allorigins.win/get?url=${encodeURIComponent(url)}` },
      // 備用代理 1：corsproxy.io
      { name: 'CorsProxy', func: (url) => `https://corsproxy.io/?${encodeURIComponent(url)}` },
      // 備用代理 2：allorigins raw
      { name: 'AllOrigins (Raw)', func: (url) => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}` },
      // 備用代理 3：cors.sh
      { name: 'CORS.sh', func: (url) => `https://cors.sh/${url}` },
      // 備用代理 4：直接嘗試 Yahoo Finance (可能因 CORS 失敗，但某些環境可用)
      { name: 'Yahoo Finance (直接)', func: (url) => url }
    ];
    
    // 調試信息：輸出構建的 URL
    console.log(`[${symbol}] 構建的 Yahoo Finance URL:`, yahooUrl);
    console.log(`[${symbol}] Ticker:`, ticker);
    const currentProxyIndex = proxyIndex % proxyServices.length;
    const currentProxy = proxyServices[currentProxyIndex];
    const proxyUrl = currentProxy.func(yahooUrl);
    console.log(`[${symbol}] 使用的代理: ${currentProxy.name}, 代理 URL:`, proxyUrl);
    
    // 更新進度狀態
    setLoadingProgress({
      currentProxy: currentProxyIndex + 1,
      totalProxies: proxyServices.length,
      retryCount: retryCount + 1,
      maxRetries: maxRetries,
      proxyName: currentProxy.name
    });
    
    try {
      // 為每個 tab 創建獨立的 AbortController，避免切換 tab 時中止正在進行的請求
      // 如果該 tab 已經有正在進行的請求，先中止它
      if (abortControllersRef.current[targetTabId]) {
        abortControllersRef.current[targetTabId].abort();
      }
      const controller = new AbortController();
      abortControllersRef.current[targetTabId] = controller;
      
      // 增加超時時間到 20 秒，給代理服務更多時間
      const timeoutId = setTimeout(() => {
        if (!controller.signal.aborted) {
          controller.abort();
        }
      }, 20000); // 20秒超時
      
      const response = await fetch(proxyUrl, {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
        },
        signal: controller.signal
      });
      
      clearTimeout(timeoutId);
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      let json;
      // 處理不同的代理響應格式
      if (currentProxyIndex === 0 || currentProxyIndex === 2) {
        // allorigins.win 格式：{ contents: "..." }
        json = await response.json();
        if (json.contents) {
          json = JSON.parse(json.contents);
        }
      } else if (currentProxyIndex === 1 || currentProxyIndex === 3) {
        // corsproxy.io 和 cors.sh 直接返回 JSON
        json = await response.json();
      } else {
        // 直接請求 Yahoo Finance (index 4)
        json = await response.json();
      }
      
      // 更新進度：成功獲取數據
      setLoadingProgress(prev => ({
        ...prev,
        status: 'processing'
      }));
      
      const result = json.chart?.result?.[0];
      
      if (!result) {
        throw new Error("股票代號不存在或無法取得數據");
      }

      let lastM = -1;
      const formatted = result.timestamp.map((ts, i) => {
        const d = new Date(ts * 1000);
        const isNewMonth = d.getMonth() !== lastM;
        if (isNewMonth) lastM = d.getMonth();
        return {
          fullDate: d.toLocaleDateString(),
          displayDate: isNewMonth ? (d.getMonth() === 0 ? `${d.getFullYear()}年` : `${d.getMonth() + 1}月`) : '', 
          isNewMonth,
          price: result.indicators.quote[0].close[i],
          high: result.indicators.quote[0].high[i],
          low: result.indicators.quote[0].low[i],
          open: result.indicators.quote[0].open[i],
          volume: result.indicators.quote[0].volume[i]
        };
      }).filter(d => d.price !== null);
      
      if (formatted.length === 0) {
        throw new Error("無法取得有效的股價數據");
      }
      
      const processed = processMarketData(formatted);
      
      // 無論使用者目前停留在哪個 tab，都應該更新目標 tab 的資料並結束 loading。
      // 否則在請求期間切 tab 時，目標 tab 可能永遠維持 loading=true 而呈現空白/模糊狀態。
      updateTab(targetTabId, {
        data: processed,
        manualPrice: processed.length > 0 ? Math.round(processed[processed.length - 1].price).toString() : '',
        loading: false
      });
      
      // 清除 AbortController 引用
      delete abortControllersRef.current[targetTabId];
      
      // 清除進度狀態
      setLoadingProgress({
        currentProxy: 0,
        totalProxies: 0,
        retryCount: 0,
        maxRetries: 0,
        proxyName: ''
      });
    } catch (err) {
      // 檢查是否是因為 AbortController 超時或被中止
      const isAbortError = err.name === 'AbortError' || err.message?.includes('aborted');
      const isNetworkError = err.name === 'TypeError' && err.message?.includes('Failed to fetch');
      
      // 檢查用戶是否已經切換到其他 tab（使用 ref 獲取最新的 activeTabId，避免閉包問題）
      const currentActiveTabId = activeTabIdRef.current;
      const userSwitchedTab = currentActiveTabId !== targetTabId;
      
      // 如果是因為切換 tab 導致的中止，不顯示錯誤也不重試
      if (isAbortError && userSwitchedTab) {
        console.log(`[${symbol}] 請求被中止（用戶切換到其他 tab: ${currentActiveTabId}，目標 tab: ${targetTabId}）`);
        // 清除該 tab 的 loading 狀態
        updateTab(targetTabId, { loading: false });
        // 清除 AbortController 引用
        delete abortControllersRef.current[targetTabId];
        return;
      }
      
      // 如果是中止錯誤但用戶沒有切換 tab，可能是超時，應該重試
      if (isAbortError && !userSwitchedTab) {
        console.warn(`[${symbol}] 請求超時或被中止（但用戶仍在該 tab: ${currentActiveTabId}），將重試`);
      }
      
      console.error(`[${symbol}] Fetch Error (代理 ${currentProxyIndex + 1}/${proxyServices.length}, 嘗試 ${retryCount + 1}/${maxRetries}):`, err);
      console.error(`[${symbol}] 錯誤類型:`, err.name);
      console.error(`[${symbol}] 錯誤訊息:`, err.message);
      console.error(`[${symbol}] 請求的 URL:`, proxyUrl);
      console.error(`[${symbol}] Ticker:`, ticker);
      console.error(`[${symbol}] 當前 activeTabId: ${currentActiveTabId}, targetTabId: ${targetTabId}`);
      
      // 更新進度：顯示錯誤
      setLoadingProgress(prev => ({
        ...prev,
        error: err.message || '連線失敗'
      }));
      
      // 如果還有其他代理可以嘗試，先切換代理
      if (currentProxyIndex < proxyServices.length - 1) {
        console.log(`[${symbol}] 切換到備用代理 ${currentProxyIndex + 2}/${proxyServices.length} (${proxyServices[currentProxyIndex + 1].name})...`);
        await new Promise(resolve => setTimeout(resolve, 500));
        return fetchStockData(symbol, targetTabId, retryCount, currentProxyIndex + 1);
      }
      
      // 如果所有代理都試過了，且還有重試次數，等待後重試所有代理
      if (retryCount < maxRetries - 1) {
        console.log(`[${symbol}] 所有代理都失敗，等待 ${1000 * (retryCount + 1)}ms 後重試...`);
        await new Promise(resolve => setTimeout(resolve, 1000 * (retryCount + 1))); // 遞增延遲：1秒、2秒、3秒
        return fetchStockData(symbol, targetTabId, retryCount + 1, 0); // 從第一個代理重新開始
      } else {
        // 所有重試都失敗，顯示錯誤視窗
        const errorDetails = err.name === 'TypeError' && err.message.includes('Failed to fetch') 
          ? '網路連線失敗或 CORS 錯誤。這通常是因為代理服務暫時無法使用。'
          : err.message || "網路連線失敗";
        
        updateTab(targetTabId, {
          loading: false,
          fetchError: {
            title: "無法取得股價數據",
            message: `已嘗試 ${proxyServices.length} 個代理服務並重試 ${maxRetries} 次仍無法取得數據。\n\n股票代號：${symbol} (${ticker})\n錯誤訊息：${errorDetails}\n\n可能原因：\n1. 所有代理服務暫時無法使用\n2. 網路連線問題\n3. 股票代號不正確\n4. Yahoo Finance API 暫時無法訪問\n\n建議：\n• 檢查網路連線\n• 稍後再試\n• 確認股票代號正確 (${symbol})`,
            symbol: symbol
          }
        });
        // 清除進度狀態
        setLoadingProgress({
          currentProxy: 0,
          totalProxies: 0,
          retryCount: 0,
          maxRetries: 0,
          proxyName: ''
        });
      }
    }
  };

  useEffect(() => {
    // 初始化時只載入第一個 tab (6669) 的數據
    const firstTab = tabs[0];
    if (firstTab && firstTab.data.length === 0 && !firstTab.loading) {
      fetchStockData(firstTab.symbol, firstTab.id);
    }
  }, []); // 只在組件掛載時執行一次 

  useEffect(() => {
    if (data.length > 0 && chartRef.current) {
      setTimeout(() => {
        if (chartRef.current) {
          chartRef.current.scrollLeft = chartRef.current.scrollWidth;
        }
      }, 400);
    }
  }, [data, isChartExpanded, activeTabId]);

  // --- 核心：完全依照您的規則重寫評分邏輯 (Algorithm V24 - Exact Specs) ---
  const analysis = useMemo(() => {
    if (!data || data.length < 120) return null;
    const last = data[data.length - 1];
    const prev = data[data.length - 2];
    
    // 判斷當前 tab 使用的評分規則（根據 stockSymbol）
    const is3231 = stockSymbol === '3231';
    const is2301 = stockSymbol === '2301';

    // 線性映射函數（用於 FIBO 和斜率評分）
    const map = (val, inMin, inMax, outMin, outMax) => {
      const v = Math.max(Math.min(val, Math.max(inMin, inMax)), Math.min(inMin, inMax));
      return outMin + (v - inMin) * (outMax - outMin) / (inMax - inMin);
    };
    
    // 1. FIBO 計算（根據股票代號使用不同規則）
    let maxPrice = -Infinity, maxIndex = -1;
    let minPrice = Infinity;
    let recentData, range, swingRate, fiboValid, fibo;
    
    if (is3231) {
      // === 3231 緯創：短線波段版（20日箱型） ===
      recentData = data.slice(-20); // 20 個交易日（月線級別）
      
      // 在 20 日內找出最高價和最低價（不要求最低點在最高點之前）
      recentData.forEach((d, i) => { 
        if (d.price > maxPrice) { maxPrice = d.price; maxIndex = i; }
        if (d.price < minPrice) { minPrice = d.price; }
      });
      
      range = maxPrice - minPrice;
      swingRate = (maxPrice - minPrice) / minPrice;
      fiboValid = swingRate >= 0.05; // 門檻 5%（避免死魚盤）
      
      // 3231 只計算簡化位階
      fibo = { 
        l500: maxPrice - range * 0.5,  // 箱型中關
        l786: maxPrice - range * 0.786, // 接近箱底（回檔 78.6%）
        ext1272: maxPrice + range * 0.272, // 短線噴出
        // 為了兼容顯示，其他位階設為 null
        l236: null,
        l382: null,
        l618: null,
        ext1618: null
      };
    } else {
      // === 6669：原版（120日 Impulse Leg） ===
      recentData = data.slice(-120); // 120 個交易日
      
      // 找最高點
      recentData.forEach((d, i) => { if (d.price > maxPrice) { maxPrice = d.price; maxIndex = i; } });
      
      // 找最低點（必須在最高點之前）
      const legData = recentData.slice(0, maxIndex + 1);
      legData.forEach(d => { if (d.price < minPrice) minPrice = d.price; });
      
      // 防呆：若高點就是第一天，則往前再找
      // 修正：使用固定窗口期，不依賴 data.length，確保計算穩定
      if (maxIndex < 5 && data.length >= 200) {
         const extendData = data.slice(-200);
         minPrice = Math.min(...extendData.map(d=>d.price));
      }
      
      range = maxPrice - minPrice;
      swingRate = (maxPrice - minPrice) / minPrice;
      fiboValid = swingRate >= 0.1; // 門檻 10%
      
      // 6669 計算完整位階
      fibo = { 
        l236: maxPrice - range * 0.236, 
        l382: maxPrice - range * 0.382, 
        l500: maxPrice - range * 0.5,
        l618: maxPrice - range * 0.618, 
        l786: maxPrice - range * 0.786,
        ext1272: maxPrice + range * 0.272, 
        ext1618: maxPrice + range * 0.618 
      };
    }

    // 只使用有效的斜率值（排除前60個點的0值）來計算百分位
    const validSlopes = data.filter((d, i) => i >= 60).map(d => d.slopeVal);
    const sPerc = validSlopes.length > 0 
      ? (validSlopes.sort((a, b) => a - b).filter(s => s < last.slopeVal).length / validSlopes.length) * 100
      : 50; // 如果沒有有效斜率，預設為50%

    // === FIBO 評分 ===
    let b_Fibo = 0;
    let s_Fibo = 0;
    const p = last.price;
    const fiboMaxScore = is3231 ? 5 : 35; // 3231 最高 5 分，6669 最高 35 分
    
    // 保存詳細資訊供 UI 顯示（僅 6669 使用）
    let fiboBaseScore = 0;
    let fiboModifier = 0;
    let fiboModifierDetails = [];

    if (fiboValid) {
      if (is3231) {
        // === 3231 緯創：短線波段版 FIBO 評分（5分） ===
        // 買入評分（階梯式，無 K 線型態修正）
        if (p > fibo.l500) {
          b_Fibo = 0; // 上半部壓力區，無成本優勢
        } else if (p > fibo.l786) {
          b_Fibo = 3; // 下半部安全區，具備基礎安全邊際
        } else {
          b_Fibo = 5; // 底部超跌區，極具反彈潛力
        }
        
        // 賣出評分（階梯式）
        if (last.high >= fibo.ext1272) {
          s_Fibo = 5; // 短線噴出，強烈建議賣出
        } else if (last.high >= maxPrice) {
          s_Fibo = 3; // 創新高，完成一個波段
        } else {
          s_Fibo = 0; // 尚未突破前高，不觸發賣訊
        }
      } else {
        // === 6669：原版 FIBO 評分（35分） ===
        // 使用外層定義的 map 函數

        // 買入 - 線性給分
        let baseScore = 0;
        if (p > fibo.l236) {
          // 高檔追價區間：從 l236 到 maxPrice，分數從 5 到 10
          baseScore = map(p, fibo.l236, maxPrice, 5, 10);
        } else if (p > fibo.l382) {
          // 強勢接力區間：從 l382 到 l236，分數從 20 到 25
          baseScore = map(p, fibo.l382, fibo.l236, 20, 25);
        } else if (p > fibo.l500) {
          // 合理價值區間：從 l500 到 l382，分數從 15 到 20
          baseScore = map(p, fibo.l500, fibo.l382, 15, 20);
        } else if (p >= fibo.l618) {
          // 防守觀察區間：從 l618 到 l500，分數從 10 到 15
          baseScore = map(p, fibo.l618, fibo.l500, 10, 15);
        } else {
          baseScore = 0; // 破線
        }

        // K線型態修正
        let modifier = 0;
        let modifierDetails = [];
        if (last.price > last.open && last.price > prev.price) {
          modifier += 10; // 止跌確認
          modifierDetails.push({ name: '止跌確認', value: 10 });
        }
        const bodyLen = Math.abs(last.price - last.open);
        const lowerShadow = Math.min(last.price, last.open) - last.low;
        if (lowerShadow > bodyLen && last.low <= fibo.l382) {
          modifier += 8; // 下影線
          modifierDetails.push({ name: '下影線', value: 8 });
        }
        if (last.volume < (last.volMA5 * 0.7)) {
          modifier += 5; // 量縮
          modifierDetails.push({ name: '量縮', value: 5 });
        }
        if (last.price < last.open && bodyLen > (last.atr * 1.5)) {
          modifier -= 10; // 殺盤
          modifierDetails.push({ name: '殺盤', value: -10 });
        }

        b_Fibo = Math.min(35, Math.max(0, baseScore + modifier));
        
        // 保存詳細資訊供 UI 顯示
        fiboBaseScore = baseScore;
        fiboModifier = modifier;
        fiboModifierDetails = modifierDetails;

        // 賣出
        if (last.high >= fibo.ext1618) s_Fibo = 35; // 獲利滿足
        else if (last.high >= fibo.ext1272) s_Fibo = 28; // 第一壓力
        else if (p > maxPrice) s_Fibo = 15; // 解套賣壓
        if (p < fibo.l618) s_Fibo = 35; // 停損
      }
    }

    // === 動態斜率 (20分) - 線性給分 ===
    // 3231 不列入評分，6669 正常計算
    let b_Hist = 0;
    let s_Hist = 0;
    let slopeBuyDetails = [];
    let slopeSellDetails = [];
    
    if (!is3231) {
      // 6669：正常計算斜率評分
      // 買入 - 線性給分
      let b_Slope_Rank = 0;
      if (sPerc < 10) {
        b_Slope_Rank = map(sPerc, 0, 10, 15, 10);
        slopeBuyDetails.push({ name: `斜率<10%`, value: Math.round(b_Slope_Rank) });
      } else if (sPerc < 25) {
        b_Slope_Rank = map(sPerc, 10, 25, 10, 5);
        slopeBuyDetails.push({ name: `斜率10-25%`, value: Math.round(b_Slope_Rank) });
      } else if (sPerc < 40) {
        b_Slope_Rank = map(sPerc, 25, 40, 5, 0);
        slopeBuyDetails.push({ name: `斜率25-40%`, value: Math.round(b_Slope_Rank) });
      }
      const b_Slope_Mom = (last.slopeVal > prev.slopeVal) ? 5 : 0;
      if (b_Slope_Mom > 0) slopeBuyDetails.push({ name: '斜率向上', value: 5 });
      b_Hist = (b_Slope_Rank > 0) ? b_Slope_Rank + b_Slope_Mom : 0;

      // 賣出 - 線性給分
      let s_Slope_Rank = 0;
      if (sPerc > 90) {
        s_Slope_Rank = map(sPerc, 90, 100, 10, 15);
        slopeSellDetails.push({ name: `斜率>90%`, value: Math.round(s_Slope_Rank) });
      } else if (sPerc > 75) {
        s_Slope_Rank = map(sPerc, 75, 90, 5, 10);
        slopeSellDetails.push({ name: `斜率75-90%`, value: Math.round(s_Slope_Rank) });
      } else if (sPerc > 60) {
        s_Slope_Rank = map(sPerc, 60, 75, 0, 5);
        slopeSellDetails.push({ name: `斜率60-75%`, value: Math.round(s_Slope_Rank) });
      }
      const s_Slope_Mom = (last.slopeVal < prev.slopeVal) ? 5 : 0;
      if (s_Slope_Mom > 0) slopeSellDetails.push({ name: '斜率向下', value: 5 });
      s_Hist = (s_Slope_Rank > 0) ? s_Slope_Rank + s_Slope_Mom : 0;
    }
    // 3231：b_Hist 和 s_Hist 保持為 0（不列入評分）

    // === MA 評分 ===
    const maMaxScore = is3231 ? 10 : 7; // 3231 權重 10 分（月線），6669 權重 7 分（季線）
    let b_MA = 0;
    let s_MA = 0;
    let maBuyDetails = [];
    let maSellDetails = [];
    
    if (is3231) {
      // === 3231 緯創：短線波段版 MA 評分（10分，MA20月線） ===
      const maValue = last.ma20; // 使用 MA20
      const bias = maValue ? (p - maValue) / maValue * 100 : 0;
      const isBroken = p < maValue; // 今日收盤價 < MA20
      
      // 買入評分（只看負乖離）
      if (bias < -6) {
        b_MA = 10;
        maBuyDetails.push({ name: '急跌超賣區', value: 10 });
      } else if (bias < -3) {
        b_MA = 6;
        maBuyDetails.push({ name: '顯著負乖離', value: 6 });
      } else if (bias <= 0) {
        b_MA = 3;
        maBuyDetails.push({ name: '回測支撐', value: 3 });
      }
      
      // 賣出評分（正乖離 + 跌破）
      if (bias > 8) {
        s_MA = 10;
        maSellDetails.push({ name: '急漲超買區', value: 10 });
      } else if (bias > 4) {
        s_MA = 6;
        maSellDetails.push({ name: '獲利警戒區', value: 6 });
      }
      
      // 跌破分數（停利/停損）
      if (isBroken) {
        s_MA = Math.max(s_MA, 3);
        if (s_MA === 3) maSellDetails = [{ name: '跌破月線', value: 3 }];
        else maSellDetails.push({ name: '跌破月線', value: 3 });
      }
      
      b_MA = Math.min(maMaxScore, b_MA);
      s_MA = Math.min(maMaxScore, s_MA);
    } else {
      // === 6669：原版 MA 評分（7分，MA60季線） ===
      const bias = last.ma60 ? (p - last.ma60) / last.ma60 * 100 : 0;
      const maSlope = prev.ma60 && prev.ma60 !== 0 ? (last.ma60 - prev.ma60) / prev.ma60 : 0;
      const last3Days = data.slice(-3);
      const isBroken = last3Days.length === 3 && last3Days.every(d => d.price < d.ma60);

      if (!isBroken) {
        if (maSlope > 0) {
          b_MA += 3;
          maBuyDetails.push({ name: '季線向上', value: 3 });
        }
        if (bias > 0 && bias <= 5) {
          b_MA += 4;
          maBuyDetails.push({ name: '正乖離0-5%', value: 4 });
        } else if (bias > 5 && bias <= 10) {
          b_MA += 2;
          maBuyDetails.push({ name: '正乖離5-10%', value: 2 });
        } else if (bias < 0 && maSlope > 0) {
          b_MA += 1;
          maBuyDetails.push({ name: '負乖離但季線向上', value: 1 });
        }
      }
      
      if (maSlope < 0) {
        s_MA += 3;
        maSellDetails.push({ name: '季線向下', value: 3 });
      }
      // 乖離過熱加強給分（回測優化：原 max7 → max18，賣出評分端最有效的單一修正）
      if (bias > 30) {
        s_MA += 15;
        maSellDetails.push({ name: '正乖離>30% 極度過熱', value: 15 });
      } else if (bias > 22) {
        s_MA += 11;
        maSellDetails.push({ name: '正乖離22-30% 過熱', value: 11 });
      } else if (bias > 15) {
        s_MA += 7;
        maSellDetails.push({ name: '正乖離15-22% 警戒', value: 7 });
      } else if (bias > 10) {
        s_MA += 4;
        maSellDetails.push({ name: '正乖離10-15% 偏高', value: 4 });
      }
      if (isBroken) {
        s_MA = Math.max(s_MA, 3);
        if (s_MA === 3) maSellDetails = [{ name: '跌破季線', value: 3 }];
        else maSellDetails.push({ name: '跌破季線', value: 3 });
      }
      b_MA = Math.min(7, b_MA);
      s_MA = Math.min(18, s_MA);
    }

    // === KD 評分 ===
    const kdMaxScore = is3231 ? 25 : 10; // 3231 權重 25 分，6669 權重 10 分
    let b_KD = 0;
    let s_KD = 0;
    let kdBuyDetails = [];
    let kdSellDetails = [];
    
    // 背離判斷（兩者共用）
    const lookback20 = data.slice(-22, -2);
    let hasDivergence = false;
    if (lookback20.length > 0) {
        const minP = Math.min(...lookback20.map(d=>d.price));
        const minK = Math.min(...lookback20.map(d=>d.k));
        if (p < minP && last.k > minK) hasDivergence = true; // 價格背離
    }
    
    if (is3231) {
      // === 3231 緯創：短線波段版 KD 評分（25分） ===
      // 買入評分
      let b_KD_Pos = 0;
      if (last.k < 20) {
        b_KD_Pos = 15;
        kdBuyDetails.push({ name: 'K<20 極度超賣', value: 15 });
      } else if (last.k < 30) {
        b_KD_Pos = 5;
        kdBuyDetails.push({ name: 'K<30 超賣邊緣', value: 5 });
      }
      
      let b_KD_Sig = 0;
      // 金叉訊號
      if (prev.k !== undefined && prev.d !== undefined && prev.k < prev.d && last.k > last.d) {
        if (last.k < 50) {
          b_KD_Sig = 10;
          kdBuyDetails.push({ name: '低檔金叉', value: 10 });
        }
      }
      
      // 背離加分（優先級最高，直接滿分）
      if (hasDivergence) {
        b_KD = kdMaxScore;
        kdBuyDetails = [{ name: '價格背離', value: kdMaxScore }];
      } else {
        b_KD = Math.min(kdMaxScore, b_KD_Pos + b_KD_Sig);
      }
      
      // 賣出評分
      let s_KD_Pos = 0;
      if (last.k > 80) {
        s_KD_Pos = 25;
        kdSellDetails.push({ name: 'K>80 極度超買', value: 25 });
      } else if (last.k > 70) {
        s_KD_Pos = 15;
        kdSellDetails.push({ name: 'K>70 警戒區', value: 15 });
      }
      
      // 3231 不等待死叉，不設訊號分數，也不設鈍化保護
      s_KD = s_KD_Pos; // 只看位階分數
    } else {
      // === 6669：原版 KD 評分（10分） ===
      // 買入
      let b_KD_Pos = 0;
      if (last.k < 20) {
        b_KD_Pos = 4;
        kdBuyDetails.push({ name: 'K<20', value: 4 });
      } else if (last.k < 40) {
        b_KD_Pos = 2;
        kdBuyDetails.push({ name: 'K<40', value: 2 });
      }
      let b_KD_Sig = 0;
      if (prev.k !== undefined && prev.d !== undefined && prev.k < prev.d && last.k > last.d) {
        if (last.k < 20) {
          b_KD_Sig = 6;
          kdBuyDetails.push({ name: '低檔金叉(K<20)', value: 6 });
        } else if (last.k < 50) {
          b_KD_Sig = 3;
          kdBuyDetails.push({ name: '金叉(K<50)', value: 3 });
        }
      }
      // 背離加分
      if (hasDivergence) {
        b_KD_Pos = 10;
        kdBuyDetails = [{ name: '價格背離', value: 10 }];
      }
      b_KD = Math.min(10, b_KD_Pos + b_KD_Sig);

      // 賣出
      let s_KD_Pos = 0;
      if (last.k > 80) {
        s_KD_Pos = 3;
        kdSellDetails.push({ name: 'K>80', value: 3 });
      } else if (last.k > 70) {
        s_KD_Pos = 1;
        kdSellDetails.push({ name: 'K>70', value: 1 });
      }
      let s_KD_Sig = 0;
      if (prev.k !== undefined && prev.d !== undefined && prev.k > prev.d && last.k < last.d) {
        if (last.k > 80) {
          s_KD_Sig = 7;
          kdSellDetails.push({ name: '高檔死叉(K>80)', value: 7 });
        } else if (last.k > 50) {
          s_KD_Sig = 4;
          kdSellDetails.push({ name: '死叉(K>50)', value: 4 });
        }
      }
      // 鈍化保護
      const last3K = data.slice(-3).map(d => d.k);
      const last3D = data.slice(-3).map(d => d.d);
      const isPassivation = last3K.length === 3 && last3K.every(k => k > 80) && last3K.every((k,i) => k > last3D[i]);
      
      s_KD = Math.min(10, s_KD_Pos + s_KD_Sig);
      if (isPassivation) {
        s_KD = 0;
        kdSellDetails = [{ name: '鈍化保護', value: 0 }];
      }
    }

    // === RSI 評分 ===
    const rsiMaxScore = is3231 ? 25 : 10; // 3231 權重 25 分，6669 權重 10 分
    let b_RSI = 0;
    let s_RSI = 0;
    let rsiBuyDetails = [];
    let rsiSellDetails = [];
    
    // 背離判斷（兩者共用）
    let hasRSIBuyDivergence = false; // 底背離
    let hasRSISellDivergence = false; // 頂背離
    if (lookback20.length > 0) {
      const minR = Math.min(...lookback20.map(d=>d.rsiVal));
      const maxR = Math.max(...lookback20.map(d=>d.rsiVal));
      const minP = Math.min(...lookback20.map(d=>d.price));
      const maxP = Math.max(...lookback20.map(d=>d.price));
      
      // 底背離：價格創新低但 RSI 未創新低
      if (p < minP && last.rsiVal > minR) {
        hasRSIBuyDivergence = true;
      }
      
      // 頂背離：價格創新高但 RSI 未創新高
      if (p > maxP && last.rsiVal < maxR) {
        hasRSISellDivergence = true;
      }
    }
    
    if (is3231) {
      // === 3231 緯創：短線波段版 RSI 評分（25分） ===
      // 買入評分
      let b_RSI_Pos = 0;
      if (last.rsiVal < 30) {
        b_RSI_Pos = 15;
        rsiBuyDetails.push({ name: 'RSI<30 極度超賣', value: 15 });
      } else if (last.rsiVal < 45) {
        b_RSI_Pos = 5;
        rsiBuyDetails.push({ name: 'RSI<45 弱勢整理', value: 5 });
      }
      
      // 底背離加分（優先級最高，直接滿分）
      if (hasRSIBuyDivergence) {
        b_RSI = rsiMaxScore;
        rsiBuyDetails = [{ name: '底背離', value: rsiMaxScore }];
      } else {
        b_RSI = b_RSI_Pos;
      }
      
      // 賣出評分
      let s_RSI_Pos = 0;
      if (last.rsiVal > 75) {
        s_RSI_Pos = 25;
        rsiSellDetails.push({ name: 'RSI>75 極度超買', value: 25 });
      } else if (last.rsiVal > 60) {
        s_RSI_Pos = 10;
        rsiSellDetails.push({ name: 'RSI>60 相對高檔', value: 10 });
      }
      
      // 頂背離加分（優先級最高，直接滿分）
      if (hasRSISellDivergence) {
        s_RSI = rsiMaxScore;
        rsiSellDetails = [{ name: '頂背離', value: rsiMaxScore }];
      } else {
        s_RSI = s_RSI_Pos;
      }
    } else {
      // === 6669：原版 RSI 評分（10分） ===
      // 買入
      if (last.rsiVal < 30) {
        b_RSI = 7;
        rsiBuyDetails.push({ name: 'RSI<30', value: 7 });
      } else if (last.rsiVal < 50) {
        b_RSI = 5;
        rsiBuyDetails.push({ name: 'RSI<50', value: 5 });
      } else if (last.rsiVal < 60) {
        b_RSI = 2;
        rsiBuyDetails.push({ name: 'RSI<60', value: 2 });
      }
      if (prev.rsiVal !== undefined && prev.rsiVal <= 50 && last.rsiVal > 50) {
        b_RSI += 2;
        rsiBuyDetails.push({ name: '突破50', value: 2 });
      }
      // 底背離
      if (hasRSIBuyDivergence) {
        b_RSI += 3;
        rsiBuyDetails.push({ name: '底背離', value: 3 });
      }
      b_RSI = Math.min(10, b_RSI);

      // 賣出
      if (last.rsiVal > 80) {
        s_RSI = 7;
        rsiSellDetails.push({ name: 'RSI>80', value: 7 });
      } else if (last.rsiVal > 70) {
        s_RSI = 5;
        rsiSellDetails.push({ name: 'RSI>70', value: 5 });
      } else if (last.rsiVal > 60) {
        s_RSI = 2;
        rsiSellDetails.push({ name: 'RSI>60', value: 2 });
      }
      if (prev.rsiVal !== undefined && prev.rsiVal >= 50 && last.rsiVal < 50) {
        s_RSI += 2;
        rsiSellDetails.push({ name: '跌破50', value: 2 });
      }
      s_RSI = Math.min(10, s_RSI);
    }

    // === MACD 評分 ===
    const macdMaxScore = is3231 ? 5 : 7; // 3231 權重 5 分，6669 權重 7 分
    let b_MACD = 0;
    let s_MACD = 0;
    let macdBuyDetails = [];
    let macdSellDetails = [];
    
    if (is3231) {
      // === 3231 緯創：短線波段版 MACD 評分（5分） ===
      // 買入評分
      let goldCross = 0; // 黃金交叉
      let redConverge = 0; // 紅柱收斂
      
      // 黃金交叉（優先級最高）
      if (prev.macd !== undefined && prev.macd < 0 && last.macd > 0) {
        goldCross = 5;
        macdBuyDetails.push({ name: '黃金交叉', value: 5 });
      }
      
      // 紅柱收斂（止跌訊號）
      if (prev.macd !== undefined && last.macd < 0 && last.macd > prev.macd) {
        redConverge = 3;
        if (goldCross === 0) macdBuyDetails.push({ name: '紅柱收斂', value: 3 });
      }
      
      b_MACD = Math.max(goldCross, redConverge);
      b_MACD = Math.min(macdMaxScore, b_MACD);
      
      // 賣出評分
      let deathCross = 0; // 死亡交叉
      let greenConverge = 0; // 綠柱收斂
      
      // 死亡交叉（優先級最高）
      if (prev.macd !== undefined && prev.macd > 0 && last.macd < 0) {
        deathCross = 5;
        macdSellDetails.push({ name: '死亡交叉', value: 5 });
      }
      
      // 綠柱收斂（上攻無力）
      if (prev.macd !== undefined && last.macd > 0 && last.macd < prev.macd) {
        greenConverge = 3;
        if (deathCross === 0) macdSellDetails.push({ name: '綠柱收斂', value: 3 });
      }
      
      s_MACD = Math.max(deathCross, greenConverge);
      s_MACD = Math.min(macdMaxScore, s_MACD);
    } else {
      // === 6669：原版 MACD 評分（7分） ===
      if (prev.macd !== undefined && last.macd < 0 && last.macd > prev.macd) {
        b_MACD += 3;
        macdBuyDetails.push({ name: '紅柱收斂', value: 3 });
      }
      if (prev.macd !== undefined && prev.macd < 0 && last.macd > 0) {
        b_MACD += 2;
        macdBuyDetails.push({ name: '零軸金叉', value: 2 });
      }
      // 底背離
      if (lookback20.length > 0) {
        const minO = Math.min(...lookback20.map(d=>d.macd));
        if (p < Math.min(...lookback20.map(d=>d.price)) && last.macd > minO && last.macd < 0) {
          b_MACD += 2;
          macdBuyDetails.push({ name: '底背離', value: 2 });
        }
      }
      b_MACD = Math.min(7, b_MACD);

      if (prev.macd !== undefined && last.macd > 0 && last.macd < prev.macd) {
        s_MACD += 3;
        macdSellDetails.push({ name: '綠柱收斂', value: 3 });
      }
      if (prev.macd !== undefined && prev.macd > 0 && last.macd < 0) {
        s_MACD += 2;
        macdSellDetails.push({ name: '零軸死叉', value: 2 });
      }
      s_MACD = Math.min(7, s_MACD);
    }

    // === DMI (6分) ===
    // 3231 不列入評分，6669 正常計算
    let b_DMI = 0;
    let s_DMI = 0;
    let dmiBuyDetails = [];
    let dmiSellDetails = [];
    
    if (!is3231) {
      // 6669：正常計算 DMI 評分
      if (last.pdi !== undefined && last.mdi !== undefined && last.pdi > last.mdi) {
        b_DMI += 2;
        dmiBuyDetails.push({ name: '+DI > -DI', value: 2 });
        if (prev.pdi !== undefined && prev.mdi !== undefined && prev.pdi <= prev.mdi && last.pdi > last.mdi) {
          b_DMI += 1;
          dmiBuyDetails.push({ name: '金叉', value: 1 });
        }
        if (prev.adx !== undefined && last.adx > 25 && last.adx > prev.adx) {
          b_DMI += 3;
          dmiBuyDetails.push({ name: 'ADX>25且向上', value: 3 });
        } else if (prev.adx !== undefined && last.adx < 25 && last.adx > prev.adx) {
          b_DMI += 1;
          dmiBuyDetails.push({ name: 'ADX向上', value: 1 });
        }
      }
      if (last.adx > 50) {
        b_DMI -= 1;
        dmiBuyDetails.push({ name: 'ADX>50過熱', value: -1 });
      }
      b_DMI = Math.max(0, Math.min(6, b_DMI));

      if (last.pdi !== undefined && last.mdi !== undefined && last.mdi > last.pdi) {
        s_DMI += 2;
        dmiSellDetails.push({ name: '-DI > +DI', value: 2 });
        if (prev.adx !== undefined && last.adx > 25 && last.adx > prev.adx) {
          s_DMI += 3;
          dmiSellDetails.push({ name: 'ADX>25且向上', value: 3 });
        }
      }
      s_DMI = Math.min(6, s_DMI);
    }
    // 3231：b_DMI 和 s_DMI 保持為 0（不列入評分）

    // 組合分數
    // 3231：趨勢綜合不包含 DMI（只有 MA + MACD）
    // 6669：趨勢綜合包含 MA + MACD + DMI
    const b_Trend = is3231 ? (b_MA + b_MACD) : (b_MA + b_MACD + b_DMI);
    const s_Trend = is3231 ? (s_MA + s_MACD) : (s_MA + s_MACD + s_DMI);
    const b_Osc = b_RSI + b_KD;
    const s_Osc = s_RSI + s_KD;

    // === BB 評分 ===
    // 3231 使用 30 分權重（短線波段），6669 使用 5 分權重（輔助）
    const pb = last.pctB ?? 0.5;
    let b_BB = 0;
    let s_BB = 0;
    const bbMaxScore = is3231 ? 30 : 5; // 3231 權重 30%，6669 權重 5%
    
    let bbBuyDetails = [];
    let bbSellDetails = [];
    
    if (is3231) {
      // === 3231 緯創：短線波段版布林評分 (30分，線性給分) ===
      // 使用外層定義的 map 函數
      
      // 【買入評分】抓下軌反彈（線性給分）
      if (pb < 0) {
        b_BB = 30;
        bbBuyDetails.push({ name: '%B<0 超跌', value: 30 });
      } else if (pb < 0.1) {
        b_BB = map(pb, 0, 0.1, 30, 25);
        bbBuyDetails.push({ name: '%B<0.1', value: Math.round(b_BB) });
      } else if (pb < 0.3) {
        b_BB = map(pb, 0.1, 0.3, 25, 10);
        bbBuyDetails.push({ name: '%B<0.3', value: Math.round(b_BB) });
      }
      b_BB = Math.min(30, Math.max(0, b_BB));
      
      // 【賣出評分】抓上軌獲利，有賺就跑（線性給分）
      if (pb > 1.0) {
        s_BB = 30;
        bbSellDetails.push({ name: '%B>1.0 突破上軌', value: 30 });
      } else if (pb > 0.9) {
        s_BB = map(pb, 0.9, 1.0, 25, 30);
        bbSellDetails.push({ name: '%B>0.9', value: Math.round(s_BB) });
      }
      
      // 假突破（最高價 > 上軌 且 收盤價 < 上軌）
      if (last.high && last.upper && last.high > last.upper && p < last.upper) {
        s_BB = Math.max(s_BB, 20);
        if (s_BB === 20) bbSellDetails = [{ name: '假突破', value: 20 }];
        else bbSellDetails.push({ name: '假突破', value: 20 });
      }
      s_BB = Math.min(30, Math.max(0, s_BB));
    } else {
      // === 6669：原版布林評分 (5分) ===
      // 【買入評分】
      if (pb < 0) {
        b_BB = 3;
        bbBuyDetails.push({ name: '%B<0', value: 3 });
      } else if (pb < 0.1) {
        b_BB = 2;
        bbBuyDetails.push({ name: '%B<0.1', value: 2 });
      }
      // 中軌回測
      if (last.mid && prev.mid && last.mid !== 0) {
        const midSlope = (last.mid - prev.mid);
        const distToMid = Math.abs((p - last.mid) / last.mid);
        if (midSlope > 0 && distToMid < 0.01) {
          b_BB = 2;
          bbBuyDetails.push({ name: '回測中軌', value: 2 });
        }
      }
      b_BB = Math.min(5, b_BB);
      
      // 【賣出評分】
      if (pb > 1.1) {
        s_BB = 3;
        bbSellDetails.push({ name: '%B>1.1', value: 3 });
      } else if (pb > 1.0) {
        s_BB = 1;
        bbSellDetails.push({ name: '%B>1.0', value: 1 });
      }
      // 假突破
      if (last.high && last.upper && last.high > last.upper && p < last.upper) {
        s_BB = 2;
        bbSellDetails.push({ name: '假突破', value: 2 });
      }
      // 開口爆量保護（6669 保留此機制）
      const bwOpen = prev.bandWidth !== undefined && last.bandWidth !== undefined ? (last.bandWidth > prev.bandWidth) : false;
      const volExp = last.volume !== undefined && last.volMA5 !== undefined ? (last.volume > (last.volMA5 * 1.5)) : false;
      if (bwOpen && volExp && s_BB > 0) {
        s_BB = 0;
        bbSellDetails = [{ name: '開口爆量保護', value: 0 }];
      }
      s_BB = Math.min(5, s_BB);
    }

    const b_Vol = b_BB;
    const s_Vol = s_BB;

    // ⚠ V25 起為死碼：6669 的賣分已改為 biasLadder 覆寫，此處算出的 s_PeakExit
    //   不再影響任何結果（3231 也不使用）。保留僅為避免改動下方共用的加總式。
    //   實測依據：高檔回落訓練期邊際 −2.42pp／測試期 +0.60pp，無預測力。
    // 高檔回落停利分（舊版元件，已停用）
    // 閘門：近 15 日曾過熱(季線乖離>15%) 才啟用，避免一般小回檔誤觸
    // 觸發：自近 60 日最高收盤回落 ≥10/14/18% 分階給分（上限 30）
    let s_PeakExit = 0;
    let peakPullbackPct = 0;
    let peakExitDetails = [];
    if (!is3231) {
      const biasWin = data.slice(-15);
      const recentMaxBias = biasWin.length > 0 ? Math.max(...biasWin.map(d => {
        const mv = d.ma60;
        return mv ? (d.price - mv) / mv * 100 : -Infinity;
      })) : 0;
      const peakWin = data.slice(-60);
      const peakClose = peakWin.length > 0 ? Math.max(...peakWin.map(d => d.price)) : p;
      peakPullbackPct = peakClose > 0 ? (peakClose - p) / peakClose * 100 : 0;
      if (recentMaxBias > 15) {
        if (peakPullbackPct >= 18) {
          s_PeakExit = 30;
          peakExitDetails.push({ name: '高檔回落≥18%', value: 30 });
        } else if (peakPullbackPct >= 14) {
          s_PeakExit = 21;
          peakExitDetails.push({ name: '高檔回落≥14%', value: 21 });
        } else if (peakPullbackPct >= 10) {
          s_PeakExit = 12;
          peakExitDetails.push({ name: '高檔回落≥10%', value: 12 });
        }
      }
    }

    // 總分（3231 沿用加權總分；6669 於下方改用單一因素評分覆寫）
    let totalBuyScore = Math.round(b_Fibo + b_Hist + b_Trend + b_Osc + b_Vol);
    let totalSellScore = Math.min(100, Math.round(s_Fibo + s_Hist + s_Trend + s_Osc + s_Vol + s_PeakExit));

    // 計算 maSlope 和 bias（用於顯示和霸王條款判斷，需要在 buySignal 判斷之前計算）
    const maValue = is3231 ? last.ma20 : last.ma60;
    const prevMaValue = is3231 ? prev.ma20 : prev.ma60;
    const bias = maValue ? (p - maValue) / maValue * 100 : 0;
    const maSlope = prevMaValue && prevMaValue !== 0 ? (maValue - prevMaValue) / prevMaValue : 0;
    const isBroken = is3231 ? (p < maValue) : (data.slice(-3).length === 3 && data.slice(-3).every(d => d.price < d.ma60));
    
    // 計算前一天的斜率，用於判斷斜率是否在改善
    const prevMaValue2 = data.length >= 3 ? (is3231 ? data[data.length - 3].ma20 : data[data.length - 3].ma60) : null;
    const prevMaSlope = prevMaValue2 && prevMaValue && prevMaValue !== 0 ? (prevMaValue - prevMaValue2) / prevMaValue2 : null;
    
    // 判斷斜率是否在改善：雖然還是負的，但負值在縮小（趨勢轉好）
    // 斜率改善 = 今日斜率 > 昨日斜率（都是負數時，數值越大代表負值越小，即改善）
    const isSlopeImproving = maSlope < 0 && prevMaSlope !== null && maSlope > prevMaSlope;

    // ==================================================================
    // 6669 評分 V25：系統性權重搜尋後改為「單一因素」
    //   買進 = RSI 低檔階梯（100 分）  賣出 = 季線乖離階梯（100 分）
    //
    // 依據：對 10 個買進因素／9 個賣出因素做系統性搜尋（2607／2828 組權重，
    //   含全部單因素、全部雙因素、等權、各 3000 組隨機 Dirichlet），以
    //   「訓練期 2019-07~2023-02 選權重 → 測試期 2023-02~2026-08 驗證」檢驗：
    //   ● 訓練期邊際 vs 測試期邊際 Spearman ρ = +0.10（買）/ +0.40（賣）
    //   ● 訓練期第一名（深度回檔74+KD26）測試期排名 2168/2607
    //   ● 訓練期前 10 名平均測試邊際 +2.27pp < 全部組合平均 +4.88pp
    //     → 依訓練期挑權重比亂選還差，權重最佳化＝配適噪音
    //   ● 測試期邊際平均：1 因素 +5.62 > 5 因素 +5.02 > 2~4 因素 +4.6~4.7
    //   買進側 10 因素中僅 RSI 低檔（+8.62/+10.20）與 KD 低檔（+10.72/+8.45）
    //   兩期都有效；賣出側僅季線乖離（+5.70/+10.51）等 3 項有效，乖離最強。
    //
    // 實測品質（相對無條件基準）：
    //   買 RSI<30：買後 40 日 +17.58%（基準 +7.84%），勝率 76%，價格位階 29.2
    //   賣 乖離>30%：減碼後 40 日 −2.80%（基準 +7.89%），價格位階 79.2
    // 頻率：買 3.1 次/年（每 4.0 個月）、減碼 1.0 次/年
    // ==================================================================
    const RSI_BUY_LV = 30;   // 買進門檻（穩健區間 28~32；RSI<40 完全無效）
    const BUY_GAP = 21;      // 買進訊號最小間隔（交易日，約 1 個月）
    const TRIM_LV = 30;      // 減碼門檻（季線乖離 %）
    const WARN_LV = 22;      // 預警門檻（季線乖離 %）
    const TRIM_REARM = 18;   // 乖離跌回此值以下，減碼訊號重新啟用（避免同一波重複減碼）

    const rsiLadder = (r) => {
      if (r === null || r === undefined || isNaN(r)) return 0;
      if (r < 25) return 100;
      if (r < 30) return 80;
      if (r < 40) return 50;
      if (r < 50) return 20;
      return 0;
    };
    const biasLadder = (b) => {
      if (b === null || b === undefined || isNaN(b)) return 0;
      if (b > 40) return 100;
      if (b > 30) return 80;
      if (b > 22) return 56;
      if (b > 15) return 32;
      if (b > 10) return 16;
      return 0;
    };
    const biasAtIdx = (idx) => {
      const d = data[idx];
      if (!d || !d.ma60) return null;
      return (d.price - d.ma60) / d.ma60 * 100;
    };

    // 6669 訊號狀態：完全由股價資料推算，不需要任何本機記錄
    let sixSignal = null;
    if (!is3231 && !is2301) {
      const buyIdx = [], trimIdx = [];
      let lastBuyMark = -9999, trimArmed = true;
      for (let i = 14; i < data.length; i++) {
        const r = data[i].rsiVal, rp = data[i - 1].rsiVal;
        // 買進：RSI 首次跌破 30，且距上次買進訊號滿 21 個交易日
        if (r !== null && r !== undefined && r < RSI_BUY_LV &&
            (rp === null || rp === undefined || rp >= RSI_BUY_LV) &&
            (i - lastBuyMark) >= BUY_GAP) {
          buyIdx.push(i);
          lastBuyMark = i;
        }
        // 減碼：季線乖離突破 30%，且本波尚未觸發過
        const bi = biasAtIdx(i);
        if (bi !== null) {
          if (trimArmed && bi > TRIM_LV) { trimIdx.push(i); trimArmed = false; }
          if (bi < TRIM_REARM) trimArmed = true;
        }
      }
      const li = data.length - 1;
      const lastBuyIdx = buyIdx.length ? buyIdx[buyIdx.length - 1] : null;
      const lastTrimIdx = trimIdx.length ? trimIdx[trimIdx.length - 1] : null;

      // 覆寫 6669 總分
      totalBuyScore = rsiLadder(last.rsiVal);
      totalSellScore = biasLadder(bias);

      sixSignal = {
        isBuyToday: lastBuyIdx === li,
        isTrimToday: lastTrimIdx === li,
        rsiReady: last.rsiVal !== null && last.rsiVal < RSI_BUY_LV,
        gapLeft: lastBuyIdx !== null ? Math.max(0, BUY_GAP - (li - lastBuyIdx)) : 0,
        daysSinceBuy: lastBuyIdx !== null ? li - lastBuyIdx : null,
        lastBuyDate: lastBuyIdx !== null ? data[lastBuyIdx].fullDate : null,
        lastBuyPrice: lastBuyIdx !== null ? data[lastBuyIdx].price : null,
        lastTrimDate: lastTrimIdx !== null ? data[lastTrimIdx].fullDate : null,
        lastTrimPrice: lastTrimIdx !== null ? data[lastTrimIdx].price : null,
        buyCount: buyIdx.length,
        trimCount: trimIdx.length,
        trimArmed,
        rsiTrend: data.slice(-5).map(d => ({ date: d.fullDate, rsi: d.rsiVal })),
        levels: [WARN_LV, TRIM_LV, 40].map(lv => ({
          lv,
          price: last.ma60 ? last.ma60 * (1 + lv / 100) : null,
          gap: last.ma60 ? (last.ma60 * (1 + lv / 100) / p - 1) * 100 : null,
          label: lv === WARN_LV ? '預警：接近減碼區' : (lv === TRIM_LV ? '★ 減碼 1/3' : '★ 減碼 1/2'),
          hit: bias > lv
        })),
        thresholds: { RSI_BUY_LV, BUY_GAP, TRIM_LV, WARN_LV, TRIM_REARM }
      };
    }

    /* ═══════════════════════════════════════════════════════════════════════
       2301 光寶科 — 目標持倉制（V1）
       ───────────────────────────────────────────────────────────────────────
       規則（三行）：
         1. 應持有張數 = floor((今日買分 − 4) / 10) + 1，買分 < 4 → 0 張
         2. 手上不足就補足差額；買分下降不賣（此數字是下限，非目標值）
         3. 賣分 ≥ 80 → 全部清空
       無停損（實測加停損會破壞「越跌越買、超買了結」的機制）。

       因素來源與驗證（回測 2015-07 ~ 2026-08，11.1 年，含息還原）：
         • 買方 14 項＝以 2301 自身資料篩出「訓練/測試兩期同向為正」者。
           實測優於沿用 1402 清單（超額 +7.3pp vs +6.8pp），並剔除了
           MACD紅柱收斂（在 2301 為 −1.48pp 的有害因素）與箱型低位（−1.54pp）。
         • 賣方 11 項＝1402 選出的清單（因素選擇對 2301 為樣本外）。
           2301 自身篩出的賣方因素前瞻邊際雖為正（+0.89/+0.70pp），
           但實際交易只有 +0.6pp 超額；1402 清單前瞻邊際為負（−0.12/−2.38pp）
           卻有 +7.3pp 超額 —— 因為賣分的作用是「相對進場價鎖利」而非
           「預測未來下跌」。頻率對等檢定：出場時機貢獻 +8.80pp（p=0.0000），
           進場時機貢獻 +12.56pp（p=0.0000）。
         • 買/賣兩側權重最佳化實測：買側訓練最佳權重在測試期排名 3592/5562（無效）
           → 故採族群等權；賣側訓練共識權重測試期排名 5/4130（有效）但實際
           交易報酬低於等權清單，故同樣採等權。

       績效（目標持倉制、每次買 1 張、賣訊清空）：
         買 14.3 次/年、賣 4.5 次/年 → 18.8 動作/年（每月 1.6 次）
         每輪報酬 +11.96%、勝率 92%（46 勝/4 敗）、賺賠比 2.49、獲利因子 28.62
         最差單輪 −5.84%、帳面最差 −27%、平均持有 49 日（中位 16、最長 253）
         平均綁住 160 萬、最壞需備 272 萬（10 張）、年損益 62 萬、資金效率 38.7%
         獲利年 11/12（2024 唯一虧損年）
       驗證：
         兩期都正（前半 +5.45%、後半 +13.13%）
         隨機化 600 次 p = 0.0000（實際 +11.96% vs 隨機平均 +2.14%、最大 +4.25%）
         高原：鄰域 36 組（買2~8 × 階梯8~12 × 賣77~83）每輪最低 +9.47%
         容錯：漏掉 50% 買訊，年損益僅 −10%（因每日重算目標，不依賴歷史狀態）
         排除近期多頭（2015~2022）：每輪 +6.51%、勝率 93%、年損益 29 萬
           → 保守預期請用此組數字（18.1%/年）
       停用條件：
         連續 2 個完整年度虧損 → 停用；單輪虧損超過 −15% → 人工檢視。
         不可重新最佳化門檻（4 / 80 / +10 固定）—— 逐年重調門檻實測會失效。
       ═══════════════════════════════════════════════════════════════════════ */
    const TWO_BUY_LV = 4;    // 第 1 張所需買分
    const TWO_SELL_LV = 80;  // 全部清空門檻
    const TWO_STEP = 10;     // 每多 1 張，門檻 +10 分
    let twoSignal = null;

    if (is2301) {
      // 階梯給分：值越小分數越高
      const ladDown = (v, cuts, vals) => {
        if (v === null || v === undefined || isNaN(v)) return 0;
        for (let k = 0; k < cuts.length; k++) if (v <= cuts[k]) return vals[k];
        return 0;
      };
      // 階梯給分：值越大分數越高
      const ladUp = (v, cuts, vals) => {
        if (v === null || v === undefined || isNaN(v)) return 0;
        for (let k = 0; k < cuts.length; k++) if (v >= cuts[k]) return vals[k];
        return 0;
      };

      // ── 買進 14 項（等權，每項 100/14 = 7.14 分）──
      const BUY_F = [
        { k: 'MA120負乖離', fam: '均線負乖離', r: '≤−20%→100｜≤−12%→70｜≤−5%→40｜≤0%→15',
          f: d => ladDown(d.bias120, [-20, -12, -5, 0], [100, 70, 40, 15]) },
        { k: 'MA60負乖離', fam: '均線負乖離', r: '≤−15%→100｜≤−9%→70｜≤−4%→40｜≤0%→15',
          f: d => ladDown(d.bias60, [-15, -9, -4, 0], [100, 70, 40, 15]) },
        { k: 'MA20負乖離', fam: '均線負乖離', r: '≤−9%→100｜≤−6%→70｜≤−3%→40｜≤0%→15',
          f: d => ladDown(d.bias20, [-9, -6, -3, 0], [100, 70, 40, 15]) },
        { k: 'MA10負乖離', fam: '均線負乖離', r: '≤−6%→100｜≤−4%→70｜≤−2%→40｜≤0%→15',
          f: d => ladDown(d.bias10, [-6, -4, -2, 0], [100, 70, 40, 15]) },
        { k: 'MA5負乖離', fam: '均線負乖離', r: '≤−4%→100｜≤−2.5%→70｜≤−1%→40｜≤0%→15',
          f: d => ladDown(d.bias5, [-4, -2.5, -1, 0], [100, 70, 40, 15]) },
        { k: '自60日高回落', fam: '自高點回落', r: '≥22%→100｜≥14%→70｜≥8%→40｜≥4%→15',
          f: d => ladUp(d.pb60, [22, 14, 8, 4], [100, 70, 40, 15]) },
        { k: '自20日高回落', fam: '自高點回落', r: '≥13%→100｜≥8%→70｜≥5%→40｜≥2%→15',
          f: d => ladUp(d.pb20, [13, 8, 5, 2], [100, 70, 40, 15]) },
        { k: '自10日高回落', fam: '自高點回落', r: '≥8%→100｜≥5%→70｜≥3%→40｜≥1.5%→15',
          f: d => ladUp(d.pb10, [8, 5, 3, 1.5], [100, 70, 40, 15]) },
        { k: '近5日跌幅', fam: '跌幅動能', r: '≤−8%→100｜≤−5%→70｜≤−2.5%→40｜≤0%→15',
          f: d => ladDown(d.ret5, [-8, -5, -2.5, 0], [100, 70, 40, 15]) },
        { k: '近3日跌幅', fam: '跌幅動能', r: '≤−6%→100｜≤−4%→70｜≤−2%→40｜≤0%→15',
          f: d => ladDown(d.ret3, [-6, -4, -2, 0], [100, 70, 40, 15]) },
        { k: '近1日下跌', fam: '跌幅動能', r: '≤−3%→100｜≤−2%→70｜≤−1%→40｜≤0%→15',
          f: d => ladDown(d.ret1, [-3, -2, -1, 0], [100, 70, 40, 15]) },
        { k: 'K9低檔', fam: '震盪超賣', r: '≤10→100｜≤20→80｜≤30→45｜≤40→20',
          f: d => ladDown(d.k, [10, 20, 30, 40], [100, 80, 45, 20]) },
        { k: 'K5低檔', fam: '震盪超賣', r: '≤10→100｜≤20→80｜≤30→45｜≤40→20',
          f: d => ladDown(d.k5, [10, 20, 30, 40], [100, 80, 45, 20]) },
        { k: 'RSI5低檔', fam: '震盪超賣', r: '≤15→100｜≤25→80｜≤35→50｜≤45→20',
          f: d => ladDown(d.rsi5, [15, 25, 35, 45], [100, 80, 50, 20]) },
      ];
      // ── 賣出 11 項（等權，每項 100/11 = 9.09 分）──
      const SELL_F = [
        { k: 'RSI21高檔', fam: '震盪超買', r: '≥68→100｜≥62→80｜≥55→50｜≥48→20',
          f: d => ladUp(d.rsi21, [68, 62, 55, 48], [100, 80, 50, 20]) },
        { k: 'RSI14高檔', fam: '震盪超買', r: '≥72→100｜≥66→80｜≥58→50｜≥50→20',
          f: d => ladUp(d.rsiVal, [72, 66, 58, 50], [100, 80, 50, 20]) },
        { k: 'RSI9高檔', fam: '震盪超買', r: '≥80→100｜≥70→80｜≥60→50｜≥52→20',
          f: d => ladUp(d.rsi9, [80, 70, 60, 52], [100, 80, 50, 20]) },
        { k: 'RSI5高檔', fam: '震盪超買', r: '≥85→100｜≥75→80｜≥65→50｜≥55→20',
          f: d => ladUp(d.rsi5, [85, 75, 65, 55], [100, 80, 50, 20]) },
        { k: 'K9高檔', fam: '震盪超買', r: '≥90→100｜≥80→80｜≥70→45｜≥60→20',
          f: d => ladUp(d.k, [90, 80, 70, 60], [100, 80, 45, 20]) },
        { k: 'K5高檔', fam: '震盪超買', r: '≥90→100｜≥80→80｜≥70→45｜≥60→20',
          f: d => ladUp(d.k5, [90, 80, 70, 60], [100, 80, 45, 20]) },
        { k: 'MA60正乖離', fam: '均線正乖離', r: '≥15%→100｜≥9%→70｜≥4%→40｜≥0%→15',
          f: d => ladUp(d.bias60, [15, 9, 4, 0], [100, 70, 40, 15]) },
        { k: 'MA120正乖離', fam: '均線正乖離', r: '≥20%→100｜≥12%→70｜≥5%→40｜≥0%→15',
          f: d => ladUp(d.bias120, [20, 12, 5, 0], [100, 70, 40, 15]) },
        { k: '布林20高檔', fam: '相對位置', r: '%B≥1.0→100｜≥0.9→70｜≥0.75→40｜≥0.6→15',
          f: d => ladUp(d.pctB, [1.0, 0.9, 0.75, 0.6], [100, 70, 40, 15]) },
        { k: '箱型高位', fam: '相對位置', r: '20日位置≥0.95→100｜≥0.85→70｜≥0.7→40｜≥0.55→15',
          f: d => ladUp(d.box20, [0.95, 0.85, 0.7, 0.55], [100, 70, 40, 15]) },
        { k: '自60日低反彈', fam: '自低點反彈', r: '≥22%→100｜≥14%→70｜≥8%→40｜≥4%→15',
          f: d => ladUp(d.rb60, [22, 14, 8, 4], [100, 70, 40, 15]) },
      ];

      const bScoreOf = (d) => BUY_F.reduce((a, x) => a + x.f(d), 0) / BUY_F.length;
      const sScoreOf = (d) => SELL_F.reduce((a, x) => a + x.f(d), 0) / SELL_F.length;
      const bArr = data.map(bScoreOf);
      const sArr = data.map(sScoreOf);

      // 買分 → 應持有張數（下限）
      const targetLots = (sc) => sc < TWO_BUY_LV ? 0
        : Math.floor((sc - TWO_BUY_LV) / TWO_STEP) + 1;

      // 覆寫 2301 總分
      totalBuyScore = Math.round(bArr[data.length - 1] * 10) / 10;
      totalSellScore = Math.round(sArr[data.length - 1] * 10) / 10;

      // ── 參考持倉推演（假設完全依訊號執行；訊號用前一日、成交用當日開盤）──
      const START = Math.min(130, Math.max(0, data.length - 1));
      let lots = 0, costSum = 0, entryIdx = null;
      let nBuyAct = 0, nSellAct = 0;
      const rounds = [];
      for (let i = START; i < data.length; i++) {
        const sig = i - 1;
        const px = data[i].open || data[i].price;
        if (lots > 0 && sArr[sig] >= TWO_SELL_LV) {
          const proceeds = lots * px * 1000 * (1 - 0.001425 - 0.003);
          rounds.push({
            entry: data[entryIdx].fullDate, exit: data[i].fullDate,
            lots, avg: costSum / lots / 1000, exitPx: px,
            pnl: proceeds - costSum, ret: (proceeds - costSum) / costSum * 100,
            days: i - entryIdx
          });
          lots = 0; costSum = 0; entryIdx = null; nSellAct++;
        }
        const tgt = targetLots(bArr[sig]);
        if (tgt > lots) {
          const add = tgt - lots;
          if (lots === 0) entryIdx = i;
          costSum += add * px * 1000 * 1.001425;
          lots += add;
          nBuyAct++;
        }
      }
      // 年數用實際日曆天數（台股每年約 242 個交易日，用 252 會低估年數、高估頻率）
      const d0 = new Date(data[START].fullDate);
      const d1 = new Date(data[data.length - 1].fullDate);
      const yrs = Math.max((d1 - d0) / 86400000 / 365.25, 0.01);
      const wins = rounds.filter(r => r.pnl > 0).length;
      const costTot = rounds.reduce((a, r) => a + r.lots * r.avg * 1000, 0);
      const pnlTot = rounds.reduce((a, r) => a + r.pnl, 0);

      const bNow = bArr[data.length - 1];
      const sNow = sArr[data.length - 1];
      const tgtNow = targetLots(bNow);
      const needForNext = TWO_BUY_LV + tgtNow * TWO_STEP;

      twoSignal = {
        buyScore: bNow, sellScore: sNow,
        targetLots: tgtNow,
        needForNext,                                  // 再多 1 張所需買分
        gapToNext: Math.max(0, needForNext - bNow),
        gapToSell: Math.max(0, TWO_SELL_LV - sNow),
        isSellToday: sNow >= TWO_SELL_LV,
        thresholds: { TWO_BUY_LV, TWO_SELL_LV, TWO_STEP },
        // 階梯對照表（買分區間 → 應持有張數）
        ladder: Array.from({ length: 10 }, (_, n) => {
          const lo = TWO_BUY_LV + n * TWO_STEP;
          const hi = TWO_BUY_LV + (n + 1) * TWO_STEP - 1;
          return {
            lots: n + 1, from: lo, to: n === 9 ? 100 : hi,
            hit: bNow >= lo && (n === 9 || bNow <= hi),
            cleared: bNow >= lo,
            days: data.slice(START).filter((_, j) => {
              const v = bArr[START + j];
              return v >= lo && (n === 9 || v <= hi);
            }).length
          };
        }),
        // 各因素今日得分
        buyFactors: BUY_F.map(x => ({
          key: x.k, fam: x.fam, rule: x.r, score: x.f(last),
          contrib: x.f(last) / BUY_F.length
        })),
        sellFactors: SELL_F.map(x => ({
          key: x.k, fam: x.fam, rule: x.r, score: x.f(last),
          contrib: x.f(last) / SELL_F.length
        })),
        // 族群彙總
        buyFams: ['均線負乖離', '自高點回落', '跌幅動能', '震盪超賣'].map(fm => {
          const g = BUY_F.filter(x => x.fam === fm);
          return {
            fam: fm, n: g.length,
            weight: g.length / BUY_F.length * 100,
            score: g.reduce((a, x) => a + x.f(last), 0) / BUY_F.length
          };
        }),
        sellFams: ['震盪超買', '均線正乖離', '相對位置', '自低點反彈'].map(fm => {
          const g = SELL_F.filter(x => x.fam === fm);
          return {
            fam: fm, n: g.length,
            weight: g.length / SELL_F.length * 100,
            score: g.reduce((a, x) => a + x.f(last), 0) / SELL_F.length
          };
        }),
        // 參考持倉（假設完全照訊號執行）
        ref: {
          lots, avg: lots > 0 ? costSum / lots / 1000 : null,
          cost: costSum, mv: lots * p * 1000,
          floatPct: lots > 0 ? (lots * p * 1000 / costSum - 1) * 100 : null,
          entryDate: entryIdx !== null ? data[entryIdx].fullDate : null,
          holdDays: entryIdx !== null ? (data.length - 1 - entryIdx) : null
        },
        stats: {
          buyPerYear: nBuyAct / yrs, sellPerYear: nSellAct / yrs,
          actPerYear: (nBuyAct + nSellAct) / yrs,
          rounds: rounds.length, wins,
          winRate: rounds.length ? wins / rounds.length * 100 : 0,
          avgRet: costTot ? pnlTot / costTot * 100 : 0,
          avgLots: rounds.length ? rounds.reduce((a, r) => a + r.lots, 0) / rounds.length : 0,
          avgDays: rounds.length ? rounds.reduce((a, r) => a + r.days, 0) / rounds.length : 0,
          maxLots: rounds.length ? Math.max(...rounds.map(r => r.lots)) : 0,
          spanFrom: data[START]?.fullDate ?? '--'
        },
        recent: rounds.slice(-6).reverse(),
        trend: data.slice(-10).map((d, j) => {
          const idx = data.length - 10 + j;
          return {
            date: d.fullDate, price: d.price,
            buy: bArr[idx], sell: sArr[idx], tgt: targetLots(bArr[idx])
          };
        }),
        _bArr: bArr, _sArr: sArr
      };
    }

    // 訊號判斷
    let buySignal = { text: '觀望', color: 'text-neutral-500' };
    if (is3231) {
      // 3231 緯創：短線波段版買入標準
      if (totalBuyScore > 38) buySignal = { text: '強力買進 (Strong Buy)', color: 'text-emerald-400 font-bold' };
      else if (totalBuyScore > 30) buySignal = { text: '嘗試進場 (Try Buy)', color: 'text-cyan-400' };
      else if (totalBuyScore >= 20) buySignal = { text: '中性觀察', color: 'text-blue-400' };
      // < 20 分：觀望（預設值）
      
      // 霸王條款：只有在建議買入時（>38分）且斜率持續惡化時才需要「逆勢」警告
      // 如果斜率在改善（負值縮小），代表趨勢可能轉好，不顯示警告
      if (maSlope < 0 && !isSlopeImproving && totalBuyScore > 38) {
        buySignal = { ...buySignal, text: buySignal.text + ' (逆勢)' };
      }
    } else if (is2301) {
      // 2301：買分直接對應「應持有張數」，不足就補足差額
      const t = twoSignal.targetLots;
      if (t >= 5) buySignal = { text: `應持有 ${t} 張（重壓區）`, color: 'text-emerald-400 font-bold' };
      else if (t >= 2) buySignal = { text: `應持有 ${t} 張`, color: 'text-emerald-400 font-bold' };
      else if (t === 1) buySignal = { text: '應持有 1 張', color: 'text-cyan-400' };
      else buySignal = { text: `未達買區（差 ${twoSignal.gapToNext.toFixed(1)} 分）`, color: 'text-neutral-500' };
    } else {
      // 6669 V25：買進 = RSI 低檔階梯，需 RSI<30 且距上次買進訊號滿 21 交易日
      if (sixSignal?.isBuyToday) {
        buySignal = { text: '買進（本日訊號）', color: 'text-emerald-400 font-bold' };
      } else if (sixSignal?.rsiReady && sixSignal?.gapLeft > 0) {
        buySignal = { text: `RSI 已達標，需再等 ${sixSignal.gapLeft} 個交易日`, color: 'text-cyan-400' };
      } else if (totalBuyScore >= 50) {
        buySignal = { text: '接近買區（RSI<40）', color: 'text-blue-400' };
      }
      // 其他：觀望（預設值）。已移除「逆勢」霸王條款 —— 季線斜率實測無預測力。
    }

    let sellSignal = { text: '續抱', color: 'text-emerald-400' };
    if (is3231) {
      // 3231 緯創：短線波段版賣出標準
      if (totalSellScore > 60) sellSignal = { text: '清倉賣出 (Clear Out)', color: 'text-rose-500 font-bold' };
      else if (totalSellScore > 52) sellSignal = { text: '獲利調節 (Trim)', color: 'text-orange-400' };
      // <= 52 分：續抱（預設值）
    } else if (is2301) {
      // 2301：賣分 ≥ 80 一次全部清空，無分批
      if (twoSignal.isSellToday) sellSignal = { text: '全部清空', color: 'text-rose-500 font-bold' };
      else if (totalSellScore >= 70) sellSignal = { text: `接近清空（差 ${twoSignal.gapToSell.toFixed(1)} 分）`, color: 'text-amber-400' };
      else sellSignal = { text: '續抱', color: 'text-emerald-400' };
    } else {
      // 6669 V25：賣出 = 季線乖離階梯。分級減碼，不清倉（核心長抱）
      // 乖離>40% → 減 1/2（0.3 次/年，位階 91.3，20日內 100% 下跌）
      // 乖離>30% → 減 1/3（1.0 次/年，位階 79.2，減碼後 40 日 −2.80%）
      // 乖離>22% → 預警（2.6 次/年，位階 72.4）
      if (bias > 40) sellSignal = { text: '減碼 1/2', color: 'text-rose-500 font-bold' };
      else if (bias > TRIM_LV) sellSignal = { text: '減碼 1/3', color: 'text-orange-400' };
      else if (bias > WARN_LV) sellSignal = { text: '預警：接近減碼區', color: 'text-amber-400' };
      // 其他：續抱（預設值）
    }

    // 已移除 6669 的「破線 (強制停損)」：實測跌破 Fibo 0.618 後 20 日平均 +6.45%
    // （edge +3.26pp，t=4.07，兩期一致），是買點而非賣點；回測中此規則將
    // 全期報酬由 +835% 壓到 +115%，並使最大回檔由 −50% 惡化到 −68%。

    // 計算前5天的買入和賣出分數（使用固定日期，確保歷史分數穩定）
    const historicalScores = [];
    
    // 獲取當前日期（最後一筆數據的日期）
    const currentDate = data.length > 0 ? data[data.length - 1].fullDate : null;
    if (!currentDate) return null;
    
    // 找到過去 5 個交易日的固定日期
    // 使用日期來查找，而不是相對索引，確保同一日期的分數永遠相同
    const targetDates = [];
    let tradingDaysFound = 0;
    for (let i = data.length - 2; i >= 0 && tradingDaysFound < 5; i--) {
      if (data[i].fullDate && data[i].fullDate !== currentDate) {
        targetDates.push(data[i].fullDate);
        tradingDaysFound++;
      }
    }
    
    // 為每個目標日期計算分數
    for (const targetDate of targetDates) {
      // 找到該日期的索引（從後往前找，確保找到最新的數據）
      let histIndex = -1;
      for (let i = data.length - 1; i >= 0; i--) {
        if (data[i].fullDate === targetDate) {
          histIndex = i;
          break;
        }
      }
      if (histIndex === -1 || histIndex < 60) continue; // 確保有足夠的歷史數據
      
      const histLast = data[histIndex];
      const histPrev = data[histIndex - 1];
      
      if (!histLast || !histPrev) continue;
      
      // 計算歷史當天的實際分數（使用歷史當天的實際數據）
      const histP = histLast.price;
      
      // 重新計算歷史當天的 FIBO（基於歷史當天往前推的窗口期）
      let histMaxPrice = -Infinity, histMaxIndex = -1;
      let histMinPrice = Infinity;
      let histRecentData, histRange, histSwingRate, histFiboValid, histFibo;
      
      if (is3231) {
        // 3231：基於歷史當天往前推 20 天
        histRecentData = data.slice(Math.max(0, histIndex - 19), histIndex + 1);
        
        histRecentData.forEach((d, idx) => { 
          if (d.price > histMaxPrice) { histMaxPrice = d.price; histMaxIndex = idx; }
          if (d.price < histMinPrice) { histMinPrice = d.price; }
        });
        
        histRange = histMaxPrice - histMinPrice;
        histSwingRate = histMinPrice > 0 ? (histMaxPrice - histMinPrice) / histMinPrice : 0;
        histFiboValid = histSwingRate >= 0.05;
        
        histFibo = { 
          l500: histMaxPrice - histRange * 0.5,
          l786: histMaxPrice - histRange * 0.786,
          ext1272: histMaxPrice + histRange * 0.272,
          l236: null, l382: null, l618: null, ext1618: null
        };
      } else {
        // 6669：基於歷史當天往前推 120 天
        histRecentData = data.slice(Math.max(0, histIndex - 119), histIndex + 1);
        
        histRecentData.forEach((d, idx) => { 
          if (d.price > histMaxPrice) { histMaxPrice = d.price; histMaxIndex = idx; } 
        });
        
        const histLegData = histRecentData.slice(0, histMaxIndex + 1);
        histLegData.forEach(d => { if (d.price < histMinPrice) histMinPrice = d.price; });
        
        // 修正：使用固定窗口期，不依賴 data.length，確保歷史分數穩定
        if (histMaxIndex < 5 && histIndex >= 199) {
          const histExtendData = data.slice(Math.max(0, histIndex - 199), histIndex + 1);
          histMinPrice = Math.min(...histExtendData.map(d=>d.price));
        }
        
        histRange = histMaxPrice - histMinPrice;
        histSwingRate = histMinPrice > 0 ? (histMaxPrice - histMinPrice) / histMinPrice : 0;
        histFiboValid = histSwingRate >= 0.1;
        
        histFibo = { 
          l236: histMaxPrice - histRange * 0.236, 
          l382: histMaxPrice - histRange * 0.382, 
          l500: histMaxPrice - histRange * 0.5,
          l618: histMaxPrice - histRange * 0.618, 
          l786: histMaxPrice - histRange * 0.786,
          ext1272: histMaxPrice + histRange * 0.272, 
          ext1618: histMaxPrice + histRange * 0.618 
        };
      }
      
      // 使用重新計算的 FIBO 來評分
      let histB_Fibo = 0, histS_Fibo = 0;
      if (histFiboValid) {
        if (is3231) {
          if (histP > histFibo.l500) histB_Fibo = 0;
          else if (histP > histFibo.l786) histB_Fibo = 3;
          else histB_Fibo = 5;
          
          if (histLast.high >= histFibo.ext1272) histS_Fibo = 5;
          else if (histLast.high >= histMaxPrice) histS_Fibo = 3;
          else histS_Fibo = 0;
        } else {
          // === 6669：使用與當天相同的完整計算邏輯 ===
          // 買入 - 線性給分（與當天相同）
          let histBaseScore = 0;
          if (histP > histFibo.l236) {
            histBaseScore = map(histP, histFibo.l236, histMaxPrice, 5, 10);
          } else if (histP > histFibo.l382) {
            histBaseScore = map(histP, histFibo.l382, histFibo.l236, 20, 25);
          } else if (histP > histFibo.l500) {
            histBaseScore = map(histP, histFibo.l500, histFibo.l382, 15, 20);
          } else if (histP >= histFibo.l618) {
            histBaseScore = map(histP, histFibo.l618, histFibo.l500, 10, 15);
          } else {
            histBaseScore = 0; // 破線
          }

          // K線型態修正（與當天相同）
          let histModifier = 0;
          if (histLast.price > histLast.open && histLast.price > histPrev.price) {
            histModifier += 10; // 止跌確認
          }
          const histBodyLen = Math.abs(histLast.price - histLast.open);
          const histLowerShadow = Math.min(histLast.price, histLast.open) - histLast.low;
          if (histLowerShadow > histBodyLen && histLast.low <= histFibo.l382) {
            histModifier += 8; // 下影線
          }
          if (histLast.volume < (histLast.volMA5 * 0.7)) {
            histModifier += 5; // 量縮
          }
          if (histLast.price < histLast.open && histBodyLen > (histLast.atr * 1.5)) {
            histModifier -= 10; // 殺盤
          }

          histB_Fibo = Math.min(35, Math.max(0, histBaseScore + histModifier));
          
          // 賣出（與當天相同）
          if (histLast.high >= histFibo.ext1618) histS_Fibo = 35; // 獲利滿足
          else if (histLast.high >= histFibo.ext1272) histS_Fibo = 28; // 第一壓力
          else if (histP > histMaxPrice) histS_Fibo = 15; // 解套賣壓
          if (histP < histFibo.l618) histS_Fibo = 35; // 停損
        }
      }
      
      // 簡化的斜率評分
      // 修正：確保歷史分數穩定
      // 當前分數使用：從第 60 個點到最後（data.filter((d, i) => i >= 60)）
      // 歷史分數應該模擬「歷史當天」的計算：從第 60 個點到歷史當天
      // 但為了確保穩定性，我們需要確保範圍固定
      // 問題：當 data.length 增加時，histIndex 也會增加，導致範圍改變
      // 解決方案：使用固定的起始點（60）和結束點（histIndex），這個範圍在計算時是固定的
      // 但實際上，如果歷史數據不變，這個範圍應該是穩定的
      // 唯一可能改變的情況是：歷史數據被修正或更新（這是預期行為）
      const histValidSlopes = data.filter((d, idx) => idx >= 60 && idx <= histIndex).map(d => d.slopeVal);
      const histSPerc = histValidSlopes.length > 0 
        ? (histValidSlopes.sort((a, b) => a - b).filter(s => s < histLast.slopeVal).length / histValidSlopes.length) * 100
        : 50;
      
      let histB_Hist = 0, histS_Hist = 0;
      if (!is3231) {
        let histB_Slope_Rank = 0;
        if (histSPerc < 10) histB_Slope_Rank = map(histSPerc, 0, 10, 15, 10);
        else if (histSPerc < 25) histB_Slope_Rank = map(histSPerc, 10, 25, 10, 5);
        else if (histSPerc < 40) histB_Slope_Rank = map(histSPerc, 25, 40, 5, 0);
        const histB_Slope_Mom = (histLast.slopeVal > histPrev.slopeVal) ? 5 : 0;
        histB_Hist = (histB_Slope_Rank > 0) ? histB_Slope_Rank + histB_Slope_Mom : 0;
        
        let histS_Slope_Rank = 0;
        if (histSPerc > 90) histS_Slope_Rank = map(histSPerc, 90, 100, 10, 15);
        else if (histSPerc > 75) histS_Slope_Rank = map(histSPerc, 75, 90, 5, 10);
        else if (histSPerc > 60) histS_Slope_Rank = map(histSPerc, 60, 75, 0, 5);
        const histS_Slope_Mom = (histLast.slopeVal < histPrev.slopeVal) ? 5 : 0;
        histS_Hist = (histS_Slope_Rank > 0) ? histS_Slope_Rank + histS_Slope_Mom : 0;
      }
      
      // 簡化的 MA 評分
      let histB_MA = 0, histS_MA = 0;
      if (is3231) {
        const histMaValue = histLast.ma20;
        const histBias = histMaValue ? (histP - histMaValue) / histMaValue * 100 : 0;
        if (histBias < -6) histB_MA = 10;
        else if (histBias < -3) histB_MA = 6;
        else if (histBias <= 0) histB_MA = 3;
        
        if (histBias > 8) histS_MA = 10;
        else if (histBias > 4) histS_MA = 6;
        if (histP < histMaValue) histS_MA = Math.max(histS_MA, 3);
        histB_MA = Math.min(10, histB_MA);
        histS_MA = Math.min(10, histS_MA);
      } else {
        const histBias = histLast.ma60 ? (histP - histLast.ma60) / histLast.ma60 * 100 : 0;
        const histMaSlope = histPrev.ma60 && histPrev.ma60 !== 0 ? (histLast.ma60 - histPrev.ma60) / histPrev.ma60 : 0;
        const histLast3Days = data.slice(Math.max(0, histIndex - 2), histIndex + 1);
        const histIsBroken = histLast3Days.length === 3 && histLast3Days.every(d => d.price < d.ma60);
        
        if (!histIsBroken) {
          if (histMaSlope > 0) histB_MA += 3;
          if (histBias > 0 && histBias <= 5) histB_MA += 4;
          else if (histBias > 5 && histBias <= 10) histB_MA += 2;
          else if (histBias < 0 && histMaSlope > 0) histB_MA += 1;
        }
        
        if (histMaSlope < 0) histS_MA += 3;
        // 乖離過熱加強給分（與當日評分一致）
        if (histBias > 30) histS_MA += 15;
        else if (histBias > 22) histS_MA += 11;
        else if (histBias > 15) histS_MA += 7;
        else if (histBias > 10) histS_MA += 4;
        if (histIsBroken) histS_MA = Math.max(histS_MA, 3);
        histB_MA = Math.min(7, histB_MA);
        histS_MA = Math.min(18, histS_MA);
      }
      
      // 簡化的 KD 評分
      let histB_KD = 0, histS_KD = 0;
      const histLookback20 = data.slice(Math.max(0, histIndex - 21), histIndex - 1);
      let histHasDivergence = false;
      if (histLookback20.length > 0) {
        const histMinP = Math.min(...histLookback20.map(d=>d.price));
        const histMinK = Math.min(...histLookback20.map(d=>d.k));
        if (histP < histMinP && histLast.k > histMinK) histHasDivergence = true;
      }
      
      if (is3231) {
        let histB_KD_Pos = 0;
        if (histLast.k < 20) histB_KD_Pos = 15;
        else if (histLast.k < 30) histB_KD_Pos = 5;
        
        let histB_KD_Sig = 0;
        if (histPrev.k !== undefined && histPrev.d !== undefined && histPrev.k < histPrev.d && histLast.k > histLast.d) {
          if (histLast.k < 50) histB_KD_Sig = 10;
        }
        
        if (histHasDivergence) histB_KD = 25;
        else histB_KD = Math.min(25, histB_KD_Pos + histB_KD_Sig);
        
        if (histLast.k > 80) histS_KD = 25;
        else if (histLast.k > 70) histS_KD = 15;
      } else {
        let histB_KD_Pos = 0;
        if (histLast.k < 20) histB_KD_Pos = 4;
        else if (histLast.k < 40) histB_KD_Pos = 2;
        let histB_KD_Sig = 0;
        if (histPrev.k !== undefined && histPrev.d !== undefined && histPrev.k < histPrev.d && histLast.k > histLast.d) {
          if (histLast.k < 20) histB_KD_Sig = 6;
          else if (histLast.k < 50) histB_KD_Sig = 3;
        }
        if (histHasDivergence) histB_KD_Pos = 10;
        histB_KD = Math.min(10, histB_KD_Pos + histB_KD_Sig);
        
        let histS_KD_Pos = 0;
        if (histLast.k > 80) histS_KD_Pos = 3;
        else if (histLast.k > 70) histS_KD_Pos = 1;
        let histS_KD_Sig = 0;
        if (histPrev.k !== undefined && histPrev.d !== undefined && histPrev.k > histPrev.d && histLast.k < histLast.d) {
          if (histLast.k > 80) histS_KD_Sig = 7;
          else if (histLast.k > 50) histS_KD_Sig = 4;
        }
        const histLast3K = data.slice(Math.max(0, histIndex - 2), histIndex + 1).map(d => d.k);
        const histLast3D = data.slice(Math.max(0, histIndex - 2), histIndex + 1).map(d => d.d);
        const histIsPassivation = histLast3K.length === 3 && histLast3K.every(k => k > 80) && histLast3K.every((k, idx) => k > histLast3D[idx]);
        
        histS_KD = Math.min(10, histS_KD_Pos + histS_KD_Sig);
        if (histIsPassivation) histS_KD = 0;
      }
      
      // 簡化的 RSI 評分
      let histB_RSI = 0, histS_RSI = 0;
      let histHasRSIBuyDivergence = false, histHasRSISellDivergence = false;
      if (histLookback20.length > 0) {
        const histMinR = Math.min(...histLookback20.map(d=>d.rsiVal));
        const histMaxR = Math.max(...histLookback20.map(d=>d.rsiVal));
        const histMinP2 = Math.min(...histLookback20.map(d=>d.price));
        const histMaxP2 = Math.max(...histLookback20.map(d=>d.price));
        if (histP < histMinP2 && histLast.rsiVal > histMinR) histHasRSIBuyDivergence = true;
        if (histP > histMaxP2 && histLast.rsiVal < histMaxR) histHasRSISellDivergence = true;
      }
      
      if (is3231) {
        let histB_RSI_Pos = 0;
        if (histLast.rsiVal < 30) histB_RSI_Pos = 15;
        else if (histLast.rsiVal < 45) histB_RSI_Pos = 5;
        
        if (histHasRSIBuyDivergence) histB_RSI = 25;
        else histB_RSI = histB_RSI_Pos;
        
        let histS_RSI_Pos = 0;
        if (histLast.rsiVal > 75) histS_RSI_Pos = 25;
        else if (histLast.rsiVal > 60) histS_RSI_Pos = 10;
        
        if (histHasRSISellDivergence) histS_RSI = 25;
        else histS_RSI = histS_RSI_Pos;
      } else {
        if (histLast.rsiVal < 30) histB_RSI = 7;
        else if (histLast.rsiVal < 50) histB_RSI = 5;
        else if (histLast.rsiVal < 60) histB_RSI = 2;
        if (histPrev.rsiVal !== undefined && histPrev.rsiVal <= 50 && histLast.rsiVal > 50) histB_RSI += 2;
        if (histHasRSIBuyDivergence) histB_RSI += 3;
        histB_RSI = Math.min(10, histB_RSI);
        
        if (histLast.rsiVal > 80) histS_RSI = 7;
        else if (histLast.rsiVal > 70) histS_RSI = 5;
        else if (histLast.rsiVal > 60) histS_RSI = 2;
        if (histPrev.rsiVal !== undefined && histPrev.rsiVal >= 50 && histLast.rsiVal < 50) histS_RSI += 2;
        histS_RSI = Math.min(10, histS_RSI);
      }
      
      // 簡化的 MACD 評分
      let histB_MACD = 0, histS_MACD = 0;
      if (is3231) {
        let histGoldCross = 0, histRedConverge = 0;
        if (histPrev.macd !== undefined && histPrev.macd < 0 && histLast.macd > 0) histGoldCross = 5;
        if (histPrev.macd !== undefined && histLast.macd < 0 && histLast.macd > histPrev.macd) histRedConverge = 3;
        histB_MACD = Math.max(histGoldCross, histRedConverge);
        histB_MACD = Math.min(5, histB_MACD);
        
        let histDeathCross = 0, histGreenConverge = 0;
        if (histPrev.macd !== undefined && histPrev.macd > 0 && histLast.macd < 0) histDeathCross = 5;
        if (histPrev.macd !== undefined && histLast.macd > 0 && histLast.macd < histPrev.macd) histGreenConverge = 3;
        histS_MACD = Math.max(histDeathCross, histGreenConverge);
        histS_MACD = Math.min(5, histS_MACD);
      } else {
        if (histPrev.macd !== undefined && histLast.macd < 0 && histLast.macd > histPrev.macd) histB_MACD += 3;
        if (histPrev.macd !== undefined && histPrev.macd < 0 && histLast.macd > 0) histB_MACD += 2;
        if (histLookback20.length > 0) {
          const histMinO = Math.min(...histLookback20.map(d=>d.macd));
          if (histP < Math.min(...histLookback20.map(d=>d.price)) && histLast.macd > histMinO && histLast.macd < 0) histB_MACD += 2;
        }
        histB_MACD = Math.min(7, histB_MACD);
        
        if (histPrev.macd !== undefined && histLast.macd > 0 && histLast.macd < histPrev.macd) histS_MACD += 3;
        if (histPrev.macd !== undefined && histPrev.macd > 0 && histLast.macd < 0) histS_MACD += 2;
        histS_MACD = Math.min(7, histS_MACD);
      }
      
      // 簡化的 DMI 評分（僅 6669）
      let histB_DMI = 0, histS_DMI = 0;
      if (!is3231) {
        if (histLast.pdi !== undefined && histLast.mdi !== undefined && histLast.pdi > histLast.mdi) {
          histB_DMI += 2;
          if (histPrev.pdi !== undefined && histPrev.mdi !== undefined && histPrev.pdi <= histPrev.mdi && histLast.pdi > histLast.mdi) histB_DMI += 1;
          if (histPrev.adx !== undefined && histLast.adx > 25 && histLast.adx > histPrev.adx) histB_DMI += 3;
          else if (histPrev.adx !== undefined && histLast.adx < 25 && histLast.adx > histPrev.adx) histB_DMI += 1;
        }
        if (histLast.adx > 50) histB_DMI -= 1;
        histB_DMI = Math.max(0, Math.min(6, histB_DMI));
        
        if (histLast.pdi !== undefined && histLast.mdi !== undefined && histLast.mdi > histLast.pdi) {
          histS_DMI += 2;
          if (histPrev.adx !== undefined && histLast.adx > 25 && histLast.adx > histPrev.adx) histS_DMI += 3;
        }
        histS_DMI = Math.min(6, histS_DMI);
      }
      
      // 簡化的 BB 評分
      let histB_BB = 0, histS_BB = 0;
      const histPb = histLast.pctB ?? 0.5;
      
      if (is3231) {
        if (histPb < 0) histB_BB = 30;
        else if (histPb < 0.1) histB_BB = map(histPb, 0, 0.1, 30, 25);
        else if (histPb < 0.3) histB_BB = map(histPb, 0.1, 0.3, 25, 10);
        else histB_BB = 0;
        histB_BB = Math.min(30, Math.max(0, histB_BB));
        
        if (histPb > 1.0) histS_BB = 30;
        else if (histPb > 0.9) histS_BB = map(histPb, 0.9, 1.0, 25, 30);
        else histS_BB = 0;
        
        if (histLast.high && histLast.upper && histLast.high > histLast.upper && histP < histLast.upper) {
          histS_BB = Math.max(histS_BB, 20);
        }
        histS_BB = Math.min(30, Math.max(0, histS_BB));
      } else {
        if (histPb < 0) histB_BB = 3;
        else if (histPb < 0.1) histB_BB = 2;
        if (histLast.mid && histPrev.mid && histLast.mid !== 0) {
          const histMidSlope = (histLast.mid - histPrev.mid);
          const histDistToMid = Math.abs((histP - histLast.mid) / histLast.mid);
          if (histMidSlope > 0 && histDistToMid < 0.01) histB_BB = 2;
        }
        histB_BB = Math.min(5, histB_BB);
        
        if (histPb > 1.1) histS_BB = 3;
        else if (histPb > 1.0) histS_BB = 1;
        if (histLast.high && histLast.upper && histLast.high > histLast.upper && histP < histLast.upper) histS_BB = 2;
        const histBwOpen = histPrev.bandWidth !== undefined && histLast.bandWidth !== undefined ? (histLast.bandWidth > histPrev.bandWidth) : false;
        const histVolExp = histLast.volume !== undefined && histLast.volMA5 !== undefined ? (histLast.volume > (histLast.volMA5 * 1.5)) : false;
        if (histBwOpen && histVolExp && histS_BB > 0) histS_BB = 0;
        histS_BB = Math.min(5, histS_BB);
      }
      
      // 組合分數
      const histB_Trend = is3231 ? (histB_MA + histB_MACD) : (histB_MA + histB_MACD + histB_DMI);
      const histS_Trend = is3231 ? (histS_MA + histS_MACD) : (histS_MA + histS_MACD + histS_DMI);
      const histB_Osc = histB_RSI + histB_KD;
      const histS_Osc = histS_RSI + histS_KD;
      const histB_Vol = histB_BB;
      const histS_Vol = histS_BB;
      
      // 高檔回落停利分（與當日評分一致）
      let histS_PeakExit = 0;
      if (!is3231) {
        const hBiasSlice = data.slice(Math.max(0, histIndex - 14), histIndex + 1);
        const hRecentMaxBias = hBiasSlice.length > 0 ? Math.max(...hBiasSlice.map(d => {
          const mv = d.ma60;
          return mv ? (d.price - mv) / mv * 100 : -Infinity;
        })) : 0;
        const hPeakSlice = data.slice(Math.max(0, histIndex - 59), histIndex + 1);
        const hPeak = hPeakSlice.length > 0 ? Math.max(...hPeakSlice.map(d => d.price)) : histP;
        const hPullback = hPeak > 0 ? (hPeak - histP) / hPeak * 100 : 0;
        if (hRecentMaxBias > 15) {
          if (hPullback >= 18) histS_PeakExit = 30;
          else if (hPullback >= 14) histS_PeakExit = 21;
          else if (hPullback >= 10) histS_PeakExit = 12;
        }
      }

      const histTotalBuyScore = Math.round(histB_Fibo + histB_Hist + histB_Trend + histB_Osc + histB_Vol);
      const histTotalSellScore = Math.min(100, Math.round(histS_Fibo + histS_Hist + histS_Trend + histS_Osc + histS_Vol + histS_PeakExit));
      
      // 歷史徽章：各分頁都改用與當日一致的評分方式
      // 6669 → 單一因素階梯；2301 → 25 項階梯（改顯示「應持有張數」對應的買分）
      historicalScores.push({
        buy: is3231 ? histTotalBuyScore
           : is2301 ? Math.round(twoSignal._bArr[histIndex])
           : rsiLadder(histLast.rsiVal),
        sell: is3231 ? histTotalSellScore
            : is2301 ? Math.round(twoSignal._sArr[histIndex])
            : biasLadder(biasAtIdx(histIndex)),
        lots: is2301 ? (twoSignal._bArr[histIndex] < TWO_BUY_LV ? 0
              : Math.floor((twoSignal._bArr[histIndex] - TWO_BUY_LV) / TWO_STEP) + 1) : undefined,
        date: histLast.fullDate || histLast.date
      });
    }
    
    let adjustedBuySignal = buySignal;
    let tradeTiming = {
      text: '今日觀望',
      detail: '訊號不足，先等待更明確時機。',
      color: 'text-neutral-300',
      bgClass: 'bg-neutral-500/20 border-neutral-500/40'
    };
    if (is2301 && twoSignal) {
      // 2301 三態提示：清空 > 補張 > 觀察（清空優先，因為賣訊是稀有事件）
      const t = twoSignal;
      if (t.isSellToday) {
        tradeTiming = {
          text: '★ 今日全部清空',
          detail: `賣分 ${t.sellScore.toFixed(1)} 已達 ${TWO_SELL_LV} 分門檻，手上持股全部出清、不分批、不留核心。`,
          color: 'text-rose-300',
          bgClass: 'bg-rose-500/20 border-rose-500/40'
        };
      } else if (t.targetLots >= 1) {
        tradeTiming = {
          text: `★ 應持有 ${t.targetLots} 張`,
          detail: `買分 ${t.buyScore.toFixed(1)}（區間 ${TWO_BUY_LV + (t.targetLots - 1) * TWO_STEP}~${t.targetLots >= 10 ? 100 : TWO_BUY_LV + t.targetLots * TWO_STEP - 1} 分）對應應持有 ${t.targetLots} 張，手上不足就補足差額。`,
          color: 'text-emerald-300',
          bgClass: 'bg-emerald-500/20 border-emerald-500/40'
        };
      } else {
        tradeTiming = {
          text: '觀察（未達買區、未達清空）',
          detail: `買分未達 ${TWO_BUY_LV} 分、賣分未達 ${TWO_SELL_LV} 分。已持有的張數繼續抱著等賣訊，不因買分下降而賣出。`,
          color: 'text-neutral-300',
          bgClass: 'bg-neutral-500/20 border-neutral-500/40'
        };
      }
    } else if (!is3231 && sixSignal) {
      // 6669 V25 三態提示：減碼 > 買進 > 不動（減碼優先，因為過熱風險先於機會）
      const s = sixSignal;
      if (bias > 40) {
        tradeTiming = {
          text: '★ 今日減碼 1/2',
          detail: `季線乖離 ${bias.toFixed(1)}% 已超過 40%（極端過熱）。歷史上此區間出現後 20 日內 100% 下跌、40 日平均 −11.7%，價格位階 91.3（賣在區間頂部）。建議減碼一半，保留核心部位。全期僅出現 2 次。`,
          color: 'text-rose-300',
          bgClass: 'bg-rose-500/20 border-rose-500/40'
        };
      } else if (bias > TRIM_LV) {
        tradeTiming = {
          text: '★ 今日減碼 1/3',
          detail: `季線乖離 ${bias.toFixed(1)}% 已超過 ${TRIM_LV}%。歷史上此訊號後 40 日平均 −2.8%（基準 +7.9%），價格位階 79.2，7 次減碼平均帳面獲利 +82%。建議減碼 1/3、保留核心續抱趨勢，不要清倉。`,
          color: 'text-orange-300',
          bgClass: 'bg-orange-500/20 border-orange-500/40'
        };
      } else if (s.isBuyToday) {
        tradeTiming = {
          text: '★ 今日買進',
          detail: `RSI ${last.rsiVal?.toFixed(1)} 首次跌破 ${RSI_BUY_LV}，且距上次買進訊號已滿 ${BUY_GAP} 個交易日。歷史上此訊號後 40 日平均 +17.6%（基準 +7.8%）、勝率 76%、買在周邊區間低 29%。建議下一交易日開盤買入固定股數。`,
          color: 'text-emerald-300',
          bgClass: 'bg-emerald-500/20 border-emerald-500/40'
        };
      } else if (s.rsiReady && s.gapLeft > 0) {
        tradeTiming = {
          text: `⏸ RSI 已達標，需再等 ${s.gapLeft} 個交易日`,
          detail: `RSI ${last.rsiVal?.toFixed(1)} < ${RSI_BUY_LV}，但距上次買進訊號（${s.lastBuyDate}）僅 ${s.daysSinceBuy} 個交易日，未滿 ${BUY_GAP} 日的最小間隔。此限制是為了把頻率控制在每月最多一次並維持訊號品質。`,
          color: 'text-cyan-300',
          bgClass: 'bg-cyan-500/20 border-cyan-500/40'
        };
      } else if (bias > WARN_LV) {
        tradeTiming = {
          text: '預警：接近減碼區',
          detail: `季線乖離 ${bias.toFixed(1)}% 已進入 ${WARN_LV}~${TRIM_LV}% 預警帶。此區間本身不執行動作（歷史上減碼後 40 日 −0.2%，弱於 30% 那一級）。再漲到乖離 ${TRIM_LV}%（約 ${last.ma60 ? Math.round(last.ma60 * (1 + TRIM_LV / 100)).toLocaleString() : '--'}）才減碼。`,
          color: 'text-amber-300',
          bgClass: 'bg-amber-500/20 border-amber-500/40'
        };
      } else {
        tradeTiming = {
          text: '不動',
          detail: `買進需 RSI < ${RSI_BUY_LV}（目前 ${last.rsiVal?.toFixed(1)}），減碼需季線乖離 > ${TRIM_LV}%（目前 ${bias.toFixed(1)}%）。兩邊都未觸發，續抱。歷史頻率：買 3.1 次/年、減碼 1.0 次/年，多數日子都是不動。`,
          color: 'text-neutral-300',
          bgClass: 'bg-neutral-500/20 border-neutral-500/40'
        };
      }
    } else if (is3231) {
      if (totalSellScore > 60) {
        tradeTiming = {
          text: '今日該賣',
          detail: '賣分已達清倉門檻，建議下一交易日優先執行賣出。',
          color: 'text-rose-300',
          bgClass: 'bg-rose-500/20 border-rose-500/40'
        };
      } else if (totalBuyScore > 38) {
        tradeTiming = {
          text: '今日可買',
          detail: '買分達強力買進門檻，可考慮下一交易日進場。',
          color: 'text-emerald-300',
          bgClass: 'bg-emerald-500/20 border-emerald-500/40'
        };
      }
    }

    return {
      last, prev, fibo, sPerc, maxPrice, minPrice, bias, maSlope, isBroken, fiboValid: fiboValid,
      sixSignal, // 6669 V25 訊號狀態（由資料推算，無需本機記錄）
      twoSignal, // 2301 目標持倉制狀態（由資料推算，無需本機記錄）
      fiboMaxScore: fiboMaxScore, // 傳遞 FIBO 最大分數，用於顯示
      kdMaxScore: kdMaxScore, // 傳遞 KD 最大分數，用於顯示
      rsiMaxScore: rsiMaxScore, // 傳遞 RSI 最大分數，用於顯示
      maMaxScore: maMaxScore, // 傳遞 MA 最大分數，用於顯示
      macdMaxScore: macdMaxScore, // 傳遞 MACD 最大分數，用於顯示
      scores: {
        fibo: { 
          buy: b_Fibo, 
          sell: s_Fibo,
          // 6669 專用：詳細分數資訊
          baseScore: !is3231 ? fiboBaseScore : undefined,
          modifier: !is3231 ? fiboModifier : undefined,
          modifierDetails: !is3231 ? fiboModifierDetails : undefined
        },
        slope: { 
          buy: b_Hist, 
          sell: s_Hist,
          buyDetails: slopeBuyDetails,
          sellDetails: slopeSellDetails
        },
        trend: { buy: b_Trend, sell: s_Trend },
        osc: { buy: b_Osc, sell: s_Osc },
        vol: { buy: b_Vol, sell: s_Vol },
        ma: { 
          buy: b_MA, 
          sell: s_MA,
          buyDetails: maBuyDetails,
          sellDetails: maSellDetails
        },
        macd: { 
          buy: b_MACD, 
          sell: s_MACD,
          buyDetails: macdBuyDetails,
          sellDetails: macdSellDetails
        },
        dmi: { 
          buy: b_DMI, 
          sell: s_DMI,
          buyDetails: dmiBuyDetails,
          sellDetails: dmiSellDetails
        },
        rsi: { 
          buy: b_RSI, 
          sell: s_RSI,
          buyDetails: rsiBuyDetails,
          sellDetails: rsiSellDetails
        },
        kd: { 
          buy: b_KD, 
          sell: s_KD,
          buyDetails: kdBuyDetails,
          sellDetails: kdSellDetails
        },
        bb: { 
          buy: b_BB, 
          sell: s_BB,
          buyDetails: bbBuyDetails,
          sellDetails: bbSellDetails
        }
      },
      buy: { total: totalBuyScore, signal: adjustedBuySignal },
      sell: { total: totalSellScore, signal: sellSignal },
      tradeTiming,
      buyTotal: totalBuyScore,
      sellTotal: totalSellScore,
      bbMaxScore: bbMaxScore, // 傳遞布林最大分數，用於顯示
      historicalScores: historicalScores.reverse() // 反轉順序，讓最舊的在前面
    };
  }, [data, stockSymbol]);

  const navScroll = (dir) => {
    if (!chartRef.current) return;
    const amount = dir === 'left' ? -600 : 600;
    chartRef.current.scrollBy({ left: amount, behavior: 'smooth' });
  };

  const handleMouseDown = (e) => {
    isDragging.current = true;
    startX.current = e.pageX - chartRef.current.offsetLeft;
    scrollLeft.current = chartRef.current.scrollLeft;
  };

  const handleMouseUp = () => {
    isDragging.current = false;
  };

  const handleMouseMove = (e) => {
    if (!isDragging.current) return;
    e.preventDefault();
    const x = e.pageX - chartRef.current.offsetLeft;
    const walk = (x - startX.current) * 2.5; 
    chartRef.current.scrollLeft = scrollLeft.current - walk;
  };

  const toggleLayer = (key) => {
    updateTab(activeTabId, {
      visibleLayers: { ...visibleLayers, [key]: !visibleLayers[key] }
    });
  };
  const monthlyTicks = useMemo(() => data.filter(d => d.isNewMonth).map(d => d.fullDate), [data]);
  const chartWidth = useMemo(() => `${(data.length / (isChartExpanded ? 150 : 350)) * 100}%`, [data, isChartExpanded]);
  
  // Y Axis ticks 500
  const yTicks = useMemo(() => {
    if (!data.length) return [];
    const min = Math.min(...data.map(d => d.price));
    const max = Math.max(...data.map(d => d.price));
    const start = Math.floor(min / 500) * 500;
    const end = Math.ceil(max / 500) * 500;
    const ticks = [];
    for (let i = start; i <= end; i += 500) {
      ticks.push(i);
    }
    return ticks;
  }, [data]);

  const showInfo = (e, type, title, content) => {
    e.stopPropagation();
    setActiveInfo({ type, title, content });
  };

  // 2301 策略統計與歷史（由主卡的 ⓘ 開啟，不占主頁空間）
  const TWO_STATS_TEXT = (T) => {
    const st = T.stats;
    const pad = (s, n) => String(s).padEnd(n, '　');
    const trendRows = T.trend.map(t =>
      `  ${t.date}  收 ${String(Math.round(t.price)).padStart(5)}` +
      `　買分 ${t.buy.toFixed(0).padStart(3)} → ${t.tgt} 張` +
      `　賣分 ${t.sell.toFixed(0).padStart(3)}${t.sell >= T.thresholds.TWO_SELL_LV ? ' ★清空' : ''}`
    ).join('\n');
    const roundRows = T.recent.map(r =>
      `  ${r.entry} → ${r.exit}　${String(r.lots).padStart(2)} 張` +
      `　均價 ${r.avg.toFixed(1)} → ${r.exitPx.toFixed(1)}` +
      `　${r.ret >= 0 ? '+' : ''}${r.ret.toFixed(2)}%　${r.days} 日`
    ).join('\n');
    return `【今日狀態】
  買分 ${T.buyScore.toFixed(1)} → 應持有 ${T.targetLots} 張
  賣分 ${T.sellScore.toFixed(1)} / ${T.thresholds.TWO_SELL_LV}${T.isSellToday ? '　★ 已達清空門檻' : `（還差 ${T.gapToSell.toFixed(1)} 分）`}
  ${T.isSellToday ? '' : `下一階需買分 ≥ ${T.needForNext}（還差 ${T.gapToNext.toFixed(1)} 分）`}

【全期統計】統計期間 ${st.spanFrom} 起
  買進動作　${st.buyPerYear.toFixed(1)} 次/年
  出清動作　${st.sellPerYear.toFixed(1)} 次/年
  合計　　　${st.actPerYear.toFixed(1)} 動作/年（每月 ${(st.actPerYear / 12).toFixed(1)} 次）
  平倉輪數　${st.rounds} 輪
  勝率　　　${st.winRate.toFixed(0)}%（${st.wins} 勝 / ${st.rounds - st.wins} 敗）
  每輪報酬　${st.avgRet >= 0 ? '+' : ''}${st.avgRet.toFixed(2)}%（成本加權）
  平均張數　${st.avgLots.toFixed(1)} 張（最多 ${st.maxLots} 張）
  平均持有　${st.avgDays.toFixed(0)} 個交易日

【⚠ 統計期間的重要說明】
App 使用 Yahoo 提供的全部歷史（2301 從 2000 年起），
但這 25 項因素是用 2015 年之後的資料篩選出來的。
2000~2014 對這組因素而言是「樣本外」，實際表現差很多：

  期間　　　　輪數　每輪報酬　勝率　最差單輪
  2000~2009　 41　 +1.50%　 80%　 −54.22%
  2010~2014　 13　 +0.83%　 85%　 −13.25%
  2015~2020　 17　 +2.78%　 82%　 −12.07%
  2021~2026　 28　+13.75%　 93%　  −8.54%

→ 這套策略在 2000~2014 的盤整年代幾乎不賺錢
  （每輪 +0.8~1.5%，扣掉 0.585% 交易成本後接近零），
  2008 年有一輪滿倉 10 張虧損 −54.22%。
  獲利幾乎全部來自 2021 之後。
→ 合理的長期預期請用 +1~3%/輪，不要用近年的 +13.75%。
→ 但 26 年全期仍為正（+7.50%/輪、83% 勝率），策略不會爆掉，
  只是在盤整年代賺不到錢。

【驗證（2015-07 ~ 2026-08 窗口，含息還原）】
  隨機化檢定 600 次：實際每輪 +11.96% vs 隨機平均 +2.14%
    （600 次最大僅 +4.25%）→ p = 0.0000
  兩期都正：前半 +5.45%、後半 +13.13%
  高原：鄰域 36 組（買2~8 × 階梯8~12 × 賣77~83）每輪最低 +9.47%
  容錯：漏掉 50% 買訊，年損益僅 −10%
    （因每日重算目標張數，不依賴任何歷史狀態）
  訊號價值拆解（頻率對等）：
    進場時機貢獻 +12.56pp（p=0.0000）
    出場時機貢獻 +8.80pp（p=0.0000）

【未還原股價的影響】
App 抓的是未還原股價（含除息缺口），我的回測用還原股價。
同一 2015 窗口：未還原 45 輪、每輪 +11.75%、勝率 89%、最差 −12.07%；
還原 50 輪、每輪 +11.96%、勝率 92%、最差 −5.84%。
策略仍有效，但單輪最壞會比回測數字難看。

【近 10 日】
${trendRows}

【近期平倉（模型推演，假設完全照訊號執行）】
${roundRows}

【停用條件】
  不可重新最佳化門檻（4 / 80 / +10 固定）—— 逐年重調實測會失效
  連續 2 個完整年度虧損 → 停用
  單輪虧損超過 −15% → 人工檢視
  每年只做一次檢核，只決定是否繼續，不改參數`;
  };

  const renderScoreBar = (label, score, maxScore, colorClass) => (
    <div className="mb-1.5 sm:mb-2">
      <div className="flex justify-between text-[9px] sm:text-[10px] mb-0.5 sm:mb-1 text-neutral-400">
        <span className="truncate pr-2">{label}</span>
        <span className="font-mono shrink-0">{Math.round(score)} / {Math.round(maxScore)}</span>
      </div>
      <div className="w-full bg-neutral-800 h-1 sm:h-1.5 rounded-full overflow-hidden">
        <div className={`h-full ${colorClass} transition-all duration-500`} style={{width: `${maxScore > 0 ? Math.min(100, (score / maxScore) * 100) : 0}%`}}></div>
      </div>
    </div>
  );

  const diagnosticCards = useMemo(() => {
    const bbWeight = analysis?.bbMaxScore || 5;
    const fiboWeight = analysis?.fiboMaxScore || 35;
    const is3231 = stockSymbol === '3231';
    
    return [
    { 
      key: 'slope', 
      title: '動態斜率 (Slope)', 
      val: `${analysis?.sPerc?.toFixed(1) ?? '--'}%`, 
      desc: is3231
        ? '不列入評分。短線操作專注轉折，不依賴歷史位階。'
        : is2301
        ? '⚪ 不列入評分。2301 篩選時斜率PR低的測試期邊際為 −0.457pp（訓練 −0.457／測試 +1.455 不同向），未通過兩期同向檢定。僅供參考。'
        : '⚪ 不列入評分（V25）。實測兩期邊際接近 0，混入評分會稀釋訊號。僅供參考。',
      info: is3231
        ? `不列入評分 (3231 短線波段版)\n\n3231 策略專注短線轉折指標（RSI、KD、BB），\n不依賴歷史位階判斷，因此斜率不列入評分。\n\n(僅供參考，不影響總分計算)`
        : `權重：20% (位階15+動能5)\n\n【買入評分 - 線性給分】\n● PR < 10: 15-10分 (線性，PR越低分數越高)\n● PR 10-25: 10-5分 (線性分配)\n● PR 25-40: 5-0分 (線性分配)\n● 動能: 向上勾頭且有位階分才觸發 +5分\n\n【賣出評分 - 線性給分】\n● PR > 90: 10-15分 (線性，PR越高分數越高)\n● PR 75-90: 5-10分 (線性分配)\n● PR 60-75: 0-5分 (線性分配)\n● 動能: 向下勾頭且有位階分才觸發 +5分`,
      diag: (p) => {
        if (p === undefined) return { t: "分析中...", c: "text-neutral-500" };
        return p > 90 ? { t: "【歷史高檔】噴發極端，風險高。", c: "text-rose-400" } : p < 15 ? { t: "【歷史低檔】超跌區間，反彈機會。", c: "text-blue-400" } : { t: "【常態波動】無顯著訊號。", c: "text-emerald-400" };
      }
    },
    { 
      key: 'ma', 
      title: is3231 ? 'MA 月線趨勢' : 'MA 季線趨勢', 
      val: analysis ? `$${Math.round(is3231 ? (analysis.last.ma20 || 0) : analysis.last.ma60).toLocaleString()}` : '--', 
      desc: is3231
        ? `動能權重 ${analysis?.maMaxScore || 10}%。月線代表短期成本。負乖離過大即買，正乖離過大即賣。`
        : is2301
        ? '🟢🔴 雙向核心。買方：MA120/60/20/10/5 負乖離共佔 35.7%（最大族群，MA120 負乖離是最強單一因素 +5.958pp）。賣方：MA60/120 正乖離佔 18.2%。'
        : '🔴 賣出評分的唯一因素（100%）。季線乖離 > 30% 減碼 1/3、> 40% 減碼 1/2、> 22% 預警。',
      info: is3231
        ? `權重：${analysis?.maMaxScore || 10}% (短線波段版，MA20月線)\n目前乖離率：${analysis?.bias?.toFixed(2)}%\n\n【買入評分 - 只看負乖離】\n● bias < -6%：10分 (急跌超賣區，滿分)\n● -6% <= bias < -3%：6分 (顯著負乖離)\n● -3% <= bias <= 0%：3分 (回測支撐)\n● bias > 0%：0分 (無便宜可撿)\n\n【賣出評分 - 正乖離 + 跌破】\n● bias > +8%：10分 (急漲超買區，滿分)\n● +4% < bias <= +8%：6分 (獲利警戒區)\n● bias <= +4%：0分 (續抱)\n● 跌破月線：至少 3分 (停利/停損)`
        : `權重：7% (趨勢+位階)\n目前乖離率：${analysis?.bias?.toFixed(2)}%\n季線斜率：${analysis?.maSlope > 0 ? '上揚' : '下彎'}\n\n【買入評分】\n● 趨勢: 斜率>0 (+3)\n● 位階: 乖離0-5% (+4), 5-10% (+2), 假跌破 (+1)\n● 破位: 0分\n\n【賣出評分】\n● 轉弱: 斜率<0 (+3)\n● 過熱: 乖離>25% (+4), >15% (+2)\n● 破位: 跌破3天 (+3)`,
      diag: (p, m) => {
        if (p === undefined) return { t: "分析中...", c: "text-neutral-500" };
        return p > m ? { t: "【多頭排列】股價守穩季線。", c: "text-emerald-400" } : { t: "【空頭盤整】股價位於季線下。", c: "text-rose-400" };
      }
    },
    { 
      key: 'rsi', 
      title: 'RSI 相對強弱', 
      val: analysis ? Math.round(analysis.last.rsiVal) : '--', 
      desc: is3231
        ? `核心權重 ${analysis?.rsiMaxScore || 25}%。短線震盪指標。RSI<30 極度超賣滿分，RSI>75 直接賣出。背離直接滿分。`
        : is2301
        ? '🟢🔴 賣方最大族群。賣方：RSI21/14/9/5 高檔（＋K9/K5）合計 54.5%，是清空訊號的主體。買方只用 RSI5 低檔（7.1%）—— RSI14/21 低檔在 2301 測試期轉負（−0.370／−0.032pp）已剔除。'
        : '🟢 買進評分的唯一因素（100%）。RSI < 30 為買點（另需距上次買訊滿 21 交易日）。買後 40 日平均 +17.6%，基準 +7.8%。',
      info: is3231
        ? `權重：${analysis?.rsiMaxScore || 25}% (短線波段版，核心震盪指標)\n\n【買入評分 - 階梯式】\n● RSI < 30：15分 (極度超賣區)\n● 30 <= RSI < 45：5分 (弱勢整理區)\n● RSI >= 45：0分 (無便宜可撿)\n\n【底背離加分】\n● 價格背離：直接滿分 25分 (強力買訊)\n\n【賣出評分 - 階梯式】\n● RSI > 75：25分 (極度超買，直接滿分賣出)\n● 60 < RSI <= 75：10分 (相對高檔，分批調節)\n● RSI <= 60：0分 (安全區，續抱)\n\n【頂背離加分】\n● 價格背離：直接滿分 25分 (假突破，強力賣訊)\n\n(移除突破/跌破50加分，短線操作不等待)`
        : `權重：${analysis?.rsiMaxScore || 10}%\n\n【買入評分】\n● RSI < 60 開始給分，< 30 滿分\n● 突破50：+2分\n● 底背離：+3分\n\n【賣出評分】\n● RSI > 40 開始給分，> 80 滿分\n● 跌破50：+2分`,
      diag: (r) => {
        if (r === undefined) return { t: "分析中...", c: "text-neutral-500" };
        return r > 75 ? { t: "【過熱】RSI高檔鈍化。", c: "text-rose-400" } : r < 35 ? { t: "【超賣】RSI低檔背離。", c: "text-blue-400" } : { t: "【中性】力道均衡。", c: "text-emerald-400" };
      }
    },
    { 
      key: 'kd', 
      title: 'KD 隨機指標', 
      val: analysis ? `K:${Math.round(analysis.last.k)}` : '--', 
      desc: is3231
        ? `核心權重 ${analysis?.kdMaxScore || 25}%。短線轉折指標。K<20 極度超賣滿分，K>80 直接賣出。無鈍化保護，有賺就跑。`
        : is2301
        ? '🟢🔴 雙向。買方：K9 低檔 + K5 低檔佔 14.3%（震盪超賣族群 21.4% 的一部分）。賣方：K9 高檔 + K5 高檔佔 18.2%。'
        : '⚪ 不列入評分（V25）。KD 低檔與 RSI 低檔統計上等價（+8.45 vs +8.62pp），為避免重複計分只採用 RSI。僅供參考。',
      info: is3231
        ? `權重：${analysis?.kdMaxScore || 25}% (短線波段版，核心轉折指標)\n\n【買入評分 - 階梯式】\n● K < 20：15分 (極度超賣區)\n● 20 <= K < 30：5分 (超賣邊緣)\n● K >= 30：0分 (位階不夠低)\n\n【金叉訊號】\n● K < 50 時金叉：+10分 (確認動能翻多)\n● K >= 50 時金叉：0分 (高檔金叉，利潤不足)\n\n【背離加分】\n● 價格背離：直接滿分 25分 (強力買訊)\n\n【賣出評分 - 只看位階】\n● K > 80：25分 (極度超買，直接滿分賣出)\n● 70 < K <= 80：15分 (警戒區，分批調節)\n● K <= 70：0分 (安全區，續抱)\n\n(不等待死叉，無鈍化保護)`
        : `權重：${analysis?.kdMaxScore || 10}% (位階+訊號)\n\n【買入】\n● K<20 (4分), 20-40 (2分)\n● 低檔金叉 (+6), 中低檔 (+3)\n● 背離 (滿分)\n\n【賣出】\n● K>80 (3分), 70-80 (1分)\n● 高檔死叉 (+7), 中高檔 (+4)\n● 鈍化保護: 0分`,
      diag: (k) => k > 80 ? { t: "【高檔】K值過高，防回檔。", c: "text-rose-400" } : k < 20 ? { t: "【低檔】K值過低，醞釀反彈。", c: "text-blue-400" } : { t: "【區間整理】K值位於 20-80。", c: "text-emerald-400" }
    },
    { 
      key: 'bb', 
      title: 'Bollinger 布林', 
      val: analysis ? `%B:${analysis.last.pctB?.toFixed(2)}` : '--', 
      desc: is3231 
        ? `波動權重 ${bbWeight}%。短線波段策略。%B < 0 超跌滿分，> 1.0 突破上軌滿分。有賺就跑，不設保護。`
        : is2301
        ? '🔴 賣方因素（9.09%）。布林20 高檔與箱型高位合計 18.2%（相對位置族群）。%B ≥ 1.0 給滿分。買方側的布林低檔在 2301 測試期轉負（−0.841pp）已剔除。'
        : '⚪ 不列入評分（V25）。實測 %B > 1.0 對頂部預測力低於基準（lift 0.91）。僅供參考。',
      info: is3231
        ? `權重：${bbWeight}% (短線波段策略)\n\n【買入評分】\n● %B < 0：超跌滿分 (30分)\n● %B < 0.1：極限接近下軌 (25分)\n● %B < 0.3：相對低檔 (10分)\n\n【賣出評分】\n● %B > 1.0：突破上軌滿分 (30分)\n● %B > 0.9：接近上軌壓力 (25分)\n● 假突破：上攻失敗 (20分)\n\n(移除爆量保護，有賺就跑)`
        : `權重：${bbWeight}% (%B策略)\n\n【買入評分】\n● %B < 0：極端超賣 (3分)\n● %B < 0.1：下軌支撐 (2分)\n● 回測中軌：強勢回檔 (2分)\n\n【賣出評分】\n● %B > 1.1：懸空噴出 (3分)\n● %B > 1.0：突破上軌 (1分)\n● 假突破：(2分)\n● 保護：爆量打開開口 -> 0分`,
      diag: (l) => {
        if (!l) return { t: "分析中...", c: "text-neutral-500" };
        return l.pctB > 1.1 ? { t: "【極端乖離】懸空噴出，不可持續。", c: "text-rose-400" } : l.pctB < 0 ? { t: "【極端超跌】跌出通道，隨時反彈。", c: "text-blue-400" } : { t: "【常態】軌道內運行。", c: "text-emerald-400" };
      }
    },
    { 
      key: 'macd', 
      title: 'MACD 動能', 
      val: analysis ? analysis.last.macd.toFixed(2) : '--', 
      desc: is3231
        ? `輔助權重 ${analysis?.macdMaxScore || 5}%。動能止跌確認。紅柱收斂即給分，不等待交叉。短線快進快出。`
        : is2301
        ? '⚪ 不列入評分。MACD 紅柱收斂在 1402 上有效，但在 2301 上實測 −1.48pp（訓練 +0.221／測試 −1.480）是有害因素，已明確剔除。綠柱收斂 −0.904pp 同樣無效。僅供參考。'
        : '⚪ 不列入評分（V25）。綠柱收斂 lift 1.00（完全無效），賣出側訓練 +0.50／測試 −2.20pp。僅供參考。',
      info: is3231
        ? `權重：${analysis?.macdMaxScore || 5}% (短線波段版，輔助濾網)\n\n【買入評分 - 止跌確認】\n● 黃金交叉 (OSC 負轉正)：5分 (滿分，動能翻多)\n● 紅柱收斂 (OSC < 0 且收斂)：3分 (止跌訊號，重點)\n● 紅柱擴大：0分 (殺盤持續)\n\n【賣出評分 - 上攻無力】\n● 死亡交叉 (OSC 正轉負)：5分 (滿分，動能翻空)\n● 綠柱收斂 (OSC > 0 且收斂)：3分 (上攻無力，獲利了結預警)\n● 綠柱擴大：0分 (主升段，續抱)\n\n(不求全拿，只要 3 分配合其他指標即可)`
        : `權重：${analysis?.macdMaxScore || 7}%\n\n【買入評分 (Max 7)】\n● 紅柱收斂 (轉強): +3\n● 零軸金叉 (確認): +2\n● 底背離 (破底翻): +2\n\n【賣出評分 (Max 7)】\n● 綠柱收斂 (轉弱): +3\n● 零軸死叉 (確認): +2\n● 頂背離 (拉高出貨): +2`,
      diag: (o) => {
        if (o === undefined) return { t: "分析中...", c: "text-neutral-500" };
        return o > 0 ? { t: "【多方動能】柱狀體為正。", c: "text-emerald-400" } : { t: "【空方動能】柱狀體為負。", c: "text-rose-400" };
      }
    },
    { 
      key: 'dmi', 
      title: 'DMI 趨勢強度', 
      val: analysis ? Math.round(analysis.last.adx) : '--', 
      desc: is3231
        ? '不列入評分。短線操作不依賴趨勢強度指標，專注轉折訊號。'
        : is2301
        ? '⚪ 不列入評分。2301 篩選中 +DI>-DI 邊際 +0.004pp、-DI>+DI 邊際 +0.006pp，兩者皆等於零，且未通過兩期同向。僅供參考。'
        : '⚪ 不列入評分（V25）。賣出側訓練邊際 −16.24pp（全部因素中最差）。僅供參考。',
      info: is3231
        ? `不列入評分 (3231 短線波段版)\n\n3231 策略專注短線轉折指標（RSI、KD、BB），\n不依賴趨勢強度判斷，因此 DMI 不列入評分。\n\n(僅供參考，不影響總分計算)`
        : `權重：6%\n\n【買入評分】\n● 方向：+DI > -DI (+2), 金叉 (+1)\n● 強度：ADX > 25 且向上 (+3)\n● 過熱扣分：ADX > 50 (-1)\n\n【賣出評分】\n● 方向：-DI > +DI (+2), 死叉 (+1)\n● 強度：ADX > 25 且向上 (+3)`,
      diag: (a) => a > 25 ? { t: "【趨勢盤】動能強勁。", c: "text-rose-400" } : { t: "【盤整盤】方向不明。", c: "text-blue-400" }
    },
    { 
      key: 'fibo', 
      title: 'Fibo 波段位階', 
      val: '關鍵位階', 
      getVal: (analysis, themeColors) => {
        if (is3231) {
          // 3231 只顯示簡化位階
          return (
            <div className="flex flex-col gap-1 mt-1">
              <div className="flex justify-between items-center text-xs">
                <span style={{color: themeColors.ext1272}}>1.272</span>
                <span className="font-mono">${analysis && analysis.fibo.ext1272 ? Math.round(analysis.fibo.ext1272) : '--'}</span>
              </div>
              <div className="flex justify-between items-center text-xs">
                <span style={{color: themeColors.l500}}>0.500</span>
                <span className="font-mono">${analysis && analysis.fibo.l500 ? Math.round(analysis.fibo.l500) : '--'}</span>
              </div>
              <div className="flex justify-between items-center text-xs">
                <span style={{color: themeColors.l786}}>0.786</span>
                <span className="font-mono">${analysis && analysis.fibo.l786 ? Math.round(analysis.fibo.l786) : '--'}</span>
              </div>
            </div>
          );
        } else {
          // 6669 顯示完整位階
          const currentPrice = analysis?.last?.price || 0;
          const fibo = analysis?.fibo || {};
          const maxPrice = analysis?.maxPrice || 0;
          
          // 判斷當前價格所在區間
          let currentRange = '';
          let rangeColor = '#fff';
          if (fibo.l236 && fibo.l382 && fibo.l500 && fibo.l618) {
            if (currentPrice > fibo.l236) {
              currentRange = `> 0.236 (高檔追價區)`;
              rangeColor = themeColors.l236 || '#fff';
            } else if (currentPrice > fibo.l382) {
              currentRange = `0.236-0.382 (強勢接力區)`;
              rangeColor = themeColors.l382 || '#fff';
            } else if (currentPrice > fibo.l500) {
              currentRange = `0.382-0.5 (合理價值區)`;
              rangeColor = themeColors.l382 || '#fff';
            } else if (currentPrice >= fibo.l618) {
              currentRange = `0.5-0.618 (防守觀察區)`;
              rangeColor = themeColors.l618 || '#fff';
            } else {
              currentRange = `< 0.618 (破線區)`;
              rangeColor = '#ef4444';
            }
          }
          
          // 取得分數詳細資訊
          const fiboScore = analysis?.scores?.fibo || {};
          const baseScore = fiboScore.baseScore;
          const modifier = fiboScore.modifier;
          const modifierDetails = fiboScore.modifierDetails || [];
          
          return (
            <div className="flex flex-col gap-1 mt-1">
              {/* 當前區間顯示 */}
              {currentRange && (
                <div className="mb-2 pb-2 border-b border-white/10">
                  <div className="text-[10px] text-neutral-400 mb-0.5">當前區間</div>
                  <div className="text-xs font-semibold" style={{color: rangeColor}}>{currentRange}</div>
                </div>
              )}
              <div className="flex justify-between items-center text-xs">
                <span style={{color: themeColors.target}}>1.618</span>
                <span className="font-mono">${analysis && analysis.fibo.ext1618 ? Math.round(analysis.fibo.ext1618) : '--'}</span>
              </div>
              <div className="flex justify-between items-center text-xs">
                <span style={{color: themeColors.ext1272}}>1.272</span>
                <span className="font-mono">${analysis && analysis.fibo.ext1272 ? Math.round(analysis.fibo.ext1272) : '--'}</span>
              </div>
              <div className="flex justify-between items-center text-xs">
                <span style={{color: themeColors.l618}}>0.618</span>
                <span className="font-mono">${analysis && analysis.fibo.l618 ? Math.round(analysis.fibo.l618) : '--'}</span>
              </div>
              <div className="flex justify-between items-center text-xs">
                <span style={{color: themeColors.l382}}>0.382</span>
                <span className="font-mono">${analysis && analysis.fibo.l382 ? Math.round(analysis.fibo.l382) : '--'}</span>
              </div>
              <div className="flex justify-between items-center text-xs">
                <span style={{color: themeColors.l236}}>0.236</span>
                <span className="font-mono">${analysis && analysis.fibo.l236 ? Math.round(analysis.fibo.l236) : '--'}</span>
              </div>
            </div>
          );
        }
      },
      desc: is3231 
        ? `短線權重 ${fiboWeight}%。20日箱型策略。`
        : is2301
        ? '⚪ 不列入評分。2301 改用「自 10/20/60 日高點回落」（買方 21.4%）與「箱型高位／自 60 日低點反彈」（賣方 27.3%）來表達相對位置，這些因素通過兩期同向檢定；Fibo 位階未列入。僅供參考。'
        : '⚪ 不列入評分（V25）。買進側兩期邊際 +0.45／+1.63pp；賣出側 1.272 在 7 年內僅觸及 1 次、1.618 為 0 次。破線停損亦已移除。僅供參考。',
      info: is3231
        ? `權重：${fiboWeight}% (短線波段版，20日箱型)\n價格位於箱型下半部即給分，極簡化階梯式評分。\n\n【買入評分 - 階梯式】\n● 價格 > l500：0分 (上半部壓力區)\n● l786 < 價格 <= l500：3分 (下半部安全區)\n● 價格 <= l786：5分 (底部超跌區)\n\n【賣出評分 - 階梯式】\n● 最高價 >= ext1272：5分 (短線噴出)\n● 最高價 >= maxPrice：3分 (創新高)\n● 價格 < maxPrice：0分 (未突破)`
        : `權重：${fiboWeight}% (最高)\n依據最近趨勢腿 (Impulse Leg) 計算。0.382 為最佳回檔買點。\n\n【買入評分 - 線性給分】\n基礎分數（依價格區間線性分配）：\n● > 0.236：5-10分 (線性分配)\n● 0.236-0.382：20-25分 (線性，0.382最高25分)\n● 0.382-0.5：15-20分 (線性分配)\n● 0.5-0.618：10-15分 (線性分配)\n● < 0.618 (破線)：0分\n\nK線型態修正（加減分）：\n● 止跌確認：+10分 (收盤價 > 開盤價 且 > 前日收盤價)\n● 下影線：+8分 (下影線 > 實體 且 最低價 <= 0.382)\n● 量縮：+5分 (成交量 < 5日均量 × 0.7)\n● 殺盤：-10分 (收盤價 < 開盤價 且 實體 > ATR × 1.5)\n\n最終分數 = 基礎分數 + 修正分數（限制在 0-35 分）\n\n【賣出評分】\n● 最高價 >= 1.618：獲利滿足 35分\n● 最高價 >= 1.272：壓力 28分\n● 價格 > 前高：解套賣壓 15分\n● 價格 < 0.618：停損 35分`,
      diag: () => ({ t: "【關鍵決策】權重最高參考指標。", c: "text-blue-400" })
    }
  ];
  }, [analysis, stockSymbol]);

  return (
    <>
      {/* Loading Modal - 放在最外層，不受模糊影響 */}
      {loading && (
        <div className="fixed inset-0 bg-black/70 z-[100] flex items-center justify-center p-4 backdrop-blur-md">
          <div className="bg-neutral-800 border-2 border-indigo-500/50 p-6 sm:p-8 rounded-2xl max-w-sm w-full shadow-2xl relative">
            <div className="flex flex-col items-center gap-4">
              <div className="p-4 bg-indigo-500/20 rounded-full">
                <RefreshCw size={32} className="text-indigo-400 animate-spin"/>
              </div>
              <h3 className="text-xl font-black text-indigo-400">正在獲取資料</h3>
              
              {/* 進度信息 */}
              {loadingProgress.totalProxies > 0 && (
                <div className="w-full space-y-3">
                  <div className="bg-neutral-900/50 rounded-xl p-4 space-y-2">
                    <div className="flex justify-between items-center text-sm">
                      <span className="text-neutral-400">代理服務</span>
                      <span className="text-indigo-400 font-bold">
                        {loadingProgress.proxyName || '連接中...'}
                      </span>
                    </div>
                    <div className="flex justify-between items-center text-xs text-neutral-500">
                      <span>代理 {loadingProgress.currentProxy} / {loadingProgress.totalProxies}</span>
                      {loadingProgress.error && (
                        <span className="text-rose-400 text-[10px] truncate max-w-[120px]" title={loadingProgress.error}>
                          ⚠ {loadingProgress.error.length > 15 ? loadingProgress.error.substring(0, 15) + '...' : loadingProgress.error}
                        </span>
                      )}
                    </div>
                  </div>
                  
                  <div className="bg-neutral-900/50 rounded-xl p-4 space-y-2">
                    <div className="flex justify-between items-center text-sm">
                      <span className="text-neutral-400">重試次數</span>
                      <span className="text-amber-400 font-bold">
                        {loadingProgress.retryCount} / {loadingProgress.maxRetries}
                      </span>
                    </div>
                  </div>
                </div>
              )}
              
              {/* 進度條 */}
              <div className="w-full bg-neutral-700 rounded-full h-2 mt-2 overflow-hidden">
                <div 
                  className="bg-indigo-500 h-full rounded-full transition-all duration-300" 
                  style={{
                    width: loadingProgress.totalProxies > 0 
                      ? `${Math.min(100, ((loadingProgress.currentProxy - 1) / loadingProgress.totalProxies) * 50 + (loadingProgress.retryCount / loadingProgress.maxRetries) * 50)}%`
                      : '60%'
                  }}
                ></div>
              </div>
              
              <p className="text-xs text-neutral-500 text-center mt-2">
                {loadingProgress.status === 'processing' ? '正在處理數據...' : '正在連接伺服器...'}
              </p>
            </div>
          </div>
        </div>
      )}

      <div className="min-h-screen bg-neutral-950 p-4 md:p-8 font-sans text-neutral-100 overflow-x-hidden selection:bg-indigo-500/30 transition-all duration-300">
        <style>{`
          .no-scrollbar::-webkit-scrollbar { display: none; }
          .chart-grid-fade { mask-image: linear-gradient(to right, transparent, black 5%, black 90%, transparent); }
          .sticky-y-overlay { 
            position: absolute; right: 0; top: 0; bottom: 0; width: 68px; z-index: 50; 
            background: #171717;
            border-left: none !important;
            pointer-events: none; 
          }
        `}</style>

        {/* Info Modal */}
        {activeInfo && (
          <div className="fixed inset-0 bg-black/60 z-[100] flex items-center justify-center p-4 backdrop-blur-sm" onClick={() => setActiveInfo(null)}>
            <div className="bg-neutral-800 border border-neutral-600 p-6 rounded-2xl max-w-sm w-full shadow-2xl relative" onClick={e => e.stopPropagation()}>
              <button onClick={() => setActiveInfo(null)} className="absolute top-4 right-4 text-neutral-400 hover:text-white"><X size={20}/></button>
              <h3 className="text-lg font-black text-white mb-2 flex items-center gap-2">
                <Info size={18} className="text-indigo-400"/> {activeInfo.title}
              </h3>
              <div className="text-sm text-neutral-300 whitespace-pre-wrap leading-relaxed border-t border-white/10 pt-4">
                {activeInfo.content}
              </div>
            </div>
          </div>
        )}

        {/* Error Modal */}
        {fetchError && (
          <div className="fixed inset-0 bg-black/60 z-[100] flex items-center justify-center p-4 backdrop-blur-sm" onClick={() => updateTab(activeTabId, { fetchError: null })}>
            <div className="bg-neutral-800 border-2 border-rose-500/50 p-6 rounded-2xl max-w-md w-full shadow-2xl relative" onClick={e => e.stopPropagation()}>
              <button onClick={() => updateTab(activeTabId, { fetchError: null })} className="absolute top-4 right-4 text-neutral-400 hover:text-white"><X size={20}/></button>
              <div className="flex items-center gap-3 mb-4">
                <div className="p-2 bg-rose-500/20 rounded-lg">
                  <AlertTriangle size={24} className="text-rose-400"/>
                </div>
                <h3 className="text-xl font-black text-rose-400">{fetchError.title}</h3>
              </div>
              <div className="text-sm text-neutral-300 whitespace-pre-wrap leading-relaxed border-t border-white/10 pt-4 mb-4">
                {fetchError.message}
              </div>
              <div className="flex gap-3">
                <button 
                  onClick={() => {
                    updateTab(activeTabId, { fetchError: null });
                    fetchStockData(fetchError.symbol, activeTabId);
                  }}
                  className="flex-1 bg-indigo-600 hover:bg-indigo-500 px-4 py-2 rounded-xl text-sm font-black transition-all flex items-center justify-center gap-2"
                >
                  <RefreshCw size={16}/> 重新載入
                </button>
                <button 
                  onClick={() => updateTab(activeTabId, { fetchError: null })}
                  className="flex-1 bg-neutral-700 hover:bg-neutral-600 px-4 py-2 rounded-xl text-sm font-black transition-all"
                >
                  關閉
                </button>
              </div>
            </div>
          </div>
        )}

        {/* 主內容區域 - 只在載入時應用模糊 */}
        <div className={loading ? 'blur-sm' : ''}>

      {/* Tab 導航欄 - 分頁樣式 */}
      <div className="max-w-7xl mx-auto mb-6 px-2">
        <div className="flex items-end gap-0 overflow-x-auto no-scrollbar border-b-2 border-neutral-800">
          {tabs.map((tab, index) => (
            <button
              key={tab.id}
              onClick={() => switchTab(tab.id)}
              className={`relative px-6 sm:px-8 py-3 sm:py-4 transition-all cursor-pointer shrink-0 font-black text-base sm:text-lg md:text-xl uppercase tracking-wider ${
                activeTabId === tab.id
                  ? 'text-indigo-300 bg-neutral-900 border-t-2 border-l-2 border-r-2 border-indigo-500 rounded-t-xl sm:rounded-t-2xl -mb-[2px] z-10'
                  : 'text-neutral-500 bg-neutral-950/50 border-t-2 border-l-2 border-r-2 border-transparent rounded-t-lg sm:rounded-t-xl hover:text-neutral-300 hover:bg-neutral-900/70'
              }`}
              style={{
                borderTopLeftRadius: index === 0 ? '0.75rem' : '0',
                borderTopRightRadius: index === tabs.length - 1 ? '0.75rem' : '0',
              }}
            >
              {tab.symbol}
              {activeTabId === tab.id && (
                <div className="absolute bottom-0 left-0 right-0 h-[2px] bg-neutral-950"></div>
              )}
            </button>
          ))}
        </div>
      </div>

      <div className="max-w-7xl mx-auto flex flex-col md:flex-row justify-between items-center mb-6 md:mb-8 gap-4 md:gap-6 px-2">
        <div className="flex flex-col items-center md:items-start w-full md:w-auto">
          <h1 className="text-2xl sm:text-3xl md:text-4xl font-black bg-clip-text text-transparent bg-gradient-to-r from-indigo-400 to-emerald-400 tracking-tighter uppercase text-center md:text-left">[{stockSymbol}] 買賣點分析</h1>
          <p className="text-[10px] sm:text-xs text-neutral-500 mt-1 tracking-wider">@ Dixon Chu</p>
        </div>
        <div className="flex items-center gap-1.5 sm:gap-2 bg-neutral-900/80 p-1.5 sm:p-2 rounded-xl sm:rounded-2xl border-2 border-neutral-700 shadow-xl w-full md:w-auto justify-center">
          <div className="relative group">
            <Search className="absolute left-2 sm:left-3 top-1/2 -translate-y-1/2 text-neutral-500 w-3.5 h-3.5 sm:w-4 sm:h-4"/>
            <input 
              type="text" 
              value={stockSymbol} 
              onChange={(e) => updateTab(activeTabId, { symbol: e.target.value.toUpperCase() })} 
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  const newSymbol = e.target.value.trim().toUpperCase();
                  if (newSymbol && newSymbol !== stockSymbol) {
                    updateTab(activeTabId, { symbol: newSymbol });
                    fetchStockData(newSymbol, activeTabId);
                  }
                }
              }}
              className="bg-transparent pl-7 sm:pl-9 pr-2 sm:pr-4 py-1.5 sm:py-2 text-xs sm:text-sm focus:outline-none w-16 sm:w-20 md:w-24 text-neutral-200 font-bold placeholder-neutral-600 uppercase" 
              placeholder="代號"
            />
          </div>
          <div className="w-px h-5 sm:h-6 bg-neutral-700 mx-0.5 sm:mx-1"></div>
          <input 
            type="number" 
            placeholder="模擬價" 
            value={manualPrice} 
            onChange={(e) => updateTab(activeTabId, { manualPrice: e.target.value })} 
            className="bg-transparent px-2 sm:px-4 py-1.5 sm:py-2 text-xs sm:text-sm focus:outline-none w-16 sm:w-20 md:w-24 text-indigo-400 font-mono" 
          />
          <button 
            onClick={() => fetchStockData(stockSymbol, activeTabId)} 
            className="bg-indigo-600 px-2 sm:px-4 py-1.5 sm:py-2 rounded-lg sm:rounded-xl text-[10px] sm:text-xs font-black hover:bg-indigo-500 transition-all flex items-center gap-1 sm:gap-2 whitespace-nowrap"
          >
            <RefreshCw size={12} className={`sm:w-[14px] sm:h-[14px] ${loading?'animate-spin':''}`}/><span className="hidden sm:inline">同步</span>
          </button>
        </div>
      </div>

      <div className="max-w-7xl mx-auto mb-5 space-y-3">
        {/* ── 三態提示（6669：買進 / 減碼 / 不動） ── */}
        <div className={`rounded-2xl border px-4 py-3 sm:px-5 sm:py-4 ${analysis?.tradeTiming?.bgClass || 'bg-neutral-500/20 border-neutral-500/40'}`}>
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2">
            <div className={`text-base sm:text-xl font-black ${analysis?.tradeTiming?.color || 'text-neutral-300'}`}>
              {is3231 ? '交易時機：' : '今日動作：'}{analysis?.tradeTiming?.text || (is3231 ? '今日觀望' : '不動')}
            </div>
            {is2301 && analysis?.twoSignal && (
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] sm:text-xs font-mono">
                <span className="text-neutral-500">
                  買分 <span className={`font-bold text-sm ${analysis.twoSignal.targetLots > 0 ? 'text-emerald-400' : 'text-neutral-200'}`}>
                    {analysis.twoSignal.buyScore.toFixed(1)}
                  </span>
                  <span className="ml-1">▸ 應持有 {analysis.twoSignal.targetLots} 張</span>
                </span>
                <span className="text-neutral-500">
                  賣分 <span className={`font-bold text-sm ${analysis.twoSignal.isSellToday ? 'text-rose-400' : analysis.twoSignal.sellScore >= 70 ? 'text-amber-400' : 'text-neutral-200'}`}>
                    {analysis.twoSignal.sellScore.toFixed(1)}
                  </span>
                  <span className="ml-1">▸ 清空需 ≥ 80</span>
                </span>
              </div>
            )}
            {is6669 && analysis && (
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] sm:text-xs font-mono">
                <span className="text-neutral-500">
                  RSI <span className={`font-bold text-sm ${analysis.last.rsiVal < 30 ? 'text-emerald-400' : 'text-neutral-200'}`}>
                    {analysis.last.rsiVal?.toFixed(1) ?? '--'}
                  </span>
                  <span className="ml-1">▸ 買進需 &lt; 30</span>
                </span>
                <span className="text-neutral-500">
                  乖離 <span className={`font-bold text-sm ${analysis.bias > 30 ? 'text-rose-400' : analysis.bias > 22 ? 'text-amber-400' : 'text-neutral-200'}`}>
                    {analysis.bias?.toFixed(1) ?? '--'}%
                  </span>
                  <span className="ml-1">▸ 減碼需 &gt; 30%</span>
                </span>
              </div>
            )}
          </div>
          <div className="text-xs sm:text-sm text-neutral-300 mt-2 leading-relaxed">
            {analysis?.tradeTiming?.detail || '訊號不足，先等待更明確時機。'}
          </div>
          {is6669 && analysis?.sixSignal && (
            <div className="flex flex-wrap gap-x-5 gap-y-1 mt-2.5 pt-2.5 border-t border-white/10 text-[10px] sm:text-[11px] text-neutral-400 font-mono">
              {analysis.sixSignal.lastBuyDate && (
                <span>上次買訊 {analysis.sixSignal.lastBuyDate} @{Math.round(analysis.sixSignal.lastBuyPrice).toLocaleString()}
                  <span className="text-neutral-600"> （{analysis.sixSignal.daysSinceBuy} 個交易日前）</span>
                </span>
              )}
              {analysis.sixSignal.lastTrimDate && (
                <span>上次減碼訊號 {analysis.sixSignal.lastTrimDate} @{Math.round(analysis.sixSignal.lastTrimPrice).toLocaleString()}</span>
              )}
              <span className="text-neutral-600">
                全期訊號：買 {analysis.sixSignal.buyCount} 次／減碼 {analysis.sixSignal.trimCount} 次
              </span>
            </div>
          )}
        </div>

        {/* ── 觸發價位表（僅 6669） ── */}
        {is6669 && analysis?.sixSignal && (
          <div className="rounded-2xl border border-neutral-700 bg-neutral-900/70 px-4 py-3 sm:px-5 sm:py-4">
            <div className="flex items-baseline justify-between mb-2.5">
              <div className="text-[11px] sm:text-xs font-black text-neutral-400 uppercase tracking-wider">觸發價位</div>
              <div className="text-[10px] sm:text-[11px] text-neutral-500 font-mono">
                季線 {analysis.last.ma60 ? Math.round(analysis.last.ma60).toLocaleString() : '--'}
                <span className="text-neutral-600">（每日變動，價位隨之重算）</span>
              </div>
            </div>
            <div className="space-y-1.5">
              {analysis.sixSignal.levels.map((L) => (
                <div key={L.lv}
                  className={`flex items-center justify-between gap-2 rounded-lg px-3 py-2 text-xs sm:text-sm ${
                    L.hit ? 'bg-rose-500/15 border border-rose-500/40'
                          : L.lv === 22 ? 'bg-amber-500/5 border border-amber-500/20'
                          : 'bg-neutral-800/60 border border-neutral-700/60'}`}>
                  <span className={`shrink-0 ${L.lv === 22 ? 'text-amber-300' : L.lv === 30 ? 'text-orange-300' : 'text-rose-300'} font-bold`}>
                    乖離 {L.lv}%
                  </span>
                  <span className="text-neutral-400 text-[10px] sm:text-xs flex-1 text-center hidden sm:block">{L.label}</span>
                  <span className="font-mono font-bold text-neutral-100 shrink-0">
                    ${L.price ? Math.round(L.price).toLocaleString() : '--'}
                  </span>
                  <span className={`font-mono shrink-0 w-16 text-right ${L.gap > 0 ? 'text-neutral-400' : 'text-rose-400'}`}>
                    {L.gap !== null ? `${L.gap > 0 ? '+' : ''}${L.gap.toFixed(1)}%` : '--'}
                  </span>
                </div>
              ))}
              {/* 買進條件：RSI 無固定價位，改顯示近 5 日走勢 */}
              <div className="flex items-center justify-between gap-2 rounded-lg px-3 py-2 text-xs sm:text-sm bg-emerald-500/5 border border-emerald-500/20">
                <span className="text-emerald-300 font-bold shrink-0">RSI &lt; 30</span>
                <span className="text-neutral-400 text-[10px] sm:text-xs flex-1 text-center hidden sm:block">★ 買進固定股數</span>
                <span className="font-mono text-[10px] sm:text-xs text-neutral-400 shrink-0">
                  近5日 {analysis.sixSignal.rsiTrend.map(t => t.rsi?.toFixed(0) ?? '-').join(' → ')}
                </span>
              </div>
            </div>
            <div className="text-[10px] text-neutral-500 mt-2.5 leading-relaxed">
              動能指標無固定價位。買進另需距上次買訊滿 21 個交易日（約 1 個月）；
              減碼訊號在同一波只觸發一次，須待乖離跌回 18% 以下才重新啟用。
            </div>
          </div>
        )}

        {/* ── 2301：主卡只留今日決策；統計與因素明細在 ⓘ 彈窗 ── */}
        {is2301 && analysis?.twoSignal && (() => {
          const T = analysis.twoSignal;
          const held = lots2301 === '' ? null : Math.max(0, parseInt(lots2301, 10) || 0);
          const toBuy = held === null ? null : Math.max(0, T.targetLots - held);
          const px = analysis.last.price;
          const cur = T.ladder.find(L => L.hit);
          return (
            <div className="rounded-2xl border border-neutral-700 bg-neutral-900/70 px-4 py-3 sm:px-5 sm:py-3.5">
              {/* 第 1 行：決策 */}
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                <div className="flex items-baseline gap-2">
                  <span className="text-[10px] text-neutral-500 uppercase tracking-wider">應持有</span>
                  <span className={`text-3xl font-black leading-none ${T.targetLots > 0 ? 'text-emerald-400' : 'text-neutral-500'}`}>
                    {T.targetLots}
                  </span>
                  <span className="text-xs font-bold text-neutral-500">張</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] text-neutral-500">手上</span>
                  <button onClick={() => setLots2301(String(Math.max(0, (held ?? 0) - 1)))}
                    className="w-6 h-6 rounded bg-neutral-800 border border-neutral-700 text-neutral-400 text-xs font-bold hover:bg-neutral-700">−</button>
                  <input type="number" min="0" value={lots2301} placeholder="0"
                    onChange={(e) => setLots2301(e.target.value)}
                    className="w-11 text-center bg-neutral-800 border border-neutral-700 rounded py-0.5 text-base font-black text-neutral-100 font-mono focus:outline-none focus:border-emerald-500" />
                  <button onClick={() => setLots2301(String((held ?? 0) + 1))}
                    className="w-6 h-6 rounded bg-neutral-800 border border-neutral-700 text-neutral-400 text-xs font-bold hover:bg-neutral-700">+</button>
                </div>
                <div className="text-neutral-700 hidden sm:block">→</div>
                {T.isSellToday ? (
                  <span className="text-xl font-black text-rose-400">
                    全部清空{held ? ` ${held} 張` : ''}
                  </span>
                ) : (
                  <span className={`text-xl font-black ${toBuy ? 'text-emerald-400' : 'text-neutral-500'}`}>
                    {toBuy === null ? '補 -- 張' : toBuy > 0 ? `補 ${toBuy} 張` : '不需動作'}
                    {toBuy > 0 && (
                      <span className="text-[10px] font-mono text-neutral-500 ml-1.5">
                        ≈ ${Math.round(toBuy * px * 1000 * 1.001425).toLocaleString()}
                      </span>
                    )}
                  </span>
                )}
                <button
                  className="ml-auto p-1 text-neutral-600 hover:text-white shrink-0"
                  title="策略統計與歷史"
                  onClick={(e) => showInfo(e, 'buy', '2301 策略統計與歷史', TWO_STATS_TEXT(T))}
                >
                  <Info size={14} />
                </button>
              </div>

              {/* 第 2 行：距離 */}
              <div className="text-[10px] sm:text-[11px] text-neutral-500 font-mono mt-2 flex flex-wrap gap-x-4 gap-y-0.5">
                <span>買分 {T.buyScore.toFixed(1)}{cur ? `（${cur.from}~${cur.to}）` : `（&lt; ${T.thresholds.TWO_BUY_LV}）`}</span>
                {!T.isSellToday && <span>下一階 ≥ {T.needForNext} 分（差 {T.gapToNext.toFixed(1)}）</span>}
                <span className={T.isSellToday ? 'text-rose-400 font-bold' : ''}>
                  賣分 {T.sellScore.toFixed(1)} / {T.thresholds.TWO_SELL_LV}
                  {!T.isSellToday && `（差 ${T.gapToSell.toFixed(1)}）`}
                </span>
              </div>

              {/* 第 3 行：警語 */}
              <div className="text-[10px] text-amber-300/70 mt-1.5">
                「應持有」是下限 —— 買分下降不用賣，只有賣分 ≥ {T.thresholds.TWO_SELL_LV} 才清空。
              </div>

              {/* 唯一保留的摺疊：張數規則（看懂一次就不用再看） */}
              <details className="mt-2 group">
                <summary className="cursor-pointer list-none text-[11px] text-neutral-500 hover:text-neutral-300 select-none">
                  <span className="inline-block transition-transform group-open:rotate-90">▸</span> 張數規則
                  <span className="text-neutral-700 ml-1.5 font-mono">floor((買分 − {T.thresholds.TWO_BUY_LV}) / {T.thresholds.TWO_STEP}) + 1</span>
                </summary>
                <div className="mt-2 grid grid-cols-3 sm:grid-cols-6 gap-1 text-[10px] font-mono">
                  <div className={`rounded px-1.5 py-1 text-center border ${T.targetLots === 0 ? 'bg-neutral-700/40 border-neutral-500' : 'bg-neutral-800/30 border-neutral-800'}`}>
                    <span className="text-neutral-500">&lt;{T.thresholds.TWO_BUY_LV}</span>
                    <span className={`ml-1 font-bold ${T.targetLots === 0 ? 'text-neutral-200' : 'text-neutral-600'}`}>0張</span>
                  </div>
                  {T.ladder.map(L => (
                    <div key={L.lots}
                      className={`rounded px-1.5 py-1 text-center border ${
                        L.hit ? 'bg-emerald-500/25 border-emerald-500'
                              : L.cleared ? 'bg-emerald-500/8 border-emerald-500/25'
                              : 'bg-neutral-800/30 border-neutral-800'}`}>
                      <span className="text-neutral-500">{L.from}~{L.to}</span>
                      <span className={`ml-1 font-bold ${L.hit ? 'text-emerald-300' : L.cleared ? 'text-emerald-600' : 'text-neutral-600'}`}>
                        {L.lots}張
                      </span>
                    </div>
                  ))}
                </div>
              </details>
            </div>
          );
        })()}
      </div>

      <div className="max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-2 gap-6 mb-12 items-stretch transition-all duration-300">
        
        {/* 左側：分數推薦區 (加權版) */}
        <div className={`grid grid-cols-1 gap-4 ${isChartExpanded ? 'hidden' : ''}`}>
          <div className="bg-neutral-900 rounded-2xl sm:rounded-[3rem] p-4 sm:p-6 border-2 border-neutral-700 shadow-xl flex flex-col sm:flex-row items-center sm:items-stretch h-full relative group">
            <div className="flex flex-col items-center justify-center shrink-0 w-full sm:w-1/3 text-center mb-4 sm:mb-0">
              <h3 className="text-emerald-500 font-black text-[9px] sm:text-[10px] uppercase tracking-widest mb-2 sm:mb-3">Buy Power</h3>
              <span className="text-5xl sm:text-6xl md:text-7xl font-black leading-none text-emerald-400">{analysis?.buy.total ?? '--'}</span>
              <div className={`text-sm sm:text-base font-black mt-3 sm:mt-4 px-3 sm:px-5 py-1.5 sm:py-2.5 rounded-full ${analysis?.buy?.signal?.color?.includes('emerald') ? 'bg-emerald-500/30 text-emerald-300' : analysis?.buy?.signal?.color?.includes('cyan') ? 'bg-cyan-500/30 text-cyan-300' : analysis?.buy?.signal?.color?.includes('sky') ? 'bg-sky-500/30 text-sky-300' : analysis?.buy?.signal?.color?.includes('blue') ? 'bg-blue-500/30 text-blue-300' : 'bg-neutral-500/30 text-neutral-300'} shadow-lg`}>
                {analysis?.buy?.signal?.text ?? '--'}
              </div>
              {/* 前5天買入分數 */}
              {analysis?.historicalScores && analysis.historicalScores.length > 0 && (
                <div className="flex gap-1 sm:gap-2 mt-2 sm:mt-3 justify-center">
                  {analysis.historicalScores.map((hist, idx) => (
                    <div key={idx} className="text-[9px] sm:text-[10px] font-mono text-emerald-400/60 bg-emerald-500/10 px-1.5 sm:px-2 py-0.5 sm:py-1 rounded">
                      {hist.buy}
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="flex-1 sm:pl-6 border-t sm:border-t-0 sm:border-l border-white/5 pt-4 sm:pt-0 w-full sm:w-auto flex flex-col justify-center">
              <div className="flex justify-between items-center border-b border-white/5 pb-1 mb-3">
                <div className="text-xs text-emerald-400 font-black uppercase">
                  {is3231 ? '佈局權重分析' : is2301 ? '買進評分（14 項等權）' : '買進評分（單一因素）'}
                </div>
                <button 
                  className="p-1 text-neutral-600 hover:text-white" 
                  onClick={(e) => {
                    const bbWeight = analysis?.bbMaxScore || 5;
                    const otherWeight = 100 - 35 - 20 - 20 - bbWeight;
                    const infoText = stockSymbol === '3231' 
                      ? `【評分標準】\n總分 100 由以下加權計算：\n\n1. 布林通道 (30%)：\n   短線波段策略，線性給分。\n   %B < 0：30分 (超跌滿分)\n   0 <= %B < 0.1：30→25分 (線性)\n   0.1 <= %B < 0.3：25→10分 (線性)\n\n2. KD 隨機指標 (25%)：\n   短線轉折指標。\n   K<20 極度超賣滿分，K>80 直接賣出。\n   無鈍化保護，有賺就跑。\n\n3. RSI 相對強弱 (25%)：\n   短線震盪指標。\n   RSI<30 極度超賣滿分，RSI>75 直接賣出。\n   背離直接滿分。\n\n4. MA 乖離 (10%)：\n   MA20月線：負乖離過大搶反彈，正乖離過大獲利了結。\n\n5. FIBO 位階 (5%)：\n   短線波段版，20日箱型。\n   價格 > l500：0分\n   l786 < 價格 <= l500：3分\n   價格 <= l786：5分\n\n6. MACD 動能 (5%)：\n   動能止跌確認。紅柱收斂即給分，不等待交叉。\n\n(註：斜率與 DMI 不列入評分，專注短線轉折)\n\n【買入分數門檻】\n● >38分：強力買進 (Strong Buy)\n   投入 50% 資金。高勝率新買點。\n   這組門檻為「收益優先 + 每月約 3~4 次動作」回測最佳化結果。\n\n● >30分：嘗試進場 (Try Buy)\n   投入 20% 資金。觀察轉強區。\n   適合先試單，待結構確認再加碼。\n\n● <20分：觀望\n   0% 資金。訊號不足，不建議進場。\n\n【霸王條款】\n● 逆勢警告：\n   即使分數 >38（建議買入），但月線斜率 <0 且持續惡化時，\n   會在推薦文字後顯示「(逆勢)」警告。\n   如果斜率在改善（負值縮小），代表趨勢可能轉好，不顯示警告。`
                      : stockSymbol === '2301'
                      ? `【今日 14 項因素得分】買分 ${analysis?.twoSignal?.buyScore.toFixed(1) ?? '--'} → 應持有 ${analysis?.twoSignal?.targetLots ?? '--'} 張\n`
                        + (analysis?.twoSignal?.buyFactors.map(f =>
                            `  ${f.key.padEnd(11, '　')} ${String(f.score.toFixed(0)).padStart(3)}/100　貢獻 ${f.contrib.toFixed(2).padStart(5)}\n`
                            + `      ${f.rule}`).join('\n') ?? '')
                        + `\n\n【2301 買進評分 — 14 項等權，每項 7.14 分】\n\n族群權重：\n● 均線負乖離 35.7%（5 項）：MA120／MA60／MA20／MA10／MA5 負乖離\n● 自高點回落 21.4%（3 項）：自 60／20／10 日高點回落\n● 跌幅動能 21.4%（3 項）：近 5／3／1 日跌幅\n● 震盪超賣 21.4%（3 項）：K9 低檔／K5 低檔／RSI5 低檔\n\n【買進規則 — 目標持倉制】\n應持有張數 = floor((今日買分 − 4) / 10) + 1，買分 < 4 → 0 張\n\n買分 <4 → 0 張｜4~13 → 1 張｜14~23 → 2 張｜24~33 → 3 張\n34~43 → 4 張｜44~53 → 5 張｜54~63 → 6 張｜64~73 → 7 張\n74~83 → 8 張｜84~93 → 9 張｜94~100 → 10 張\n\n手上不足就補足差額。這是「下限」而非目標值 ——\n買分之後下降不需要賣，只有賣分 ≥ 80 才全部清空。\n\n【為什麼是這 14 項】\n以 2301 自身資料篩選「訓練期／測試期兩期同向為正」的因素，\n25 個候選中有 14 個通過。最強的是 MA120 負乖離\n（邊際 +5.958pp，訓練 +4.354／測試 +14.162）。\n\n實測優於直接沿用 1402 的清單（超額 +7.3pp vs +6.8pp），\n並剔除了兩個對 2301 有害的因素：\n● MACD 紅柱收斂 −1.48pp（在 1402 上有效，在 2301 上有害）\n● 箱型低位 −1.54pp\n以及測試期轉負的 RSI14／RSI21 低檔。\n\n【為什麼是等權而非最佳化權重】\n對 5562 組買方權重做系統性搜尋（全部單因素 + 全部雙因素 +\n全部三因素 + 等權 + 4000 組隨機 Dirichlet），以「訓練期選權重\n→ 測試期驗證」檢驗：\n● 訓練期第一名 → 測試期排名 3592/5562\n● 各共識權重 K=1~500 的測試期表現全部落在 PR 50 附近\n● NNLS 迴歸權重 → 測試期 +0.670pp ＜ 等權 +0.814pp\n→ 買方權重最佳化無效，任何合理的低接組合都差不多，故採族群等權。\n\n【驗證（2015-07 ~ 2026-08，11.1 年，含息還原）】\n● 買 14.3 次/年、賣 4.5 次/年 → 18.8 動作/年（每月 1.6 次）\n● 每輪報酬 +11.96%、勝率 92%（46 勝/4 敗）\n● 賺賠比 2.49、獲利因子 28.62、最差單輪 −5.84%\n● 平均持有 49 日（中位 16、最長 253）、帳面最差 −27%\n● 平均綁住 160 萬、最壞需備 272 萬（10 張）\n● 年損益 62 萬、資金效率 38.7%／年\n● 獲利年 11/12（2024 唯一虧損年）\n● 兩期都正：前半 +5.45%、後半 +13.13%\n● 隨機化 600 次 p = 0.0000\n  （實際 +11.96% vs 隨機平均 +2.14%、600 次最大僅 +4.25%）\n● 高原：鄰域 36 組（買2~8 × 階梯8~12 × 賣77~83）每輪最低 +9.47%\n● 容錯：漏掉 50% 買訊，年損益僅 −10%\n  （因每日重算目標張數，不依賴任何歷史狀態）\n\n【誠實限制】\n排除近期多頭（2015~2022）後：每輪 +6.51%、勝率 93%、\n年損益 29 萬（18.1%／年）。保守預期請用這組數字，\n62 萬是含 2023~2026 多頭的水準。\n\n【停用條件】\n● 不可重新最佳化門檻（4／80／+10 固定）—— 逐年重調實測會失效\n● 連續 2 個完整年度虧損 → 停用\n● 單輪虧損超過 −15% → 人工檢視（歷史最差 −5.84%）`
                      : `【6669 買進評分 V25 — 單一因素】\n\n評分 = RSI 低檔階梯（權重 100%）\n\n● RSI < 25 → 100 分\n● RSI < 30 → 80 分  ← 買進門檻\n● RSI < 40 → 50 分\n● RSI < 50 → 20 分\n● RSI ≥ 50 → 0 分\n\n【觸發條件】\nRSI 首次跌破 30，且距上次買進訊號滿 21 個交易日\n（約 1 個月，用來把頻率控制在每月最多一次）\n\n【實測品質（2019-07 ~ 2026-08）】\n● 買後 40 日平均 +17.58%（任一天買進的基準是 +7.84%）\n● 邊際 +9.7pp，勝率 76%\n● 價格位階 29.2（買在周邊 ±60 日區間的低 29%）\n● 訊號 22 次 / 7 年 = 3.1 次/年（每 4.0 個月）\n● 逐年 2~4 次，分布均勻（2020:3、2021:3、2022:4、2023:3、2024:3、2025:4、2026:2）\n\n【為什麼只用一個因素】\n對 10 個買進因素做系統性權重搜尋（2607 組，含全部單因素、\n全部雙因素、等權、3000 組隨機 Dirichlet），以「訓練期選權重\n→ 測試期驗證」檢驗：\n● 訓練期邊際 vs 測試期邊際 Spearman ρ = 僅 +0.10\n● 訓練期第一名（深度回檔74+KD26）測試期排名 2168/2607\n● 訓練期前 10 名平均測試邊際 +2.27pp\n  ＜ 全部組合平均 +4.88pp\n  → 依訓練期挑權重比亂選還差\n● 測試期邊際平均：1 因素 +5.62 ＞ 5 因素 +5.02\n  ＞ 2~4 因素 +4.6~4.7 ＞ 10 因素 +3.95\n\n10 個因素中只有 RSI 低檔（訓練 +8.62／測試 +10.20）與\nKD 低檔（+10.72／+8.45）在兩期都有效，其餘 8 個接近 0。\n把無效因素以任何權重混入，只會稀釋稀有訊號的品質。\n\n【門檻穩健性】\nRSI<28 邊際 +11.69pp、<30 +9.74pp、<32 +7.88pp、\n<40 +0.04pp（完全失效）。28~32 為高原，取 30。\n\n【備選】\nKD < 20 統計上等價（+8.45pp，1.9 次/年）。\n若不想押注單一指標可用 RSI50+KD50（+6.89pp），代價約 1.7pp。\n\n【誠實限制】\n樣本僅 22 個訊號，多重比較修正後 p≈0.034（勉強顯著）。\n邊際的真實期望值可能是 +5~7pp 而非 +9.7pp。\n僅適用 6669。`;
                    showInfo(e, 'buy', '買入評分模型', infoText);
                  }}
                >
                  <Info size={14}/>
                </button>
              </div>
              {is3231 ? (
                <div className="space-y-3">
                  {renderScoreBar(
                    `FIBO 位階 (${analysis?.fiboMaxScore || 35}%)`,
                    analysis?.scores.fibo.buy || 0,
                    analysis?.fiboMaxScore || 35,
                    'bg-emerald-500'
                  )}
                  {renderScoreBar('歷史起伏 (不列入評分)', analysis?.scores.slope.buy || 0, 0, 'bg-emerald-500')}
                  {renderScoreBar(
                    `趨勢綜合 (${(analysis?.maMaxScore || 10) + (analysis?.macdMaxScore || 5)}%)`,
                    (analysis?.scores.ma.buy + analysis?.scores.macd.buy || 0),
                    ((analysis?.maMaxScore || 10) + (analysis?.macdMaxScore || 5)),
                    'bg-emerald-500'
                  )}
                  {renderScoreBar(
                    `震盪指標 (${(analysis?.rsiMaxScore || 25) + (analysis?.kdMaxScore || 25)}%)`,
                    analysis?.scores.osc.buy || 0,
                    (analysis?.rsiMaxScore || 25) + (analysis?.kdMaxScore || 25),
                    'bg-emerald-500'
                  )}
                  {renderScoreBar(
                    `波動風險 (${analysis?.bbMaxScore || 30}%)`,
                    analysis?.scores.bb.buy || 0,
                    analysis?.bbMaxScore || 30,
                    'bg-emerald-500'
                  )}
                </div>
              ) : is2301 ? (
                /* 2301：14 項等權，族群拆解 + 因素明細 */
                <div className="space-y-2.5">
                  {analysis?.twoSignal?.buyFams.map(F => (
                    <div key={F.fam}>
                      {renderScoreBar(`${F.fam} (${F.weight.toFixed(1)}%・${F.n}項)`, F.score, F.weight, 'bg-emerald-500')}
                    </div>
                  ))}
                  <div className="text-[10px] text-neutral-500 pt-1.5 border-t border-white/5">
                    {analysis?.twoSignal?.buyFactors.filter(f => f.score > 0).length ?? 0} / 14 項有得分
                    <span className="text-neutral-700 ml-1.5">・逐項明細見右上 ⓘ</span>
                  </div>
                </div>
              ) : (
                /* 6669 V25：單一因素 = RSI 低檔階梯 */
                <div className="space-y-2.5">
                  {renderScoreBar('RSI 低檔 (100%)', analysis?.buy.total || 0, 100, 'bg-emerald-500')}
                  <div className="space-y-1 text-[10px] sm:text-[11px] font-mono">
                    {[
                      { lb: 'RSI < 25', sc: 100 }, { lb: 'RSI < 30', sc: 80 },
                      { lb: 'RSI < 40', sc: 50 }, { lb: 'RSI < 50', sc: 20 }, { lb: 'RSI ≥ 50', sc: 0 }
                    ].map(t => {
                      const active = (analysis?.buy.total ?? -1) === t.sc;
                      return (
                        <div key={t.lb} className={`flex justify-between px-2 py-0.5 rounded ${
                          active ? 'bg-emerald-500/20 text-emerald-300 font-bold' : 'text-neutral-500'}`}>
                          <span>{t.lb}{t.sc === 80 ? '　← 買進門檻' : ''}</span>
                          <span>{t.sc} 分</span>
                        </div>
                      );
                    })}
                  </div>
                  <div className="text-[10px] text-neutral-500 pt-1.5 border-t border-white/5 leading-relaxed">
                    已移除 FIBO 位階／斜率／MA／MACD／DMI／布林（實測兩期邊際接近 0，混入只會稀釋訊號）。
                    另需距上次買訊滿 21 交易日。
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="bg-neutral-900 rounded-2xl sm:rounded-[3rem] p-4 sm:p-6 border-2 border-neutral-700 shadow-xl flex flex-col sm:flex-row items-center sm:items-stretch h-full relative">
            <div className="flex flex-col items-center justify-center shrink-0 w-full sm:w-1/3 text-center mb-4 sm:mb-0">
              <h3 className="text-rose-500 font-black text-[9px] sm:text-[10px] uppercase tracking-widest mb-2 sm:mb-3">Sell Risk</h3>
              <span className="text-5xl sm:text-6xl md:text-7xl font-black leading-none text-rose-400">{analysis?.sell.total ?? '--'}</span>
              <div className={`text-sm sm:text-base font-black mt-3 sm:mt-4 px-3 sm:px-5 py-1.5 sm:py-2.5 rounded-full ${analysis?.sell?.signal?.color?.includes('rose') ? 'bg-rose-500/30 text-rose-300' : analysis?.sell?.signal?.color?.includes('red') ? 'bg-red-600/40 text-red-200 animate-pulse' : analysis?.sell?.signal?.color?.includes('orange') ? 'bg-orange-500/30 text-orange-300' : analysis?.sell?.signal?.color?.includes('amber') ? 'bg-amber-500/30 text-amber-300' : 'bg-emerald-500/30 text-emerald-300'} shadow-lg`}>
                {analysis?.sell?.signal?.text ?? '--'}
              </div>
              {/* 前5天賣出分數 */}
              {analysis?.historicalScores && analysis.historicalScores.length > 0 && (
                <div className="flex gap-1 sm:gap-2 mt-2 sm:mt-3 justify-center">
                  {analysis.historicalScores.map((hist, idx) => (
                    <div key={idx} className="text-[9px] sm:text-[10px] font-mono text-rose-400/60 bg-rose-500/10 px-1.5 sm:px-2 py-0.5 sm:py-1 rounded">
                      {hist.sell}
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="flex-1 sm:pl-6 border-t sm:border-t-0 sm:border-l border-white/5 pt-4 sm:pt-0 w-full sm:w-auto flex flex-col justify-center">
              <div className="flex justify-between items-center border-b border-white/5 pb-1 mb-3">
                <div className="text-xs text-rose-400 font-black uppercase">
                  {is3231 ? '風險權重分析' : is2301 ? '賣出評分（11 項等權）' : '賣出評分（單一因素）'}
                </div>
                <button 
                  className="p-1 text-neutral-600 hover:text-white"
                  onClick={(e) => {
                    const bbWeight = analysis?.bbMaxScore || 5;
                    const infoText = stockSymbol === '3231'
                      ? `【評分標準】\n總分 100 由以下加權計算：\n\n1. 布林通道 (30%)：\n   短線波段策略，線性給分。\n   %B > 1.0：30分 (突破上軌滿分)\n   0.9 < %B <= 1.0：25→30分 (線性)\n   假突破：20分\n   (移除爆量保護，有賺就跑)\n\n2. KD 隨機指標 (25%)：\n   短線轉折指標。\n   K>80 直接滿分賣出，70 < K <= 80 分批調節。\n   無鈍化保護，有賺就跑。\n\n3. RSI 相對強弱 (25%)：\n   短線震盪指標。\n   RSI>75 直接滿分賣出，60 < RSI <= 75 分批調節。\n   頂背離直接滿分。\n\n4. MA 乖離 (10%)：\n   MA20月線：正乖離過大獲利了結，跌破月線停利/停損。\n\n5. FIBO 壓力 (5%)：\n   短線波段版，20日箱型。\n   最高價 >= ext1272：5分\n   最高價 >= maxPrice：3分\n   價格 < maxPrice：0分\n\n6. MACD 動能 (5%)：\n   動能上攻無力，綠柱收斂即給分。\n\n(註：斜率與 DMI 不列入評分，專注短線轉折)\n\n【賣出分數門檻】\n● >60分：清倉賣出 (Clear Out)\n   100% 全跑。過熱與轉弱共振訊號。\n   這組門檻為「收益優先 + 每月約 3~4 次動作」回測最佳化結果。\n\n● >52分：獲利調節 (Trim)\n   賣出 50% 持股。鎖利降風險。\n   先收現金，再等待下一段更明確訊號。\n\n● ≤52分：續抱\n   不動。尚未達到高勝率賣點。`
                      : stockSymbol === '2301'
                      ? `【今日 11 項因素得分】賣分 ${analysis?.twoSignal?.sellScore.toFixed(1) ?? '--'} / 80`
                        + `${analysis?.twoSignal?.isSellToday ? '　★ 已達清空門檻' : `（還差 ${analysis?.twoSignal?.gapToSell.toFixed(1) ?? '--'} 分）`}\n`
                        + (analysis?.twoSignal?.sellFactors.map(f =>
                            `  ${f.key.padEnd(11, '　')} ${String(f.score.toFixed(0)).padStart(3)}/100　貢獻 ${f.contrib.toFixed(2).padStart(5)}\n`
                            + `      ${f.rule}`).join('\n') ?? '')
                        + `\n\n【2301 賣出評分 — 11 項等權，每項 9.09 分】\n\n族群權重：\n● 震盪超買 54.5%（6 項）：RSI21／RSI14／RSI9／RSI5 高檔、K9／K5 高檔\n● 均線正乖離 18.2%（2 項）：MA60／MA120 正乖離\n● 相對位置 18.2%（2 項）：布林20 高檔、箱型高位\n● 自低點反彈 9.1%（1 項）：自 60 日低點反彈\n\n【賣出規則】\n賣分 ≥ 80 → 全部清空，不分批、無停損。\n\n【重要：賣分的作用不是「預測未來會跌」】\n這 11 項在 2301 上的前瞻邊際是負的（訓練 −0.12／測試 −2.38pp）——\n意思是 2301 超買之後往往還會漲（它是動能股）。\n但實際交易結果完全相反：+7.3pp 超額。\n\n用頻率對等檢定拆解（真買訊 + 隨機持有天數 vs 真買訊 + 真賣訊）：\n● 隨機出場：CAGR 23.62%、勝率 62%\n● 真實賣訊：CAGR 32.4%、勝率 90%\n→ 出場時機貢獻 +8.80pp（p = 0.0000）\n\n原因：賣分的價值在於「相對進場價鎖利」，它很可靠地出現在\n相對進場的高點。用前瞻報酬去挑賣出因素在 2301 上是錯的標準。\n\n【為什麼用 1402 的清單而非 2301 自己篩的】\n2301 自身篩選只有 2 項通過兩期同向（布林10 高檔 +0.89/+0.70pp、\nMA5 正乖離），前瞻邊際雖為正，但實際交易只有 +0.6pp 超額。\n1402 清單前瞻邊際為負卻有 +7.3pp 超額 —— 因此採用 1402 清單。\n這也讓「因素選擇」這個維度成為樣本外（用另一檔股票的資料挑的），\n證據等級高於用 2301 自己的資料挑因素。\n\n【為什麼是等權】\n對 4130 組賣方權重做系統性搜尋，訓練期共識權重\n（RSI21-63／K5-21／RSI9-11／K9-5）在測試期排名 5/4130（有效），\n但放進實際回測只有 CAGR 18.6%，等權清單是 34.6%。\n前瞻邊際與交易報酬衡量的不是同一件事，交易報酬才是目標。\n\n【賣門檻 80 的選擇】\n頻率-效益曲線（固定買門檻，掃賣門檻）：\n賣 62 → 6.1 次/年、每輪 +2.33%\n賣 71 → 4.1 次/年、每輪 +6.17%\n賣 74 → 3.6 次/年、每輪 +6.26%\n賣 80 → 2.3 次/年、每輪 +9.21%　← 搭配階梯加碼時最佳\n賣 83 → 1.9 次/年、每輪 +12.51%\n在目標持倉制下，賣 80 的組合有最佳的\n「每輪報酬 × 輪數 × 資金效率」平衡。\n\n【驗證】\n● 賣 4.5 次/年、每輪 +11.96%、勝率 92%\n● 隨機化 600 次 p = 0.0000\n● 兩期都正（前半 +5.45%、後半 +13.13%）\n● 鄰域 36 組每輪最低 +9.47%（賣 77~83 都穩定）\n\n【誠實限制】\n只有 50 輪樣本。排除近期多頭（2015~2022）後每輪降到 +6.51%。\n最長一輪抱了 253 個交易日（約 12 個月）。僅適用 2301。`
                      : `【6669 賣出評分 V25 — 單一因素】\n\n評分 = 季線乖離階梯（權重 100%）\n乖離 = (收盤價 − MA60) / MA60 × 100%\n\n● 乖離 > 40% → 100 分　★ 減碼 1/2\n● 乖離 > 30% →  80 分　★ 減碼 1/3\n● 乖離 > 22% →  56 分　　預警\n● 乖離 > 15% →  32 分\n● 乖離 > 10% →  16 分\n● 乖離 ≤ 10% →   0 分\n\n【核心設計：分級減碼，不清倉】\n保留核心部位長抱，只在過熱時分批獲利入袋。\n同一波只觸發一次減碼，須待乖離跌回 18% 以下\n才重新啟用（避免在同一段高檔重複賣出）。\n\n【實測品質（2019-07 ~ 2026-08）】\n乖離>30%（主訊號，1.0 次/年）\n● 減碼後 40 日平均 −2.80%（基準 +7.89%）→ 邊際 +8.05pp\n● 價格位階 79.2（賣在周邊區間的高 79%）\n● 7 次減碼平均帳面獲利 +82%\n\n乖離>40%（極端，0.3 次/年）\n● 減碼後 20 日 −9.13%、40 日 −11.72%\n● 20 日內下跌機率 100%，價格位階 91.3\n\n乖離>22%（預警，2.6 次/年）\n● 減碼後 40 日 −0.16%，位階 72.4\n● 弱於 30% 那一級，因此只做提示不執行\n\n【已移除的成分與原因】\n● FIBO 壓力（原 35 分）：訓練 −0.92／測試 +8.06 反向。\n  且 7 年內觸及 1.272 僅 1 次、1.618 為 0 次，\n  實際上只透過「跌破 l618」給分 —— 那是停損不是獲利了結。\n● 高檔回落（原 30 分）：訓練 −2.42／測試 +0.60，無效。\n● MACD（+0.50／−2.20）、DMI（−16.24／−1.92）、\n  布林（−0.92／+2.81）、斜率：皆無或反向。\n\n【已移除破線強制停損】\n原規則：跌破 Fibo 0.618 → 強制清倉。\n實測跌破後 20 日平均 +6.45%（邊際 +3.26pp、t=4.07、\n兩期一致）—— 那是買點而非賣點。\n回測中此規則把全期報酬由 +835% 壓到 +115%，\n並使最大回檔由 −50% 惡化到 −68%。\n\n【減碼的取捨（端到端回測，每次買固定股數）】\n● 只買不賣：總回收倍數 3.55，最大回檔 −39%\n● 乖離>30% 減 1/3：倍數 2.20，回檔 −33%，取回現金 > 總投入\n● 減 1/2：倍數 1.90　● 多級減碼：倍數 1.63\n→ 減碼買的是「回檔縮小 + 獲利入袋」，代價是總報酬倍數。\n   建議只用單一級（>30% 減 1/3），不要多級。\n\n【誠實限制】\n減碼樣本僅 7 次。僅適用 6669。`;
                    showInfo(e, 'sell', '賣出評分模型', infoText);
                  }}
                >
                  <Info size={14}/>
                </button>
              </div>
              {is2301 ? (
                /* 2301：11 項等權，族群拆解 + 因素明細 */
                <div className="space-y-2.5">
                  {analysis?.twoSignal?.sellFams.map(F => (
                    <div key={F.fam}>
                      {renderScoreBar(`${F.fam} (${F.weight.toFixed(1)}%・${F.n}項)`, F.score, F.weight, 'bg-rose-500')}
                    </div>
                  ))}
                  <div className="flex items-center justify-between px-2 py-1 rounded text-[11px] sm:text-xs font-mono border border-rose-500/30 bg-rose-500/10">
                    <span className="text-rose-300 font-bold">清空門檻</span>
                    <span className="text-neutral-300">
                      賣分 {analysis?.twoSignal?.sellScore.toFixed(1)} / 80
                      {analysis?.twoSignal?.isSellToday
                        ? <span className="text-rose-400 font-bold ml-2">★ 已觸發</span>
                        : <span className="text-neutral-500 ml-2">還差 {analysis?.twoSignal?.gapToSell.toFixed(1)} 分</span>}
                    </span>
                  </div>
                  <div className="text-[10px] text-neutral-500 pt-1.5 border-t border-white/5">
                    {analysis?.twoSignal?.sellFactors.filter(f => f.score >= 70).length ?? 0} / 11 項達 70 分以上
                    <span className="text-neutral-700 ml-1.5">・逐項明細見右上 ⓘ</span>
                  </div>
                </div>
              ) : is6669 ? (
                /* 6669 V25：單一因素 = 季線乖離階梯 */
                <div className="space-y-2.5">
                  {renderScoreBar('季線乖離 (100%)', analysis?.sell.total || 0, 100, 'bg-rose-500')}
                  <div className="space-y-1 text-[10px] sm:text-[11px] font-mono">
                    {[
                      { lb: '乖離 > 40%', sc: 100, act: '← 減碼 1/2' },
                      { lb: '乖離 > 30%', sc: 80, act: '← 減碼 1/3' },
                      { lb: '乖離 > 22%', sc: 56, act: '← 預警' },
                      { lb: '乖離 > 15%', sc: 32, act: '' },
                      { lb: '乖離 > 10%', sc: 16, act: '' },
                      { lb: '乖離 ≤ 10%', sc: 0, act: '' }
                    ].map(t => {
                      const active = (analysis?.sell.total ?? -1) === t.sc;
                      return (
                        <div key={t.lb} className={`flex justify-between px-2 py-0.5 rounded ${
                          active ? 'bg-rose-500/20 text-rose-300 font-bold' : 'text-neutral-500'}`}>
                          <span>{t.lb}<span className="text-neutral-600">{t.act ? '　' + t.act : ''}</span></span>
                          <span>{t.sc} 分</span>
                        </div>
                      );
                    })}
                  </div>
                  <div className="text-[10px] text-neutral-500 pt-1.5 border-t border-white/5 leading-relaxed">
                    已移除 FIBO 壓力／斜率／MACD／DMI／布林／高檔回落，並移除破線強制停損。
                    分級減碼、不清倉（核心長抱）。
                  </div>
                </div>
              ) : (
              <div className="space-y-3">
                {renderScoreBar(
                  `FIBO 壓力 (${analysis?.fiboMaxScore || 35}%)`,
                  analysis?.scores.fibo.sell || 0,
                  analysis?.fiboMaxScore || 35,
                  'bg-rose-500'
                )}
                {renderScoreBar('歷史噴發 (不列入評分)', analysis?.scores.slope.sell || 0, 0, 'bg-rose-500')}
                {renderScoreBar(
                  `趨勢乖離 (${(analysis?.maMaxScore || 10) + (analysis?.macdMaxScore || 5)}%)`,
                  (analysis?.scores.ma.sell + analysis?.scores.macd.sell || 0),
                  ((analysis?.maMaxScore || 10) + (analysis?.macdMaxScore || 5)),
                  'bg-rose-500'
                )}
                {renderScoreBar(
                  `震盪過熱 (${(analysis?.rsiMaxScore || 25) + (analysis?.kdMaxScore || 25)}%)`,
                  analysis?.scores.osc.sell || 0,
                  (analysis?.rsiMaxScore || 25) + (analysis?.kdMaxScore || 25),
                  'bg-rose-500'
                )}
                {renderScoreBar(
                  `波動極端 (${analysis?.bbMaxScore || 30}%)`,
                  analysis?.scores.bb.sell || 0,
                  analysis?.bbMaxScore || 30,
                  'bg-rose-500'
                )}
              </div>
              )}
            </div>
          </div>
        </div>

        {/* 右側：圖表區 */}
        <div className={`bg-neutral-900 rounded-2xl sm:rounded-[3.5rem] p-4 sm:p-6 md:p-8 border-2 border-neutral-700 relative shadow-2xl flex flex-col transition-all duration-300 ${isChartExpanded ? 'col-span-full h-[400px] sm:h-[500px] md:h-[600px]' : 'min-h-[300px] sm:min-h-[360px]'}`}>
          <div className="flex justify-between items-center mb-4 sm:mb-6 px-1 sm:px-2">
            <div className="flex items-center gap-2 sm:gap-3">
              <div className="p-1 sm:p-1.5 bg-neutral-800 rounded-lg shadow-inner"><BarChart3 className="w-4 h-4 sm:w-5 sm:h-5 text-indigo-400" /></div>
              <div className="flex gap-0.5 sm:gap-1">
                <button onClick={() => navScroll('left')} className="p-1 sm:p-1.5 bg-neutral-800 hover:bg-neutral-700 rounded-lg text-neutral-400 transition-colors"><ChevronLeft size={14} className="sm:w-4 sm:h-4"/></button>
                <button onClick={() => navScroll('right')} className="p-1 sm:p-1.5 bg-neutral-800 hover:bg-neutral-700 rounded-lg text-neutral-400 transition-colors"><ChevronRight size={14} className="sm:w-4 sm:h-4"/></button>
              </div>
            </div>
            <button onClick={() => setIsChartExpanded(!isChartExpanded)} className="p-1.5 sm:p-2 bg-neutral-800 hover:bg-neutral-700 rounded-lg text-neutral-400 transition-colors">
              {isChartExpanded ? <Minimize2 size={16} className="sm:w-[18px] sm:h-[18px]"/> : <Maximize2 size={16} className="sm:w-[18px] sm:h-[18px]"/>}
            </button>
          </div>
          
          <div className="flex-1 relative overflow-hidden flex">
            <div 
              ref={chartRef}
              onMouseDown={handleMouseDown}
              onMouseLeave={() => isDragging.current = false}
              onMouseUp={() => isDragging.current = false}
              onMouseMove={(e) => {
                if (!isDragging.current) return;
                const x = e.pageX - chartRef.current.offsetLeft;
                chartRef.current.scrollLeft = scrollLeft.current - (x - startX.current) * 2.5;
              }}
              className="flex-1 overflow-x-auto no-scrollbar chart-grid-fade cursor-grab active:cursor-grabbing pr-[68px]"
            >
              <div style={{ width: chartWidth, minWidth: '100%' }} className="h-full">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={data} margin={{ top: 10 }}>
                    <defs>
                      <linearGradient id="pGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor={themeColors.price} stopOpacity={0.2}/><stop offset="95%" stopColor={themeColors.price} stopOpacity={0}/></linearGradient>
                    </defs>
                    <CartesianGrid vertical={true} horizontal={true} stroke="#666" strokeOpacity={0.8} strokeDasharray="2 2" />
                    <XAxis 
                      dataKey="fullDate" 
                      axisLine={false} 
                      tickLine={false} 
                      tick={{fontSize: 9, fill: '#888'}} 
                      ticks={monthlyTicks} 
                      interval={0} 
                      tickFormatter={(t) => data.find(d => d.fullDate === t)?.displayDate || ''} 
                    />
                    
                    {/* 隱藏的 YAxis，只為了佔位和同步 */}
                    <YAxis yAxisId="right" orientation="right" hide domain="auto" />
                    <YAxis yAxisId="left" orientation="left" hide domain="auto" />

                    <Tooltip 
                      labelFormatter={(label) => `日期: ${label}`}
                      formatter={(val) => [`${Number(val).toFixed(1)}`, '數值']}
                      contentStyle={{backgroundColor:'#171717', border:'1px solid #444', borderRadius:'12px'}} 
                    />
                    <Area yAxisId="right" dataKey="price" stroke="transparent" fill="url(#pGrad)" isAnimationActive={false} />
                    <Line yAxisId="right" type="linear" dataKey="price" stroke={themeColors.price} strokeWidth={3} dot={false} isAnimationActive={false} />
                    
                    {visibleLayers.ma && <Line yAxisId="right" type="linear" dataKey={is3231 ? "ma20" : "ma60"} stroke={themeColors.ma} strokeWidth={2} dot={false} strokeDasharray="5 5" isAnimationActive={false} />}
                    {visibleLayers.bb && (
                      <>
                        <Line yAxisId="right" type="linear" dataKey="upper" stroke={themeColors.bb} strokeWidth={1} dot={false} strokeDasharray="3 3" opacity={0.6} isAnimationActive={false} />
                        <Line yAxisId="right" type="linear" dataKey="lower" stroke={themeColors.bb} strokeWidth={1} dot={false} strokeDasharray="3 3" opacity={0.6} isAnimationActive={false} />
                      </>
                    )}
                    {visibleLayers.fibo && analysis && (
                      <>
                        {stockSymbol === '3231' ? (
                          // 3231 只顯示簡化位階
                          <>
                            {analysis.fibo.ext1272 && <ReferenceLine yAxisId="right" y={analysis.fibo.ext1272} stroke={themeColors.ext1272} strokeWidth={2} strokeDasharray="3 3" label={{ value: '1.272', fill: '#fff', fontSize: 11, fontWeight: 'bold', position: 'insideTopRight' }} />}
                            {analysis.fibo.l500 && <ReferenceLine yAxisId="right" y={analysis.fibo.l500} stroke={themeColors.l500} strokeWidth={1.5} strokeDasharray="3 3" label={{ value: '0.500', fill: '#fff', fontSize: 10, fontWeight: 'bold', position: 'insideTopRight' }} />}
                            {analysis.fibo.l786 && <ReferenceLine yAxisId="right" y={analysis.fibo.l786} stroke={themeColors.l786} strokeWidth={1.5} strokeDasharray="3 3" label={{ value: '0.786', fill: '#fff', fontSize: 10, fontWeight: 'bold', position: 'insideTopRight' }} />}
                          </>
                        ) : (
                          // 6669 顯示完整位階
                          <>
                            {analysis.fibo.ext1618 && <ReferenceLine yAxisId="right" y={analysis.fibo.ext1618} stroke={themeColors.target} strokeWidth={2} strokeDasharray="3 3" label={{ value: '1.618', fill: '#fff', fontSize: 11, fontWeight: 'bold', position: 'insideTopRight' }} />}
                            {analysis.fibo.ext1272 && <ReferenceLine yAxisId="right" y={analysis.fibo.ext1272} stroke={themeColors.ext1272} strokeWidth={2} strokeDasharray="3 3" label={{ value: '1.272', fill: '#fff', fontSize: 11, fontWeight: 'bold', position: 'insideTopRight' }} />}
                            {analysis.fibo.l786 && <ReferenceLine yAxisId="right" y={analysis.fibo.l786} stroke={themeColors.l786} strokeWidth={1.5} strokeDasharray="3 3" label={{ value: '0.786', fill: '#fff', fontSize: 10, fontWeight: 'bold', position: 'insideTopRight' }} />}
                            {analysis.fibo.l618 && <ReferenceLine yAxisId="right" y={analysis.fibo.l618} stroke={themeColors.l618} strokeWidth={2.5} label={{ value: '0.618', fill: '#fff', fontSize: 11, fontWeight: 'bold', position: 'insideTopRight' }} />}
                            {analysis.fibo.l500 && <ReferenceLine yAxisId="right" y={analysis.fibo.l500} stroke={themeColors.l500} strokeWidth={1.5} strokeDasharray="3 3" label={{ value: '0.500', fill: '#fff', fontSize: 10, fontWeight: 'bold', position: 'insideTopRight' }} />}
                            {analysis.fibo.l382 && <ReferenceLine yAxisId="right" y={analysis.fibo.l382} stroke={themeColors.l382} strokeWidth={1.5} strokeDasharray="3 3" label={{ value: '0.382', fill: '#fff', fontSize: 10, fontWeight: 'bold', position: 'insideTopRight' }} />}
                            {analysis.fibo.l236 && <ReferenceLine yAxisId="right" y={analysis.fibo.l236} stroke={themeColors.l236} strokeWidth={1.5} strokeDasharray="3 3" label={{ value: '0.236', fill: '#fff', fontSize: 10, fontWeight: 'bold', position: 'insideTopRight' }} />}
                          </>
                        )}
                      </>
                    )}
                    
                    {/* Slope 指標 - 顯示斜率值（使用左軸） */}
                    {visibleLayers.slope && <Line yAxisId="left" type="monotone" dataKey="slopeVal" stroke={themeColors.slope} strokeWidth={2} dot={false} strokeDasharray="5 5" isAnimationActive={false} />}
                    
                    {/* 左軸指標 */}
                    {visibleLayers.rsi && <Line yAxisId="left" type="monotone" dataKey="rsiVal" stroke={themeColors.rsi} strokeWidth={2} dot={false} isAnimationActive={false} />}
                    {visibleLayers.macd && <Line yAxisId="left" type="monotone" dataKey="macd" stroke={themeColors.macd} strokeWidth={2} dot={false} isAnimationActive={false} />}
                    {visibleLayers.dmi && <Line yAxisId="left" type="monotone" dataKey="adx" stroke={themeColors.dmi} strokeWidth={2} dot={false} isAnimationActive={false} />}
                    
                    {/* KD 指標 */}
                    {visibleLayers.kd && (
                        <>
                            <Line yAxisId="left" type="monotone" dataKey="k" stroke={themeColors.kd_k} strokeWidth={2} dot={false} isAnimationActive={false} />
                            <Line yAxisId="left" type="monotone" dataKey="d" stroke={themeColors.kd_d} strokeWidth={2} dot={false} isAnimationActive={false} />
                        </>
                    )}

                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </div>
            
            {/* Sticky Y-Axis Overlay: 純色背景(#171717)，無邊框，且加入 stroke="rgba(0,0,0,0)" 修復白線 */}
            <div className="sticky-y-overlay">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={data} margin={{ top: 10, right: 15 }}>
                   <XAxis dataKey="fullDate" hide />
                   {/* 關鍵修復：強制軸線描邊為透明 */}
                   <YAxis 
                    yAxisId="right"
                    stroke="rgba(0,0,0,0)"
                    domain="auto"
                    orientation="right"
                    axisLine={false}
                    tickLine={false} 
                    tick={{fontSize: 11, fill: '#e5e5e5', fontWeight: '900', fontFamily: 'monospace'}} 
                    ticks={yTicks}
                   />
                   {/* 需要一個隱藏的 series 來確保 domain 計算正確 */}
                   <Line yAxisId="right" dataKey="price" stroke="none" dot={false} isAnimationActive={false} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      </div>

      {/* 技術指標小卡 (一排四張，共八張) */}
      <div className="max-w-7xl mx-auto grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-12 sm:mb-16 px-2 sm:px-0">
        {diagnosticCards.map((card) => {
          const diagResult = card.diag ? (typeof card.diag === 'function' ? card.diag(
            card.key === 'ma' ? analysis?.last.price : 
            card.key === 'rsi' ? analysis?.last.rsiVal : 
            card.key === 'bb' ? analysis?.last :
            card.key === 'slope' ? analysis?.sPerc :
            card.key === 'macd' ? analysis?.last.macd :
            card.key === 'dmi' ? analysis?.last.adx : 
            card.key === 'kd' ? analysis?.last.k : 0,
            card.key === 'ma' ? (is3231 ? (analysis?.last.ma20 || 0) : analysis?.last.ma60) : 0
          ) : { t: "--", c: "" }) : { t: "--", c: "" };
          
          // 取得該指標的得分 (從 analysis.scores 中獲取)
          const scoreObj = analysis?.scores[card.key] || { buy: 0, sell: 0 };
          
          // 為每個卡片定義邊框顏色（使用 themeColors 對應的顏色）
          const borderColorMap = {
            slope: '#818cf8',      // indigo
            ma: '#3b82f6',         // blue
            rsi: '#d946ef',        // pink/purple
            kd: '#facc15',         // yellow
            bb: '#f59e0b',         // amber
            macd: '#2dd4bf',       // cyan
            dmi: '#fbbf24',        // yellow
            fibo: '#10b981'        // emerald
          };
          const borderColor = borderColorMap[card.key] || '#525252';
          const borderColorWithOpacity = borderColor + '66'; // 添加 40% 透明度 (66 in hex)
          const bgColorLight = borderColor + '08'; // 極淺背景色 (約 3% 透明度)
          const bgColorSelected = borderColor + '15'; // 選中時稍深一點 (約 8% 透明度)
          
          return (
            <div 
              key={card.key} 
              onClick={() => toggleLayer(card.key)}
              className={`p-4 sm:p-6 rounded-2xl sm:rounded-[2.5rem] border-2 transition-all cursor-pointer shadow-lg flex flex-col h-[415px] sm:h-[441px] overflow-hidden
                ${visibleLayers[card.key] 
                  ? 'ring-2 ring-opacity-50' 
                  : 'hover:border-opacity-80'}`}
              style={{
                borderColor: visibleLayers[card.key] ? borderColor : borderColorWithOpacity,
                boxShadow: visibleLayers[card.key] ? `0 0 20px -5px ${themeColors[card.key] || '#6366f1'}40` : '',
                backgroundColor: visibleLayers[card.key] ? bgColorSelected : bgColorLight
              }}
            >
              <div className="flex-1 min-h-0 flex flex-col">
                <div className="flex justify-between items-start mb-3 sm:mb-4 shrink-0">
                  <span className="text-xs sm:text-sm font-black uppercase tracking-wider" style={{color: themeColors[card.key] || '#fff'}}>{card.title}</span>
                  <button 
                    className="p-0.5 sm:p-1 text-neutral-600 hover:text-white transition-colors shrink-0"
                    onClick={(e) => showInfo(e, card.key, card.title, card.info)}
                  >
                    <HelpCircle size={14} className="sm:w-4 sm:h-4" />
                  </button>
                </div>
                {/* 如果是 Fibo，使用自定義的 val 渲染，否則使用預設樣式 */}
                {card.key === 'fibo' && card.getVal ? (
                  <div className="mb-3 sm:mb-4 shrink-0">{card.getVal(analysis, themeColors)}</div>
                ) : (
                  <div className="text-2xl sm:text-3xl font-mono font-black text-neutral-200 mb-3 sm:mb-4 tracking-tight shrink-0">{card.val}</div>
                )}
                
                <p className="text-[11px] sm:text-xs text-neutral-400 leading-relaxed font-medium pb-4 sm:pb-6 border-b border-white/5 shrink-0">{card.desc}</p>
              </div>
              <div className="mt-auto pt-4 sm:pt-6 border-t border-white/5 shrink-0">
                <div className="bg-neutral-950/50 p-3 sm:p-4 rounded-xl sm:rounded-2xl border border-white/5">
                  <p className={`text-xs sm:text-sm font-bold leading-relaxed ${diagResult.c}`}>
                    {diagResult.t}
                  </p>
                  <div className="flex gap-2 sm:gap-4 mt-2 text-[10px] sm:text-xs font-mono opacity-80">
                    {/* 修正：顯示 實得/滿分 格式，並根據 is3231 動態調整 maxScore */}
                    <span className="text-emerald-400">買: {Math.round(scoreObj.buy)}/{
                      card.key === 'fibo' ? (analysis?.fiboMaxScore || 35) : 
                      card.key === 'slope' ? (is3231 ? 0 : 20) : 
                      card.key === 'ma' ? (analysis?.maMaxScore || (is3231 ? 10 : 7)) : 
                      card.key === 'macd' ? (analysis?.macdMaxScore || (is3231 ? 5 : 7)) : 
                      card.key === 'dmi' ? (is3231 ? 0 : 6) : 
                      card.key === 'rsi' ? (analysis?.rsiMaxScore || (is3231 ? 25 : 10)) : 
                      card.key === 'kd' ? (analysis?.kdMaxScore || (is3231 ? 25 : 10)) : 
                      card.key === 'bb' ? (analysis?.bbMaxScore || (is3231 ? 30 : 5)) : 5
                    }</span>
                    <span className="text-rose-400">賣: {Math.round(scoreObj.sell)}/{
                      card.key === 'fibo' ? (analysis?.fiboMaxScore || 35) : 
                      card.key === 'slope' ? (is3231 ? 0 : 20) : 
                      card.key === 'ma' ? (analysis?.maMaxScore || (is3231 ? 10 : 7)) : 
                      card.key === 'macd' ? (analysis?.macdMaxScore || (is3231 ? 5 : 7)) : 
                      card.key === 'dmi' ? (is3231 ? 0 : 6) : 
                      card.key === 'rsi' ? (analysis?.rsiMaxScore || (is3231 ? 25 : 10)) : 
                      card.key === 'kd' ? (analysis?.kdMaxScore || (is3231 ? 25 : 10)) : 
                      card.key === 'bb' ? (analysis?.bbMaxScore || (is3231 ? 30 : 5)) : 5
                    }</span>
                  </div>
                  
                  {/* 配分明細顯示 */}
                  {(scoreObj.buyDetails || scoreObj.sellDetails || scoreObj.baseScore !== undefined) && (
                    <div className="mt-3 pt-3 border-t border-white/5">
                      <div className="text-[9px] space-y-1">
                        {/* 買入配分明細 */}
                        {scoreObj.buy > 0 && (
                          <div>
                            {scoreObj.baseScore !== undefined ? (
                              // FIBO 特殊顯示（基礎分數 + 修正）
                              <>
                                <div className="flex justify-between text-neutral-300">
                                  <span>基礎分數</span>
                                  <span className="font-mono">{Math.round(scoreObj.baseScore)}分</span>
                                </div>
                                {scoreObj.modifierDetails && scoreObj.modifierDetails.length > 0 && (
                                  <>
                                    {scoreObj.modifierDetails.map((detail, idx) => (
                                      <div key={idx} className="flex justify-between">
                                        <span className={detail.value > 0 ? 'text-emerald-400' : 'text-rose-400'}>
                                          {detail.name}
                                        </span>
                                        <span className={`font-mono ${detail.value > 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                                          {detail.value > 0 ? '+' : ''}{detail.value}分
                                        </span>
                                      </div>
                                    ))}
                                    <div className="flex justify-between pt-0.5 border-t border-white/5 mt-0.5">
                                      <span className="text-neutral-200 font-semibold">總分</span>
                                      <span className="font-mono text-emerald-400 font-semibold">
                                        {Math.round(scoreObj.baseScore + (scoreObj.modifier || 0))}分
                                      </span>
                                    </div>
                                  </>
                                )}
                              </>
                            ) : (
                              // 其他指標的詳細資訊
                              scoreObj.buyDetails && scoreObj.buyDetails.length > 0 ? (
                                scoreObj.buyDetails.map((detail, idx) => (
                                  <div key={idx} className="flex justify-between">
                                    <span className="text-emerald-400">{detail.name}</span>
                                    <span className="font-mono text-emerald-400">{detail.value}分</span>
                                  </div>
                                ))
                              ) : null
                            )}
                          </div>
                        )}
                        
                        {/* 賣出配分明細 */}
                        {scoreObj.sell > 0 && (
                          <div className={scoreObj.buy > 0 ? 'mt-2 pt-2 border-t border-white/5' : ''}>
                            {scoreObj.sellDetails && scoreObj.sellDetails.length > 0 ? (
                              scoreObj.sellDetails.map((detail, idx) => (
                                <div key={idx} className="flex justify-between">
                                  <span className="text-rose-400">{detail.name}</span>
                                  <span className="font-mono text-rose-400">{detail.value}分</span>
                                </div>
                              ))
                            ) : null}
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <footer className="max-w-7xl mx-auto mt-6 sm:mt-10 pt-6 sm:pt-10 border-t border-neutral-900 text-center pb-8 sm:pb-12 px-4">
        <p className="text-[9px] sm:text-[10px] text-neutral-700 font-bold uppercase tracking-[0.2em] sm:tracking-[0.3em] break-words">6669 Wiwynn calculateEMA develope by Dixon Chu</p>
      </footer>
        </div>
      </div>
    </>
  );
};

export default App;