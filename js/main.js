// 应用数据（从 apps.js 加载）
const apps = appsData || [];

// 初始化
document.addEventListener('DOMContentLoaded', () => {
    renderApps(apps);
    setupSearch();
});

// 渲染应用卡片
function renderApps(appsToRender) {
    const appGrid = document.getElementById('appGrid');
    
    if (appsToRender.length === 0) {
        appGrid.innerHTML = '<div class="no-results">未找到相关应用</div>';
        return;
    }
    
    appGrid.innerHTML = appsToRender.map(app => `
        <div class="app-card" onclick="openApp('${app.id}')">
            <div class="app-icon">${app.icon}</div>
            <div class="app-name">${app.name}</div>
            <div class="app-description">${app.description}</div>
        </div>
    `).join('');
}

// 搜索功能
function setupSearch() {
    const searchInput = document.getElementById('searchInput');
    searchInput.addEventListener('input', (e) => {
        const keyword = e.target.value.toLowerCase().trim();
        
        if (keyword === '') {
            renderApps(apps);
            return;
        }
        
        const filteredApps = apps.filter(app => 
            app.name.toLowerCase().includes(keyword) ||
            app.description.toLowerCase().includes(keyword) ||
            app.keywords.some(kw => kw.toLowerCase().includes(keyword))
        );
        
        renderApps(filteredApps);
    });
}

// 打开应用
function openApp(appId) {
    const app = apps.find(a => a.id === appId);
    if (app) {
        window.location.href = `apps/${app.id}/index.html`;
    }
}
