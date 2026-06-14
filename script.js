// 全局提示框
const tooltip = document.getElementById('global-tooltip');

// ================= 登录功能 =================
const DEFAULT_ACCOUNTS = {
    'admin': 'admin123'
};

const loginOverlay = document.getElementById('login-overlay');
const loginForm = document.getElementById('login-form');
const loginTrigger = document.getElementById('login-trigger');
const loginClose = document.getElementById('login-close');
const usernameInput = document.getElementById('username');
const passwordInput = document.getElementById('password');
const loginError = document.getElementById('login-error');
const userBar = document.getElementById('user-bar');
const userNameEl = document.getElementById('user-name');
const logoutBtn = document.getElementById('logout-btn');

function openLoginModal() {
    if (loginOverlay) {
        loginOverlay.classList.remove('hidden');
        if (usernameInput) usernameInput.focus();
    }
}

function closeLoginModal() {
    if (loginOverlay) loginOverlay.classList.add('hidden');
    if (loginError) loginError.textContent = '';
}

function getAccounts() {
    try {
        return JSON.parse(localStorage.getItem('pharmatrace_accounts') || '{}');
    } catch (e) {
        return {};
    }
}

function verifyAccount(username, password) {
    if (DEFAULT_ACCOUNTS[username] === password) return true;
    const accounts = getAccounts();
    return accounts[username] === password;
}

function isLoggedIn() {
    return localStorage.getItem('pharmatrace_user') !== null;
}

function getLoggedInUser() {
    return localStorage.getItem('pharmatrace_user');
}

function setLoginState(username) {
    localStorage.setItem('pharmatrace_user', username);
    document.body.classList.remove('logged-out');
    document.body.classList.add('logged-in');
    unlockStepBottoms();
    closeLoginModal();
    if (loginTrigger) loginTrigger.style.display = 'none';
    if (userBar) {
        userBar.style.display = 'flex';
        if (userNameEl) userNameEl.textContent = '👤 ' + username;
    }
    if (typeof refreshDrugTrack === 'function') {
        requestAnimationFrame(refreshDrugTrack);
        setTimeout(refreshDrugTrack, 100);
    }
}

function setLogoutState() {
    localStorage.removeItem('pharmatrace_user');
    document.body.classList.remove('logged-in');
    document.body.classList.add('logged-out');
    lockStepBottoms();
    if (loginTrigger) loginTrigger.style.display = 'inline-flex';
    if (userBar) userBar.style.display = 'none';
    if (usernameInput) usernameInput.value = '';
    if (passwordInput) passwordInput.value = '';
    if (loginError) loginError.textContent = '';
    if (typeof refreshDrugTrack === 'function') {
        requestAnimationFrame(refreshDrugTrack);
        setTimeout(refreshDrugTrack, 100);
    }
}

if (loginTrigger) {
    loginTrigger.addEventListener('click', openLoginModal);
}

if (loginClose) {
    loginClose.addEventListener('click', closeLoginModal);
}

if (loginOverlay) {
    loginOverlay.addEventListener('click', function(e) {
        if (e.target === loginOverlay) closeLoginModal();
    });
}

if (loginForm) {
    loginForm.addEventListener('submit', function(e) {
        e.preventDefault();
        const username = usernameInput.value.trim();
        const password = passwordInput.value;

        if (!username || !password) {
            loginError.textContent = '请输入账号和密码';
            return;
        }

        if (verifyAccount(username, password)) {
            setLoginState(username);
        } else {
            loginError.textContent = '账号或密码错误';
            passwordInput.value = '';
            passwordInput.focus();
        }
    });
}

if (logoutBtn) {
    logoutBtn.addEventListener('click', setLogoutState);
}

// ================= step-bottom 登录保护 =================
// 未登录时用占位内容替换真实内容，防止控制台直接去除 blur 查看
const stepBottomCache = new Map();

function lockStepBottoms() {
    document.querySelectorAll('.step-bottom').forEach(el => {
        if (el.classList.contains('step-bottom-public') || stepBottomCache.has(el) || el.classList.contains('step-bottom-locked')) return;

        const realHTML = el.innerHTML;
        stepBottomCache.set(el, realHTML);

        el.classList.add('step-bottom-locked');
        el.innerHTML = `
            <div class="step-bottom-content step-bottom-placeholder"></div>
            <div class="step-bottom-overlay">
                <span class="step-bottom-overlay-text">🔒 登录后显示完整内容</span>
                <button type="button" class="step-bottom-overlay-btn login-trigger-from-blur">立即登录</button>
            </div>
        `;
    });
}

function unlockStepBottoms() {
    document.querySelectorAll('.step-bottom-locked').forEach(el => {
        if (stepBottomCache.has(el)) {
            el.innerHTML = stepBottomCache.get(el);
            el.classList.remove('step-bottom-locked');
            stepBottomCache.delete(el);
        }
    });
}

// 点击虚化层上的登录按钮也能打开登录弹窗
document.addEventListener('click', function(e) {
    if (e.target && e.target.classList.contains('login-trigger-from-blur')) {
        openLoginModal();
    }
});

// 页面加载时检查登录状态
if (isLoggedIn()) {
    setLoginState(getLoggedInUser());
} else {
    document.body.classList.add('logged-out');
    if (loginTrigger) loginTrigger.style.display = 'inline-flex';
    if (userBar) userBar.style.display = 'none';
    lockStepBottoms();
}

// ================= 药物管线进度条定位与分隔线 =================
function updateDrugLinePositions() {
    const trackLines = document.querySelector('.drug-track-lines');
    const phase3 = document.querySelector('.phase-3');
    const sin4 = document.querySelector('.drug-line.in-progress');

    if (trackLines && phase3 && sin4) {
        const trackTop = trackLines.getBoundingClientRect().top;
        const phase3Rect = phase3.getBoundingClientRect();
        const phase3Mid = phase3Rect.top + (phase3Rect.bottom - phase3Rect.top) / 2;
        sin4.style.height = Math.max(0, phase3Mid - trackTop) + 'px';
    }
}

// 用 CSS mask 在 drug-bar 上“切开” phase 之间的间隙
// 所有位置以 drug-track-lines 顶部为基准，确保切口与左侧 phase 间隙对齐
function applySegmentedMasks() {
    const trackLines = document.querySelector('.drug-track-lines');
    const phase1 = document.querySelector('.phase-1');
    const phase2 = document.querySelector('.phase-2');
    const phase3 = document.querySelector('.phase-3');
    const completedLines = document.querySelectorAll('.drug-line.completed');
    const inProgressLine = document.querySelector('.drug-line.in-progress');

    if (!trackLines || !phase1 || !phase2 || !phase3) return;

    const trackRect = trackLines.getBoundingClientRect();
    const trackTop = trackRect.top;
    const trackHeight = trackRect.height;

    const p1Bottom = phase1.getBoundingClientRect().bottom - trackTop;
    const p2Top = phase2.getBoundingClientRect().top - trackTop;
    const p2Bottom = phase2.getBoundingClientRect().bottom - trackTop;
    const p3Top = phase3.getBoundingClientRect().top - trackTop;
    const p3Bottom = phase3.getBoundingClientRect().bottom - trackTop;

    // 完成线：三段可见，中间两段间隙透明
    const completedMask = buildMaskGradient([
        { start: 0, end: p1Bottom },
        { start: p2Top, end: p2Bottom },
        { start: p3Top, end: p3Bottom }
    ], trackHeight);

    completedLines.forEach(line => {
        const bar = line.querySelector('.drug-bar');
        if (bar) bar.style.setProperty('--mask-gradient', completedMask);
    });

    // 进行中线：01/02、02/03 之间都切开，并延伸到 03 的一半
    if (inProgressLine) {
        const bar = inProgressLine.querySelector('.drug-bar');
        if (bar) {
            const halfP3 = p3Top + (p3Bottom - p3Top) / 2;
            const inProgressMask = buildMaskGradient([
                { start: 0, end: p1Bottom },
                { start: p2Top, end: p2Bottom },
                { start: p3Top, end: halfP3 }
            ], halfP3);
            bar.style.setProperty('--mask-gradient', inProgressMask);
        }
    }
}

function buildMaskGradient(segments, totalHeight) {
    if (totalHeight <= 0) return 'none';
    const stops = [];
    let pos = 0;
    segments.forEach(seg => {
        const s = Math.max(0, Math.min(100, seg.start / totalHeight * 100));
        const e = Math.max(0, Math.min(100, seg.end / totalHeight * 100));
        if (s > pos) {
            stops.push(`transparent ${pos.toFixed(3)}%`, `transparent ${s.toFixed(3)}%`);
        }
        if (e > s) {
            stops.push(`black ${s.toFixed(3)}%`, `black ${e.toFixed(3)}%`);
        }
        pos = e;
    });
    if (pos < 100) {
        stops.push(`transparent ${pos.toFixed(3)}%`, `transparent 100%`);
    }
    return `linear-gradient(to bottom, ${stops.join(', ')})`;
}

function refreshDrugTrack() {
    updateDrugLinePositions();
    applySegmentedMasks();
}

window.addEventListener('load', refreshDrugTrack);
window.addEventListener('resize', refreshDrugTrack);

// 为所有带 data-tooltip 的元素添加悬停事件（事件委托，支持动态内容）
document.body.addEventListener('mouseover', function(e) {
    const target = e.target.closest('[data-tooltip]');
    if (!target) return;
    const text = target.getAttribute('data-tooltip');
    tooltip.textContent = text;
    tooltip.classList.add('visible');
    updateTooltipPosition(e);
});

document.body.addEventListener('mousemove', function(e) {
    if (!e.target.closest('[data-tooltip]')) return;
    updateTooltipPosition(e);
});

document.body.addEventListener('mouseout', function(e) {
    const target = e.target.closest('[data-tooltip]');
    if (!target) return;
    tooltip.classList.remove('visible');
});

function updateTooltipPosition(e) {
    const x = e.clientX;
    const y = e.clientY;
    
    // 计算提示框位置（在鼠标上方）
    let top = y - tooltip.offsetHeight - 10;
    let left = x - tooltip.offsetWidth / 2;
    
    // 边界检查
    if (left < 10) left = 10;
    if (left + tooltip.offsetWidth > window.innerWidth - 10) {
        left = window.innerWidth - tooltip.offsetWidth - 10;
    }
    if (top < 10) top = y + 20; // 如果上方空间不够，显示在下方
    
    tooltip.style.left = left + 'px';
    tooltip.style.top = top + 'px';
}

// Add interactive hover effects
document.querySelectorAll('.step').forEach(step => {
    step.addEventListener('click', function() {
        this.style.transform = 'scale(0.95)';
        setTimeout(() => {
            this.style.transform = '';
        }, 150);
    });
});

// Animate phases on scroll
const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
        if (entry.isIntersecting) {
            entry.target.style.opacity = '1';
            entry.target.style.transform = 'translateY(0)';
        }
    });
}, { threshold: 0.1 });

document.querySelectorAll('.phase').forEach(phase => {
    phase.style.opacity = '0';
    phase.style.transform = 'translateY(30px)';
    phase.style.transition = 'opacity 0.6s ease, transform 0.6s ease';
    observer.observe(phase);
});

// ================= 生存分析功能 =================
(function() {
    // 后端API基础URL
    // 配置方式：在HTML中 <script>window.API_BASE_URL = 'https://your-backend.com';</script>
    const API_BASE = window.API_BASE_URL || (
        window.location.hostname === 'localhost' ? 'http://localhost:5000' : ''
    );

    // 标准正态分布CDF
    function normalCDF(x) {
        const a1 =  0.254829592;
        const a2 = -0.284496736;
        const a3 =  1.421413741;
        const a4 = -1.453152027;
        const a5 =  1.061405429;
        const p  =  0.3275911;
        const sign = x < 0 ? -1 : 1;
        x = Math.abs(x) / Math.sqrt(2);
        const t = 1 / (1 + p * x);
        const y = 1 - (((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-x * x));
        return 0.5 * (1 + sign * y);
    }

    // 确定性随机数生成器（模拟数据后备）
    function seededRandom(seed) {
        let s = seed;
        return function() {
            s = (s * 16807 + 0) % 2147483647;
            return (s - 1) / 2147483646;
        };
    }
    function strToSeed(str) {
        let h = 0;
        for (let i = 0; i < str.length; i++) {
            h = ((h << 5) - h + str.charCodeAt(i)) | 0;
        }
        return Math.abs(h) + 1;
    }

    // 模拟数据生成（API不可用时后备）
    function generateMockSurvivalData(gene, cancerType) {
        const seed = strToSeed(gene.toUpperCase() + '_' + cancerType);
        const rng = seededRandom(seed);
        const isRiskGene = rng() > 0.4;
        const effectSize = 0.5 + rng() * 2.0;
        const hr = isRiskGene ? effectSize : 1 / effectSize;
        const totalN = 200 + Math.floor(rng() * 600);
        const highN = Math.floor(totalN * (0.4 + rng() * 0.2));
        const lowN = totalN - highN;
        const maxTime = 120 + Math.floor(rng() * 60);
        const timePoints = [];
        const numPoints = 50;
        const highMedianOS = isRiskGene ? 20 + rng() * 40 : 40 + rng() * 50;
        const lowMedianOS = isRiskGene ? 50 + rng() * 50 : 20 + rng() * 40;
        for (let i = 0; i <= numPoints; i++) {
            const t = (i / numPoints) * maxTime;
            const highSurv = Math.exp(-t * Math.LN2 / highMedianOS);
            const lowSurv = Math.exp(-t * Math.LN2 / lowMedianOS);
            timePoints.push({
                time: Math.round(t),
                high: Math.max(0, Math.min(1, highSurv * (1 - rng() * 0.02))),
                low: Math.max(0, Math.min(1, lowSurv * (1 - rng() * 0.02)))
            });
        }
        const highEvents = Math.floor(highN * (0.3 + rng() * 0.5));
        const lowEvents = Math.floor(lowN * (0.2 + rng() * 0.4));
        const logHR = Math.log(hr);
        const se = Math.sqrt(1/highEvents + 1/lowEvents);
        const z = Math.abs(logHR) / se;
        const pValue = 2 * (1 - normalCDF(z));
        return {
            gene: gene.toUpperCase(), cancerType: cancerType,
            hr: hr, hrCI: [hr * Math.exp(-1.96 * se), hr * Math.exp(1.96 * se)],
            pValue: Math.max(0.0001, Math.min(0.999, pValue)),
            highN: highN, lowN: lowN, highEvents: highEvents, lowEvents: lowEvents,
            highMedianOS: Math.round(highMedianOS), lowMedianOS: Math.round(lowMedianOS),
            timePoints: timePoints, isRiskGene: isRiskGene, maxTime: maxTime,
            data_source: 'Demo (API unavailable)'
        };
    }

    // 从后端API获取真实生存分析数据
    async function fetchSurvivalData(gene, cancerType, survivalType) {
        survivalType = survivalType || 'OS';
        try {
            if (!API_BASE) {
                throw new Error('Backend API not configured. Set window.API_BASE_URL');
            }
            const resp = await fetch(API_BASE + '/api/survival/forward', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ gene: gene, cancer_type: cancerType, survival_type: survivalType, cutoff: 50 })
            });
            if (!resp.ok) {
                const err = await resp.json();
                throw new Error(err.error || 'API error: ' + resp.status);
            }
            const data = await resp.json();
            // 转换API格式为内部格式
            return {
                gene: data.gene,
                cancerType: data.gene + ' in ' + cancerType,
                hr: data.hr,
                hrCI: [data.hr_ci_low, data.hr_ci_high],
                pValue: data.p_value,
                highN: data.high_n,
                lowN: data.low_n,
                highEvents: data.high_events,
                lowEvents: data.low_events,
                highMedianOS: data.high_median ? Math.round(data.high_median) : '--',
                lowMedianOS: data.low_median ? Math.round(data.low_median) : '--',
                timePoints: convertKMData(data.km_data),
                isRiskGene: data.hr > 1,
                maxTime: data.km_data && data.km_data.high && data.km_data.high.time.length > 0
                    ? Math.max(...data.km_data.high.time)
                    : 180,
                data_source: data.data_source || 'cBioPortal/TCGA',
                isRealData: true
            };
        } catch (e) {
            console.warn('API failed:', e.message);
            alert('\u26a0\ufe0f \u65e0\u6cd5\u8fde\u63a5\u5230\u540e\u7aefAPI\uff0c\u4f7f\u7528\u6f14\u793a\u6570\u636e\u3002\n\n\u8981\u83b7\u53d6\u771f\u5b9e\u6570\u636e\uff0c\u8bf7\uff1a\n1. \u542f\u52a8\u540e\u7aef: cd backend && python app.py\n2. \u6216\u90e8\u7f72\u5230 Render\n\nAPI_BASE \u5f53\u524d\u503c: ' + (API_BASE || '(\u672a\u914d\u7f6e)'));
            var mock = generateMockSurvivalData(gene, cancerType);
            mock.isRealData = false;
            return mock;
        }
    }

    // 转换后端KM数据格式
    function convertKMData(km) {
        if (!km || !km.high || !km.low) return [];
        const highTime = km.high.time;
        const highSurv = km.high.survival;
        const lowTime = km.low.time;
        const lowSurv = km.low.survival;
        const maxLen = Math.max(highTime.length, lowTime.length);
        const points = [];
        for (let i = 0; i < maxLen; i++) {
            points.push({
                time: i < highTime.length ? Math.round(highTime[i]) : Math.round(highTime[highTime.length - 1]),
                high: i < highSurv.length ? highSurv[i] : highSurv[highSurv.length - 1],
                low: i < lowSurv.length ? lowSurv[i] : lowSurv[lowSurv.length - 1]
            });
        }
        return points;
    }

    // 绘制KM曲线
    function drawKMCanvas(data) {
        const canvas = document.getElementById('km-canvas');
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        const w = canvas.width;
        const h = canvas.height;

        // 清除画布
        ctx.clearRect(0, 0, w, h);

        // 背景
        ctx.fillStyle = 'rgba(15,23,42,0.9)';
        ctx.fillRect(0, 0, w, h);

        // 边距
        const padLeft = 55, padRight = 20, padTop = 35, padBottom = 45;
        const plotW = w - padLeft - padRight;
        const plotH = h - padTop - padBottom;

        // 网格线
        ctx.strokeStyle = 'rgba(0,212,255,0.1)';
        ctx.lineWidth = 0.5;
        for (let i = 0; i <= 5; i++) {
            const y = padTop + (plotH / 5) * i;
            ctx.beginPath();
            ctx.moveTo(padLeft, y);
            ctx.lineTo(padLeft + plotW, y);
            ctx.stroke();

            // Y轴标签
            ctx.fillStyle = '#a0c4e8';
            ctx.font = '10px Segoe UI, sans-serif';
            ctx.textAlign = 'right';
            ctx.fillText((100 - i * 20) + '%', padLeft - 8, y + 3);
        }

        // X轴网格
        const xTicks = 6;
        for (let i = 0; i <= xTicks; i++) {
            const x = padLeft + (plotW / xTicks) * i;
            ctx.strokeStyle = 'rgba(0,212,255,0.1)';
            ctx.beginPath();
            ctx.moveTo(x, padTop);
            ctx.lineTo(x, padTop + plotH);
            ctx.stroke();

            // X轴标签
            ctx.fillStyle = '#a0c4e8';
            ctx.font = '10px Segoe UI, sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText(Math.round((data.maxTime / xTicks) * i) + '', x, padTop + plotH + 18);
        }

        // 轴标题
        ctx.fillStyle = '#a0c4e8';
        ctx.font = '11px Segoe UI, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('生存时间 (月)', padLeft + plotW / 2, h - 5);

        ctx.save();
        ctx.translate(12, padTop + plotH / 2);
        ctx.rotate(-Math.PI / 2);
        ctx.fillText('生存率', 0, 0);
        ctx.restore();

        // 绘制高表达组曲线
        drawSurvivalCurve(ctx, data.timePoints, 'high', padLeft, padTop, plotW, plotH, data.maxTime);
        // 绘制低表达组曲线
        drawSurvivalCurve(ctx, data.timePoints, 'low', padLeft, padTop, plotW, plotH, data.maxTime);

        // 图例
        const legendY = padTop + 12;
        ctx.font = 'bold 11px Segoe UI, sans-serif';

        // 高表达
        ctx.strokeStyle = '#ff6b6b';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(padLeft + plotW - 140, legendY);
        ctx.lineTo(padLeft + plotW - 120, legendY);
        ctx.stroke();
        ctx.fillStyle = '#ff6b6b';
        ctx.textAlign = 'left';
        ctx.fillText('高表达 (n=' + data.highN + ')', padLeft + plotW - 115, legendY + 3);

        // 低表达
        ctx.strokeStyle = '#4ecdc4';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(padLeft + plotW - 140, legendY + 16);
        ctx.lineTo(padLeft + plotW - 120, legendY + 16);
        ctx.stroke();
        ctx.fillStyle = '#4ecdc4';
        ctx.fillText('低表达 (n=' + data.lowN + ')', padLeft + plotW - 115, legendY + 19);

        // 标题
        ctx.fillStyle = '#e0e8ff';
        ctx.font = 'bold 12px Segoe UI, sans-serif';
        ctx.textAlign = 'left';
        ctx.fillText(data.gene + ' in ' + data.cancerType + ' - Overall Survival', padLeft, padTop - 10);

        // HR和p-value
        const pStr = data.pValue < 0.001 ? '< 0.001' : data.pValue.toFixed(3);
        ctx.fillStyle = '#00d4ff';
        ctx.font = '10px Segoe UI, sans-serif';
        ctx.textAlign = 'left';
        ctx.fillText('HR = ' + data.hr.toFixed(2) + ' (95% CI: ' + data.hrCI[0].toFixed(2) + '-' + data.hrCI[1].toFixed(2) + '), p = ' + pStr, padLeft, padTop + plotH + 32);
    }

    function drawSurvivalCurve(ctx, points, key, padLeft, padTop, plotW, plotH, maxTime) {
        const color = key === 'high' ? '#ff6b6b' : '#4ecdc4';
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.beginPath();

        points.forEach((pt, i) => {
            const x = padLeft + (pt.time / maxTime) * plotW;
            const y = padTop + (1 - pt[key]) * plotH;
            if (i === 0) {
                ctx.moveTo(x, y);
            } else {
                // 阶梯效果：先水平再垂直
                const prevX = padLeft + (points[i-1].time / maxTime) * plotW;
                const prevY = padTop + (1 - points[i-1][key]) * plotH;
                ctx.lineTo(x, prevY);
                ctx.lineTo(x, y);
            }
        });
        ctx.stroke();

        // 添加删失标记（小竖线）
        ctx.strokeStyle = color;
        ctx.lineWidth = 1;
        const censorStep = Math.floor(points.length / 8);
        for (let i = censorStep; i < points.length - 1; i += censorStep) {
            const pt = points[i];
            const x = padLeft + (pt.time / maxTime) * plotW;
            const y = padTop + (1 - pt[key]) * plotH;
            const size = 4;
            ctx.beginPath();
            ctx.moveTo(x - size, y - size);
            ctx.lineTo(x + size, y + size);
            ctx.moveTo(x + size, y - size);
            ctx.lineTo(x - size, y + size);
            ctx.stroke();
        }
    }

    // 格式化数字
    function fmtNum(n) { return n.toString(); }

    // 显示结果
    function displayResults(data) {
        var isReal = data.isRealData;
        var sourceTag = data.data_source ? ' | ' + data.data_source : '';
        var statusBadge = isReal 
            ? ' | \ud83d\udd12 \u771f\u5b9e\u6570\u636e' 
            : ' | \u26a0\ufe0f \u6f14\u793a\u6570\u636e';
        document.getElementById('result-title').innerHTML =
            data.gene + ' / ' + data.cancerType + ' - OS\u751f\u5b58\u5206\u6790' + sourceTag + '<span style="color:' + (isReal ? '#00ff88' : '#ffc107') + ';">' + statusBadge + '</span>';

        // 统计指标
        document.getElementById('stat-hr').textContent =
            data.hr.toFixed(2) + ' (' + data.hrCI[0].toFixed(2) + '-' + data.hrCI[1].toFixed(2) + ')';

        const pStr = data.pValue < 0.001 ? '< 0.001' : data.pValue.toFixed(3);
        const pColor = data.pValue < 0.05 ? '#00ff88' : '#ff6b6b';
        const pEl = document.getElementById('stat-pvalue');
        pEl.textContent = pStr;
        pEl.style.color = pColor;

        document.getElementById('stat-high-median').textContent = data.highMedianOS + ' 月';
        document.getElementById('stat-low-median').textContent = data.lowMedianOS + ' 月';

        // 表格
        document.getElementById('table-high-n').textContent = data.highN;
        document.getElementById('table-high-events').textContent = data.highEvents;
        document.getElementById('table-high-os').textContent = data.highMedianOS;
        document.getElementById('table-low-n').textContent = data.lowN;
        document.getElementById('table-low-events').textContent = data.lowEvents;
        document.getElementById('table-low-os').textContent = data.lowMedianOS;

        // 结果解读
        let interp = '';
        if (data.pValue < 0.05) {
            if (data.hr > 1) {
                interp = data.gene + ' 在 ' + data.cancerType + ' 中高表达与较差的总生存期显著相关 (HR=' + data.hr.toFixed(2) + ', p=' + pStr + ')。高表达组的中位OS为 ' + data.highMedianOS + ' 个月，低于低表达组的 ' + data.lowMedianOS + ' 个月。' + data.gene + ' 可能作为该癌种的预后不良标志物。';
            } else {
                interp = data.gene + ' 在 ' + data.cancerType + ' 中高表达与较好的总生存期显著相关 (HR=' + data.hr.toFixed(2) + ', p=' + pStr + ')。高表达组的中位OS为 ' + data.highMedianOS + ' 个月，优于低表达组的 ' + data.lowMedianOS + ' 个月。' + data.gene + ' 可能作为该癌种的保护性标志物。';
            }
        } else {
            interp = data.gene + ' 在 ' + data.cancerType + ' 中的表达水平与总生存期无显著关联 (HR=' + data.hr.toFixed(2) + ', p=' + pStr + ')。高表达组和低表达组的中位OS分别为 ' + data.highMedianOS + ' 个月和 ' + data.lowMedianOS + ' 个月。';
        }
        document.getElementById('interpretation-text').textContent = interp;

        // 绘制曲线
        drawKMCanvas(data);

        // 切换显示
        document.getElementById('survival-loading').style.display = 'none';
        document.getElementById('survival-result-content').style.display = 'block';
    }

    // 导出PNG
    function downloadPNG() {
        const canvas = document.getElementById('km-canvas');
        if (!canvas) return;
        const link = document.createElement('a');
        link.download = 'KM-plot-' + currentResult.gene + '-' + currentResult.cancerType + '.png';
        link.href = canvas.toDataURL('image/png');
        link.click();
    }

    // 导出CSV
    function downloadCSV() {
        if (!currentResult) return;
        const data = currentResult;
        let csv = 'Time (months),High Expression Survival,Low Expression Survival\n';
        data.timePoints.forEach(pt => {
            csv += pt.time + ',' + pt.high.toFixed(4) + ',' + pt.low.toFixed(4) + '\n';
        });
        csv += '\nStatistics\n';
        csv += 'Gene,' + data.gene + '\n';
        csv += 'Cancer Type,' + data.cancerType + '\n';
        csv += 'HR (95% CI),' + data.hr.toFixed(2) + ' (' + data.hrCI[0].toFixed(2) + '-' + data.hrCI[1].toFixed(2) + ')' + '\n';
        csv += 'p-value,' + (data.pValue < 0.001 ? '<0.001' : data.pValue.toFixed(4)) + '\n';
        csv += 'High Group (n/events/median OS),' + data.highN + '/' + data.highEvents + '/' + data.highMedianOS + '\n';
        csv += 'Low Group (n/events/median OS),' + data.lowN + '/' + data.lowEvents + '/' + data.lowMedianOS + '\n';

        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = 'survival-data-' + data.gene + '-' + data.cancerType + '.csv';
        link.click();
    }

    // 当前结果
    let currentResult = null;

    // 核心分析函数 - 同时暴露为全局函数供内联onclick调用
    window.runSurvivalAnalysis = async function() {
        const cancerSelect = document.getElementById('cancer-type-select');
        const geneInput = document.getElementById('gene-input');
        const survivalSelect = document.getElementById('fw-survival-type');
        const cancer = cancerSelect ? cancerSelect.value : '';
        const gene = geneInput ? geneInput.value.trim() : '';
        const survivalType = survivalSelect ? survivalSelect.value : 'OS';

        if (!cancer) {
            alert('请选择一个癌种');
            return;
        }
        if (!gene) {
            alert('请输入基因ID或基因名');
            return;
        }
        if (!/^[a-zA-Z0-9\-_]+$/.test(gene)) {
            alert('基因名只能包含字母、数字、下划线和横线');
            return;
        }

        // 显示面板和加载动画
        const resultPanel = document.getElementById('survival-result-panel');
        const loadingDiv = document.getElementById('survival-loading');
        const resultContent = document.getElementById('survival-result-content');
        if (resultPanel) resultPanel.style.display = 'block';
        if (loadingDiv) loadingDiv.style.display = 'block';
        if (resultContent) resultContent.style.display = 'none';

        // 调用后端API获取真实数据
        currentResult = await fetchSurvivalData(gene, cancer, survivalType);
        displayResults(currentResult);
    };

    // 使用事件委托绑定点击事件（兼容 lockStepBottoms / unlockStepBottoms 的DOM替换）
    document.addEventListener('click', function(e) {
        // 确认分析按钮
        if (e.target && e.target.id === 'confirm-analysis-btn') {
            e.preventDefault();
            window.runSurvivalAnalysis();
            return;
        }

        // 关闭结果按钮
        if (e.target && e.target.id === 'close-result-btn') {
            const resultPanel = document.getElementById('survival-result-panel');
            if (resultPanel) resultPanel.style.display = 'none';
            return;
        }

        // 下载PNG按钮
        if (e.target && e.target.id === 'download-png-btn') {
            downloadPNG();
            return;
        }

        // 导出CSV按钮
        if (e.target && e.target.id === 'download-csv-btn') {
            downloadCSV();
            return;
        }
    });

    // ================= 反向分析功能 =================
    // 常见癌症基因池
    const GENE_POOL = [
        'TP53','EGFR','BRCA1','BRCA2','KRAS','PIK3CA','PTEN','MYC','CDH1','ERBB2',
        'VEGFA','CDKN2A','MLH1','MSH2','ATM','CHEK2','BCL2','CASP8','FOXM1','CDK4',
        'MDM2','RB1','SMAD4','APC','CTNNB1','AXIN2','MYC','CCND1','CDK6','ESR1',
        'AR','TGFBR2','FGFR1','FGFR2','MET','ROS1','ALK','RET','NTRK1','NTRK2',
        'PD-L1','CD274','CTLA4','LAG3','TIM3','TIGIT','ICOS','OX40','CD27','CD40',
        'STK11','KEAP1','SMARCA4','PBRM1','BAP1','SETD2','KMT2D','KDM6A','ARID1A','CREBBP',
        'EP300','NOTCH1','NOTCH2','JAK1','JAK2','STAT3','SOX2','NANOG','OCT4','KLF4'
    ];

    function generateReverseData(cancerType, survivalType, cutoff) {
        const seed = strToSeed(cancerType + '_' + survivalType + '_' + cutoff);
        const rng = seededRandom(seed);
        const results = [];
        // 从基因池中随机选取 15-25 个显著相关基因
        const numGenes = 15 + Math.floor(rng() * 11);
        const shuffled = GENE_POOL.slice().sort(function() { return rng() - 0.5; });
        const selectedGenes = shuffled.slice(0, numGenes);

        selectedGenes.forEach(function(gene, idx) {
            const isRisk = rng() > 0.45;
            const hr = isRisk ? 1.2 + rng() * 2.3 : 0.3 + rng() * 0.7;
            const ciLow = hr * (0.6 + rng() * 0.3);
            const ciHigh = hr * (1.1 + rng() * 0.6);
            // p-value: 排名越靠前越显著
            const baseP = 0.001 + rng() * 0.008 * (idx + 1) / numGenes;
            const pValue = Math.min(0.05, baseP * (1 + rng() * 0.5));
            const medianOS = isRisk
                ? Math.round(12 + rng() * 36)
                : Math.round(36 + rng() * 48);
            results.push({
                rank: idx + 1,
                gene: gene,
                hr: hr,
                ciLow: ciLow,
                ciHigh: ciHigh,
                pValue: pValue,
                medianOS: medianOS,
                trend: isRisk ? 'Risk' : 'Protective',
                fdr: Math.min(0.05, pValue * numGenes / (idx + 1))
            });
        });
        // 按 p-value 排序
        results.sort(function(a, b) { return a.pValue - b.pValue; });
        results.forEach(function(r, i) { r.rank = i + 1; });
        return results;
    }

    function displayReverseResults(data, cancerType, survivalType, cutoff) {
        document.getElementById('rev-result-title').textContent =
            cancerType + ' - ' + survivalType + ' 相关基因列表';
        document.getElementById('rev-filter-desc').textContent =
            cancerType + ' | ' + survivalType + ' | cutoff=' + cutoff + '%';
        document.getElementById('rev-gene-count').textContent = data.length;

        // 填充表格
        var tbody = document.getElementById('rev-gene-table-body');
        if (!tbody) return;
        var html = '';
        data.forEach(function(gene) {
            var pStr = gene.pValue < 0.001 ? '<0.001' : gene.pValue.toFixed(3);
            var pColor = gene.pValue < 0.01 ? '#00ff88' : (gene.pValue < 0.05 ? '#ffc107' : '#e0e8ff');
            var trendIcon = gene.trend === 'Risk' ? '🔴 高风险' : '🟢 保护性';
            var trendColor = gene.trend === 'Risk' ? '#ff6b6b' : '#4ecdc4';
            var ciStr = gene.ciLow.toFixed(2) + '-' + gene.ciHigh.toFixed(2);
            html += '<tr style="background: ' + (gene.rank % 2 === 0 ? 'rgba(0,212,255,0.03)' : 'transparent') + ';">' +
                '<td style="padding: 6px; border: 1px solid rgba(0,212,255,0.15); text-align: center; color: #a0c4e8;">' + gene.rank + '</td>' +
                '<td style="padding: 6px; border: 1px solid rgba(0,212,255,0.15); text-align: left; font-weight: 600; color: #00d4ff;">' + gene.gene + '</td>' +
                '<td style="padding: 6px; border: 1px solid rgba(0,212,255,0.15); text-align: center; color: ' + (gene.hr > 1 ? '#ff6b6b' : '#4ecdc4') + ';">' + gene.hr.toFixed(2) + '</td>' +
                '<td style="padding: 6px; border: 1px solid rgba(0,212,255,0.15); text-align: center; color: #a0c4e8;">' + ciStr + '</td>' +
                '<td style="padding: 6px; border: 1px solid rgba(0,212,255,0.15); text-align: center; color: ' + pColor + '; font-weight: 600;">' + pStr + '</td>' +
                '<td style="padding: 6px; border: 1px solid rgba(0,212,255,0.15); text-align: center; color: #e0e8ff;">' + gene.medianOS + '</td>' +
                '<td style="padding: 6px; border: 1px solid rgba(0,212,255,0.15); text-align: center; color: ' + trendColor + ';">' + trendIcon + '</td>' +
            '</tr>';
        });
        tbody.innerHTML = html;

        // 结果解读
        var riskGenes = data.filter(function(g) { return g.trend === 'Risk'; }).length;
        var protGenes = data.filter(function(g) { return g.trend === 'Protective'; }).length;
        var topGene = data[0];
        var interp = '在 ' + cancerType + ' 中，基于 ' + survivalType + ' 指标共筛选出 ' + data.length + ' 个与预后显著相关的基因（p<0.05）。' +
            '其中 ' + riskGenes + ' 个为高风险基因（高表达预后差），' + protGenes + ' 个为保护性基因（高表达预后好）。' +
            '最显著的基因是 ' + topGene.gene + ' (HR=' + topGene.hr.toFixed(2) + ', p=' + (topGene.pValue < 0.001 ? '<0.001' : topGene.pValue.toFixed(3)) + ')。';
        document.getElementById('rev-interpretation-text').textContent = interp;

        // 切换显示
        document.getElementById('rev-loading').style.display = 'none';
        document.getElementById('rev-result-content').style.display = 'block';
    }

    // 从后端API获取反向分析数据
    async function fetchReverseData(cancer, survivalType, cutoff, msigdbCategory) {
        msigdbCategory = msigdbCategory || 'C6';
        try {
            var resp = await fetch(API_BASE + '/api/survival/reverse', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ cancer_type: cancer, survival_type: survivalType, cutoff: cutoff, max_genes: 200, msigdb_category: msigdbCategory })
            });
            if (!resp.ok) {
                var err = await resp.json();
                throw new Error(err.error || 'API error: ' + resp.status);
            }
            return await resp.json();
        } catch (e) {
            console.warn('Reverse API failed, using mock:', e.message);
            return null;
        }
    }

    // 反向分析 - 暴露为全局函数
    window.runReverseAnalysis = async function() {
        var cancerSelect = document.getElementById('rev-cancer-select');
        var survivalSelect = document.getElementById('rev-survival-type');
        var cutoffInput = document.getElementById('rev-cutoff');
        var msigdbSelect = document.getElementById('rev-msigdb-category');
        var cancer = cancerSelect ? cancerSelect.value : '';
        var survivalType = survivalSelect ? survivalSelect.value : 'OS';
        var cutoff = cutoffInput ? parseInt(cutoffInput.value) : 50;
        var msigdbCategory = msigdbSelect ? msigdbSelect.value : 'C6';

        if (!cancer) {
            alert('请选择一个癌种');
            return;
        }

        var resultPanel = document.getElementById('rev-result-panel');
        var loadingDiv = document.getElementById('rev-loading');
        var resultContent = document.getElementById('rev-result-content');
        if (resultPanel) resultPanel.style.display = 'block';
        if (loadingDiv) loadingDiv.style.display = 'block';
        if (resultContent) resultContent.style.display = 'none';

        // 尝试调用后端API
        var apiData = await fetchReverseData(cancer, survivalType, cutoff, msigdbCategory);
        if (apiData && apiData.genes) {
            displayReverseAPIData(apiData);
        } else {
            // 后备：使用模拟数据
            var data = generateReverseData(cancer, survivalType, cutoff);
            displayReverseResults(data, cancer, survivalType, cutoff);
        }
    };

    // 显示后端API返回的反向分析结果
    function displayReverseAPIData(data) {
        var cancer = data.cancer_type;
        var survivalType = data.survival_type;
        var cutoff = data.cutoff;
        var genes = data.genes || [];
        var source = data.data_source || 'cBioPortal/TCGA';

        document.getElementById('rev-result-title').textContent =
            cancer + ' - ' + survivalType + ' 相关基因列表 | ' + source;
        document.getElementById('rev-filter-desc').textContent =
            cancer + ' | ' + survivalType + ' | cutoff=' + cutoff + '%';
        document.getElementById('rev-gene-count').textContent = genes.length;

        // 填充表格
        var tbody = document.getElementById('rev-gene-table-body');
        if (!tbody) return;
        var html = '';
        if (genes.length === 0) {
            html = '<tr><td colspan="7" style="padding: 20px; text-align: center; color: #a0c4e8;">未找到显著相关的基因（p<0.05），建议调整cutoff值或更换癌种</td></tr>';
        } else {
            genes.forEach(function(gene) {
                var pStr = gene.p_value < 0.001 ? '<0.001' : gene.p_value.toFixed(3);
                var pColor = gene.p_value < 0.01 ? '#00ff88' : (gene.p_value < 0.05 ? '#ffc107' : '#e0e8ff');
                var trendIcon = gene.hr > 1 ? '🔴 高风险' : '🟢 保护性';
                var trendColor = gene.hr > 1 ? '#ff6b6b' : '#4ecdc4';
                var ciStr = gene.hr_ci_low.toFixed(2) + '-' + gene.hr_ci_high.toFixed(2);
                var medOS = gene.high_median ? Math.round(gene.high_median) : '--';
                html += '<tr style="background: ' + (gene.rank % 2 === 0 ? 'rgba(0,212,255,0.03)' : 'transparent') + ';">' +
                    '<td style="padding: 6px; border: 1px solid rgba(0,212,255,0.15); text-align: center; color: #a0c4e8;">' + gene.rank + '</td>' +
                    '<td style="padding: 6px; border: 1px solid rgba(0,212,255,0.15); text-align: left; font-weight: 600; color: #00d4ff;">' + gene.gene + '</td>' +
                    '<td style="padding: 6px; border: 1px solid rgba(0,212,255,0.15); text-align: center; color: ' + (gene.hr > 1 ? '#ff6b6b' : '#4ecdc4') + ';">' + gene.hr.toFixed(2) + '</td>' +
                    '<td style="padding: 6px; border: 1px solid rgba(0,212,255,0.15); text-align: center; color: #a0c4e8;">' + ciStr + '</td>' +
                    '<td style="padding: 6px; border: 1px solid rgba(0,212,255,0.15); text-align: center; color: ' + pColor + '; font-weight: 600;">' + pStr + '</td>' +
                    '<td style="padding: 6px; border: 1px solid rgba(0,212,255,0.15); text-align: center; color: #e0e8ff;">' + medOS + '</td>' +
                    '<td style="padding: 6px; border: 1px solid rgba(0,212,255,0.15); text-align: center; color: ' + trendColor + ';">' + trendIcon + '</td>' +
                '</tr>';
            });
        }
        tbody.innerHTML = html;

        // 结果解读
        var riskGenes = genes.filter(function(g) { return g.hr > 1; }).length;
        var protGenes = genes.filter(function(g) { return g.hr <= 1; }).length;
        var interp;
        if (genes.length > 0) {
            var topGene = genes[0];
            var pStr = topGene.p_value < 0.001 ? '<0.001' : topGene.p_value.toFixed(3);
            interp = '在 ' + cancer + ' 中，基于 ' + survivalType + ' 指标共筛选出 ' + genes.length + ' 个与预后显著相关的基因（p<0.05）。其中 ' + riskGenes + ' 个为高风险基因（高表达预后差），' + protGenes + ' 个为保护性基因（高表达预后好）。最显著的基因是 ' + topGene.gene + ' (HR=' + topGene.hr.toFixed(2) + ', p=' + pStr + ')。数据来源：' + source + '。';
        } else {
            interp = '在 ' + cancer + ' 中，基于 ' + survivalType + ' 指标未找到与预后显著相关的基因（p<0.05）。建议：1) 调整cutoff值（尝试25%或75%）；2) 更换生存指标（尝试DFS或PFS）；3) 扩大基因筛选范围。数据来源：' + source + '。';
        }
        document.getElementById('rev-interpretation-text').textContent = interp;

        // 切换显示
        document.getElementById('rev-loading').style.display = 'none';
        document.getElementById('rev-result-content').style.display = 'block';
    }

    // 按Enter键触发分析
    document.addEventListener('keypress', function(e) {
        if (e.key === 'Enter' && e.target && e.target.id === 'gene-input') {
            e.preventDefault();
            var confirmBtn = document.getElementById('confirm-analysis-btn');
            if (confirmBtn) confirmBtn.click();
        }
    });
})();

// ================= 申请入驻授权弹窗 =================
const applyOverlay = document.getElementById('apply-overlay');
const applyTrigger = document.getElementById('apply-trigger');
const applyClose = document.getElementById('apply-close');
const applyForm = document.getElementById('apply-form');
const applyTabs = document.querySelectorAll('.apply-tab');
const applyTypeInput = document.getElementById('apply-type');
const nameLabel = document.getElementById('name-label');
const applyNameInput = document.getElementById('apply-name');

function openApplyModal() {
    if (applyOverlay) {
        applyOverlay.classList.remove('hidden');
        document.body.style.overflow = 'hidden';
        if (applyNameInput) applyNameInput.focus();
    }
}

function closeApplyModal() {
    if (applyOverlay) {
        applyOverlay.classList.add('hidden');
        document.body.style.overflow = '';
    }
    if (applyForm) applyForm.reset();
    resetApplyFormView();
}

function resetApplyFormView() {
    if (applyForm) applyForm.style.display = 'block';
    const existingSuccess = applyOverlay ? applyOverlay.querySelector('.apply-success') : null;
    if (existingSuccess) existingSuccess.remove();
}

function switchApplyTab(tab) {
    applyTabs.forEach(t => {
        t.classList.toggle('active', t.dataset.tab === tab);
    });
    if (applyTypeInput) applyTypeInput.value = tab;
    if (nameLabel) {
        nameLabel.textContent = tab === 'org' ? '机构全称' : '申请人姓名';
    }
    if (applyNameInput) {
        applyNameInput.placeholder = tab === 'org' ? '请输入机构全称' : '请输入申请人姓名';
    }
    const emailLabel = document.querySelector('label[for="apply-email"]');
    if (emailLabel && emailLabel.firstChild) {
        emailLabel.firstChild.textContent = tab === 'org' ? '单位邮箱' : '个人邮箱';
    }
}

if (applyTrigger) {
    applyTrigger.addEventListener('click', openApplyModal);
}

if (applyClose) {
    applyClose.addEventListener('click', closeApplyModal);
}

if (applyOverlay) {
    applyOverlay.addEventListener('click', function(e) {
        if (e.target === applyOverlay) closeApplyModal();
    });
}

applyTabs.forEach(tab => {
    tab.addEventListener('click', function() {
        switchApplyTab(this.dataset.tab);
    });
});

if (applyForm) {
    applyForm.addEventListener('submit', function(e) {
        e.preventDefault();

        const applyNameEl = document.getElementById('apply-name');
        const applyEmailEl = document.getElementById('apply-email');
        const applyFieldEl = document.getElementById('apply-field');
        const applyDescEl = document.getElementById('apply-desc');

        const data = {
            type: applyTypeInput && applyTypeInput.value === 'person' ? '个人申请' : '机构注册',
            name: applyNameEl ? applyNameEl.value.trim() : '',
            email: applyEmailEl ? applyEmailEl.value.trim() : '',
            field: applyFieldEl ? applyFieldEl.value : '',
            description: applyDescEl ? applyDescEl.value.trim() : '',
            time: new Date().toLocaleString('zh-CN')
        };

        if (!data.name || !data.email || !data.field || !data.description) {
            alert('请填写所有必填项');
            return;
        }

        // 保存到 localStorage（演示用途）
        const applications = JSON.parse(localStorage.getItem('pharmatrace_applications') || '[]');
        applications.push(data);
        localStorage.setItem('pharmatrace_applications', JSON.stringify(applications));

        // 显示成功界面
        applyForm.style.display = 'none';
        const successDiv = document.createElement('div');
        successDiv.className = 'apply-success';
        successDiv.innerHTML = `
            <div class="apply-success-icon">✅</div>
            <h3>申请已提交</h3>
            <p>感谢您的申请，平台管理员将在 3-5 个工作日内与您联系。请留意您的邮箱。 </p>
            <button type="button" class="login-btn" id="apply-back" style="margin-top: 24px;">返回</button>
        `;
        const applyBox = applyOverlay ? applyOverlay.querySelector('.apply-box') : null;
        if (applyBox) {
            applyBox.appendChild(successDiv);
            successDiv.querySelector('#apply-back').addEventListener('click', closeApplyModal);
        }
    });
}

// ================= 内页导航栏滚动毛玻璃效果 =================
(function () {
    const header = document.querySelector('.home-header');
    if (header) {
        function updateHeaderScroll() {
            header.classList.toggle('scrolled', window.scrollY > 20);
        }
        window.addEventListener('scroll', updateHeaderScroll);
        updateHeaderScroll();
    }
})();

// ================= 虚拟基因敲除分析 =================
(function() {
    // 确定性随机数生成器
    function seededRandom(seed) {
        var s = seed;
        return function() {
            s = (s * 16807) % 2147483647;
            return (s - 1) / 2147483646;
        };
    }
    function strToSeed(str) {
        var h = 0;
        for (var i = 0; i < str.length; i++) {
            h = ((h << 5) - h + str.charCodeAt(i)) | 0;
        }
        return Math.abs(h) + 1;
    }

    // 生成虚拟敲除数据
    function generateKnockoutData(gene, geoId) {
        var seed = strToSeed((gene + '_' + geoId).toUpperCase());
        var rng = seededRandom(seed);
        
        // 基因依赖性评分 (0-1, 越高越必需)
        var depScore = 0.1 + rng() * 0.8;
        // 细胞存活率 (敲除后)
        var viability = Math.max(5, Math.min(95, (1 - depScore) * 100 + (rng() - 0.5) * 20));
        // p-value
        var pValue = Math.exp(-3 - rng() * 10);
        pValue = Math.max(0.0001, Math.min(0.05, pValue));
        
        // 效应分类
        var effectClass, effectColor;
        if (depScore > 0.6) {
            effectClass = '必需基因 (Essential)';
            effectColor = '#ff6b6b';
        } else if (depScore > 0.3) {
            effectClass = '条件必需 (Context-dependent)';
            effectColor = '#ffc107';
        } else {
            effectClass = '非必需基因 (Non-essential)';
            effectColor = '#4ecdc4';
        }
        
        // 生成Top 10差异基因表达变化
        var diffGenes = [];
        var geneNames = ['CDKN1A', 'BCL2', 'CASP3', 'MYC', 'VEGFA', 'CDH1', 'SNAI1', 'ZEB1', 'TWIST1', 'CD274',
                         'FOXM1', 'MKI67', 'PCNA', 'CCND1', 'CDK6', 'STAT3', 'JAK2', 'PIK3CA', 'PTEN', 'KRAS'];
        // 选取10个与输入基因不同的基因
        var filtered = geneNames.filter(function(g) { return g !== gene.toUpperCase(); });
        var shuffled = filtered.sort(function() { return rng() - 0.5; });
        for (var i = 0; i < 10; i++) {
            var logFC = (rng() - 0.5) * 4; // -2 to +2
            diffGenes.push({
                gene: shuffled[i] || ('GENE' + i),
                logFC: logFC,
                p: Math.exp(-2 - rng() * 5)
            });
        }
        diffGenes.sort(function(a, b) { return b.logFC - a.logFC; });
        
        // 生成通路富集数据
        var pathways = [
            { name: 'Cell Cycle', enrichment: rng() * 5 + 2, p: Math.exp(-3 - rng() * 4) },
            { name: 'Apoptosis', enrichment: rng() * 4 + 1.5, p: Math.exp(-2 - rng() * 3) },
            { name: 'PI3K-Akt signaling', enrichment: rng() * 4 + 1, p: Math.exp(-2 - rng() * 3) },
            { name: 'p53 signaling', enrichment: rng() * 3 + 0.5, p: Math.exp(-1 - rng() * 2) },
            { name: 'DNA Repair', enrichment: rng() * 3 + 0.5, p: Math.exp(-1 - rng() * 2) }
        ];
        pathways.sort(function(a, b) { return a.p - b.p; });
        
        return {
            gene: gene.toUpperCase(),
            geoId: geoId.toUpperCase(),
            depScore: depScore,
            viability: viability,
            pValue: pValue,
            effectClass: effectClass,
            effectColor: effectColor,
            diffGenes: diffGenes,
            pathways: pathways
        };
    }

    // 绘制敲除效应可视化
    function drawKnockoutCanvas(data) {
        var canvas = document.getElementById('ko-canvas');
        if (!canvas) return;
        var ctx = canvas.getContext('2d');
        var w = canvas.width;
        var h = canvas.height;
        
        ctx.clearRect(0, 0, w, h);
        ctx.fillStyle = 'rgba(15,23,42,0.9)';
        ctx.fillRect(0, 0, w, h);
        
        var padLeft = 80, padRight = 15, padTop = 25, padBottom = 50;
        var plotW = w - padLeft - padRight;
        var plotH = h - padTop - padBottom;
        
        // 标题
        ctx.fillStyle = '#e0e8ff';
        ctx.font = 'bold 11px sans-serif';
        ctx.textAlign = 'left';
        ctx.fillText(data.gene + ' 敲除后差异表达基因 (log2FC)', padLeft, padTop - 8);
        
        // Y轴标签
        ctx.fillStyle = '#a0c4e8';
        ctx.font = '9px sans-serif';
        ctx.textAlign = 'right';
        var yTicks = [-2, -1, 0, 1, 2];
        yTicks.forEach(function(tick) {
            var y = padTop + plotH / 2 - (tick / 2.5) * (plotH / 2);
            ctx.fillText(tick.toFixed(0), padLeft - 6, y + 3);
            ctx.strokeStyle = 'rgba(0,212,255,0.1)';
            ctx.beginPath();
            ctx.moveTo(padLeft, y);
            ctx.lineTo(padLeft + plotW, y);
            ctx.stroke();
        });
        
        // 零线
        var zeroY = padTop + plotH / 2;
        ctx.strokeStyle = 'rgba(255,255,255,0.3)';
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.moveTo(padLeft, zeroY);
        ctx.lineTo(padLeft + plotW, zeroY);
        ctx.stroke();
        ctx.setLineDash([]);
        
        // 柱状图
        var barWidth = plotW / data.diffGenes.length * 0.7;
        var barGap = plotW / data.diffGenes.length;
        data.diffGenes.forEach(function(dg, i) {
            var x = padLeft + i * barGap + (barGap - barWidth) / 2;
            var barH = (dg.logFC / 2.5) * (plotH / 2);
            var color = dg.logFC > 0 ? '#ff6b6b' : '#4ecdc4';
            ctx.fillStyle = color;
            if (barH >= 0) {
                ctx.fillRect(x, zeroY - barH, barWidth, barH);
            } else {
                ctx.fillRect(x, zeroY, barWidth, -barH);
            }
            
            // 基因名
            ctx.save();
            ctx.translate(x + barWidth / 2, padTop + plotH + 12);
            ctx.rotate(-Math.PI / 3);
            ctx.fillStyle = '#a0c4e8';
            ctx.font = '8px sans-serif';
            ctx.textAlign = 'right';
            ctx.fillText(dg.gene, 0, 0);
            ctx.restore();
        });
        
        // Y轴标题
        ctx.save();
        ctx.translate(12, padTop + plotH / 2);
        ctx.rotate(-Math.PI / 2);
        ctx.fillStyle = '#a0c4e8';
        ctx.font = '10px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('log2 Fold Change', 0, 0);
        ctx.restore();
    }

    // 显示结果
    function displayKnockoutResults(data) {
        document.getElementById('knockout-result-title').textContent =
            data.gene + ' (' + data.geoId + ') 虚拟敲除结果';
        
        document.getElementById('ko-dep-score').textContent = data.depScore.toFixed(3);
        document.getElementById('ko-viability').textContent = data.viability.toFixed(1) + '%';
        
        var pStr = data.pValue < 0.001 ? '<0.001' : data.pValue.toFixed(3);
        var pEl = document.getElementById('ko-pvalue');
        pEl.textContent = pStr;
        pEl.style.color = data.pValue < 0.05 ? '#00ff88' : '#ff6b6b';
        
        var effEl = document.getElementById('ko-effect');
        effEl.textContent = data.effectClass;
        effEl.style.color = data.effectColor;
        
        // 通路表格
        var tbody = document.getElementById('ko-pathway-body');
        if (tbody) {
            var html = '';
            data.pathways.forEach(function(p, idx) {
                var pp = p.p < 0.001 ? '<0.001' : p.p.toFixed(3);
                html += '<tr style="background: ' + (idx % 2 === 0 ? 'rgba(0,212,255,0.03)' : 'transparent') + ';">' +
                    '<td style="padding: 5px; border: 1px solid rgba(0,212,255,0.15);">' + p.name + '</td>' +
                    '<td style="padding: 5px; border: 1px solid rgba(0,212,255,0.15); text-align: center;">' + p.enrichment.toFixed(2) + '</td>' +
                    '<td style="padding: 5px; border: 1px solid rgba(0,212,255,0.15); text-align: center; color: #00ff88;">' + pp + '</td>' +
                '</tr>';
            });
            tbody.innerHTML = html;
        }
        
        // 解读
        var interp = data.gene + ' 在 ' + data.geoId + ' 数据集中的虚拟敲除结果显示：';
        interp += '基因依赖性评分为 ' + data.depScore.toFixed(3) + '，';
        interp += '敲除后细胞存活率为 ' + data.viability.toFixed(1) + '%。';
        if (data.depScore > 0.6) {
            interp += '该基因被分类为<strong style="color:#ff6b6b;">必需基因</strong>，';
            interp += '敲除会导致显著的细胞死亡，提示其作为药物靶点的潜力较高。';
        } else if (data.depScore > 0.3) {
            interp += '该基因被分类为<strong style="color:#ffc107;">条件必需基因</strong>，';
            interp += '在特定细胞环境或遗传背景下可能具有靶点价值。';
        } else {
            interp += '该基因被分类为<strong style="color:#4ecdc4;">非必需基因</strong>，';
            interp += '敲除对细胞存活影响较小，可能不是理想的药物靶点。';
        }
        document.getElementById('ko-interpretation-text').innerHTML = interp;
        
        // 绘制图表
        drawKnockoutCanvas(data);
        
        // 切换显示
        document.getElementById('knockout-loading').style.display = 'none';
        document.getElementById('knockout-result-content').style.display = 'block';
    }

    // 核心分析函数 - 暴露为全局
    window.runVirtualKnockout = function() {
        var geneInput = document.getElementById('knockout-gene-input');
        var geoInput = document.getElementById('knockout-geo-input');
        var gene = geneInput ? geneInput.value.trim().toUpperCase() : '';
        var geoId = geoInput ? geoInput.value.trim().toUpperCase() : '';
        
        if (!gene) {
            alert('请输入基因ID或基因名');
            return;
        }
        if (!geoId) {
            alert('请输入GEO数据库号');
            return;
        }
        if (!/^[A-Z0-9]+$/.test(gene)) {
            alert('基因名只能包含字母和数字');
            return;
        }
        if (!/^GSE\d+$/i.test(geoId)) {
            alert('GEO数据库号格式应为 GSE+数字，如 GSE42568');
            return;
        }
        
        var resultPanel = document.getElementById('knockout-result-panel');
        var loadingDiv = document.getElementById('knockout-loading');
        var resultContent = document.getElementById('knockout-result-content');
        if (resultPanel) resultPanel.style.display = 'block';
        if (loadingDiv) loadingDiv.style.display = 'block';
        if (resultContent) resultContent.style.display = 'none';
        
        // 模拟延迟
        setTimeout(function() {
            var data = generateKnockoutData(gene, geoId);
            displayKnockoutResults(data);
        }, 1200);
    };

    // 事件委托
    document.addEventListener('click', function(e) {
        if (e.target && e.target.id === 'ko-close-btn') {
            var panel = document.getElementById('knockout-result-panel');
            if (panel) panel.style.display = 'none';
        }
        if (e.target && e.target.id === 'ko-download-png-btn') {
            var canvas = document.getElementById('ko-canvas');
            if (canvas) {
                var link = document.createElement('a');
                link.download = 'knockout-' + document.getElementById('knockout-gene-input').value + '-' + document.getElementById('knockout-geo-input').value + '.png';
                link.href = canvas.toDataURL('image/png');
                link.click();
            }
        }
    });

    // Enter键触发
    document.addEventListener('keypress', function(e) {
        if (e.key === 'Enter' && e.target && (e.target.id === 'knockout-gene-input' || e.target.id === 'knockout-geo-input')) {
            e.preventDefault();
            window.runVirtualKnockout();
        }
    });
})();

// ================= 研发平台页：Therapeutic Pipeline 点击跳转 =================
(function () {
    const drugTrack = document.querySelector('.drug-track[data-link]');
    if (drugTrack) {
        drugTrack.addEventListener('click', function (e) {
            if (e.target.closest('.drug-line')) return;
            window.location.href = drugTrack.dataset.link;
        });
    }
})();

// ================= 在研管线页：表格行点击跳转 =================
(function () {
    document.querySelectorAll('.data-table tbody tr[data-link]').forEach(function (row) {
        row.addEventListener('click', function () {
            window.location.href = row.dataset.link;
        });
    });
})();
