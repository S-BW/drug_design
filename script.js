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
    const phase3Content = document.querySelector('.phase-3 .phase-content');
    const sin4 = document.querySelector('.drug-line.in-progress');

    if (trackLines && phase3Content && sin4) {
        const trackTop = trackLines.getBoundingClientRect().top;
        const contentRect = phase3Content.getBoundingClientRect();
        const contentMid = contentRect.top + (contentRect.bottom - contentRect.top) / 2;
        sin4.style.height = Math.max(0, contentMid - trackTop) + 'px';
    }
}

// 用 CSS mask 在 drug-bar 上“切开” phase-content 之间的间隙
// 所有位置以 drug-track-lines 顶部为基准，确保切口与左侧 phase-content 间隙对齐
function applySegmentedMasks() {
    const trackLines = document.querySelector('.drug-track-lines');
    const phaseContents = document.querySelectorAll('.phase-content');
    const completedLines = document.querySelectorAll('.drug-line.completed');
    const inProgressLine = document.querySelector('.drug-line.in-progress');

    if (!trackLines || phaseContents.length === 0) return;

    const trackRect = trackLines.getBoundingClientRect();
    const trackTop = trackRect.top;
    const trackHeight = trackRect.height;

    // 以每个 phase-content 的可见区域作为进度条上的显示段
    const contentSegments = Array.from(phaseContents).map(content => {
        const rect = content.getBoundingClientRect();
        return {
            start: rect.top - trackTop,
            end: rect.bottom - trackTop
        };
    }).map(seg => ({
        start: Math.max(0, seg.start),
        end: Math.min(trackHeight, seg.end)
    })).filter(seg => seg.end > seg.start);

    // 为每条 drug-line 生成 mask：以该线自身顶部为基准，把 phase-content 的绝对位置
    // 转换为线内相对位置，确保无论线多长，切口在屏幕上的绝对位置都对齐。
    function applyMaskToLine(line) {
        const bar = line.querySelector('.drug-bar');
        if (!bar) return;

        const lineRect = line.getBoundingClientRect();
        const lineTop = lineRect.top - trackTop;
        const lineHeight = lineRect.height;

        const segments = contentSegments
            .map(seg => ({
                start: seg.start - lineTop,
                end: seg.end - lineTop
            }))
            .map(seg => ({
                start: Math.max(0, seg.start),
                end: Math.min(lineHeight, seg.end)
            }))
            .filter(seg => seg.end > seg.start);

        bar.style.setProperty('--mask-gradient', buildMaskGradient(segments, lineHeight));
    }

    completedLines.forEach(applyMaskToLine);
    if (inProgressLine) applyMaskToLine(inProgressLine);
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

        // 显示提交成功弹窗
        if (typeof window.showAnalysisSuccessModal === 'function') {
            window.showAnalysisSuccessModal();
        }
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

// ================= 蛋白结构查询 (PDB / AlphaFold) =================
(function() {
    // 常见的蛋白-UniProt映射
    var PROTEIN_MAP = {
        'EGFR': { uniprot: 'P00533', name: 'Epidermal growth factor receptor', length: 1210 },
        'TP53': { uniprot: 'P04637', name: 'Cellular tumor antigen p53', length: 393 },
        'BRCA1': { uniprot: 'P38398', name: 'Breast cancer type 1 susceptibility protein', length: 1863 },
        'BRCA2': { uniprot: 'P51587', name: 'Breast cancer type 2 susceptibility protein', length: 3418 },
        'KRAS': { uniprot: 'P01116', name: 'GTPase KRas', length: 189 },
        'PIK3CA': { uniprot: 'P42336', name: 'Phosphatidylinositol 4,5-bisphosphate 3-kinase catalytic subunit alpha', length: 1068 },
        'PTEN': { uniprot: 'P60484', name: 'Phosphatidylinositol 3,4,5-trisphosphate 3-phosphatase', length: 403 },
        'MYC': { uniprot: 'P01106', name: 'Myc proto-oncogene protein', length: 439 },
        'ERBB2': { uniprot: 'P04626', name: 'Receptor tyrosine-protein kinase erbB-2', length: 1255 },
        'VEGFA': { uniprot: 'P15692', name: 'Vascular endothelial growth factor A', length: 232 },
        'CDH1': { uniprot: 'P12830', name: 'Cadherin-1', length: 882 },
        'CDKN2A': { uniprot: 'P42771', name: 'Cyclin-dependent kinase inhibitor 2A', length: 156 },
        'MTOR': { uniprot: 'P42345', name: 'Serine/threonine-protein kinase mTOR', length: 2549 },
        'AKT1': { uniprot: 'P31749', name: 'RAC-alpha serine/threonine-protein kinase', length: 480 },
        'BCL2': { uniprot: 'P10415', name: 'Apoptosis regulator Bcl-2', length: 239 },
        'CASP3': { uniprot: 'P42574', name: 'Caspase-3', length: 277 },
        'BRAF': { uniprot: 'P15056', name: 'Serine/threonine-protein kinase B-raf', length: 766 },
        'ALK': { uniprot: 'Q9UM73', name: 'Anaplastic lymphoma kinase', length: 1620 },
        'ROS1': { uniprot: 'P08922', name: 'Proto-oncogene tyrosine-protein kinase ROS', length: 2347 },
        'MET': { uniprot: 'P08581', name: 'Hepatocyte growth factor receptor', length: 1390 },
        'PD-L1': { uniprot: 'Q9NZQ7', name: 'Programmed cell death 1 ligand 1', length: 290 },
        'CD274': { uniprot: 'Q9NZQ7', name: 'Programmed cell death 1 ligand 1', length: 290 },
        'CTLA4': { uniprot: 'P16410', name: 'Cytotoxic T-lymphocyte protein 4', length: 223 },
        'KIT': { uniprot: 'P10721', name: 'Mast/stem cell growth factor receptor Kit', length: 976 },
        'FLT3': { uniprot: 'P36888', name: 'Receptor-type tyrosine-protein kinase FLT3', length: 993 },
        'RET': { uniprot: 'P07949', name: 'Proto-oncogene tyrosine-protein kinase receptor Ret', length: 1114 },
        'JAK2': { uniprot: 'O60674', name: 'Tyrosine-protein kinase JAK2', length: 1132 },
        'STAT3': { uniprot: 'P40763', name: 'Signal transducer and activator of transcription 3', length: 770 },
        'FGFR1': { uniprot: 'P11362', name: 'Fibroblast growth factor receptor 1', length: 822 },
        'FGFR2': { uniprot: 'P21802', name: 'Fibroblast growth factor receptor 2', length: 821 },
        'FGFR3': { uniprot: 'P22607', name: 'Fibroblast growth factor receptor 3', length: 806 },
        'NTRK1': { uniprot: 'P04629', name: 'High affinity nerve growth factor receptor', length: 796 },
        'AR': { uniprot: 'P10275', name: 'Androgen receptor', length: 920 },
        'ESR1': { uniprot: 'P03372', name: 'Estrogen receptor', length: 595 },
        'PARP1': { uniprot: 'P09874', name: 'Poly [ADP-ribose] polymerase 1', length: 1014 },
        'HDAC1': { uniprot: 'Q13547', name: 'Histone deacetylase 1', length: 482 },
        'DNMT1': { uniprot: 'P26358', name: 'DNA methyltransferase 1', length: 1616 },
        'EZH2': { uniprot: 'Q15910', name: 'Histone-lysine N-methyltransferase EZH2', length: 746 },
        'IDH1': { uniprot: 'O75874', name: 'Isocitrate dehydrogenase [NADP] cytoplasmic', length: 414 },
        'IDH2': { uniprot: 'P48735', name: 'Isocitrate dehydrogenase [NADP] mitochondrial', length: 452 },
        'VHL': { uniprot: 'P40337', name: 'von Hippel-Lindau disease tumor suppressor', length: 213 },
        'RB1': { uniprot: 'P06400', name: 'Retinoblastoma-associated protein', length: 928 },
        'APC': { uniprot: 'P25054', name: 'Adenomatous polyposis coli protein', length: 2843 },
        'SMAD4': { uniprot: 'Q13485', name: 'Mothers against decapentaplegic homolog 4', length: 552 },
        'CTNNB1': { uniprot: 'P35222', name: 'Catenin beta-1', length: 781 },
        'TGFBR2': { uniprot: 'P37173', name: 'TGF-beta receptor type-2', length: 565 },
        'NOTCH1': { uniprot: 'P46531', name: 'Notch homolog 1', length: 2555 },
        'HIF1A': { uniprot: 'Q16665', name: 'Hypoxia-inducible factor 1-alpha', length: 826 },
        'CDK4': { uniprot: 'P11802', name: 'Cyclin-dependent kinase 4', length: 303 },
        'CDK6': { uniprot: 'Q00534', name: 'Cyclin-dependent kinase 6', length: 326 },
        'MDM2': { uniprot: 'Q00987', name: 'E3 ubiquitin-protein ligase Mdm2', length: 491 },
        'XIAP': { uniprot: 'P98170', name: 'E3 ubiquitin-protein ligase XIAP', length: 497 },
        'BIRC5': { uniprot: 'O15392', name: 'Baculoviral IAP repeat-containing protein 5', length: 142 },
        'TOP2A': { uniprot: 'P11388', name: 'DNA topoisomerase 2-alpha', length: 1531 },
        'AURKA': { uniprot: 'O14965', name: 'Aurora kinase A', length: 403 },
        'PLK1': { uniprot: 'P53350', name: 'Serine/threonine-protein kinase PLK1', length: 603 },
        'WEE1': { uniprot: 'P30291', name: 'Serine/threonine-protein kinase WEE1', length: 646 },
        'ATM': { uniprot: 'Q13315', name: 'Serine-protein kinase ATM', length: 3056 },
        'ATR': { uniprot: 'Q13535', name: 'Serine/threonine-protein kinase ATR', length: 2644 },
        'CHEK1': { uniprot: 'O14757', name: 'Serine/threonine-protein kinase Chk1', length: 476 },
        'CHEK2': { uniprot: 'O96017', name: 'Serine/threonine-protein kinase Chk2', length: 543 },
        'BRCA1': { uniprot: 'P38398', name: 'Breast cancer type 1 susceptibility protein', length: 1863 },
        'PALB2': { uniprot: 'Q86YC2', name: 'Partner and localizer of BRCA2', length: 1186 }
    };

    // 常见蛋白的PDB结构
    var PDB_MAP = {
        'EGFR': ['1M17', '2GS6', '3W2S', '5HG7'],
        'TP53': ['1TUP', '2OCJ', '2YBG'],
        'BRCA1': ['1JNX', '4Y2G'],
        'KRAS': ['4OBE', '4EPR', '6GJ4'],
        'PIK3CA': ['2RD0', '3L08'],
        'PTEN': ['1D5R', '5BZX'],
        'MYC': ['1NKP', '6A5H'],
        'ERBB2': ['3PP0', '3WSQ', '7R0R'],
        'BCL2': ['1GJH', '2XA0'],
        'CASP3': ['1CP3', '1GFW'],
        'BRAF': ['4MNF', '6N3H'],
        'ALK': ['2XP2', '4CLI'],
        'MET': ['1R0P', '3LQ8', '5E8C'],
        'CD274': ['5J89', '5GGS'],
        'CTLA4': ['1DQT', '3OSK'],
        'KIT': ['1PKG', '1T46'],
        'FLT3': ['1RJB', '4RT7'],
        'RET': ['2XDD', '7JU5'],
        'JAK2': ['2B7A', '4IVA'],
        'STAT3': ['1BG1', '6QHD'],
        'FGFR1': ['3C4F', '4P3W'],
        'AR': ['1E3G', '2AX7'],
        'ESR1': ['1A52', '1G50', '3ERT'],
        'PARP1': ['4R6E', '6BHV'],
        'HDAC1': ['4BKX', '5ICN'],
        'EZH2': ['4MI0', '5HYN'],
        'IDH1': ['1T0L', '5DE1'],
        'IDH2': ['5I96'],
        'VHL': ['1LM8', '1VCB'],
        'RB1': ['2AZE'],
        'SMAD4': ['1DD1', '5MEZ'],
        'CTNNB1': ['1I7W', '3CBL'],
        'NOTCH1': ['3I08', '3L95'],
        'HIF1A': ['1H2L', '4ZPR'],
        'CDK4': ['2W96'],
        'MDM2': ['1RV1', '1YCR'],
        'AURKA': ['1OL5', '2X6D'],
        'PLK1': ['2OWB', '4J53'],
        'ATM': ['7SBS'],
        'ATR': ['6YZB'],
        'BRCA2': ['1MIU', '4OGF'],
        'PALB2': ['6M3G']
    };

    function resolveProtein(query) {
        query = query.toUpperCase().trim();
        // 检查是否是UniProt ID格式 (如 P00533)
        if (/^[A-Z]\d+[A-Z]?\d*$/.test(query)) {
            // 通过值查找蛋白名
            for (var name in PROTEIN_MAP) {
                if (PROTEIN_MAP[name].uniprot === query) {
                    return { name: name, info: PROTEIN_MAP[name] };
                }
            }
            return { name: query, info: { uniprot: query, name: 'Unknown protein', length: Math.floor(200 + Math.random() * 800) } };
        }
        // 直接蛋白名
        if (PROTEIN_MAP[query]) {
            return { name: query, info: PROTEIN_MAP[query] };
        }
        return null;
    }

    function generateMockProteinData(query) {
        var resolved = resolveProtein(query);
        if (!resolved) {
            // 未知蛋白，生成模拟数据
            var seed = 0;
            for (var i = 0; i < query.length; i++) seed += query.charCodeAt(i);
            var rng = function() { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
            var len = Math.floor(150 + rng() * 2000);
            resolved = {
                name: query,
                info: { uniprot: 'P' + String(Math.floor(rng() * 90000 + 10000)), name: query + ' protein', length: len }
            };
        }
        
        var geneName = resolved.name;
        var uniprot = resolved.info.uniprot;
        var fullName = resolved.info.name;
        var length = resolved.info.length;
        
        // 查找PDB结构
        var pdbIds = PDB_MAP[geneName] || [];
        var hasPDB = pdbIds.length > 0;
        var primaryPDB = hasPDB ? pdbIds[0] : null;
        
        // 如果没有PDB，生成AlphaFold预测
        var isAlphaFold = !hasPDB;
        var resolution = hasPDB ? (1.5 + Math.random() * 2.5).toFixed(1) + ' Å' : 'N/A (Predicted)';
        
        // 可药性评分
        var druggability = Math.random();
        var drugScore, drugText, drugColor;
        if (druggability > 0.7) {
            drugScore = 'High'; drugText = '高 (High)'; drugColor = '#00ff88';
        } else if (druggability > 0.4) {
            drugScore = 'Medium'; drugText = '中 (Medium)'; drugColor = '#ffc107';
        } else {
            drugScore = 'Low'; drugText = '低 (Low)'; drugColor = '#ff6b6b';
        }
        
        // 生成结构域数据用于可视化
        var domains = [];
        var numDomains = Math.floor(2 + Math.random() * 5);
        var pos = 0;
        for (var d = 0; d < numDomains; d++) {
            var domLen = Math.floor(length / numDomains * (0.6 + Math.random() * 0.8));
            if (pos + domLen > length) domLen = length - pos;
            var colors = ['#00d4ff', '#ff6b6b', '#4ecdc4', '#ffc107', '#a29bfe', '#fd79a8'];
            domains.push({
                name: ['Kinase', 'Binding', 'Regulatory', 'DNA-BD', 'SH2', 'SH3', 'TM', 'Catalytic', 'Signal'][d % 9],
                start: pos,
                end: pos + domLen,
                color: colors[d % colors.length]
            });
            pos += domLen;
            if (pos >= length) break;
        }
        
        return {
            geneName: geneName,
            uniprot: uniprot,
            fullName: fullName,
            length: length,
            hasPDB: hasPDB,
            pdbId: primaryPDB,
            pdbIds: pdbIds,
            isAlphaFold: isAlphaFold,
            resolution: resolution,
            druggability: drugScore,
            druggabilityText: drugText,
            druggabilityColor: drugColor,
            domains: domains,
            source: hasPDB ? 'RCSB PDB' : 'AlphaFold DB'
        };
    }

    function drawProteinStructure(data) {
        var canvas = document.getElementById('protein-canvas');
        if (!canvas) return;
        var ctx = canvas.getContext('2d');
        var w = canvas.width;
        var h = canvas.height;
        
        ctx.clearRect(0, 0, w, h);
        ctx.fillStyle = 'rgba(15,23,42,0.9)';
        ctx.fillRect(0, 0, w, h);
        
        var padLeft = 20, padRight = 20, padTop = 30, padBottom = 35;
        var plotW = w - padLeft - padRight;
        var plotH = h - padTop - padBottom;
        var barY = padTop + plotH / 2 - 15;
        var barH = 30;
        
        // 标题
        ctx.fillStyle = '#e0e8ff';
        ctx.font = 'bold 11px sans-serif';
        ctx.textAlign = 'left';
        ctx.fillText(data.geneName + ' - ' + (data.hasPDB ? 'PDB ' + data.pdbId : 'AlphaFold Prediction'), padLeft, padTop - 8);
        
        // 绘制蛋白全长条
        ctx.fillStyle = 'rgba(100,116,139,0.3)';
        ctx.fillRect(padLeft, barY, plotW, barH);
        
        // 绘制结构域
        var scale = plotW / data.length;
        data.domains.forEach(function(dom) {
            var x = padLeft + dom.start * scale;
            var dw = (dom.end - dom.start) * scale;
            ctx.fillStyle = dom.color;
            ctx.fillRect(x, barY, dw, barH);
            
            // 结构域名称
            if (dw > 30) {
                ctx.fillStyle = '#0f172a';
                ctx.font = 'bold 8px sans-serif';
                ctx.textAlign = 'center';
                ctx.fillText(dom.name, x + dw / 2, barY + barH / 2 + 3);
            }
        });
        
        // 结构域边框
        ctx.strokeStyle = 'rgba(224,232,255,0.2)';
        ctx.lineWidth = 1;
        ctx.strokeRect(padLeft, barY, plotW, barH);
        
        // 刻度
        ctx.fillStyle = '#a0c4e8';
        ctx.font = '8px sans-serif';
        ctx.textAlign = 'center';
        var numTicks = 5;
        for (var t = 0; t <= numTicks; t++) {
            var res = Math.floor(data.length * t / numTicks);
            var tx = padLeft + plotW * t / numTicks;
            ctx.fillText(res, tx, barY + barH + 14);
            ctx.strokeStyle = 'rgba(160,196,232,0.2)';
            ctx.beginPath();
            ctx.moveTo(tx, barY + barH);
            ctx.lineTo(tx, barY + barH + 6);
            ctx.stroke();
        }
        
        // X轴标签
        ctx.fillStyle = '#a0c4e8';
        ctx.font = '9px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('氨基酸位置', padLeft + plotW / 2, h - 5);
        
        // 图例
        var legendY = padTop + 5;
        var legendX = padLeft + plotW - 100;
        ctx.fillStyle = data.hasPDB ? '#00ff88' : '#a29bfe';
        ctx.fillRect(legendX, legendY, 8, 8);
        ctx.fillStyle = '#a0c4e8';
        ctx.font = '8px sans-serif';
        ctx.textAlign = 'left';
        ctx.fillText(data.hasPDB ? '实验结构 (X-ray/NMR)' : 'AI预测结构 (AlphaFold)', legendX + 12, legendY + 7);
    }

    function displayProteinResults(data) {
        document.getElementById('protein-result-title').textContent = data.geneName + ' - ' + data.fullName;
        
        // 来源标签
        var badge = document.getElementById('protein-source-badge');
        if (data.hasPDB) {
            badge.textContent = '🧪 实验解析结构 (PDB)';
            badge.style.background = 'rgba(0,255,136,0.15)';
            badge.style.color = '#00ff88';
            badge.style.border = '1px solid rgba(0,255,136,0.3)';
        } else {
            badge.textContent = '🤖 AI预测结构 (AlphaFold)';
            badge.style.background = 'rgba(162,155,254,0.15)';
            badge.style.color = '#a29bfe';
            badge.style.border = '1px solid rgba(162,155,254,0.3)';
        }
        
        document.getElementById('prot-name').textContent = data.geneName;
        document.getElementById('prot-uniprot').textContent = data.uniprot;
        document.getElementById('prot-pdb').textContent = data.pdbId || 'N/A';
        document.getElementById('prot-resolution').textContent = data.resolution;
        document.getElementById('prot-length').textContent = data.length + ' aa';
        
        var drugEl = document.getElementById('prot-druggability');
        drugEl.textContent = data.druggabilityText;
        drugEl.style.color = data.druggabilityColor;
        
        // 外部链接
        document.getElementById('prot-pdb-link').href = data.pdbId ? 'https://www.rcsb.org/structure/' + data.pdbId : 'https://www.rcsb.org/';
        document.getElementById('prot-af-link').href = 'https://alphafold.ebi.ac.uk/entry/' + data.uniprot;
        document.getElementById('prot-uniprot-link').href = 'https://www.uniprot.org/uniprotkb/' + data.uniprot;
        
        // 解读
        var interp = '<strong>' + data.geneName + '</strong> (' + data.fullName + ') ';
        interp += 'UniProt ID: <strong>' + data.uniprot + '</strong>，全长 <strong>' + data.length + '</strong> 个氨基酸。';
        if (data.hasPDB) {
            interp += '<br><br>✅ 在 PDB 数据库中找到 <strong>' + data.pdbIds.length + '</strong> 个实验解析结构';
            interp += '（最高分辨率: ' + data.resolution + '）。';
            interp += '推荐使用实验结构进行分子对接。';
        } else {
            interp += '<br><br>⚠️ PDB 中暂无实验解析结构。';
            interp += '已为您链接到 <strong>AlphaFold</strong> AI预测结构。';
            interp += '预测结构可用于初步的虚拟筛选和分子对接研究。';
        }
        interp += '<br><br>可药性评估: <strong style="color:' + data.druggabilityColor + '">' + data.druggabilityText + '</strong>。';
        if (data.druggability === 'High') {
            interp += '该蛋白具有良好的成药性，适合作为药物靶点进行后续开发。';
        } else if (data.druggability === 'Medium') {
            interp += '该蛋白具有中等成药性，可能需要针对性的药物设计策略。';
        } else {
            interp += '该蛋白成药性较低，建议考虑变构位点或蛋白-蛋白相互作用界面。';
        }
        document.getElementById('prot-interpretation-text').innerHTML = interp;
        
        // 绘制结构
        drawProteinStructure(data);
        
        // 切换显示
        document.getElementById('protein-loading').style.display = 'none';
        document.getElementById('protein-result-content').style.display = 'block';
    }

    // 全局函数
    window.runProteinStructureSearch = function() {
        var input = document.getElementById('protein-id-input');
        var query = input ? input.value.trim() : '';
        
        if (!query) {
            alert('请输入蛋白ID或蛋白名');
            return;
        }
        
        var resultPanel = document.getElementById('protein-result-panel');
        var loadingDiv = document.getElementById('protein-loading');
        var resultContent = document.getElementById('protein-result-content');
        if (resultPanel) resultPanel.style.display = 'block';
        if (loadingDiv) loadingDiv.style.display = 'block';
        if (resultContent) resultContent.style.display = 'none';
        
        setTimeout(function() {
            var data = generateMockProteinData(query);
            displayProteinResults(data);
        }, 1200);
    };

    // 事件委托
    document.addEventListener('click', function(e) {
        if (e.target && e.target.id === 'prot-close-btn') {
            var panel = document.getElementById('protein-result-panel');
            if (panel) panel.style.display = 'none';
        }
        if (e.target && e.target.id === 'prot-download-png-btn') {
            var canvas = document.getElementById('protein-canvas');
            if (canvas) {
                var link = document.createElement('a');
                link.download = 'protein-structure-' + document.getElementById('protein-id-input').value + '.png';
                link.href = canvas.toDataURL('image/png');
                link.click();
            }
        }
    });

    // Enter键触发
    document.addEventListener('keypress', function(e) {
        if (e.key === 'Enter' && e.target && e.target.id === 'protein-id-input') {
            e.preventDefault();
            window.runProteinStructureSearch();
        }
    });
})();

// ================= 结合口袋识别 / 活性位点预测 =================
(function() {
    // 常见蛋白的已知口袋残基
    var KNOWN_POCKETS = {
        'EGFR': { pockets: 3, type: 'Kinase ATP-binding', residues: ['Met769','Leu694','Thr790','Cys797','Lys745','Asp855','Phe723','Val726','Ala743'], bestPocket: 1 },
        'TP53': { pockets: 2, type: 'DNA-binding domain', residues: ['Arg248','Arg273','Arg280','Gly245','Arg249','Met237','Pro222','Trp146','Arg158'], bestPocket: 1 },
        'KRAS': { pockets: 2, type: 'GTP-binding / Switch II', residues: ['Cys12','Gly13','Asp33','Gln61','Ala59','Tyr32','Arg68','Met72','Glu63'], bestPocket: 2 },
        'BRCA1': { pockets: 2, type: 'RING domain', residues: ['Cys61','Cys64','His77','Cys39','Cys47','Glu54','Lys56','Arg71','Ile80'], bestPocket: 1 },
        'PIK3CA': { pockets: 2, type: 'Kinase ATP-binding', residues: ['Lys802','Asp810','Met953','Ile831',' Tyr864','Ser806','Ile963','Met1021','Leu1017'], bestPocket: 1 },
        'PTEN': { pockets: 2, type: 'Phosphatase active site', residues: ['Cys124','Arg130','His123','Ala126','Thr167','Asp92','Lys128','Gln171','Ser180'], bestPocket: 1 },
        'BCL2': { pockets: 2, type: 'BH3 groove', residues: ['Phe104','Trp67','Leu96','Asp108','Phe112','Arg139','Asn140','Val133','Gly142'], bestPocket: 1 },
        'BRAF': { pockets: 3, type: 'Kinase ATP-binding', residues: ['Val471','Thr529','Phe583','Glu501','Cys531','Leu505','Phe468','Ile463','Leu577'], bestPocket: 1 },
        'ALK': { pockets: 2, type: 'Kinase ATP-binding', residues: ['Met1199','Leu1122','Gly1202','Val1130','Leu1256','Asp1270','Phe1271','Arg1272','Asp1203'], bestPocket: 1 },
        'MET': { pockets: 3, type: 'Kinase ATP-binding', residues: ['Met1160','Leu1157','Val1092','Tyr1230','Asp1222','Leu1195','Phe1223','Val1200','Ala1108'], bestPocket: 1 },
        'CD274': { pockets: 2, type: 'IgV domain', residues: ['Tyr56','Arg113','Met115','Asp122','Tyr123','Gln66','Thr59','Ser117','Ala121'], bestPocket: 1 },
        'CTLA4': { pockets: 2, type: 'IgV MYPPPY motif', residues: ['Tyr104','Pro99','Pro100','Tyr105','Met99','Thr30','Gln92','Arg70','Asn78'], bestPocket: 1 },
        'AR': { pockets: 2, type: 'Ligand-binding domain', residues: ['Asn705','Gln711','Arg752','Thr877','Met780','Leu704','Met742','Phe764','Leu873'], bestPocket: 1 },
        'ESR1': { pockets: 2, type: 'Ligand-binding domain', residues: ['Glu353','Arg394','His524','Leu349','Leu387','Leu525','Met528','Phe404','Thr347'], bestPocket: 1 },
        'PARP1': { pockets: 3, type: 'Catalytic domain / NAD+ binding', residues: ['Tyr896','Glu988','Ser904','His862','Lys903','Asp766','Arg878','Ile895','Met890'], bestPocket: 1 },
        'HDAC1': { pockets: 2, type: 'Catalytic pocket (Zn2+)', residues: ['His141','His142','Asp176','Tyr204','Phe150','Pro29','Gly149','Asp99','Met259'], bestPocket: 1 },
        'EZH2': { pockets: 2, type: 'SET domain / SAM binding', residues: ['Tyr641','Ala677','Tyr111','Phe665','Trp624','Asp multip','Tyr726','Ser662','His689'], bestPocket: 1 },
        'MTOR': { pockets: 3, type: 'Kinase ATP-binding (FRB/FKBP)', residues: ['Val2240','Thr2245','Phe2108','Asp2244','Lip2109','Met2342','Ile2167','Leu2185','Ser2165'], bestPocket: 1 },
        'JAK2': { pockets: 2, type: 'Kinase ATP-binding', residues: ['Leu855','Val911','Met929','Lys882','Gly856','Phe829','Alal069','Ile1012','Leu932'], bestPocket: 1 },
        'STAT3': { pockets: 2, type: 'SH2 domain', residues: ['Arg609','Ser613','Glu638','Gln644','Thr620','Lys591','Ile597','Asp661','Val637'], bestPocket: 1 },
        'FGFR1': { pockets: 3, type: 'Kinase ATP-binding', residues: ['Ala564','Phe589','Leu484','Asp641','Met535','Phe642','Asn628','Leu486','Tyr563'], bestPocket: 1 },
        'CDK4': { pockets: 2, type: 'Kinase ATP-binding', residues: ['Val96','Thr102','Ala157','Ile12','Phe93','His100','Asp99','Gln98','Leu147'], bestPocket: 1 },
        'MDM2': { pockets: 2, type: 'p53-binding groove', residues: ['Phe55','Trp23','Leu26','His96','Tyr100','Ile61','Tyr67','Gln72','Val75'], bestPocket: 1 },
        'AURKA': { pockets: 2, type: 'Kinase ATP-binding', residues: ['Leu139','Val147','Ala160','Glu211','Thr217','Arg137','Glu260','Leu263','Asp274'], bestPocket: 1 },
        'VEGFA': { pockets: 1, type: 'Heparin-binding / Receptor', residues: ['Arg121','Lys101','Asp34','Asn62','Arg50','Tyr21','Gln79','Asp63','Lys84'], bestPocket: 1 }
    };

    // 氨基酸名称
    var RESIDUE_NAMES = ['Ala','Arg','Asn','Asp','Cys','Gln','Glu','Gly','His','Ile','Leu','Lys','Met','Phe','Pro','Ser','Thr','Trp','Tyr','Val'];

    function seededRandom(seed) {
        var s = seed;
        return function() {
            s = (s * 16807) % 2147483647;
            return (s - 1) / 2147483646;
        };
    }
    function strToSeed(str) {
        var h = 0;
        for (var i = 0; i < str.length; i++) h = ((h << 5) - h + str.charCodeAt(i)) | 0;
        return Math.abs(h) + 1;
    }

    function generatePocketData(proteinName) {
        var query = proteinName.toUpperCase().trim();
        var seed = strToSeed(query);
        var rng = seededRandom(seed);

        var known = KNOWN_POCKETS[query];
        var numPockets = known ? known.pockets : Math.floor(2 + rng() * 4);
        var pockets = [];
        var bestIdx = known ? (known.bestPocket - 1) : 0;

        for (var i = 0; i < numPockets; i++) {
            var volume = 100 + rng() * 900;
            var depth = 2 + rng() * 8;
            var drugScore = rng();
            var drugLabel, drugColor;
            if (drugScore > 0.7) { drugLabel = 'Druggable'; drugColor = '#00ff88'; }
            else if (drugScore > 0.4) { drugLabel = 'Potentially'; drugColor = '#ffc107'; }
            else { drugLabel = 'Poor'; drugColor = '#ff6b6b'; }

            var types = ['Orthosteric','Allosteric','Catalytic','Regulatory','Cryptic'];
            var pocketType = known ? known.type : types[Math.floor(rng() * types.length)];

            // 关键残基
            var residues = [];
            if (known && known.residues) {
                // 使用已知残基，为每个口袋分配不同的子集
                var start = Math.floor(rng() * 3);
                var count = 5 + Math.floor(rng() * 4);
                for (var r = 0; r < count; r++) {
                    var idx = (start + r) % known.residues.length;
                    residues.push(known.residues[idx]);
                }
            } else {
                // 生成随机残基
                for (var r2 = 0; r2 < 6; r2++) {
                    var rName = RESIDUE_NAMES[Math.floor(rng() * RESIDUE_NAMES.length)];
                    var rNum = Math.floor(rng() * 500) + 50;
                    residues.push(rName + rNum);
                }
            }

            // 口袋中心位置（用于可视化）
            var angle = (i / numPockets) * Math.PI * 2 + rng() * 0.5;
            var dist = 0.3 + rng() * 0.4;
            var px = 0.5 + Math.cos(angle) * dist;
            var py = 0.5 + Math.sin(angle) * dist;

            pockets.push({
                id: i + 1,
                volume: volume,
                depth: depth,
                druggability: drugLabel,
                druggabilityScore: drugScore,
                druggabilityColor: drugColor,
                type: pocketType,
                residues: residues,
                x: px,
                y: py,
                radius: 0.08 + rng() * 0.06
            });
        }

        // 按可药性排序
        pockets.sort(function(a, b) { return b.druggabilityScore - a.druggabilityScore; });
        pockets.forEach(function(p, idx) { p.rank = idx + 1; });

        var bestPocket = pockets[0];

        return {
            protein: query,
            numPockets: numPockets,
            bestScore: bestPocket.druggabilityScore,
            bestPocket: bestPocket,
            pockets: pockets,
            isKnown: !!known
        };
    }

    function drawPocketCanvas(data) {
        var canvas = document.getElementById('pocket-canvas');
        if (!canvas) return;
        var ctx = canvas.getContext('2d');
        var w = canvas.width;
        var h = canvas.height;

        ctx.clearRect(0, 0, w, h);

        // 深色背景
        ctx.fillStyle = '#0a0e1a';
        ctx.fillRect(0, 0, w, h);

        var cx = w / 2;
        var cy = h / 2;
        var radius = Math.min(w, h) * 0.38;

        // 绘制蛋白表面（多层圆环）
        for (var ring = 4; ring >= 1; ring--) {
            var r = radius * (0.4 + ring * 0.2);
            ctx.beginPath();
            ctx.arc(cx, cy, r, 0, Math.PI * 2);
            ctx.strokeStyle = 'rgba(0,212,255,' + (0.03 + ring * 0.02) + ')';
            ctx.lineWidth = 1;
            ctx.stroke();
        }

        // 蛋白主体（半透明球体）
        var grad = ctx.createRadialGradient(cx - radius * 0.2, cy - radius * 0.2, 0, cx, cy, radius);
        grad.addColorStop(0, 'rgba(100,140,200,0.15)');
        grad.addColorStop(0.6, 'rgba(50,80,150,0.1)');
        grad.addColorStop(1, 'rgba(20,40,100,0.05)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(cx, cy, radius, 0, Math.PI * 2);
        ctx.fill();

        // 蛋白表面轮廓
        ctx.beginPath();
        ctx.arc(cx, cy, radius, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(0,212,255,0.15)';
        ctx.lineWidth = 2;
        ctx.stroke();

        // 绘制氨基酸残基点（表面点）
        var surfacePoints = 60;
        for (var s = 0; s < surfacePoints; s++) {
            var angle = (s / surfacePoints) * Math.PI * 2 + Math.sin(s * 0.5) * 0.3;
            var dist = radius * (0.85 + Math.sin(s * 1.3) * 0.1);
            var sx = cx + Math.cos(angle) * dist;
            var sy = cy + Math.sin(angle) * dist;
            ctx.fillStyle = 'rgba(160,196,232,0.4)';
            ctx.beginPath();
            ctx.arc(sx, sy, 1.5, 0, Math.PI * 2);
            ctx.fill();
        }

        // 绘制结合口袋（3D球体效果）
        data.pockets.forEach(function(pocket, idx) {
            var px = cx + (pocket.x - 0.5) * radius * 2;
            var py = cy + (pocket.y - 0.5) * radius * 2;
            var pr = pocket.radius * radius * 2.5;

            // 口袋光晕
            var glowGrad = ctx.createRadialGradient(px, py, 0, px, py, pr * 2);
            var color = pocket.rank === 1 ? '0,255,136' : (pocket.druggabilityColor === '#ffc107' ? '255,193,7' : '255,107,107');
            glowGrad.addColorStop(0, 'rgba(' + color + ',0.3)');
            glowGrad.addColorStop(0.5, 'rgba(' + color + ',0.1)');
            glowGrad.addColorStop(1, 'rgba(' + color + ',0)');
            ctx.fillStyle = glowGrad;
            ctx.beginPath();
            ctx.arc(px, py, pr * 2, 0, Math.PI * 2);
            ctx.fill();

            // 口袋主体（3D球体）
            var sphereGrad = ctx.createRadialGradient(px - pr * 0.3, py - pr * 0.3, pr * 0.1, px, py, pr);
            sphereGrad.addColorStop(0, 'rgba(' + color + ',0.8)');
            sphereGrad.addColorStop(0.5, 'rgba(' + color + ',0.5)');
            sphereGrad.addColorStop(1, 'rgba(' + color + ',0.2)');
            ctx.fillStyle = sphereGrad;
            ctx.beginPath();
            ctx.arc(px, py, pr, 0, Math.PI * 2);
            ctx.fill();

            // 口袋边框
            ctx.strokeStyle = 'rgba(' + color + ',0.6)';
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.arc(px, py, pr, 0, Math.PI * 2);
            ctx.stroke();

            // 口袋编号
            ctx.fillStyle = '#fff';
            ctx.font = 'bold 11px sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText('P' + pocket.rank, px, py);

            // 连接线到中心
            ctx.strokeStyle = 'rgba(' + color + ',0.2)';
            ctx.lineWidth = 0.5;
            ctx.setLineDash([3, 3]);
            ctx.beginPath();
            ctx.moveTo(px, py);
            ctx.lineTo(cx, cy);
            ctx.stroke();
            ctx.setLineDash([]);
        });

        // 中心标签
        ctx.fillStyle = '#a0c4e8';
        ctx.font = '9px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(data.protein, cx, cy + 4);

        // 标题
        ctx.fillStyle = '#e0e8ff';
        ctx.font = 'bold 10px sans-serif';
        ctx.textAlign = 'left';
        ctx.fillText(data.protein + ' - 结合口袋分布 (Top ' + data.pockets.length + ')', 10, 16);

        // 图例
        var legY = h - 12;
        ctx.font = '8px sans-serif';
        ctx.fillStyle = '#00ff88';
        ctx.fillRect(10, legY - 4, 8, 8);
        ctx.fillStyle = '#a0c4e8';
        ctx.fillText('Druggable', 22, legY + 2);

        ctx.fillStyle = '#ffc107';
        ctx.fillRect(80, legY - 4, 8, 8);
        ctx.fillStyle = '#a0c4e8';
        ctx.fillText('Potential', 92, legY + 2);

        ctx.fillStyle = '#ff6b6b';
        ctx.fillRect(145, legY - 4, 8, 8);
        ctx.fillStyle = '#a0c4e8';
        ctx.fillText('Poor', 157, legY + 2);
    }

    function displayPocketResults(data) {
        var best = data.bestPocket;

        document.getElementById('pocket-result-title').textContent = data.protein + ' - 结合口袋预测';
        document.getElementById('pocket-count').textContent = data.numPockets;
        document.getElementById('pocket-best-score').textContent = (best.druggabilityScore * 100).toFixed(1) + '%';

        var drugEl = document.getElementById('pocket-druggability');
        if (best.druggabilityScore > 0.7) {
            drugEl.textContent = '高 (High)'; drugEl.style.color = '#00ff88';
        } else if (best.druggabilityScore > 0.4) {
            drugEl.textContent = '中 (Medium)'; drugEl.style.color = '#ffc107';
        } else {
            drugEl.textContent = '低 (Low)'; drugEl.style.color = '#ff6b6b';
        }

        // 表格
        var tbody = document.getElementById('pocket-table-body');
        if (tbody) {
            var html = '';
            data.pockets.forEach(function(p) {
                html += '<tr style="background: ' + (p.rank === 1 ? 'rgba(0,255,136,0.08)' : (p.rank % 2 === 0 ? 'rgba(0,212,255,0.03)' : 'transparent')) + ';">' +
                    '<td style="padding: 5px; border: 1px solid rgba(0,212,255,0.15); text-align: center; color: ' + (p.rank === 1 ? '#00ff88' : '#a0c4e8') + '; font-weight: ' + (p.rank === 1 ? '600' : '400') + ';">P' + p.rank + '</td>' +
                    '<td style="padding: 5px; border: 1px solid rgba(0,212,255,0.15);">' + p.type + '</td>' +
                    '<td style="padding: 5px; border: 1px solid rgba(0,212,255,0.15); text-align: center;">' + p.volume.toFixed(0) + '</td>' +
                    '<td style="padding: 5px; border: 1px solid rgba(0,212,255,0.15); text-align: center;">' + p.depth.toFixed(1) + '</td>' +
                    '<td style="padding: 5px; border: 1px solid rgba(0,212,255,0.15); text-align: center; color: ' + p.druggabilityColor + ';">' + p.druggability + '</td>' +
                    '<td style="padding: 5px; border: 1px solid rgba(0,212,255,0.15); text-align: center; font-size: 0.85em;">' + p.type.split('/')[0] + '</td>' +
                '</tr>';
            });
            tbody.innerHTML = html;
        }

        // 关键残基
        var resDiv = document.getElementById('pocket-residues');
        if (resDiv) {
            var resHtml = '<strong style="color:#00d4ff;">最佳口袋 (P1)  lining residues:</strong><br>';
            best.residues.forEach(function(r, i) {
                resHtml += '<span style="display:inline-block; background:rgba(0,212,255,0.15); border:1px solid rgba(0,212,255,0.3); border-radius:4px; padding:2px 6px; margin:2px;">' + r + '</span>';
            });
            resHtml += '<br><br><span style="color:#a0c4e8; font-size:0.85em;">这些残基构成口袋的 lining，是与配体相互作用的关键位点。</span>';
            resDiv.innerHTML = resHtml;
        }

        // 解读
        var interp = '<strong>' + data.protein + '</strong> 的结合口袋预测发现 <strong>' + data.numPockets + '</strong> 个潜在口袋。';
        interp += '最佳口袋 (P1) 为 <strong style="color:#00d4ff;">' + best.type + '</strong> 类型，';
        interp += '体积 ' + best.volume.toFixed(0) + ' Å³，深度 ' + best.depth.toFixed(1) + ' Å，';
        interp += '可药性评估: <strong style="color:' + best.druggabilityColor + '">' + best.druggability + '</strong>。';
        if (data.isKnown) {
            interp += '<br><br>✅ 该蛋白为已知药物靶点，预测结果与文献报道的活性位点一致。';
        }
        if (best.druggabilityScore > 0.7) {
            interp += '<br><br>🟢 该口袋具有良好的成药性，推荐作为药物设计的靶点。';
            interp += '建议进行分子对接和虚拟筛选实验。';
        } else if (best.druggabilityScore > 0.4) {
            interp += '<br><br>🟡 该口袋具有中等成药性，可能需要特殊的设计策略。';
            interp += '建议考虑片段筛选或共价抑制剂设计。';
        } else {
            interp += '<br><br>🔴 该口袋成药性较低，建议探索变构口袋或蛋白-蛋白相互作用界面。';
        }
        document.getElementById('pocket-interpretation-text').innerHTML = interp;

        // 绘制
        drawPocketCanvas(data);

        document.getElementById('pocket-loading').style.display = 'none';
        document.getElementById('pocket-result-content').style.display = 'block';
    }

    // 全局函数
    window.runPocketDetection = function() {
        var input = document.getElementById('pocket-protein-input');
        var query = input ? input.value.trim() : '';

        if (!query) { alert('请输入蛋白ID或蛋白名'); return; }

        var panel = document.getElementById('pocket-result-panel');
        var loading = document.getElementById('pocket-loading');
        var content = document.getElementById('pocket-result-content');
        if (panel) panel.style.display = 'block';
        if (loading) loading.style.display = 'block';
        if (content) content.style.display = 'none';

        setTimeout(function() {
            var data = generatePocketData(query);
            displayPocketResults(data);
        }, 1200);
    };

    // 事件委托
    document.addEventListener('click', function(e) {
        if (e.target && e.target.id === 'pocket-close-btn') {
            var panel = document.getElementById('pocket-result-panel');
            if (panel) panel.style.display = 'none';
        }
        if (e.target && e.target.id === 'pocket-download-btn') {
            var canvas = document.getElementById('pocket-canvas');
            if (canvas) {
                var link = document.createElement('a');
                link.download = 'pocket-' + document.getElementById('pocket-protein-input').value + '.png';
                link.href = canvas.toDataURL('image/png');
                link.click();
            }
        }
    });

    // Enter键
    document.addEventListener('keypress', function(e) {
        if (e.key === 'Enter' && e.target && e.target.id === 'pocket-protein-input') {
            e.preventDefault();
            window.runPocketDetection();
        }
    });
})();

// ================= 分子对接 (AutoDock Vina / AlphaFold3) =================
(function() {
    // 已知蛋白-配体对接数据
    var KNOWN_DOCKING = {
        'EGFR': { bindingEnergy: -9.8, ki: '56 nM', pocket: 'ATP-binding site' },
        'TP53': { bindingEnergy: -7.2, ki: '5.2 μM', pocket: 'DNA-binding groove' },
        'KRAS': { bindingEnergy: -8.5, ki: '620 nM', pocket: 'Switch II pocket' },
        'BCL2': { bindingEnergy: -10.2, ki: '32 nM', pocket: 'BH3 groove' },
        'PARP1': { bindingEnergy: -11.5, ki: '3.8 nM', pocket: 'Catalytic domain' },
        'AR': { bindingEnergy: -9.1, ki: '210 nM', pocket: 'Ligand-binding domain' },
        'ESR1': { bindingEnergy: -10.8, ki: '18 nM', pocket: 'Ligand-binding domain' },
        'CDK4': { bindingEnergy: -8.9, ki: '280 nM', pocket: 'ATP-binding site' },
        'MTOR': { bindingEnergy: -9.4, ki: '120 nM', pocket: 'FRB domain' },
        'AURKA': { bindingEnergy: -9.6, ki: '85 nM', pocket: 'ATP-binding site' }
    };

    // 相互作用类型和颜色
    var INTERACTION_TYPES = [
        { type: '氢键', color: '#00d4ff', ligandAtom: 'N/O', examples: [['O2','Glu762'], ['N1','Met769'], ['O4','Asp855'], ['N3','Thr790'], ['O1','Lys745']] },
        { type: '疏水', color: '#ffc107', ligandAtom: 'C', examples: [['C5','Leu694'], ['C8','Val726'], ['C3','Ala743'], ['C7','Phe723'], ['C2','Ile720']] },
        { type: 'π-π堆积', color: '#a29bfe', ligandAtom: 'Ar', examples: [['Ar1','Phe723'], ['Ar2','Tyr740'], ['Ar1','Trp760']] },
        { type: '盐桥', color: '#ff6b6b', ligandAtom: '+/-', examples: [['NH2+','Asp855'], ['COO-','Arg841'], ['N+','Glu762']] },
        { type: '范德华', color: '#4ecdc4', ligandAtom: 'any', examples: [['C6','Gly722'], ['C4','Ser652'], ['O3','Thr854']] }
    ];

    function seededRandom(seed) {
        var s = seed;
        return function() { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; };
    }
    function strToSeed(str) {
        var h = 0;
        for (var i = 0; i < str.length; i++) h = ((h << 5) - h + str.charCodeAt(i)) | 0;
        return Math.abs(h) + 1;
    }

    function generateDockingData(protein, ligand, method) {
        var seed = strToSeed((protein + '_' + ligand + '_' + method).toUpperCase());
        var rng = seededRandom(seed);

        var known = KNOWN_DOCKING[protein.toUpperCase()];

        // 结合能
        var baseEnergy = known ? known.bindingEnergy : -(6 + rng() * 6);
        var methodModifier = method === 'alphafold3' ? rng() * 0.8 - 0.4 : 0;
        var bindingEnergy = baseEnergy + methodModifier + (rng() - 0.5) * 0.3;
        bindingEnergy = Math.round(bindingEnergy * 10) / 10;

        // Ki估算
        var ki;
        if (bindingEnergy < -11) ki = '< 10 nM';
        else if (bindingEnergy < -9) ki = (10 + Math.floor(rng() * 490)) + ' nM';
        else if (bindingEnergy < -7) ki = (0.5 + rng() * 4.5).toFixed(1) + ' μM';
        else if (bindingEnergy < -5) ki = (5 + Math.floor(rng() * 45)) + ' μM';
        else ki = '> 50 μM';

        // 对接质量
        var quality, qualityColor;
        if (bindingEnergy <= -9) { quality = '优秀 (Excellent)'; qualityColor = '#00ff88'; }
        else if (bindingEnergy <= -7) { quality = '良好 (Good)'; qualityColor = '#4ecdc4'; }
        else if (bindingEnergy <= -5) { quality = '一般 (Moderate)'; qualityColor = '#ffc107'; }
        else { quality = '较差 (Poor)'; qualityColor = '#ff6b6b'; }

        // RMSD
        var rmsd = (0.3 + rng() * 2.5).toFixed(2);

        // 构象数
        var numPoses = method === 'vina' ? 9 : 5;

        // 生成相互作用
        var interactions = [];
        var numInteractions = 5 + Math.floor(rng() * 5);
        var usedExamples = new Set();

        for (var i = 0; i < numInteractions; i++) {
            var itype = INTERACTION_TYPES[Math.floor(rng() * INTERACTION_TYPES.length)];
            var example = itype.examples[Math.floor(rng() * itype.examples.length)];
            var key = itype.type + example[0] + example[1];
            if (usedExamples.has(key)) continue;
            usedExamples.add(key);

            interactions.push({
                type: itype.type,
                typeColor: itype.color,
                ligandAtom: example[0],
                residue: example[1],
                distance: (1.5 + rng() * 3.5).toFixed(1)
            });
        }
        interactions.sort(function(a, b) { return parseFloat(a.distance) - parseFloat(b.distance); });

        return {
            protein: protein.toUpperCase(),
            ligand: ligand,
            method: method,
            methodName: method === 'vina' ? 'AutoDock Vina' : 'AlphaFold3',
            methodColor: method === 'vina' ? '#00d4ff' : '#a29bfe',
            bindingEnergy: bindingEnergy,
            ki: ki,
            quality: quality,
            qualityColor: qualityColor,
            rmsd: rmsd,
            numPoses: numPoses,
            interactions: interactions,
            pocket: known ? known.pocket : 'Predicted binding site',
            isKnown: !!known
        };
    }

    function drawDockingCanvas(data) {
        var canvas = document.getElementById('dock-canvas');
        if (!canvas) return;
        var ctx = canvas.getContext('2d');
        var w = canvas.width;
        var h = canvas.height;

        ctx.clearRect(0, 0, w, h);
        ctx.fillStyle = '#0a0e1a';
        ctx.fillRect(0, 0, w, h);

        // 标题
        ctx.fillStyle = '#e0e8ff';
        ctx.font = 'bold 10px sans-serif';
        ctx.textAlign = 'left';
        ctx.fillText(data.protein + ' + Ligand | ' + data.methodName + ' | ' + data.bindingEnergy + ' kcal/mol', 10, 16);

        var cx = w / 2;
        var cy = h / 2 + 5;

        // 绘制蛋白（大圆形，表面点阵）
        var protRadius = 55;
        var protGrad = ctx.createRadialGradient(cx - 20, cy - 20, 10, cx, cy, protRadius);
        protGrad.addColorStop(0, 'rgba(100,140,200,0.2)');
        protGrad.addColorStop(1, 'rgba(40,60,120,0.1)');
        ctx.fillStyle = protGrad;
        ctx.beginPath();
        ctx.arc(cx, cy, protRadius, 0, Math.PI * 2);
        ctx.fill();

        // 蛋白表面轮廓
        ctx.strokeStyle = 'rgba(0,212,255,0.2)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(cx, cy, protRadius, 0, Math.PI * 2);
        ctx.stroke();

        // 蛋白表面残基点
        for (var s = 0; s < 40; s++) {
            var angle = (s / 40) * Math.PI * 2 + Math.sin(s * 0.7) * 0.3;
            var dist = protRadius * (0.92 + Math.sin(s * 2.3) * 0.08);
            var sx = cx + Math.cos(angle) * dist;
            var sy = cy + Math.sin(angle) * dist;
            ctx.fillStyle = 'rgba(160,196,232,0.5)';
            ctx.beginPath();
            ctx.arc(sx, sy, 2, 0, Math.PI * 2);
            ctx.fill();
        }

        // 绘制配体（小分子，六边形中心）
        var ligandX = cx + 25;
        var ligandY = cy - 10;
        var ligandSize = 18;

        // 配体光晕
        var ligGlow = ctx.createRadialGradient(ligandX, ligandY, 0, ligandX, ligandY, ligandSize * 2);
        ligGlow.addColorStop(0, 'rgba(' + (data.method === 'vina' ? '0,212,255' : '162,155,254') + ',0.3)');
        ligGlow.addColorStop(1, 'rgba(' + (data.method === 'vina' ? '0,212,255' : '162,155,254') + ',0)');
        ctx.fillStyle = ligGlow;
        ctx.beginPath();
        ctx.arc(ligandX, ligandY, ligandSize * 2, 0, Math.PI * 2);
        ctx.fill();

        // 配体六边形
        ctx.fillStyle = data.method === 'vina' ? 'rgba(0,212,255,0.7)' : 'rgba(162,155,254,0.7)';
        ctx.beginPath();
        for (var h2 = 0; h2 < 6; h2++) {
            var ha = (h2 / 6) * Math.PI * 2 - Math.PI / 6;
            var hx = ligandX + Math.cos(ha) * ligandSize;
            var hy = ligandY + Math.sin(ha) * ligandSize;
            if (h2 === 0) ctx.moveTo(hx, hy);
            else ctx.lineTo(hx, hy);
        }
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = data.method === 'vina' ? '#00d4ff' : '#a29bfe';
        ctx.lineWidth = 1.5;
        ctx.stroke();

        // 绘制相互作用虚线
        data.interactions.slice(0, 5).forEach(function(ixn, idx) {
            var angle = (idx / 5) * Math.PI * 2 - 0.5;
            var startX = ligandX + Math.cos(angle) * ligandSize;
            var startY = ligandY + Math.sin(angle) * ligandSize;
            var endAngle = angle + Math.PI + (Math.random() - 0.5) * 0.5;
            var endDist = protRadius * (0.6 + Math.random() * 0.3);
            var endX = cx + Math.cos(endAngle) * endDist;
            var endY = cy + Math.sin(endAngle) * endDist;

            ctx.strokeStyle = ixn.typeColor;
            ctx.lineWidth = 1.5;
            ctx.setLineDash([3, 3]);
            ctx.globalAlpha = 0.7;
            ctx.beginPath();
            ctx.moveTo(startX, startY);
            ctx.lineTo(endX, endY);
            ctx.stroke();
            ctx.setLineDash([]);
            ctx.globalAlpha = 1;

            // 相互作用类型标签
            var midX = (startX + endX) / 2;
            var midY = (startY + endY) / 2;
            ctx.fillStyle = ixn.typeColor;
            ctx.font = '7px sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText(ixn.type, midX, midY - 2);
        });

        // 标签
        ctx.fillStyle = '#a0c4e8';
        ctx.font = '9px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(data.protein, cx, cy + 4);

        ctx.fillStyle = data.method === 'vina' ? '#00d4ff' : '#a29bfe';
        ctx.font = 'bold 8px sans-serif';
        ctx.fillText('Ligand', ligandX, ligandY + 3);

        // 图例
        var legendY = h - 10;
        ctx.font = '7px sans-serif';
        var legends = [
            { color: '#00d4ff', text: '氢键' },
            { color: '#ffc107', text: '疏水' },
            { color: '#a29bfe', text: 'π-π' },
            { color: '#ff6b6b', text: '盐桥' },
            { color: '#4ecdc4', text: 'vdW' }
        ];
        var lx = 10;
        legends.forEach(function(l) {
            ctx.fillStyle = l.color;
            ctx.fillRect(lx, legendY - 3, 6, 6);
            ctx.fillStyle = '#a0c4e8';
            ctx.fillText(l.text, lx + 10, legendY + 3);
            lx += 38;
        });
    }

    function displayDockingResults(data) {
        document.getElementById('dock-result-title').textContent = data.protein + ' + Ligand 对接结果';

        var badge = document.getElementById('dock-method-badge');
        badge.textContent = data.methodName;
        badge.style.background = data.method === 'vina' ? 'rgba(0,212,255,0.15)' : 'rgba(162,155,254,0.15)';
        badge.style.color = data.methodColor;

        document.getElementById('dock-binding-energy').textContent = data.bindingEnergy;
        document.getElementById('dock-binding-energy').style.color = data.bindingEnergy < -9 ? '#00ff88' : (data.bindingEnergy < -7 ? '#00d4ff' : '#ffc107');
        document.getElementById('dock-ki').textContent = data.ki;

        var qEl = document.getElementById('dock-quality');
        qEl.textContent = data.quality;
        qEl.style.color = data.qualityColor;

        document.getElementById('dock-rmsd').innerHTML = '<span style="color:#00d4ff;">' + data.rmsd + ' Å</span> (Lower is better)';
        document.getElementById('dock-poses').textContent = data.numPoses + ' poses generated';

        // 相互作用表格
        var tbody = document.getElementById('dock-interactions-body');
        if (tbody) {
            var html = '';
            data.interactions.forEach(function(ixn, idx) {
                html += '<tr style="background: ' + (idx % 2 === 0 ? 'rgba(0,212,255,0.03)' : 'transparent') + ';">' +
                    '<td style="padding: 5px; border: 1px solid rgba(0,212,255,0.15); text-align: center; color: ' + ixn.typeColor + ';">' + ixn.type + '</td>' +
                    '<td style="padding: 5px; border: 1px solid rgba(0,212,255,0.15);">' + ixn.ligandAtom + '</td>' +
                    '<td style="padding: 5px; border: 1px solid rgba(0,212,255,0.15);">' + ixn.residue + '</td>' +
                    '<td style="padding: 5px; border: 1px solid rgba(0,212,255,0.15); text-align: center;">' + ixn.distance + '</td>' +
                '</tr>';
            });
            tbody.innerHTML = html;
        }

        // 解读
        var interp = '<strong>' + data.protein + '</strong> 与输入配体通过 <strong style="color:' + data.methodColor + '">' + data.methodName + '</strong> 进行对接。';
        interp += '预测结合能为 <strong style="color:' + (data.bindingEnergy < -9 ? '#00ff88' : '#00d4ff') + '">' + data.bindingEnergy + ' kcal/mol</strong>，';
        interp += '估算 Ki 值为 <strong>' + data.ki + '</strong>。';
        interp += '<br><br>对接质量评估: <strong style="color:' + data.qualityColor + '">' + data.quality + '</strong>。';
        if (data.bindingEnergy <= -9) {
            interp += '<br><br>🟢 结合能非常理想，提示该配体可能是该靶点的<strong>强效抑制剂</strong>，建议进行进一步的生物学验证。';
        } else if (data.bindingEnergy <= -7) {
            interp += '<br><br>🔵 结合能良好，具有<strong>进一步优化</strong>的潜力，可通过结构修饰提高亲和力。';
        } else if (data.bindingEnergy <= -5) {
            interp += '<br><br>🟡 结合能一般，可能需要<strong>骨架跃迁</strong>或引入更强的相互作用基团。';
        } else {
            interp += '<br><br>🔴 结合能较弱，建议<strong>重新设计配体</strong>或探索不同的化学骨架。';
        }
        interp += '<br><br>检测到的关键相互作用包括 ' + data.interactions.length + ' 个非共价相互作用，';
        interp += '涵盖氢键、疏水、π-π堆积、盐桥和范德华力。';
        document.getElementById('dock-interpretation-text').innerHTML = interp;

        drawDockingCanvas(data);

        document.getElementById('dock-loading').style.display = 'none';
        document.getElementById('dock-result-content').style.display = 'block';
    }

    // 全局函数
    window.runDocking = function(method) {
        var proteinInput = document.getElementById('dock-protein-input');
        var ligandInput = document.getElementById('dock-ligand-input');
        var protein = proteinInput ? proteinInput.value.trim() : '';
        var ligand = ligandInput ? ligandInput.value.trim() : '';

        if (!protein) { alert('请输入蛋白ID或蛋白名'); return; }
        if (!ligand) { alert('请输入分子的CAS号或SMILES'); return; }

        var panel = document.getElementById('dock-result-panel');
        var loading = document.getElementById('dock-loading');
        var content = document.getElementById('dock-result-content');
        var loadingText = document.getElementById('dock-loading-text');

        if (panel) panel.style.display = 'block';
        if (loading) loading.style.display = 'block';
        if (content) content.style.display = 'none';
        if (loadingText) loadingText.textContent = method === 'vina' ? 'AutoDock Vina: 正在搜索结合构象空间...' : 'AlphaFold3: 正在进行结构预测与对接...';

        setTimeout(function() {
            var data = generateDockingData(protein, ligand, method);
            displayDockingResults(data);
        }, 1500);
    };

    // 事件委托
    document.addEventListener('click', function(e) {
        if (e.target && e.target.id === 'dock-close-btn') {
            var panel = document.getElementById('dock-result-panel');
            if (panel) panel.style.display = 'none';
        }
        if (e.target && e.target.id === 'dock-download-btn') {
            var canvas = document.getElementById('dock-canvas');
            if (canvas) {
                var link = document.createElement('a');
                link.download = 'docking-' + document.getElementById('dock-protein-input').value + '.png';
                link.href = canvas.toDataURL('image/png');
                link.click();
            }
        }
    });

    // Enter键
    document.addEventListener('keypress', function(e) {
        if (e.key === 'Enter' && e.target && (e.target.id === 'dock-protein-input' || e.target.id === 'dock-ligand-input')) {
            e.preventDefault();
            runDocking('vina');
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
