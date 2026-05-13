// 全局提示框
const tooltip = document.getElementById('global-tooltip');

// 为所有带 data-tooltip 的元素添加悬停事件
document.querySelectorAll('[data-tooltip]').forEach(el => {
    el.addEventListener('mouseenter', function(e) {
        const text = this.getAttribute('data-tooltip');
        tooltip.textContent = text;
        tooltip.classList.add('visible');
        updateTooltipPosition(e);
    });
    
    el.addEventListener('mousemove', updateTooltipPosition);
    
    el.addEventListener('mouseleave', function() {
        tooltip.classList.remove('visible');
    });
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
