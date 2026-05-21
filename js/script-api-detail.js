async function showRelationPreview() {
    if (!currentDb) {
        showToast('请先在左侧列表中选择一个数据库', 'warning');
        return;
    }

    // 加载第一页数据
    await loadRelationPreviewPage(1);
}

// 加载关系预览分页数据
async function loadRelationPreviewPage(page) {
    const pageSize = 50;

    // 从页面获取筛选条件
    const searchInput = document.getElementById('relationSearchInput');
    const matchTypeSelect = document.getElementById('relationMatchTypeSelect');
    const keyword = searchInput ? searchInput.value.trim() : '';
    const matchType = matchTypeSelect ? matchTypeSelect.value : '';

    // 创建或更新弹窗
    let modal = document.getElementById('relationPreviewModal');
    if (!modal) {
        const modalHtml = `
            <div id="relationPreviewModal" class="modal" style="display:flex;">
                <div class="modal-content" style="max-width:1200px;max-height:85vh;">
                    <div class="modal-header">
                        <h2>👁️ 关系索引预览</h2>
                        <button class="modal-close" onclick="closeRelationPreviewModal()">&times;</button>
                    </div>
                    <div class="modal-body" style="max-height:500px;overflow-y:auto;padding:15px;">
                        <!-- 工具栏 -->
                        <div style="display:flex;gap:10px;margin-bottom:15px;flex-wrap:wrap;align-items:center;">
                            <input type="text" id="relationSearchInput" placeholder="搜索表名/字段名..." 
                                style="padding:8px 12px;border:1px solid #ddd;border-radius:4px;flex:1;min-width:200px;max-width:300px;"
                                onkeyup="if(event.key==='Enter')loadRelationPreviewPage(1)">
                            <select id="relationMatchTypeSelect" 
                                style="padding:8px 12px;border:1px solid #ddd;border-radius:4px;min-width:150px;"
                                onchange="loadRelationPreviewPage(1)">
                                <option value="">全部匹配类型</option>
                            </select>
                            <button type="button" class="btn btn-primary" onclick="loadRelationPreviewPage(1)">🔍 搜索</button>
                            <button type="button" class="btn btn-secondary" onclick="clearRelationFilters()">清空</button>
                            <div style="flex:1;"></div>
                            <button type="button" class="btn btn-primary" onclick="showAddRelationModal()">➕ 新增关系</button>
                            <button type="button" class="btn" style="background:#dc3545;color:#fff;" onclick="deleteSelectedRelations()">🗑️ 删除选中</button>
                        </div>
                        <div id="relationPreviewContent" style="text-align:center;padding:40px;color:#999;">加载中...</div>
                    </div>
                    <div class="modal-footer" style="justify-content:space-between;">
                        <div id="relationPreviewInfo" style="font-size:13px;color:#666;"></div>
                        <div style="display:flex;gap:8px;align-items:center;">
                            <input type="checkbox" id="relationSelectAll" onchange="toggleRelationSelectAll()" style="margin-right:8px;">
                            <label for="relationSelectAll" style="font-size:13px;margin-right:8px;">全选</label>
                            <button type="button" class="btn btn-secondary" id="relationPrevBtn" onclick="loadRelationPreviewPage(currentRelationPage - 1)">上一页</button>
                            <button type="button" class="btn btn-secondary" id="relationNextBtn" onclick="loadRelationPreviewPage(currentRelationPage + 1)">下一页</button>
                        </div>
                    </div>
                </div>
            </div>
        `;
        document.body.insertAdjacentHTML('beforeend', modalHtml);
    }

    const contentEl = document.getElementById('relationPreviewContent');
    const infoEl = document.getElementById('relationPreviewInfo');
    const matchTypeSelectEl = document.getElementById('relationMatchTypeSelect');

    try {
        // 调用 relation-preview API（从 data-store.json 读取）
        let url = `${API_BASE}/api/v1/retrieval/relation-preview?db_id=${currentDb.id}`;
        
        const response = await fetchWithAuth(url);
        const data = await response.json();

        if (data.success) {
            // 转换字段名：table1/col1/table2/col2 → source_table/source_field/target_table/target_field
            const rawRelations = data.relations || [];
            const relations = rawRelations.map(r => ({
                id: r.id,
                source_table: r.table1,
                source_field: r.col1,
                target_table: r.table2,
                target_field: r.col2,
                match_type: r.type,
                created_at: '-'
            }));
            const total = relations.length;
            const totalPages = 1;
            const matchTypes = [...new Set(relations.map(r => r.match_type))];

            window.currentRelationPage = page;

            // 初始化匹配类型下拉（只在第一次加载时）
            if (matchTypes.length > 0 && matchTypeSelectEl.options.length <= 1) {
                matchTypes.forEach(t => {
                    const opt = document.createElement('option');
                    opt.value = t;
                    opt.textContent = t;
                    if (t === matchType) opt.selected = true;
                    matchTypeSelectEl.appendChild(opt);
                });
            }

            // 恢复筛选条件
            const searchInputEl = document.getElementById('relationSearchInput');
            if (searchInputEl) searchInputEl.value = keyword;

            // 清除选中状态
            document.getElementById('relationSelectAll').checked = false;

            if (relations.length === 0) {
                contentEl.innerHTML = '<div style="text-align:center;padding:40px;color:#999;">暂无关系索引数据</div>';
                infoEl.textContent = keyword ? `共 ${total} 条（筛选结果）` : '共 0 条';
            } else {
                // 保存当前页数据用于删除
                window.currentRelationData = relations;
                
                const tableHtml = `
                    <table style="width:100%;border-collapse:collapse;font-size:13px;">
                        <thead>
                            <tr style="background:#f8f9fa;">
                                <th style="padding:10px;text-align:center;border-bottom:2px solid #dee2e6;width:40px;">✓</th>
                                <th style="padding:10px;text-align:left;border-bottom:2px solid #dee2e6;">源表</th>
                                <th style="padding:10px;text-align:left;border-bottom:2px solid #dee2e6;">源字段</th>
                                <th style="padding:10px;text-align:center;border-bottom:2px solid #dee2e6;">→</th>
                                <th style="padding:10px;text-align:left;border-bottom:2px solid #dee2e6;">目标表</th>
                                <th style="padding:10px;text-align:left;border-bottom:2px solid #dee2e6;">目标字段</th>
                                <th style="padding:10px;text-align:center;border-bottom:2px solid #dee2e6;">匹配类型</th>
                                <th style="padding:10px;text-align:left;border-bottom:2px solid #dee2e6;">创建时间</th>
                                <th style="padding:10px;text-align:center;border-bottom:2px solid #dee2e6;width:120px;">操作</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${relations.map(r => `
                                <tr data-id="${r.id}">
                                    <td style="padding:10px;border-bottom:1px solid #eee;text-align:center;">
                                        <input type="checkbox" class="relation-checkbox" value="${r.id}">
                                    </td>
                                    <td style="padding:10px;border-bottom:1px solid #eee;">${r.source_table || '-'}</td>
                                    <td style="padding:10px;border-bottom:1px solid #eee;">${r.source_field || '-'}</td>
                                    <td style="padding:10px;border-bottom:1px solid #eee;text-align:center;color:#999;">→</td>
                                    <td style="padding:10px;border-bottom:1px solid #eee;">${r.target_table || '-'}</td>
                                    <td style="padding:10px;border-bottom:1px solid #eee;">${r.target_field || '-'}</td>
                                    <td style="padding:10px;border-bottom:1px solid #eee;text-align:center;">
                                        <span style="background:#e9ecef;padding:2px 8px;border-radius:3px;font-size:12px;">${r.match_type || '-'}</span>
                                    </td>
                                    <td style="padding:10px;border-bottom:1px solid #eee;">${r.created_at || '-'}</td>
                                    <td style="padding:10px;border-bottom:1px solid #eee;text-align:center;">
                                        <button type="button" class="btn btn-secondary" style="padding:4px 8px;font-size:12px;margin-right:4px;" onclick="showEditRelationModal(${r.id})">编辑</button>
                                        <button type="button" class="btn" style="padding:4px 8px;font-size:12px;background:#dc3545;color:#fff;" onclick="deleteRelation(${r.id})">删除</button>
                                    </td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                `;
                contentEl.innerHTML = tableHtml;
                
                const filterInfo = keyword || matchType ? '（筛选结果）' : '';
                infoEl.textContent = `共 ${total} 条${filterInfo}，第 ${page}/${totalPages} 页`;

                // 更新按钮状态
                document.getElementById('relationPrevBtn').disabled = page <= 1;
                document.getElementById('relationNextBtn').disabled = page >= totalPages;
            }
        } else {
            contentEl.innerHTML = `<div style="text-align:center;padding:40px;color:#dc3545;">加载失败: ${data.message || '未知错误'}</div>`;
        }
    } catch (error) {
        contentEl.innerHTML = `<div style="text-align:center;padding:40px;color:#dc3545;">加载失败: ${error.message}</div>`;
    }
}

// 清空关系筛选条件
function clearRelationFilters() {
    const searchInput = document.getElementById('relationSearchInput');
    const matchTypeSelect = document.getElementById('relationMatchTypeSelect');
    if (searchInput) searchInput.value = '';
    if (matchTypeSelect) matchTypeSelect.value = '';
    loadRelationPreviewPage(1);
}

// 全选/取消全选
function toggleRelationSelectAll() {
    const selectAll = document.getElementById('relationSelectAll').checked;
    document.querySelectorAll('.relation-checkbox').forEach(cb => {
        cb.checked = selectAll;
    });
}

// 删除选中的关系
async function deleteSelectedRelations() {
    const checked = document.querySelectorAll('.relation-checkbox:checked');
    if (checked.length === 0) {
        showToast('请先选择要删除的关系', 'warning');
        return;
    }

    if (!confirm(`确定要删除选中的 ${checked.length} 条关系吗？此操作不可恢复。`)) {
        return;
    }

    const relationIDs = Array.from(checked).map(cb => parseInt(cb.value));
    
    try {
        const response = await fetchWithAuth(`${API_BASE}/api/v1/retrieval/relations`, {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                database_id: currentDb.id,
                relation_ids: relationIDs
            })
        });
        
        const data = await response.json();
        if (data.success) {
            showToast(`成功删除 ${data.deleted_count} 条关系`, 'success');
            loadRelationPreviewPage(currentRelationPage);
        } else {
            showToast('删除失败: ' + (data.message || '未知错误'), 'error');
        }
    } catch (error) {
        showToast('删除失败: ' + error.message, 'error');
    }
}

function closeRelationPreviewModal() {
    const modal = document.getElementById('relationPreviewModal');
    if (modal) modal.remove();
}

// 显示新增关系弹窗
async function showAddRelationModal() {
    try {
        // 获取表列表
        const response = await fetchWithAuth(`${API_BASE}/api/v1/databases/${currentDb.id}/tables`);
        const data = await response.json();

        if (!data.success) {
            showToast('获取表列表失败: ' + data.message, 'error');
            return;
        }

        const tables = data.tables || [];
        const tableOptions = tables.map(t => `<option value="${t.name}">${t.name}${t.comment ? ' (' + t.comment + ')' : ''}</option>`).join('');

        const modalHtml = `
            <div id="addRelationModal" class="modal" style="display:flex;">
                <div class="modal-content" style="max-width:600px;">
                    <div class="modal-header">
                        <h2>➕ 新增关系</h2>
                        <button class="modal-close" onclick="closeAddRelationModal()">&times;</button>
                    </div>
                    <div class="modal-body">
                        <div style="margin-bottom:15px;">
                            <label style="display:block;margin-bottom:5px;font-weight:bold;">源表:</label>
                            <select id="addRelationSourceTable" style="width:100%;padding:8px;border:1px solid #ddd;border-radius:4px;" onchange="loadSourceFields()">
                                <option value="">请选择源表</option>
                                ${tableOptions}
                            </select>
                        </div>
                        <div style="margin-bottom:15px;">
                            <label style="display:block;margin-bottom:5px;font-weight:bold;">源字段:</label>
                            <select id="addRelationSourceField" style="width:100%;padding:8px;border:1px solid #ddd;border-radius:4px;">
                                <option value="">请先选择源表</option>
                            </select>
                        </div>
                        <div style="margin-bottom:15px;">
                            <label style="display:block;margin-bottom:5px;font-weight:bold;">目标表:</label>
                            <select id="addRelationTargetTable" style="width:100%;padding:8px;border:1px solid #ddd;border-radius:4px;" onchange="loadTargetFields()">
                                <option value="">请选择目标表</option>
                                ${tableOptions}
                            </select>
                        </div>
                        <div style="margin-bottom:15px;">
                            <label style="display:block;margin-bottom:5px;font-weight:bold;">目标字段:</label>
                            <select id="addRelationTargetField" style="width:100%;padding:8px;border:1px solid #ddd;border-radius:4px;">
                                <option value="">请先选择目标表</option>
                            </select>
                        </div>
                        <div style="margin-bottom:15px;">
                            <label style="display:block;margin-bottom:5px;font-weight:bold;">匹配类型:</label>
                            <select id="addRelationMatchType" style="width:100%;padding:8px;border:1px solid #ddd;border-radius:4px;">
                                <option value="exact">精确匹配</option>
                                <option value="case_insensitive">大小写不敏感</option>
                                <option value="naming_style">命名风格相似</option>
                                <option value="type_keyword">类型+关键词</option>
                            </select>
                        </div>
                        <div style="margin-bottom:15px;">
                            <label style="display:block;margin-bottom:5px;font-weight:bold;">关系名称（可选）:</label>
                            <input type="text" id="addRelationName" style="width:100%;padding:8px;border:1px solid #ddd;border-radius:4px;" placeholder="输入关系名称（可选）">
                        </div>
                    </div>
                    <div class="modal-footer">
                        <button type="button" class="btn btn-secondary" onclick="closeAddRelationModal()">取消</button>
                        <button type="button" class="btn btn-primary" onclick="createRelation()">创建关系</button>
                    </div>
                </div>
            </div>
        `;
        document.body.insertAdjacentHTML('beforeend', modalHtml);
    } catch (error) {
        showToast('获取表列表失败: ' + error.message, 'error');
    }
}

function closeAddRelationModal() {
    const modal = document.getElementById('addRelationModal');
    if (modal) modal.remove();
}

// 加载源表字段
async function loadSourceFields() {
    const tableName = document.getElementById('addRelationSourceTable').value;
    const fieldSelect = document.getElementById('addRelationSourceField');

    if (!tableName) {
        fieldSelect.innerHTML = '<option value="">请先选择源表</option>';
        return;
    }

    try {
        const response = await fetchWithAuth(`${API_BASE}/api/v1/databases/${currentDb.id}/tables/${tableName}/structure`);
        const data = await response.json();

        if (data.success) {
            const fields = data.columns || [];
            fieldSelect.innerHTML = '<option value="">请选择字段</option>' +
                fields.map(f => `<option value="${f.name}">${f.name}${f.comment ? ' (' + f.comment + ')' : ''}</option>`).join('');
        } else {
            showToast('获取字段列表失败: ' + data.message, 'error');
        }
    } catch (error) {
        showToast('获取字段列表失败: ' + error.message, 'error');
    }
}

// 加载目标表字段
async function loadTargetFields() {
    const tableName = document.getElementById('addRelationTargetTable').value;
    const fieldSelect = document.getElementById('addRelationTargetField');

    if (!tableName) {
        fieldSelect.innerHTML = '<option value="">请先选择目标表</option>';
        return;
    }

    try {
        const response = await fetchWithAuth(`${API_BASE}/api/v1/databases/${currentDb.id}/tables/${tableName}/structure`);
        const data = await response.json();

        if (data.success) {
            const fields = data.columns || [];
            fieldSelect.innerHTML = '<option value="">请选择字段</option>' +
                fields.map(f => `<option value="${f.name}">${f.name}${f.comment ? ' (' + f.comment + ')' : ''}</option>`).join('');
        } else {
            showToast('获取字段列表失败: ' + data.message, 'error');
        }
    } catch (error) {
        showToast('获取字段列表失败: ' + error.message, 'error');
    }
}

// 创建关系
async function createRelation() {
    const sourceTable = document.getElementById('addRelationSourceTable').value;
    const sourceField = document.getElementById('addRelationSourceField').value;
    const targetTable = document.getElementById('addRelationTargetTable').value;
    const targetField = document.getElementById('addRelationTargetField').value;
    const matchType = document.getElementById('addRelationMatchType').value;
    const relationName = document.getElementById('addRelationName').value.trim();

    if (!sourceTable || !sourceField || !targetTable || !targetField || !matchType) {
        showToast('请填写所有必填字段', 'warning');
        return;
    }

    try {
        const body = {
            database_id: currentDb.id,
            source_table: sourceTable,
            source_field: sourceField,
            target_table: targetTable,
            target_field: targetField,
            match_type: matchType
        };
        if (relationName) {
            body.relation_name = relationName;
        }

        const response = await fetchWithAuth(`${API_BASE}/api/v1/retrieval/relations`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });

        const data = await response.json();
        if (data.success) {
            showToast('关系创建成功', 'success');
            closeAddRelationModal();
            loadRelationPreviewPage(currentRelationPage);
        } else {
            showToast('创建失败: ' + (data.message || '未知错误'), 'error');
        }
    } catch (error) {
        showToast('创建失败: ' + error.message, 'error');
    }
}

// 显示编辑关系弹窗
async function showEditRelationModal(relationId) {
    const relation = (window.currentRelationData || []).find(r => r.id === relationId);
    if (!relation) {
        showToast('未找到关系数据', 'error');
        return;
    }

    try {
        // 获取表列表
        const response = await fetchWithAuth(`${API_BASE}/api/v1/databases/${currentDb.id}/tables`);
        const data = await response.json();

        if (!data.success) {
            showToast('获取表列表失败: ' + data.message, 'error');
            return;
        }

        const tables = data.tables || [];
        const tableOptions = tables.map(t => `<option value="${t.name}">${t.name}${t.comment ? ' (' + t.comment + ')' : ''}</option>`).join('');

        const modalHtml = `
            <div id="editRelationModal" class="modal" style="display:flex;">
                <div class="modal-content" style="max-width:600px;">
                    <div class="modal-header">
                        <h2>✏️ 编辑关系</h2>
                        <button class="modal-close" onclick="closeEditRelationModal()">&times;</button>
                    </div>
                    <div class="modal-body">
                        <div style="margin-bottom:15px;">
                            <label style="display:block;margin-bottom:5px;font-weight:bold;">源表:</label>
                            <select id="editRelationSourceTable" style="width:100%;padding:8px;border:1px solid #ddd;border-radius:4px;" onchange="loadEditSourceFields()">
                                <option value="">请选择源表</option>
                                ${tableOptions}
                            </select>
                        </div>
                        <div style="margin-bottom:15px;">
                            <label style="display:block;margin-bottom:5px;font-weight:bold;">源字段:</label>
                            <select id="editRelationSourceField" style="width:100%;padding:8px;border:1px solid #ddd;border-radius:4px;">
                                <option value="">请先选择源表</option>
                            </select>
                        </div>
                        <div style="margin-bottom:15px;">
                            <label style="display:block;margin-bottom:5px;font-weight:bold;">目标表:</label>
                            <select id="editRelationTargetTable" style="width:100%;padding:8px;border:1px solid #ddd;border-radius:4px;" onchange="loadEditTargetFields()">
                                <option value="">请选择目标表</option>
                                ${tableOptions}
                            </select>
                        </div>
                        <div style="margin-bottom:15px;">
                            <label style="display:block;margin-bottom:5px;font-weight:bold;">目标字段:</label>
                            <select id="editRelationTargetField" style="width:100%;padding:8px;border:1px solid #ddd;border-radius:4px;">
                                <option value="">请先选择目标表</option>
                            </select>
                        </div>
                        <div style="margin-bottom:15px;">
                            <label style="display:block;margin-bottom:5px;font-weight:bold;">匹配类型:</label>
                            <select id="editRelationMatchType" style="width:100%;padding:8px;border:1px solid #ddd;border-radius:4px;">
                                <option value="exact">精确匹配</option>
                                <option value="case_insensitive">大小写不敏感</option>
                                <option value="naming_style">命名风格相似</option>
                                <option value="type_keyword">类型+关键词</option>
                            </select>
                        </div>
                        <div style="margin-bottom:15px;">
                            <label style="display:block;margin-bottom:5px;font-weight:bold;">关系名称（可选）:</label>
                            <input type="text" id="editRelationName" style="width:100%;padding:8px;border:1px solid #ddd;border-radius:4px;" placeholder="输入关系名称（可选）">
                        </div>
                    </div>
                    <div class="modal-footer">
                        <button type="button" class="btn btn-secondary" onclick="closeEditRelationModal()">取消</button>
                        <button type="button" class="btn btn-primary" onclick="updateRelation(${relationId})">保存修改</button>
                    </div>
                </div>
            </div>
        `;
        document.body.insertAdjacentHTML('beforeend', modalHtml);

        // 设置当前值
        document.getElementById('editRelationSourceTable').value = relation.source_table;
        document.getElementById('editRelationTargetTable').value = relation.target_table;
        document.getElementById('editRelationMatchType').value = relation.match_type || 'exact';
        document.getElementById('editRelationName').value = relation.relation_name || '';

        // 加载字段并设置当前值
        await loadEditSourceFields();
        document.getElementById('editRelationSourceField').value = relation.source_field;

        await loadEditTargetFields();
        document.getElementById('editRelationTargetField').value = relation.target_field;

    } catch (error) {
        showToast('获取表列表失败: ' + error.message, 'error');
    }
}

function closeEditRelationModal() {
    const modal = document.getElementById('editRelationModal');
    if (modal) modal.remove();
}

// 加载编辑弹窗的源表字段
async function loadEditSourceFields() {
    const tableName = document.getElementById('editRelationSourceTable').value;
    const fieldSelect = document.getElementById('editRelationSourceField');

    if (!tableName) {
        fieldSelect.innerHTML = '<option value="">请先选择源表</option>';
        return;
    }

    try {
        const response = await fetchWithAuth(`${API_BASE}/api/v1/databases/${currentDb.id}/tables/${tableName}/structure`);
        const data = await response.json();

        if (data.success) {
            const fields = data.columns || [];
            fieldSelect.innerHTML = '<option value="">请选择字段</option>' +
                fields.map(f => `<option value="${f.name}">${f.name}${f.comment ? ' (' + f.comment + ')' : ''}</option>`).join('');
        } else {
            showToast('获取字段列表失败: ' + data.message, 'error');
        }
    } catch (error) {
        showToast('获取字段列表失败: ' + error.message, 'error');
    }
}

// 加载编辑弹窗的目标表字段
async function loadEditTargetFields() {
    const tableName = document.getElementById('editRelationTargetTable').value;
    const fieldSelect = document.getElementById('editRelationTargetField');

    if (!tableName) {
        fieldSelect.innerHTML = '<option value="">请先选择目标表</option>';
        return;
    }

    try {
        const response = await fetchWithAuth(`${API_BASE}/api/v1/databases/${currentDb.id}/tables/${tableName}/structure`);
        const data = await response.json();

        if (data.success) {
            const fields = data.columns || [];
            fieldSelect.innerHTML = '<option value="">请选择字段</option>' +
                fields.map(f => `<option value="${f.name}">${f.name}${f.comment ? ' (' + f.comment + ')' : ''}</option>`).join('');
        } else {
            showToast('获取字段列表失败: ' + data.message, 'error');
        }
    } catch (error) {
        showToast('获取字段列表失败: ' + error.message, 'error');
    }
}

// 更新关系
async function updateRelation(relationId) {
    const sourceTable = document.getElementById('editRelationSourceTable').value;
    const sourceField = document.getElementById('editRelationSourceField').value;
    const targetTable = document.getElementById('editRelationTargetTable').value;
    const targetField = document.getElementById('editRelationTargetField').value;
    const matchType = document.getElementById('editRelationMatchType').value;
    const relationName = document.getElementById('editRelationName').value.trim();

    if (!sourceTable || !sourceField || !targetTable || !targetField || !matchType) {
        showToast('请填写所有必填字段', 'warning');
        return;
    }

    try {
        const body = {
            database_id: currentDb.id,
            relation_id: relationId,
            source_table: sourceTable,
            source_field: sourceField,
            target_table: targetTable,
            target_field: targetField,
            match_type: matchType
        };
        if (relationName) {
            body.relation_name = relationName;
        }

        const response = await fetchWithAuth(`${API_BASE}/api/v1/retrieval/relations`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });

        const data = await response.json();
        if (data.success) {
            showToast('关系更新成功', 'success');
            closeEditRelationModal();
            loadRelationPreviewPage(currentRelationPage);
        } else {
            showToast('更新失败: ' + (data.message || '未知错误'), 'error');
        }
    } catch (error) {
        showToast('更新失败: ' + error.message, 'error');
    }
}

// 删除单个关系
async function deleteRelation(relationId) {
    if (!confirm('确定要删除该关系吗？此操作不可恢复。')) {
        return;
    }

    // 前端先移除行，让用户感觉更快
    const row = document.querySelector(`tr[data-id="${relationId}"]`);
    if (row) {
        row.style.opacity = '0.5';
        row.innerHTML = `<td colspan="6" style="text-align:center;color:#888;"><span class="spinner"></span> 正在删除...</td>`;
    }

    try {
        const response = await fetchWithAuth(`${API_BASE}/api/v1/retrieval/relations`, {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                database_id: currentDb.id,
                relation_ids: [relationId]
            })
        });

        const data = await response.json();
        if (data.success) {
            showToast('删除成功', 'success');
            loadRelationPreviewPage(currentRelationPage);
        } else {
            showToast('删除失败: ' + (data.message || '未知错误'), 'error');
            loadRelationPreviewPage(currentRelationPage); // 失败也刷新恢复
        }
    } catch (error) {
        showToast('删除失败: ' + error.message, 'error');
        loadRelationPreviewPage(currentRelationPage); // 失败刷新恢复
    }
}

async function govDownloadExamplesForTask(taskId, exampleFiles, taskName = '') {
    const token = localStorage.getItem('dataOntologyToken') || '';
    if (!token) {
        showToast('请先登录', 'error');
        return;
    }
    
    // 优先从全局 govTasks 查找，确保数据最新
    let files = exampleFiles;
    if (!files || !files.length) {
        const task = govTasks.find(t => t.id === taskId);
        if (task && task.example_files && task.example_files.length) {
            files = task.example_files;
        }
    }
    
    if (!files || !files.length) {
        showToast('没有可下载的样例文件', 'error');
        return;
    }
    
    // 清理任务名中的非法字符，用于文件名
    const safeTaskName = (taskName || '治理任务').replace(/[\\/:*?"<>|]/g, '_');
    const zipName = `${safeTaskName}_样例文件.zip`;
    
    showToast('正在准备下载...', 'info');
    
    // 格式化文件列表：{ name: "xxx.docx", path: "xxx.docx" }
    const formattedFiles = files.map(f => ({
        name: typeof f === 'string' ? f : f.name,
        path: typeof f === 'string' ? f : (f.path || f.name)
    }));
    
    // 使用批量打包接口下载
    try {
        const res = await fetch(`${API_BASE}/api/v1/gov/examples/download`, {
            method: 'POST',
            headers: { 
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                files: formattedFiles,
                zip_name: zipName
            })
        });
        if (!res.ok) throw new Error(res.statusText);
        const blob = await res.blob();
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = zipName;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(a.href);
    } catch (e) {
        console.error('下载失败:', e);
        showToast('下载失败: ' + e.message, 'error');
    }
}

// === Agent Cluster Mode Functions ===

// Show cluster mode usage guide
function showClusterModeGuide() {
