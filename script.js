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
    } catch {
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
        userNameEl.textContent = `👤 ${username}`;
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
        if (stepBottomCache.has(el) || el.classList.contains('step-bottom-locked')) return;

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
    const workflow = document.querySelector('.workflow');
    const phase3 = document.querySelector('.phase-3');
    const sin4 = document.querySelector('.drug-line.in-progress');
    const trackLines = document.querySelector('.drug-track-lines');

    if (workflow && phase3 && sin4 && trackLines) {
        const workflowRect = workflow.getBoundingClientRect();
        const phase3Rect = phase3.getBoundingClientRect();
        const height = phase3Rect.top - workflowRect.top;
        const trackRect = trackLines.getBoundingClientRect();
        const trackTop = trackRect.top;
        const relativeTop = workflowRect.top - trackTop;
        sin4.style.height = Math.max(0, height + relativeTop) + 'px';
    }
}

// 用 CSS mask 在 drug-bar 上“切开” phase 之间的间隙
function applySegmentedMasks() {
    const workflow = document.querySelector('.workflow');
    const phase1 = document.querySelector('.phase-1');
    const phase2 = document.querySelector('.phase-2');
    const phase3 = document.querySelector('.phase-3');
    const completedLines = document.querySelectorAll('.drug-line.completed');
    const inProgressLine = document.querySelector('.drug-line.in-progress');

    if (!workflow || !phase1 || !phase2 || !phase3) return;

    const workflowTop = workflow.getBoundingClientRect().top;
    const p1Bottom = phase1.getBoundingClientRect().bottom - workflowTop;
    const p2Top = phase2.getBoundingClientRect().top - workflowTop;
    const p2Bottom = phase2.getBoundingClientRect().bottom - workflowTop;
    const p3Top = phase3.getBoundingClientRect().top - workflowTop;
    const p3Bottom = phase3.getBoundingClientRect().bottom - workflowTop;

    const totalHeight = p3Bottom;

    // 完成线：三段可见，中间两段间隙透明
    const completedMask = buildMaskGradient([
        { start: 0, end: p1Bottom },
        { start: p2Top, end: p2Bottom },
        { start: p3Top, end: p3Bottom }
    ], totalHeight);

    completedLines.forEach(line => {
        const bar = line.querySelector('.drug-bar');
        if (bar) bar.style.setProperty('--mask-gradient', completedMask);
    });

    // 进行中线：到 phase3 顶部结束，前两段可见，第二段后透明
    if (inProgressLine) {
        const bar = inProgressLine.querySelector('.drug-bar');
        if (bar) {
            const inProgressMask = buildMaskGradient([
                { start: 0, end: p1Bottom },
                { start: p2Top, end: p2Bottom }
            ], p3Top);
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
    phase.style.transition = 'all 0.6s ease';
    observer.observe(phase);
});

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
    const existingSuccess = applyOverlay?.querySelector('.apply-success');
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

        const data = {
            type: applyTypeInput?.value === 'person' ? '个人申请' : '机构注册',
            name: document.getElementById('apply-name')?.value.trim(),
            email: document.getElementById('apply-email')?.value.trim(),
            field: document.getElementById('apply-field')?.value,
            description: document.getElementById('apply-desc')?.value.trim(),
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
        applyOverlay.querySelector('.apply-box').appendChild(successDiv);

        successDiv.querySelector('#apply-back').addEventListener('click', closeApplyModal);
    });
}
