import React, { useState, useEffect, useMemo, useRef } from 'react';
import { ComposedChart, Area, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts';
import { Activity, BarChart3, RefreshCw, Info, ChevronLeft, ChevronRight, Maximize2, Minimize2, ShieldCheck, HelpCircle, X, Search, TrendingUp, AlertTriangle, Plus } from 'lucide-react';

const App = () => {
  // Tab 管理系統 - 預設兩個 tab
  const [tabs, setTabs] = useState([
    { id: '6669', symbol: '6669', data: [], loading: false, manualPrice: '', fetchError: null, visibleLayers: { ma: false, fibo: false, rsi: false, macd: false, bb: false, slope: false, dmi: false, kd: false } },
    { id: '3231', symbol: '3231', data: [], loading: false, manualPrice: '', fetchError: null, visibleLayers: { ma: false, fibo: false, rsi: false, macd: false, bb: false, slope: false, dmi: false, kd: false } }
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
      let ma60 = i >= 59 ? closes.slice(i - 59, i + 1).reduce((a, b) => a + b, 0) / 60 : null;
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
      return { 
        ...item, ma60, rsiVal, slopeVal, upper, lower, mid, pctB, bandWidth,
        macd: osc[i] || 0, adx: adx[i] || 0, pdi: pdi[i] || 0, mdi: mdi[i] || 0,
        k: kdData[i].k, d: kdData[i].d,
        volMA5: volMA5[i] || 0, volMA20: volMA20[i] || 0, atr: atr14[i] || 0,
        open: opens[i], volume: volumes[i]
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
      
      // 再次檢查用戶是否還在該 tab（使用 ref 獲取最新的 activeTabId，避免閉包問題）
      const finalActiveTabId = activeTabIdRef.current;
      if (finalActiveTabId === targetTabId) {
        updateTab(targetTabId, {
          data: processed,
          manualPrice: processed.length > 0 ? Math.round(processed[processed.length - 1].price).toString() : '',
          loading: false
        });
      } else {
        console.log(`[${symbol}] 數據載入完成，但用戶已切換到其他 tab (${finalActiveTabId})，不更新數據`);
      }
      
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
    
    // 1. FIBO: Impulse Leg (120日滾動回溯)
    const recentData = data.slice(-120); 
    let maxPrice = -Infinity, maxIndex = -1;
    recentData.forEach((d, i) => { if (d.price > maxPrice) { maxPrice = d.price; maxIndex = i; } });
    
    let minPrice = Infinity;
    const legData = recentData.slice(0, maxIndex + 1); // 起漲點必須在高點前
    legData.forEach(d => { if (d.price < minPrice) minPrice = d.price; });
    
    // 防呆：若高點就是第一天，則往前再找
    if (maxIndex < 5 && data.length > 200) {
       const extendData = data.slice(-200);
       minPrice = Math.min(...extendData.map(d=>d.price));
    }

    const range = maxPrice - minPrice;
    const swingRate = (maxPrice - minPrice) / minPrice;
    const fiboValid = swingRate >= 0.1; // 門檻 10%

    const fibo = { 
      l236: maxPrice - range * 0.236, 
      l382: maxPrice - range * 0.382, 
      l500: maxPrice - range * 0.5,
      l618: maxPrice - range * 0.618, 
      l786: maxPrice - range * 0.786,
      ext1272: maxPrice + range * 0.272, 
      ext1618: maxPrice + range * 0.618 
    };

    // 只使用有效的斜率值（排除前60個點的0值）來計算百分位
    const validSlopes = data.filter((d, i) => i >= 60).map(d => d.slopeVal);
    const sPerc = validSlopes.length > 0 
      ? (validSlopes.sort((a, b) => a - b).filter(s => s < last.slopeVal).length / validSlopes.length) * 100
      : 50; // 如果沒有有效斜率，預設為50%

    // === FIBO 評分 (35分) ===
    let b_Fibo = 0;
    let s_Fibo = 0;
    const p = last.price;

    // 線性映射函數
    const map = (val, inMin, inMax, outMin, outMax) => {
      const v = Math.max(Math.min(val, Math.max(inMin, inMax)), Math.min(inMin, inMax));
      return outMin + (v - inMin) * (outMax - outMin) / (inMax - inMin);
    };

    if (fiboValid) {
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
        if (last.price > last.open && last.price > prev.price) modifier += 10; // 止跌確認
        const bodyLen = Math.abs(last.price - last.open);
        const lowerShadow = Math.min(last.price, last.open) - last.low;
        if (lowerShadow > bodyLen && last.low <= fibo.l382) modifier += 8; // 下影線
        if (last.volume < (last.volMA5 * 0.7)) modifier += 5; // 量縮
        if (last.price < last.open && bodyLen > (last.atr * 1.5)) modifier -= 10; // 殺盤

        b_Fibo = Math.min(35, Math.max(0, baseScore + modifier));

        // 賣出
        if (last.high >= fibo.ext1618) s_Fibo = 35; // 獲利滿足
        else if (last.high >= fibo.ext1272) s_Fibo = 28; // 第一壓力
        else if (p > maxPrice) s_Fibo = 15; // 解套賣壓
        if (p < fibo.l618) s_Fibo = 35; // 停損
    }

    // === 動態斜率 (20分) - 線性給分 ===
    // 買入 - 線性給分
    let b_Slope_Rank = 0;
    if (sPerc < 10) {
      // 極度超跌區間：從 0% 到 10%，分數從 15 到 10
      b_Slope_Rank = map(sPerc, 0, 10, 15, 10);
    } else if (sPerc < 25) {
      // 價值區間：從 10% 到 25%，分數從 10 到 5
      b_Slope_Rank = map(sPerc, 10, 25, 10, 5);
    } else if (sPerc < 40) {
      // 初步區間：從 25% 到 40%，分數從 5 到 0
      b_Slope_Rank = map(sPerc, 25, 40, 5, 0);
    }
    const b_Slope_Mom = (last.slopeVal > prev.slopeVal) ? 5 : 0;
    const b_Hist = (b_Slope_Rank > 0) ? b_Slope_Rank + b_Slope_Mom : 0;

    // 賣出 - 線性給分
    let s_Slope_Rank = 0;
    if (sPerc > 90) {
      // 極度過熱區間：從 90% 到 100%，分數從 10 到 15
      s_Slope_Rank = map(sPerc, 90, 100, 10, 15);
    } else if (sPerc > 75) {
      // 警戒區間：從 75% 到 90%，分數從 5 到 10
      s_Slope_Rank = map(sPerc, 75, 90, 5, 10);
    } else if (sPerc > 60) {
      // 初步區間：從 60% 到 75%，分數從 0 到 5
      s_Slope_Rank = map(sPerc, 60, 75, 0, 5);
    }
    const s_Slope_Mom = (last.slopeVal < prev.slopeVal) ? 5 : 0;
    const s_Hist = (s_Slope_Rank > 0) ? s_Slope_Rank + s_Slope_Mom : 0;

    // === MA 季線 (7分) ===
    const bias = last.ma60 ? (p - last.ma60) / last.ma60 * 100 : 0;
    const maSlope = prev.ma60 && prev.ma60 !== 0 ? (last.ma60 - prev.ma60) / prev.ma60 : 0;
    const last3Days = data.slice(-3);
    const isBroken = last3Days.length === 3 && last3Days.every(d => d.price < d.ma60);

    let b_MA = 0;
    if (!isBroken) {
        if (maSlope > 0) b_MA += 3;
        if (bias > 0 && bias <= 5) b_MA += 4;
        else if (bias > 5 && bias <= 10) b_MA += 2;
        else if (bias < 0 && maSlope > 0) b_MA += 1;
    }
    
    let s_MA = 0;
    if (maSlope < 0) s_MA += 3;
    if (bias > 25) s_MA += 4;
    else if (bias > 15) s_MA += 2;
    if (isBroken) s_MA = Math.max(s_MA, 3);
    b_MA = Math.min(7, b_MA);
    s_MA = Math.min(7, s_MA);

    // === KD (10分) ===
    // 買入
    let b_KD_Pos = 0;
    if (last.k < 20) b_KD_Pos = 4;
    else if (last.k < 40) b_KD_Pos = 2;
    let b_KD_Sig = 0;
    if (prev.k !== undefined && prev.d !== undefined && prev.k < prev.d && last.k > last.d) {
        if (last.k < 20) b_KD_Sig = 6;
        else if (last.k < 50) b_KD_Sig = 3;
    }
    // 背離加分
    const lookback20 = data.slice(-22, -2);
    if (lookback20.length > 0) {
        const minP = Math.min(...lookback20.map(d=>d.price));
        const minK = Math.min(...lookback20.map(d=>d.k));
        if (p < minP && last.k > minK) b_KD_Pos = 10; // 背離直接滿分
    }
    const b_KD = Math.min(10, b_KD_Pos + b_KD_Sig);

    // 賣出
    let s_KD_Pos = 0;
    if (last.k > 80) s_KD_Pos = 3;
    else if (last.k > 70) s_KD_Pos = 1;
    let s_KD_Sig = 0;
    if (prev.k !== undefined && prev.d !== undefined && prev.k > prev.d && last.k < last.d) {
        if (last.k > 80) s_KD_Sig = 7;
        else if (last.k > 50) s_KD_Sig = 4;
    }
    // 鈍化保護
    const last3K = data.slice(-3).map(d => d.k);
    const last3D = data.slice(-3).map(d => d.d);
    const isPassivation = last3K.length === 3 && last3K.every(k => k > 80) && last3K.every((k,i) => k > last3D[i]);
    
    let s_KD = Math.min(10, s_KD_Pos + s_KD_Sig);
    if (isPassivation) s_KD = 0;

    // === RSI (10分) ===
    let b_RSI = 0;
    if (last.rsiVal < 30) b_RSI = 7;
    else if (last.rsiVal < 50) b_RSI = 5;
    else if (last.rsiVal < 60) b_RSI = 2;
    if (prev.rsiVal !== undefined && prev.rsiVal <= 50 && last.rsiVal > 50) b_RSI += 2; // 突破50
    // 底背離
    if (lookback20.length > 0) {
         const minR = Math.min(...lookback20.map(d=>d.rsiVal));
         if (p < Math.min(...lookback20.map(d=>d.price)) && last.rsiVal > minR) b_RSI += 3;
    }
    b_RSI = Math.min(10, b_RSI);

    let s_RSI = 0;
    if (last.rsiVal > 80) s_RSI = 7;
    else if (last.rsiVal > 70) s_RSI = 5;
    else if (last.rsiVal > 60) s_RSI = 2;
    if (prev.rsiVal !== undefined && prev.rsiVal >= 50 && last.rsiVal < 50) s_RSI += 2; // 跌破50
    s_RSI = Math.min(10, s_RSI);

    // === MACD (7分) ===
    let b_MACD = 0;
    if (prev.macd !== undefined && last.macd < 0 && last.macd > prev.macd) b_MACD += 3; // 紅收斂
    if (prev.macd !== undefined && prev.macd < 0 && last.macd > 0) b_MACD += 2; // 金叉
    // 底背離
    if (lookback20.length > 0) {
        const minO = Math.min(...lookback20.map(d=>d.macd));
        if (p < Math.min(...lookback20.map(d=>d.price)) && last.macd > minO && last.macd < 0) b_MACD += 2;
    }
    b_MACD = Math.min(7, b_MACD);

    let s_MACD = 0;
    if (prev.macd !== undefined && last.macd > 0 && last.macd < prev.macd) s_MACD += 3; // 綠收斂
    if (prev.macd !== undefined && prev.macd > 0 && last.macd < 0) s_MACD += 2; // 死叉
    s_MACD = Math.min(7, s_MACD);

    // === DMI (6分) ===
    let b_DMI = 0;
    if (last.pdi !== undefined && last.mdi !== undefined && last.pdi > last.mdi) {
        b_DMI += 2;
        if (prev.pdi !== undefined && prev.mdi !== undefined && prev.pdi <= prev.mdi && last.pdi > last.mdi) b_DMI += 1;
        if (prev.adx !== undefined && last.adx > 25 && last.adx > prev.adx) b_DMI += 3;
        else if (prev.adx !== undefined && last.adx < 25 && last.adx > prev.adx) b_DMI += 1;
    }
    if (last.adx > 50) b_DMI -= 1;
    b_DMI = Math.max(0, Math.min(6, b_DMI));

    let s_DMI = 0;
    if (last.pdi !== undefined && last.mdi !== undefined && last.mdi > last.pdi) {
        s_DMI += 2;
        if (prev.adx !== undefined && last.adx > 25 && last.adx > prev.adx) s_DMI += 3;
    }
    s_DMI = Math.min(6, s_DMI);

    // 組合分數
    const b_Trend = b_MA + b_MACD + b_DMI;
    const s_Trend = s_MA + s_MACD + s_DMI;
    const b_Osc = b_RSI + b_KD;
    const s_Osc = s_RSI + s_KD;

    // === BB (5分) ===
    const pb = last.pctB ?? 0.5;
    let b_BB = 0;
    if (pb < 0) b_BB = 3;
    else if (pb < 0.1) b_BB = 2;
    // 中軌回測
    if (last.mid && prev.mid && last.mid !== 0) {
      const midSlope = (last.mid - prev.mid);
      const distToMid = Math.abs((p - last.mid) / last.mid);
      if (midSlope > 0 && distToMid < 0.01) b_BB = 2;
    }
    b_BB = Math.min(5, b_BB);

    let s_BB = 0;
    if (pb > 1.1) s_BB = 3;
    else if (pb > 1.0) s_BB = 1;
    // 假突破
    if (last.high && last.upper && last.high > last.upper && p < last.upper) s_BB = 2;
    // 開口爆量保護
    const bwOpen = prev.bandWidth !== undefined && last.bandWidth !== undefined ? (last.bandWidth > prev.bandWidth) : false;
    const volExp = last.volume !== undefined && last.volMA5 !== undefined ? (last.volume > (last.volMA5 * 1.5)) : false;
    if (bwOpen && volExp && s_BB > 0) s_BB = 0;
    s_BB = Math.min(5, s_BB);

    const b_Vol = b_BB;
    const s_Vol = s_BB;

    // 總分
    const totalBuyScore = Math.round(b_Fibo + b_Hist + b_Trend + b_Osc + b_Vol);
    const totalSellScore = Math.round(s_Fibo + s_Hist + s_Trend + s_Osc + s_Vol);

    // 訊號判斷
    let buySignal = { text: '觀望', color: 'text-neutral-500' };
    if (totalBuyScore > 50) buySignal = { text: '強力買進', color: 'text-emerald-400 font-bold' };
    else if (totalBuyScore > 40) buySignal = { text: '分批佈局', color: 'text-cyan-400' };
    else if (totalBuyScore >= 20) buySignal = { text: '中性觀察', color: 'text-blue-400' };
    
    if (maSlope < 0 && totalBuyScore > 20) buySignal = { text: '逆勢 (停止買入)', color: 'text-neutral-500' };

    let sellSignal = { text: '續抱', color: 'text-emerald-400' };
    if (totalSellScore > 55) sellSignal = { text: '清倉賣出', color: 'text-rose-500 font-bold' };
    else if (totalSellScore > 40) sellSignal = { text: '調節警戒', color: 'text-orange-400' };
    
    if (p < fibo.l618) sellSignal = { text: '破線 (強制停損)', color: 'text-red-600 font-black animate-pulse' };

    return { 
      last, prev, fibo, sPerc, maxPrice, minPrice, bias, maSlope, isBroken, fiboValid: true,
      scores: {
        fibo: { buy: b_Fibo, sell: s_Fibo },
        slope: { buy: b_Hist, sell: s_Hist },
        trend: { buy: b_Trend, sell: s_Trend },
        osc: { buy: b_Osc, sell: s_Osc },
        vol: { buy: b_Vol, sell: s_Vol },
        ma: { buy: b_MA, sell: s_MA },
        macd: { buy: b_MACD, sell: s_MACD },
        dmi: { buy: b_DMI, sell: s_DMI },
        rsi: { buy: b_RSI, sell: s_RSI },
        kd: { buy: b_KD, sell: s_KD },
        bb: { buy: b_BB, sell: s_BB }
      },
      buy: { total: totalBuyScore, signal: buySignal },
      sell: { total: totalSellScore, signal: sellSignal },
      buyTotal: totalBuyScore,
      sellTotal: totalSellScore
    };
  }, [data]);

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

  const renderScoreBar = (label, score, maxScore, colorClass) => (
    <div className="mb-1.5 sm:mb-2">
      <div className="flex justify-between text-[9px] sm:text-[10px] mb-0.5 sm:mb-1 text-neutral-400">
        <span className="truncate pr-2">{label}</span>
        <span className="font-mono shrink-0">{Math.round(score)} / {maxScore}</span>
      </div>
      <div className="w-full bg-neutral-800 h-1 sm:h-1.5 rounded-full overflow-hidden">
        <div className={`h-full ${colorClass} transition-all duration-500`} style={{width: `${Math.min(100, (score/maxScore)*100)}%`}}></div>
      </div>
    </div>
  );

  const diagnosticCards = [
    { 
      key: 'slope', title: '動態斜率 (Slope)', val: `${analysis?.sPerc?.toFixed(1) ?? '--'}%`, 
      desc: '比較今日漲速與歷史排名。拆解為「位階」與「動能」給分。', 
      info: `權重：20% (位階15+動能5)\n\n【買入評分 - 線性給分】\n● PR < 10: 15-10分 (線性，PR越低分數越高)\n● PR 10-25: 10-5分 (線性分配)\n● PR 25-40: 5-0分 (線性分配)\n● 動能: 向上勾頭且有位階分才觸發 +5分\n\n【賣出評分 - 線性給分】\n● PR > 90: 10-15分 (線性，PR越高分數越高)\n● PR 75-90: 5-10分 (線性分配)\n● PR 60-75: 0-5分 (線性分配)\n● 動能: 向下勾頭且有位階分才觸發 +5分`,
      diag: (p) => {
        if (p === undefined) return { t: "分析中...", c: "text-neutral-500" };
        return p > 90 ? { t: "【歷史高檔】噴發極端，風險高。", c: "text-rose-400" } : p < 15 ? { t: "【歷史低檔】超跌區間，反彈機會。", c: "text-blue-400" } : { t: "【常態波動】無顯著訊號。", c: "text-emerald-400" };
      }
    },
    { 
      key: 'ma', title: 'MA 季線趨勢', val: analysis ? `$${Math.round(analysis.last.ma60).toLocaleString()}` : '--', 
      desc: '趨勢權重 7%。季線代表中期成本。價格在季線上且乖離適中為最佳。', 
      info: `權重：7% (趨勢+位階)\n目前乖離率：${analysis?.bias?.toFixed(2)}%\n季線斜率：${analysis?.maSlope > 0 ? '上揚' : '下彎'}\n\n【買入評分】\n● 趨勢: 斜率>0 (+3)\n● 位階: 乖離0-5% (+4), 5-10% (+2), 假跌破 (+1)\n● 破位: 0分\n\n【賣出評分】\n● 轉弱: 斜率<0 (+3)\n● 過熱: 乖離>25% (+4), >15% (+2)\n● 破位: 跌破3天 (+3)`,
      diag: (p, m) => {
        if (p === undefined) return { t: "分析中...", c: "text-neutral-500" };
        return p > m ? { t: "【多頭排列】股價守穩季線。", c: "text-emerald-400" } : { t: "【空頭盤整】股價位於季線下。", c: "text-rose-400" };
      }
    },
    { 
      key: 'rsi', title: 'RSI 相對強弱', val: analysis ? Math.round(analysis.last.rsiVal) : '--', 
      desc: '震盪權重 10%。反映市場情緒。低檔 (<60) 適合佈局，高檔 (>40) 適合調節。', 
      info: `權重：10%\n\n【買入評分】\n● RSI < 60 開始給分，< 30 滿分\n\n【賣出評分】\n● RSI > 40 開始給分，> 80 滿分`,
      diag: (r) => {
        if (r === undefined) return { t: "分析中...", c: "text-neutral-500" };
        return r > 75 ? { t: "【過熱】RSI高檔鈍化。", c: "text-rose-400" } : r < 35 ? { t: "【超賣】RSI低檔背離。", c: "text-blue-400" } : { t: "【中性】力道均衡。", c: "text-emerald-400" };
      }
    },
    { 
      key: 'kd', title: 'KD 隨機指標', val: analysis ? `K:${Math.round(analysis.last.k)}` : '--', 
      desc: '震盪權重 10%。K值反應靈敏。K<20 強力買訊，K>80 若鈍化則不賣。', 
      info: `權重：10% (位階+訊號)\n\n【買入】\n● K<20 (4分), 20-40 (2分)\n● 低檔金叉 (+6), 中低檔 (+3)\n● 背離 (滿分)\n\n【賣出】\n● K>80 (3分), 70-80 (1分)\n● 高檔死叉 (+7), 中高檔 (+4)\n● 鈍化保護: 0分`,
      diag: (k) => k > 80 ? { t: "【高檔】K值過高，防回檔。", c: "text-rose-400" } : k < 20 ? { t: "【低檔】K值過低，醞釀反彈。", c: "text-blue-400" } : { t: "【區間整理】K值位於 20-80。", c: "text-emerald-400" }
    },
    { 
      key: 'bb', title: 'Bollinger 布林', val: analysis ? `%B:${analysis.last.pctB?.toFixed(2)}` : '--', 
      desc: '波動權重 5%。%B < 0 極端超跌，> 1.1 極端乖離。引入開口與爆量保護。', 
      info: `權重：5% (%B策略)\n\n【買入評分】\n● %B < 0：極端超賣 (3分)\n● %B < 0.1：下軌支撐 (2分)\n● 回測中軌：強勢回檔 (2分)\n\n【賣出評分】\n● %B > 1.1：懸空噴出 (3分)\n● %B > 1.0：突破上軌 (1分)\n● 假突破：(2分)\n● 保護：爆量打開開口 -> 0分`,
      diag: (l) => {
        if (!l) return { t: "分析中...", c: "text-neutral-500" };
        return l.pctB > 1.1 ? { t: "【極端乖離】懸空噴出，不可持續。", c: "text-rose-400" } : l.pctB < 0 ? { t: "【極端超跌】跌出通道，隨時反彈。", c: "text-blue-400" } : { t: "【常態】軌道內運行。", c: "text-emerald-400" };
      }
    },
    { 
      key: 'macd', title: 'MACD 動能', val: analysis ? analysis.last.macd.toFixed(2) : '--', 
      desc: '趨勢權重 7%。柱狀體 (OSC) 代表動能。捕捉轉折點。', 
      info: `權重：7%\n\n【買入評分 (Max 7)】\n● 紅柱收斂 (轉強): +3\n● 零軸金叉 (確認): +2\n● 底背離 (破底翻): +2\n\n【賣出評分 (Max 7)】\n● 綠柱收斂 (轉弱): +3\n● 零軸死叉 (確認): +2\n● 頂背離 (拉高出貨): +2`,
      diag: (o) => {
        if (o === undefined) return { t: "分析中...", c: "text-neutral-500" };
        return o > 0 ? { t: "【多方動能】柱狀體為正。", c: "text-emerald-400" } : { t: "【空方動能】柱狀體為負。", c: "text-rose-400" };
      }
    },
    { 
      key: 'dmi', title: 'DMI 趨勢強度', val: analysis ? Math.round(analysis.last.adx) : '--', 
      desc: '趨勢權重 6%。ADX 數值代表趨勢強度。數值越高代表趨勢越明確。', 
      info: `權重：6%\n\n【買入評分】\n● 方向：+DI > -DI (+2), 金叉 (+1)\n● 強度：ADX > 25 且向上 (+3)\n● 過熱扣分：ADX > 50 (-1)\n\n【賣出評分】\n● 方向：-DI > +DI (+2), 死叉 (+1)\n● 強度：ADX > 25 且向上 (+3)`,
      diag: (a) => a > 25 ? { t: "【趨勢盤】動能強勁。", c: "text-rose-400" } : { t: "【盤整盤】方向不明。", c: "text-blue-400" }
    },
    { 
      key: 'fibo', 
      title: 'Fibo 波段位階', 
      val: '關鍵位階', 
      getVal: (analysis, themeColors) => (
        <div className="flex flex-col gap-1 mt-1">
          <div className="flex justify-between items-center text-xs">
            <span style={{color: themeColors.target}}>1.618</span>
            <span className="font-mono">${analysis ? Math.round(analysis.fibo.ext1618) : '--'}</span>
          </div>
          <div className="flex justify-between items-center text-xs">
            <span style={{color: themeColors.ext1272}}>1.272</span>
            <span className="font-mono">${analysis ? Math.round(analysis.fibo.ext1272) : '--'}</span>
          </div>
          <div className="flex justify-between items-center text-xs">
            <span style={{color: themeColors.l618}}>0.618</span>
            <span className="font-mono">${analysis ? Math.round(analysis.fibo.l618) : '--'}</span>
          </div>
          <div className="flex justify-between items-center text-xs">
            <span style={{color: themeColors.l382}}>0.382</span>
            <span className="font-mono">${analysis ? Math.round(analysis.fibo.l382) : '--'}</span>
          </div>
          <div className="flex justify-between items-center text-xs">
            <span style={{color: themeColors.l236}}>0.236</span>
            <span className="font-mono">${analysis ? Math.round(analysis.fibo.l236) : '--'}</span>
          </div>
        </div>
      ),
      desc: '最高權重 35%。依據最近趨勢腿 (Impulse Leg) 計算。0.382 為最佳回檔買點。', 
      info: `權重：35% (最高)\n\n【買入評分 - 線性給分】\n● > 0.236：5-10分 (線性分配)\n● 0.236-0.382：20-25分 (線性，0.382最高25分)\n● 0.382-0.5：15-20分 (線性分配)\n● 0.5-0.618：10-15分 (線性分配)\n● < 0.618 (破線)：0分\n\n【賣出評分】\n● 1.618：獲利滿足 35分\n● 1.272：壓力 28分\n● 破0.618：停損 35分`,
      diag: () => ({ t: "【關鍵決策】權重最高參考指標。", c: "text-blue-400" })
    }
  ];

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

      <div className="max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-2 gap-6 mb-12 items-stretch transition-all duration-300">
        
        {/* 左側：分數推薦區 (加權版) */}
        <div className={`grid grid-cols-1 gap-4 ${isChartExpanded ? 'hidden' : ''}`}>
          <div className="bg-neutral-900 rounded-2xl sm:rounded-[3rem] p-4 sm:p-6 border-2 border-neutral-700 shadow-xl flex flex-col sm:flex-row items-center sm:items-stretch h-full relative group">
            <div className="flex flex-col items-center justify-center shrink-0 w-full sm:w-1/3 text-center mb-4 sm:mb-0">
              <h3 className="text-emerald-500 font-black text-[9px] sm:text-[10px] uppercase tracking-widest mb-2 sm:mb-3">Buy Power</h3>
              <span className="text-5xl sm:text-6xl md:text-7xl font-black leading-none text-emerald-400">{analysis?.buy.total ?? '--'}</span>
              <div className={`text-sm sm:text-base font-black mt-3 sm:mt-4 px-3 sm:px-5 py-1.5 sm:py-2.5 rounded-full ${analysis?.buy?.signal?.color?.includes('emerald') ? 'bg-emerald-500/30 text-emerald-300' : analysis?.buy?.signal?.color?.includes('cyan') ? 'bg-cyan-500/30 text-cyan-300' : analysis?.buy?.signal?.color?.includes('blue') ? 'bg-blue-500/30 text-blue-300' : 'bg-neutral-500/30 text-neutral-300'} shadow-lg`}>
                {analysis?.buy?.signal?.text ?? '--'}
              </div>
            </div>
            <div className="flex-1 sm:pl-6 border-t sm:border-t-0 sm:border-l border-white/5 pt-4 sm:pt-0 w-full sm:w-auto flex flex-col justify-center">
              <div className="flex justify-between items-center border-b border-white/5 pb-1 mb-3">
                <div className="text-xs text-emerald-400 font-black uppercase">佈局權重分析</div>
                <button 
                  className="p-1 text-neutral-600 hover:text-white" 
                  onClick={(e) => showInfo(e, 'buy', '買入評分模型', 
                    `【評分標準】\n總分 100 由以下加權計算：\n\n1. FIBO 位階 (35%)：\n   0.382為最高分，各區間內線性分配。\n\n2. 歷史起伏 (20%)：\n   斜率位階低檔 (超跌)，線性給分。\n\n3. 趨勢綜合 (20%)：\n   MA/MACD/DMI 多頭排列。\n\n4. 震盪指標 (20%)：\n   RSI/KD 低檔背離給分。\n\n5. 波動風險 (5%)：\n   觸及布林下軌。\n\n【各階段評語】\n● >50分：強力買進\n   多項指標同步看多，適合積極進場。\n\n● 40~50分：分批佈局\n   趨勢轉強但仍有風險，建議分批買入。\n\n● 20~40分：中性觀察\n   市場方向不明，建議等待更明確訊號。\n\n● <20分：觀望\n   多項指標偏弱，不建議進場。\n\n【霸王條款】\n● 逆勢 (停止買入)：\n   即使分數 >20，但季線斜率 <0 時，\n   表示趨勢向下，應停止買入。`
                  )}
                >
                  <Info size={14}/>
                </button>
              </div>
              <div className="space-y-3">
                {renderScoreBar('FIBO 位階 (35%)', analysis?.scores.fibo.buy || 0, 35, 'bg-emerald-500')}
                {renderScoreBar('歷史起伏 (20%)', analysis?.scores.slope.buy || 0, 20, 'bg-emerald-500')}
                {renderScoreBar('趨勢綜合 (20%)', analysis?.scores.ma.buy + analysis?.scores.macd.buy + analysis?.scores.dmi.buy || 0, 20, 'bg-emerald-500')}
                {renderScoreBar('震盪指標 (20%)', analysis?.scores.rsi.buy + analysis?.scores.kd.buy || 0, 20, 'bg-emerald-500')}
                {renderScoreBar('波動風險 (5%)', analysis?.scores.bb.buy || 0, 5, 'bg-emerald-500')}
              </div>
            </div>
          </div>

          <div className="bg-neutral-900 rounded-2xl sm:rounded-[3rem] p-4 sm:p-6 border-2 border-neutral-700 shadow-xl flex flex-col sm:flex-row items-center sm:items-stretch h-full relative">
            <div className="flex flex-col items-center justify-center shrink-0 w-full sm:w-1/3 text-center mb-4 sm:mb-0">
              <h3 className="text-rose-500 font-black text-[9px] sm:text-[10px] uppercase tracking-widest mb-2 sm:mb-3">Sell Risk</h3>
              <span className="text-5xl sm:text-6xl md:text-7xl font-black leading-none text-rose-400">{analysis?.sell.total ?? '--'}</span>
              <div className={`text-sm sm:text-base font-black mt-3 sm:mt-4 px-3 sm:px-5 py-1.5 sm:py-2.5 rounded-full ${analysis?.sell?.signal?.color?.includes('rose') ? 'bg-rose-500/30 text-rose-300' : analysis?.sell?.signal?.color?.includes('red') ? 'bg-red-600/40 text-red-200 animate-pulse' : analysis?.sell?.signal?.color?.includes('orange') ? 'bg-orange-500/30 text-orange-300' : 'bg-emerald-500/30 text-emerald-300'} shadow-lg`}>
                {analysis?.sell?.signal?.text ?? '--'}
              </div>
            </div>
            <div className="flex-1 sm:pl-6 border-t sm:border-t-0 sm:border-l border-white/5 pt-4 sm:pt-0 w-full sm:w-auto flex flex-col justify-center">
              <div className="flex justify-between items-center border-b border-white/5 pb-1 mb-3">
                <div className="text-xs text-rose-400 font-black uppercase">風險權重分析</div>
                <button 
                  className="p-1 text-neutral-600 hover:text-white"
                  onClick={(e) => showInfo(e, 'sell', '賣出評分模型', 
                    `【評分標準】\n總分 100 由以下加權計算：\n\n1. FIBO 壓力 (35%)：\n   接近 1.618 擴展位滿分。\n\n2. 歷史噴發 (20%)：\n   斜率位階 > 90% (過熱)，線性給分。\n\n3. 趨勢乖離 (20%)：\n   乖離過大或指標轉弱。\n\n4. 震盪過熱 (20%)：\n   RSI/KD 高檔鈍化。\n\n5. 波動極端 (5%)：\n   觸及布林上軌。\n\n【各階段評語】\n● >55分：清倉賣出\n   多項指標同步看空，建議全部出清。\n\n● 40~55分：調節警戒\n   風險上升但仍有上漲空間，建議減碼。\n\n● ≤40分：續抱\n   風險可控，可繼續持有。\n\n【霸王條款】\n● 破線 (強制停損)：\n   價格跌破 FIBO 0.618 位階時，\n   無論分數多少，都應立即停損。`
                  )}
                >
                  <Info size={14}/>
                </button>
              </div>
              <div className="space-y-3">
                {renderScoreBar('FIBO 壓力 (35%)', analysis?.scores.fibo.sell || 0, 35, 'bg-rose-500')}
                {renderScoreBar('歷史噴發 (20%)', analysis?.scores.slope.sell || 0, 20, 'bg-rose-500')}
                {renderScoreBar('趨勢乖離 (20%)', analysis?.scores.ma.sell + analysis?.scores.macd.sell + analysis?.scores.dmi.sell || 0, 20, 'bg-rose-500')}
                {renderScoreBar('震盪過熱 (20%)', analysis?.scores.osc.sell || 0, 20, 'bg-rose-500')}
                {renderScoreBar('波動極端 (5%)', analysis?.scores.bb.sell || 0, 5, 'bg-rose-500')}
              </div>
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
                    
                    {visibleLayers.ma && <Line yAxisId="right" type="linear" dataKey="ma60" stroke={themeColors.ma} strokeWidth={2} dot={false} strokeDasharray="5 5" isAnimationActive={false} />}
                    {visibleLayers.bb && (
                      <>
                        <Line yAxisId="right" type="linear" dataKey="upper" stroke={themeColors.bb} strokeWidth={1} dot={false} strokeDasharray="3 3" opacity={0.6} isAnimationActive={false} />
                        <Line yAxisId="right" type="linear" dataKey="lower" stroke={themeColors.bb} strokeWidth={1} dot={false} strokeDasharray="3 3" opacity={0.6} isAnimationActive={false} />
                      </>
                    )}
                    {visibleLayers.fibo && analysis && (
                      <>
                        <ReferenceLine yAxisId="right" y={analysis.fibo.ext1618} stroke={themeColors.target} strokeWidth={2} strokeDasharray="3 3" label={{ value: '1.618', fill: '#fff', fontSize: 11, fontWeight: 'bold', position: 'insideTopRight' }} />
                        <ReferenceLine yAxisId="right" y={analysis.fibo.ext1272} stroke={themeColors.ext1272} strokeWidth={2} strokeDasharray="3 3" label={{ value: '1.272', fill: '#fff', fontSize: 11, fontWeight: 'bold', position: 'insideTopRight' }} />
                        <ReferenceLine yAxisId="right" y={analysis.fibo.l786} stroke={themeColors.l786} strokeWidth={1.5} strokeDasharray="3 3" label={{ value: '0.786', fill: '#fff', fontSize: 10, fontWeight: 'bold', position: 'insideTopRight' }} />
                        <ReferenceLine yAxisId="right" y={analysis.fibo.l618} stroke={themeColors.l618} strokeWidth={2.5} label={{ value: '0.618', fill: '#fff', fontSize: 11, fontWeight: 'bold', position: 'insideTopRight' }} />
                        <ReferenceLine yAxisId="right" y={analysis.fibo.l500} stroke={themeColors.l500} strokeWidth={1.5} strokeDasharray="3 3" label={{ value: '0.500', fill: '#fff', fontSize: 10, fontWeight: 'bold', position: 'insideTopRight' }} />
                        <ReferenceLine yAxisId="right" y={analysis.fibo.l382} stroke={themeColors.l382} strokeWidth={1.5} strokeDasharray="3 3" label={{ value: '0.382', fill: '#fff', fontSize: 10, fontWeight: 'bold', position: 'insideTopRight' }} />
                        <ReferenceLine yAxisId="right" y={analysis.fibo.l236} stroke={themeColors.l236} strokeWidth={1.5} strokeDasharray="3 3" label={{ value: '0.236', fill: '#fff', fontSize: 10, fontWeight: 'bold', position: 'insideTopRight' }} />
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
            card.key === 'ma' ? analysis?.last.ma60 : 0
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
              className={`p-4 sm:p-6 rounded-2xl sm:rounded-[2.5rem] border-2 transition-all cursor-pointer shadow-lg flex flex-col h-[320px] sm:h-[340px] overflow-hidden
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
                    {/* 修正：顯示 實得/滿分 格式，並移除 + 號 */}
                    <span className="text-emerald-400">買: {Math.round(scoreObj.buy)}/{card.key === 'fibo' ? 35 : (card.key === 'slope' ? 20 : (card.key === 'ma' || card.key === 'macd' ? 7 : (card.key === 'dmi' ? 6 : (card.key === 'rsi' || card.key === 'kd' ? 10 : 5))))}</span>
                    <span className="text-rose-400">賣: {Math.round(scoreObj.sell)}/{card.key === 'fibo' ? 35 : (card.key === 'slope' ? 20 : (card.key === 'ma' || card.key === 'macd' ? 7 : (card.key === 'dmi' ? 6 : (card.key === 'rsi' || card.key === 'kd' ? 10 : 5))))}</span>
                  </div>
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