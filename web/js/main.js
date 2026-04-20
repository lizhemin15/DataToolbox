// 应用数据（从 apps.js 加载）
const apps = appsData || [];
const categories = appCategories || [];
const tags = appTags || [];

// 当前筛选状态
let currentCategory = 'all';
let currentSort = 'default';
let currentKeyword = '';
let selectedTags = new Set();

// 初始化
document.addEventListener('DOMContentLoaded', () => {
    renderCategoryTabs();
    renderTagFilter();
    renderApps();
    setupSearch();
    setupSort();
});

// 渲染分区标签
function renderCategoryTabs() {
    const tabsContainer = document.getElementById('categoryTabs');
    tabsContainer.innerHTML = categories.map(cat => `
        <button class="category-tab${cat.id === currentCategory ? ' active' : ''}" 
                data-category="${cat.id}" onclick="switchCategory('${cat.id}')">
            <span class="tab-icon">${cat.icon}</span>
            <span class="tab-name">${cat.name}</span>
            <span class="tab-count">${getCountByCategory(cat.id)}</span>
        </button>
    `).join('');
}

// 获取分区应用数量
function getCountByCategory(categoryId) {
    if (categoryId === 'all') return apps.length;
    return apps.filter(app => app.category === categoryId).length;
}

// 切换分区
function switchCategory(categoryId) {
    currentCategory = categoryId;
    renderCategoryTabs();
    renderApps();
}

// 渲染标签筛选器
function renderTagFilter() {
    const filterBar = document.querySelector('.filter-bar');
    const tagFilterHTML = `
        <div class="tag-filter">
            <button class="tag-filter-toggle" onclick="toggleTagFilter()">
                <span class="filter-icon">🏷️</span>
                <span class="filter-text">标签筛选</span>
                <span class="selected-count">${selectedTags.size > 0 ? `(${selectedTags.size})` : ''}</span>
            </button>
            <div class="tag-list" id="tagList" style="display: none;">
                ${tags.map(tag => `
                    <button class="tag-item${selectedTags.has(tag.id) ? ' active' : ''}" 
                            data-tag="${tag.id}"
                            onclick="toggleTag('${tag.id}')"
                            style="border-color: ${tag.color}80; ${selectedTags.has(tag.id) ? `background: ${tag.color}40; border-color: ${tag.color};` : ''}">
                        <span class="tag-dot" style="background: ${tag.color}; display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 4px;"></span>
                        <span class="tag-name">${tag.name}</span>
                        <span class="tag-check">${selectedTags.has(tag.id) ? '✓' : ''}</span>
                    </button>
                `).join('')}
                ${selectedTags.size > 0 ? '<button class="tag-clear" onclick="clearTags()">清除所有</button>' : ''}
            </div>
        </div>
    `;
    
    // 插入到排序控件之前
    const sortControl = filterBar.querySelector('.sort-control');
    if (!document.querySelector('.tag-filter')) {
        sortControl.insertAdjacentHTML('beforebegin', tagFilterHTML);
    } else {
        document.querySelector('.tag-filter').outerHTML = tagFilterHTML;
    }
}

// 切换标签筛选器显示
function toggleTagFilter() {
    const tagList = document.getElementById('tagList');
    tagList.style.display = tagList.style.display === 'none' ? 'flex' : 'none';
}

// 切换标签选择
function toggleTag(tagId) {
    if (selectedTags.has(tagId)) {
        selectedTags.delete(tagId);
    } else {
        selectedTags.add(tagId);
    }
    renderTagFilter();
    renderApps();
}

// 清除所有标签
function clearTags() {
    selectedTags.clear();
    renderTagFilter();
    renderApps();
}

// 获取筛选+排序后的应用列表
function getFilteredApps() {
    let result = [...apps];

    // 分区筛选
    if (currentCategory !== 'all') {
        result = result.filter(app => app.category === currentCategory);
    }

    // 标签筛选（多选AND逻辑：应用必须包含所有选中的标签）
    if (selectedTags.size > 0) {
        result = result.filter(app => {
            if (!app.tags) return false;
            return Array.from(selectedTags).every(tagId => app.tags.includes(tagId));
        });
    }

    // 关键词筛选
    if (currentKeyword) {
        const kw = currentKeyword.toLowerCase();
        result = result.filter(app =>
            app.name.toLowerCase().includes(kw) ||
            app.description.toLowerCase().includes(kw) ||
            app.keywords.some(k => k.toLowerCase().includes(kw))
        );
    }

    // 排序
    if (currentSort === 'name-asc') {
        result.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
    } else if (currentSort === 'name-desc') {
        result.sort((a, b) => b.name.localeCompare(a.name, 'zh-CN'));
    }

    return result;
}

// 渲染应用列表（按分区分组显示）
function renderApps() {
    const container = document.getElementById('appContainer');
    const filtered = getFilteredApps();

    if (filtered.length === 0) {
        container.innerHTML = '<div class="no-results">未找到相关应用</div>';
        return;
    }

    // 当选择"全部"且没有搜索关键词时，按分区分组显示
    if (currentCategory === 'all' && !currentKeyword) {
        const groups = categories.filter(c => c.id !== 'all');
        container.innerHTML = groups.map(cat => {
            const groupApps = filtered.filter(app => app.category === cat.id);
            if (groupApps.length === 0) return '';
            return `
                <section class="app-section">
                    <div class="section-header">
                        <span class="section-icon">${cat.icon}</span>
                        <h2 class="section-title">${cat.name}</h2>
                        <span class="section-count">${groupApps.length} 个应用</span>
                    </div>
                    <div class="app-grid">
                        ${groupApps.map(app => renderCard(app)).join('')}
                    </div>
                </section>
            `;
        }).join('');
    } else {
        // 筛选/搜索模式：平铺显示
        container.innerHTML = `
            <div class="app-grid">
                ${filtered.map(app => renderCard(app)).join('')}
            </div>
        `;
    }
}

// 渲染单个卡片
function renderCard(app) {
    const appTagsHTML = app.tags ? app.tags.slice(0, 3).map(tagId => {
        const tag = tags.find(t => t.id === tagId);
        return tag ? `<span class="app-tag" style="background-color: ${tag.color};">${tag.name}</span>` : '';
    }).join('') : '';
    
    return `
        <div class="app-card" onclick="openApp('${app.id}')">
            <div class="app-icon">${app.icon}</div>
            <div class="app-name">${app.name}</div>
            <div class="app-description">${app.description}</div>
            ${appTagsHTML ? `<div class="app-tags">${appTagsHTML}</div>` : ''}
        </div>
    `;
}

// 搜索功能
function setupSearch() {
    const searchInput = document.getElementById('searchInput');
    searchInput.addEventListener('input', (e) => {
        currentKeyword = e.target.value.trim();
        renderApps();
    });
}

// 排序功能
function setupSort() {
    const sortSelect = document.getElementById('sortSelect');
    sortSelect.addEventListener('change', (e) => {
        currentSort = e.target.value;
        renderApps();
    });
}

// 打开应用
function openApp(appId) {
    const app = apps.find(a => a.id === appId);
    if (app) {
        window.location.href = `apps/${app.id}/index.html`;
    }
}
