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
    // 确定性随机数生成器（相同输入产生相同输出）
    function seededRandom(seed) {
        let s = seed;
        return function() {
            s = (s * 16807 + 0) % 2147483647;
            return (s - 1) / 2147483646;
        };
    }

    // 字符串转种子数字
    function strToSeed(str) {
        let h = 0;
        for (let i = 0; i < str.length; i++) {
            h = ((h << 5) - h + str.charCodeAt(i)) | 0;
        }
        return Math.abs(h) + 1;
    }

    // 生成模拟KM数据
    function generateSurvivalData(gene, cancerType) {
        const seed = strToSeed(gene.toUpperCase() + '_' + cancerType);
        const rng = seededRandom(seed);

        // 决定该基因在癌种中的预后效应（高表达是好是坏）
        const isRiskGene = rng() > 0.4; // 60%概率是高表达预后差
        const effectSize = 0.5 + rng() * 2.0; // HR: 0.5 ~ 2.5
        const hr = isRiskGene ? effectSize : 1 / effectSize;

        // 样本量
        const totalN = 200 + Math.floor(rng() * 600); // 200-800
        const highN = Math.floor(totalN * (0.4 + rng() * 0.2)); // 40%-60%
        const lowN = totalN - highN;

        // 生成时间点和生存概率
        const maxTime = 120 + Math.floor(rng() * 60); // 120-180个月
        const timePoints = [];
        const numPoints = 50;

        // 高表达组（可能是高风险组）
        const highMedianOS = isRiskGene
            ? 20 + rng() * 40  // 短生存
            : 40 + rng() * 50; // 长生存
        const lowMedianOS = isRiskGene
            ? 50 + rng() * 50  // 长生存
            : 20 + rng() * 40; // 短生存

        for (let i = 0; i <= numPoints; i++) {
            const t = (i / numPoints) * maxTime;
            const highSurv = Math.exp(-t * Math.LN2 / highMedianOS);
            const lowSurv = Math.exp(-t * Math.LN2 / lowMedianOS);

            // 添加一些噪声和阶梯效应
            const highNoise = 1 - (rng() * 0.02);
            const lowNoise = 1 - (rng() * 0.02);

            timePoints.push({
                time: Math.round(t),
                high: Math.max(0, Math.min(1, highSurv * highNoise)),
                low: Math.max(0, Math.min(1, lowSurv * lowNoise))
            });
        }

        // 计算事件数
        const highEvents = Math.floor(highN * (0.3 + rng() * 0.5));
        const lowEvents = Math.floor(lowN * (0.2 + rng() * 0.4));

        // p-value (基于HR和样本量)
        const logHR = Math.log(hr);
        const se = Math.sqrt(1/highEvents + 1/lowEvents);
        const z = Math.abs(logHR) / se;
        const pValue = 2 * (1 - normalCDF(z));

        return {
            gene: gene.toUpperCase(),
            cancerType: cancerType,
            hr: hr,
            hrCI: [hr * Math.exp(-1.96 * se), hr * Math.exp(1.96 * se)],
            pValue: Math.max(0.0001, Math.min(0.999, pValue)),
            highN: highN,
            lowN: lowN,
            highEvents: highEvents,
            lowEvents: lowEvents,
            highMedianOS: Math.round(highMedianOS),
            lowMedianOS: Math.round(lowMedianOS),
            timePoints: timePoints,
            isRiskGene: isRiskGene,
            maxTime: maxTime
        };
    }

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
        const y = 1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);
        return 0.5 * (1 + sign * y);
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
        document.getElementById('result-title').textContent =
            data.gene + ' / ' + data.cancerType + ' - OS生存分析';

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
    window.runSurvivalAnalysis = function() {
        const cancerSelect = document.getElementById('cancer-type-select');
        const geneInput = document.getElementById('gene-input');
        const cancer = cancerSelect ? cancerSelect.value : '';
        const gene = geneInput ? geneInput.value.trim() : '';

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

        // 模拟网络延迟后执行分析
        setTimeout(function() {
            currentResult = generateSurvivalData(gene, cancer);
            displayResults(currentResult);
        }, 1200);
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

    // 按Enter键触发分析（事件委托）
    document.addEventListener('keypress', function(e) {
        if (e.key === 'Enter' && e.target && e.target.id === 'gene-input') {
            e.preventDefault();
            const confirmBtn = document.getElementById('confirm-analysis-btn');
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
