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
  const is3231 = stockSymbol === '3231'; // 組件層級的 is3231，用於 JSX 渲染
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
      return { 
        ...item, ma20, ma60, rsiVal, slopeVal, upper, lower, mid, pctB, bandWidth,
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
    
    // 判斷當前 tab 使用的評分規則（根據 stockSymbol）
    const is3231 = stockSymbol === '3231';
    
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
      if (maxIndex < 5 && data.length > 200) {
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
      if (bias > 25) {
        s_MA += 4;
        maSellDetails.push({ name: '正乖離>25%', value: 4 });
      } else if (bias > 15) {
        s_MA += 2;
        maSellDetails.push({ name: '正乖離15-25%', value: 2 });
      }
      if (isBroken) {
        s_MA = Math.max(s_MA, 3);
        if (s_MA === 3) maSellDetails = [{ name: '跌破季線', value: 3 }];
        else maSellDetails.push({ name: '跌破季線', value: 3 });
      }
      b_MA = Math.min(7, b_MA);
      s_MA = Math.min(7, s_MA);
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

    // 總分
    const totalBuyScore = Math.round(b_Fibo + b_Hist + b_Trend + b_Osc + b_Vol);
    const totalSellScore = Math.round(s_Fibo + s_Hist + s_Trend + s_Osc + s_Vol);

    // 計算 maSlope 和 bias（用於顯示和霸王條款判斷，需要在 buySignal 判斷之前計算）
    const maValue = is3231 ? last.ma20 : last.ma60;
    const prevMaValue = is3231 ? prev.ma20 : prev.ma60;
    const bias = maValue ? (p - maValue) / maValue * 100 : 0;
    const maSlope = prevMaValue && prevMaValue !== 0 ? (maValue - prevMaValue) / prevMaValue : 0;
    const isBroken = is3231 ? (p < maValue) : (data.slice(-3).length === 3 && data.slice(-3).every(d => d.price < d.ma60));

    // 訊號判斷
    let buySignal = { text: '觀望', color: 'text-neutral-500' };
    if (is3231) {
      // 3231 緯創：短線波段版買入標準
      if (totalBuyScore > 60) buySignal = { text: '強力買進 (Strong Buy)', color: 'text-emerald-400 font-bold' };
      else if (totalBuyScore > 45) buySignal = { text: '嘗試進場 (Try Buy)', color: 'text-cyan-400' };
      else if (totalBuyScore >= 20) buySignal = { text: '中性觀察', color: 'text-blue-400' };
      // < 20 分：觀望（預設值）
      
      if (maSlope < 0 && totalBuyScore > 20) buySignal = { text: '逆勢 (停止買入)', color: 'text-neutral-500' };
    } else {
      // 6669：原版買入標準
      if (totalBuyScore > 50) buySignal = { text: '強力買進', color: 'text-emerald-400 font-bold' };
      else if (totalBuyScore > 40) buySignal = { text: '分批佈局', color: 'text-cyan-400' };
      else if (totalBuyScore >= 20) buySignal = { text: '中性觀察', color: 'text-blue-400' };
      
      if (maSlope < 0 && totalBuyScore > 20) buySignal = { text: '逆勢 (停止買入)', color: 'text-neutral-500' };
    }

    let sellSignal = { text: '續抱', color: 'text-emerald-400' };
    if (is3231) {
      // 3231 緯創：短線波段版賣出標準
      if (totalSellScore > 60) sellSignal = { text: '清倉賣出 (Clear Out)', color: 'text-rose-500 font-bold' };
      else if (totalSellScore > 40) sellSignal = { text: '獲利調節 (Trim)', color: 'text-orange-400' };
      // <= 40 分：續抱（預設值）
    } else {
      // 6669：原版賣出標準
      if (totalSellScore > 55) sellSignal = { text: '清倉賣出', color: 'text-rose-500 font-bold' };
      else if (totalSellScore > 40) sellSignal = { text: '調節警戒', color: 'text-orange-400' };
    }
    
    // 6669 的停損判斷（3231 不使用此邏輯）
    if (!is3231 && fibo.l618 && p < fibo.l618) {
      sellSignal = { text: '破線 (強制停損)', color: 'text-red-600 font-black animate-pulse' };
    }
    
    // 計算前5天的買入和賣出分數（簡化版，只計算總分）
    const historicalScores = [];
    for (let i = 1; i <= 5; i++) {
      if (data.length < 120 + i) break; // 確保有足夠的歷史數據
      const histIndex = data.length - 1 - i;
      const histLast = data[histIndex];
      const histPrev = data[histIndex - 1];
      
      if (!histLast || !histPrev) break;
      
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
        
        if (histMaxIndex < 5 && data.length > histIndex + 80) {
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
          // 6669 簡化計算
          if (histP > histFibo.l236) histB_Fibo = map(histP, histFibo.l236, histMaxPrice, 5, 10);
          else if (histP > histFibo.l382) histB_Fibo = map(histP, histFibo.l382, histFibo.l236, 20, 25);
          else if (histP > histFibo.l500) histB_Fibo = map(histP, histFibo.l500, histFibo.l382, 15, 20);
          else if (histP >= histFibo.l618) histB_Fibo = map(histP, histFibo.l618, histFibo.l500, 10, 15);
          else histB_Fibo = 0;
          histB_Fibo = Math.min(35, Math.max(0, histB_Fibo));
          
          if (histLast.high >= histFibo.ext1618) histS_Fibo = 35;
          else if (histLast.high >= histFibo.ext1272) histS_Fibo = 28;
          else if (histP > histMaxPrice) histS_Fibo = 15;
          if (histP < histFibo.l618) histS_Fibo = 35;
        }
      }
      
      // 簡化的斜率評分
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
        if (histBias > 25) histS_MA += 4;
        else if (histBias > 15) histS_MA += 2;
        if (histIsBroken) histS_MA = Math.max(histS_MA, 3);
        histB_MA = Math.min(7, histB_MA);
        histS_MA = Math.min(7, histS_MA);
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
      
      const histTotalBuyScore = Math.round(histB_Fibo + histB_Hist + histB_Trend + histB_Osc + histB_Vol);
      const histTotalSellScore = Math.round(histS_Fibo + histS_Hist + histS_Trend + histS_Osc + histS_Vol);
      
      historicalScores.push({
        buy: histTotalBuyScore,
        sell: histTotalSellScore,
        date: histLast.fullDate || histLast.date
      });
    }
    
    return { 
      last, prev, fibo, sPerc, maxPrice, minPrice, bias, maSlope, isBroken, fiboValid: fiboValid,
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
      buy: { total: totalBuyScore, signal: buySignal },
      sell: { total: totalSellScore, signal: sellSignal },
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
        : '比較今日漲速與歷史排名。拆解為「位階」與「動能」給分。', 
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
        : '趨勢權重 7%。季線代表中期成本。價格在季線上且乖離適中為最佳。', 
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
        : `震盪權重 ${analysis?.rsiMaxScore || 10}%。反映市場情緒。低檔 (<60) 適合佈局，高檔 (>40) 適合調節。`, 
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
        : `震盪權重 ${analysis?.kdMaxScore || 10}%。K值反應靈敏。K<20 強力買訊，K>80 若鈍化則不賣。`, 
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
        : `波動權重 ${bbWeight}%。%B < 0 極端超跌，> 1.1 極端乖離。引入開口與爆量保護。`, 
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
        : `趨勢權重 ${analysis?.macdMaxScore || 7}%。柱狀體 (OSC) 代表動能。捕捉轉折點。`, 
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
        : '趨勢權重 6%。ADX 數值代表趨勢強度。數值越高代表趨勢越明確。', 
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
        ? `短線權重 ${fiboWeight}%。20日箱型策略。價格位於箱型下半部即給分，極簡化階梯式評分。`
        : `最高權重 ${fiboWeight}%。依據最近趨勢腿 (Impulse Leg) 計算。0.382 為最佳回檔買點。`, 
      info: is3231
        ? `權重：${fiboWeight}% (短線波段版，20日箱型)\n\n【買入評分 - 階梯式】\n● 價格 > l500：0分 (上半部壓力區)\n● l786 < 價格 <= l500：3分 (下半部安全區)\n● 價格 <= l786：5分 (底部超跌區)\n\n【賣出評分 - 階梯式】\n● 最高價 >= ext1272：5分 (短線噴出)\n● 最高價 >= maxPrice：3分 (創新高)\n● 價格 < maxPrice：0分 (未突破)`
        : `權重：${fiboWeight}% (最高)\n\n【買入評分 - 線性給分】\n基礎分數（依價格區間線性分配）：\n● > 0.236：5-10分 (線性分配)\n● 0.236-0.382：20-25分 (線性，0.382最高25分)\n● 0.382-0.5：15-20分 (線性分配)\n● 0.5-0.618：10-15分 (線性分配)\n● < 0.618 (破線)：0分\n\nK線型態修正（加減分）：\n● 止跌確認：+10分 (收盤價 > 開盤價 且 > 前日收盤價)\n● 下影線：+8分 (下影線 > 實體 且 最低價 <= 0.382)\n● 量縮：+5分 (成交量 < 5日均量 × 0.7)\n● 殺盤：-10分 (收盤價 < 開盤價 且 實體 > ATR × 1.5)\n\n最終分數 = 基礎分數 + 修正分數（限制在 0-35 分）\n\n【賣出評分】\n● 最高價 >= 1.618：獲利滿足 35分\n● 最高價 >= 1.272：壓力 28分\n● 價格 > 前高：解套賣壓 15分\n● 價格 < 0.618：停損 35分`,
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
                <div className="text-xs text-emerald-400 font-black uppercase">佈局權重分析</div>
                <button 
                  className="p-1 text-neutral-600 hover:text-white" 
                  onClick={(e) => {
                    const bbWeight = analysis?.bbMaxScore || 5;
                    const otherWeight = 100 - 35 - 20 - 20 - bbWeight;
                    const infoText = stockSymbol === '3231' 
                      ? `【評分標準】\n總分 100 由以下加權計算：\n\n1. 布林通道 (30%)：\n   短線波段策略，線性給分。\n   %B < 0：30分 (超跌滿分)\n   0 <= %B < 0.1：30→25分 (線性)\n   0.1 <= %B < 0.3：25→10分 (線性)\n\n2. KD 隨機指標 (25%)：\n   短線轉折指標。\n   K<20 極度超賣滿分，K>80 直接賣出。\n   無鈍化保護，有賺就跑。\n\n3. RSI 相對強弱 (25%)：\n   短線震盪指標。\n   RSI<30 極度超賣滿分，RSI>75 直接賣出。\n   背離直接滿分。\n\n4. MA 乖離 (10%)：\n   MA20月線：負乖離過大搶反彈，正乖離過大獲利了結。\n\n5. FIBO 位階 (5%)：\n   短線波段版，20日箱型。\n   價格 > l500：0分\n   l786 < 價格 <= l500：3分\n   價格 <= l786：5分\n\n6. MACD 動能 (5%)：\n   動能止跌確認。紅柱收斂即給分，不等待交叉。\n\n(註：斜率與 DMI 不列入評分，專注短線轉折)\n\n【買入分數門檻】\n● >60分：強力買進 (Strong Buy)\n   投入 50% 資金。黃金買點。\n   通常代表「跌破布林下軌 + KD < 20 + RSI 極低」。\n   這是送分題，勝率極高。\n\n● >45分：嘗試進場 (Try Buy)\n   投入 20% 資金。普通買點。\n   對應回測月線或稍微碰到布林下軌。\n   適合先買一張試水溫，若跌更深再加碼。\n\n● <20分：觀望\n   0% 資金。股價在高檔噴出中，千萬別追高。\n\n【霸王條款】\n● 逆勢 (停止買入)：\n   即使分數 >20，但月線斜率 <0 時，\n   表示趨勢向下，應停止買入。`
                      : `【評分標準】\n總分 100 由以下加權計算：\n\n1. FIBO 位階 (35%)：\n   0.382為最高分，各區間內線性分配。\n\n2. 歷史起伏 (20%)：\n   斜率位階低檔 (超跌)，線性給分。\n\n3. 趨勢綜合 (20%)：\n   MA/MACD/DMI 多頭排列。\n\n4. 震盪指標 (20%)：\n   RSI/KD 低檔背離給分。\n\n5. 波動風險 (5%)：\n   觸及布林下軌。\n\n【各階段評語】\n● >50分：強力買進\n   多項指標同步看多，適合積極進場。\n\n● 40~50分：分批佈局\n   趨勢轉強但仍有風險，建議分批買入。\n\n● 20~40分：中性觀察\n   市場方向不明，建議等待更明確訊號。\n\n● <20分：觀望\n   多項指標偏弱，不建議進場。\n\n【霸王條款】\n● 逆勢 (停止買入)：\n   即使分數 >20，但季線斜率 <0 時，\n   表示趨勢向下，應停止買入。`;
                    showInfo(e, 'buy', '買入評分模型', infoText);
                  }}
                >
                  <Info size={14}/>
                </button>
              </div>
              <div className="space-y-3">
                {renderScoreBar(
                  `FIBO 位階 (${analysis?.fiboMaxScore || 35}%)`, 
                  analysis?.scores.fibo.buy || 0, 
                  analysis?.fiboMaxScore || 35, 
                  'bg-emerald-500'
                )}
                {renderScoreBar(
                  is3231 ? '歷史起伏 (不列入評分)' : '歷史起伏 (20%)', 
                  analysis?.scores.slope.buy || 0, 
                  is3231 ? 0 : 20, 
                  'bg-emerald-500'
                )}
                {renderScoreBar(
                  is3231 
                    ? `趨勢綜合 (${(analysis?.maMaxScore || 10) + (analysis?.macdMaxScore || 5)}%)` 
                    : `趨勢綜合 (${(analysis?.maMaxScore || 7) + (analysis?.macdMaxScore || 7) + 6}%)`, 
                  is3231
                    ? (analysis?.scores.ma.buy + analysis?.scores.macd.buy || 0)
                    : (analysis?.scores.ma.buy + analysis?.scores.macd.buy + analysis?.scores.dmi.buy || 0), 
                  is3231
                    ? ((analysis?.maMaxScore || 10) + (analysis?.macdMaxScore || 5))
                    : ((analysis?.maMaxScore || 7) + (analysis?.macdMaxScore || 7) + 6), 
                  'bg-emerald-500'
                )}
                {renderScoreBar(
                  `震盪指標 (${(analysis?.rsiMaxScore || (is3231 ? 25 : 10)) + (analysis?.kdMaxScore || (is3231 ? 25 : 10))}%)`, 
                  analysis?.scores.osc.buy || 0, 
                  (analysis?.rsiMaxScore || (is3231 ? 25 : 10)) + (analysis?.kdMaxScore || (is3231 ? 25 : 10)), 
                  'bg-emerald-500'
                )}
                {renderScoreBar(
                  `波動風險 (${analysis?.bbMaxScore || (is3231 ? 30 : 5)}%)`, 
                  analysis?.scores.bb.buy || 0, 
                  analysis?.bbMaxScore || (is3231 ? 30 : 5), 
                  'bg-emerald-500'
                )}
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
                <div className="text-xs text-rose-400 font-black uppercase">風險權重分析</div>
                <button 
                  className="p-1 text-neutral-600 hover:text-white"
                  onClick={(e) => {
                    const bbWeight = analysis?.bbMaxScore || 5;
                    const infoText = stockSymbol === '3231'
                      ? `【評分標準】\n總分 100 由以下加權計算：\n\n1. 布林通道 (30%)：\n   短線波段策略，線性給分。\n   %B > 1.0：30分 (突破上軌滿分)\n   0.9 < %B <= 1.0：25→30分 (線性)\n   假突破：20分\n   (移除爆量保護，有賺就跑)\n\n2. KD 隨機指標 (25%)：\n   短線轉折指標。\n   K>80 直接滿分賣出，70 < K <= 80 分批調節。\n   無鈍化保護，有賺就跑。\n\n3. RSI 相對強弱 (25%)：\n   短線震盪指標。\n   RSI>75 直接滿分賣出，60 < RSI <= 75 分批調節。\n   頂背離直接滿分。\n\n4. MA 乖離 (10%)：\n   MA20月線：正乖離過大獲利了結，跌破月線停利/停損。\n\n5. FIBO 壓力 (5%)：\n   短線波段版，20日箱型。\n   最高價 >= ext1272：5分\n   最高價 >= maxPrice：3分\n   價格 < maxPrice：0分\n\n6. MACD 動能 (5%)：\n   動能上攻無力，綠柱收斂即給分。\n\n(註：斜率與 DMI 不列入評分，專注短線轉折)\n\n【賣出分數門檻】\n● >60分：清倉賣出 (Clear Out)\n   100% 全跑。過熱警報。\n   代表「突破布林上軌 + KD/RSI 鈍化」。\n   短線肉已被吃光，隨時會回檔，不要留戀。\n\n● >40分：獲利調節 (Trim)\n   賣出 50% 持股。止盈點。\n   只要有賺且分數超過 40 分（代表碰到上軌壓力），\n   先收一半現金進口袋，剩下的一半設移動停利。\n\n● ≤40分：續抱\n   不動。股價還在從底部往上爬的過程中，\n   還沒碰到天花板。`
                      : `【評分標準】\n總分 100 由以下加權計算：\n\n1. FIBO 壓力 (35%)：\n   接近 1.618 擴展位滿分。\n\n2. 歷史噴發 (20%)：\n   斜率位階 > 90% (過熱)，線性給分。\n\n3. 趨勢乖離 (20%)：\n   乖離過大或指標轉弱。\n\n4. 震盪過熱 (20%)：\n   RSI/KD 高檔鈍化。\n\n5. 波動極端 (5%)：\n   觸及布林上軌。\n\n【各階段評語】\n● >55分：清倉賣出\n   多項指標同步看空，建議全部出清。\n\n● 40~55分：調節警戒\n   風險上升但仍有上漲空間，建議減碼。\n\n● ≤40分：續抱\n   風險可控，可繼續持有。\n\n【霸王條款】\n● 破線 (強制停損)：\n   價格跌破 FIBO 0.618 位階時，\n   無論分數多少，都應立即停損。`;
                    showInfo(e, 'sell', '賣出評分模型', infoText);
                  }}
                >
                  <Info size={14}/>
                </button>
              </div>
              <div className="space-y-3">
                {renderScoreBar(
                  `FIBO 壓力 (${analysis?.fiboMaxScore || 35}%)`, 
                  analysis?.scores.fibo.sell || 0, 
                  analysis?.fiboMaxScore || 35, 
                  'bg-rose-500'
                )}
                {renderScoreBar(
                  is3231 ? '歷史噴發 (不列入評分)' : '歷史噴發 (20%)', 
                  analysis?.scores.slope.sell || 0, 
                  is3231 ? 0 : 20, 
                  'bg-rose-500'
                )}
                {renderScoreBar(
                  is3231 
                    ? `趨勢乖離 (${(analysis?.maMaxScore || 10) + (analysis?.macdMaxScore || 5)}%)` 
                    : `趨勢乖離 (${(analysis?.maMaxScore || 7) + (analysis?.macdMaxScore || 7) + 6}%)`, 
                  is3231
                    ? (analysis?.scores.ma.sell + analysis?.scores.macd.sell || 0)
                    : (analysis?.scores.ma.sell + analysis?.scores.macd.sell + analysis?.scores.dmi.sell || 0), 
                  is3231
                    ? ((analysis?.maMaxScore || 10) + (analysis?.macdMaxScore || 5))
                    : ((analysis?.maMaxScore || 7) + (analysis?.macdMaxScore || 7) + 6), 
                  'bg-rose-500'
                )}
                {renderScoreBar(
                  `震盪過熱 (${(analysis?.rsiMaxScore || (is3231 ? 25 : 10)) + (analysis?.kdMaxScore || (is3231 ? 25 : 10))}%)`, 
                  analysis?.scores.osc.sell || 0, 
                  (analysis?.rsiMaxScore || (is3231 ? 25 : 10)) + (analysis?.kdMaxScore || (is3231 ? 25 : 10)), 
                  'bg-rose-500'
                )}
                {renderScoreBar(
                  `波動極端 (${analysis?.bbMaxScore || (is3231 ? 30 : 5)}%)`, 
                  analysis?.scores.bb.sell || 0, 
                  analysis?.bbMaxScore || (is3231 ? 30 : 5), 
                  'bg-rose-500'
                )}
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
              className={`p-4 sm:p-6 rounded-2xl sm:rounded-[2.5rem] border-2 transition-all cursor-pointer shadow-lg flex flex-col h-[461px] sm:h-[490px] overflow-hidden
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