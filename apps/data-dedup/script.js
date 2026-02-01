/**
 * 开发者：李哲民
 */

let uploadedData = null;
let resultData = null;

function goBack() {
    window.location.href = '../../index.html';
}

function downloadSample() {
    const sampleData = [
        ['姓名', '部门', '邮箱', '电话'],
        ['张三', '技术部', 'zhangsan@example.com', '13800138000'],
        ['李四', '市场部', 'lisi@example.com', '13800138001'],
        ['张三', '技术部', 'zhangsan@example.com', '13800138000'],
        ['王五', '财务部', 'wangwu@example.com', '13800138002'],
        ['李四', '市场部', 'lisi@example.com', '13800138001'],
        ['赵六', '人事部', 'zhaoliu@example.com', '13800138003'],
        ['张三', '技术部', 'zhangsan2@example.com', '13800138004']
    ];
    
    const ws = XLSX.utils.aoa_to_sheet(sampleData);
    ws['!cols'] = [
        { wch: 12 },
        { wch: 12 },
        { wch: 25 },
        { wch: 15 }
    ];
    
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '示例数据');
    
    XLSX.writeFile(wb, '数据去重示例文件.xlsx');
}

document.addEventListener('DOMContentLoaded', () => {
    const uploadArea = document.getElementById('uploadArea');
    const fileInput = document.getElementById('fileInput');
    
    uploadArea.addEventListener('click', (e) => {
        if (e.target.closest('.upload-btn') || e.target.closest('.sample-btn')) return;
        fileInput.click();
    });
    
    uploadArea.addEventListener('dragover', (e) => {
        e.preventDefault();
        uploadArea.classList.add('dragover');
    });
    
    uploadArea.addEventListener('dragleave', () => {
        uploadArea.classList.remove('dragover');
    });
    
    uploadArea.addEventListener('drop', (e) => {
        e.preventDefault();
        uploadArea.classList.remove('dragover');
        const files = e.dataTransfer.files;
        if (files.length > 0) {
            handleFile(files[0]);
        }
    });
    
    fileInput.addEventListener('change', (e) => {
        if (e.target.files.length > 0) {
            handleFile(e.target.files[0]);
        }
    });
});

function handleFile(file) {
    const fileName = file.name;
    const fileExt = fileName.split('.').pop().toLowerCase();
    
    if (!['xlsx', 'xls', 'csv'].includes(fileExt)) {
        alert('请上传 .xlsx, .xls 或 .csv 格式的文件');
        return;
    }
    
    const reader = new FileReader();
    reader.onload = (e) => {
        try {
            const data = new Uint8Array(e.target.result);
            const workbook = XLSX.read(data, { type: 'array' });
            const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
            const jsonData = XLSX.utils.sheet_to_json(firstSheet, { header: 1, defval: '' });
            
            if (jsonData.length < 2) {
                alert('文件内容不足，请确保至少有一行数据');
                return;
            }
            
            uploadedData = {
                fileName: fileName,
                headers: jsonData[0],
                data: jsonData.slice(1),
                rawData: jsonData
            };
            
            showConfig();
        } catch (error) {
            alert('文件解析失败：' + error.message);
        }
    };
    reader.readAsArrayBuffer(file);
}

function showConfig() {
    document.getElementById('configSection').style.display = 'block';
    
    const keyColumn = document.getElementById('keyColumn');
    keyColumn.innerHTML = '';
    uploadedData.headers.forEach((header, index) => {
        const option = document.createElement('option');
        option.value = index;
        option.textContent = header || `列 ${index + 1}`;
        keyColumn.appendChild(option);
    });
    
    const fileInfo = document.getElementById('fileInfo');
    fileInfo.innerHTML = `
        <strong>文件名：</strong>${uploadedData.fileName}<br>
        <strong>总行数：</strong>${uploadedData.data.length} 行<br>
        <strong>总列数：</strong>${uploadedData.headers.length} 列
    `;
}

function startDedup() {
    const keyColumnIndex = parseInt(document.getElementById('keyColumn').value);
    const strategy = document.querySelector('input[name="strategy"]:checked').value;
    const options = {
        caseSensitive: document.getElementById('caseSensitive').checked,
        trimSpaces: document.getElementById('trimSpaces').checked,
        ignoreEmpty: document.getElementById('ignoreEmpty').checked
    };
    
    if (isNaN(keyColumnIndex)) {
        alert('请选择去重依据列');
        return;
    }
    
    document.getElementById('uploadSection').style.display = 'none';
    document.getElementById('processingSection').style.display = 'block';
    
    setTimeout(() => {
        performDedup(keyColumnIndex, strategy, options);
    }, 100);
}

function performDedup(keyColumnIndex, strategy, options) {
    const { data, headers } = uploadedData;
    const seen = new Map();
    const duplicates = [];
    
    data.forEach((row, index) => {
        let keyValue = row[keyColumnIndex];
        
        if (keyValue === null || keyValue === undefined) {
            keyValue = '';
        } else {
            keyValue = String(keyValue);
        }
        
        if (options.trimSpaces) {
            keyValue = keyValue.trim();
        }
        
        if (!options.caseSensitive) {
            keyValue = keyValue.toLowerCase();
        }
        
        if (options.ignoreEmpty && keyValue === '') {
            return;
        }
        
        if (seen.has(keyValue)) {
            if (strategy === 'last') {
                const oldIndex = seen.get(keyValue);
                duplicates.push(oldIndex);
                seen.set(keyValue, index);
            } else {
                duplicates.push(index);
            }
        } else {
            seen.set(keyValue, index);
        }
    });
    
    const uniqueData = data.filter((row, index) => !duplicates.includes(index));
    
    resultData = {
        headers: headers,
        data: uniqueData,
        originalCount: data.length,
        uniqueCount: uniqueData.length,
        removedCount: duplicates.length,
        keyColumn: headers[keyColumnIndex]
    };
    
    setTimeout(() => {
        showResults();
    }, 500);
}

function showResults() {
    document.getElementById('processingSection').style.display = 'none';
    document.getElementById('resultSection').style.display = 'block';
    
    const stats = document.getElementById('resultStats');
    stats.innerHTML = `
        <div class="stat-item">
            <div class="stat-label">原始数据</div>
            <div class="stat-value">${resultData.originalCount}</div>
        </div>
        <div class="stat-item">
            <div class="stat-label">去重后</div>
            <div class="stat-value">${resultData.uniqueCount}</div>
        </div>
        <div class="stat-item">
            <div class="stat-label">已删除</div>
            <div class="stat-value">${resultData.removedCount}</div>
        </div>
        <div class="stat-item">
            <div class="stat-label">去重列</div>
            <div class="stat-value">${resultData.keyColumn}</div>
        </div>
    `;
    
    const preview = document.getElementById('resultPreview');
    let headers = '<tr>';
    resultData.headers.forEach(header => {
        headers += `<th>${header}</th>`;
    });
    headers += '</tr>';
    
    let rows = '';
    const previewLimit = Math.min(resultData.data.length, 20);
    
    for (let i = 0; i < previewLimit; i++) {
        const row = resultData.data[i];
        rows += '<tr>';
        row.forEach(cell => {
            rows += `<td>${cell}</td>`;
        });
        rows += '</tr>';
    }
    
    if (resultData.data.length > previewLimit) {
        rows += `<tr><td colspan="${resultData.headers.length}" style="text-align: center; color: rgba(255,255,255,0.6);">仅显示前 ${previewLimit} 行，完整结果请下载</td></tr>`;
    }
    
    preview.innerHTML = `<table class="preview-table">${headers}${rows}</table>`;
}

function downloadResult() {
    const outputData = [resultData.headers, ...resultData.data];
    
    const ws = XLSX.utils.aoa_to_sheet(outputData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '去重结果');
    
    const fileName = '去重结果_' + new Date().toISOString().slice(0, 19).replace(/:/g, '-') + '.xlsx';
    XLSX.writeFile(wb, fileName);
}

function reset() {
    uploadedData = null;
    resultData = null;
    document.getElementById('fileInput').value = '';
    document.getElementById('configSection').style.display = 'none';
    document.getElementById('uploadSection').style.display = 'block';
    document.getElementById('resultSection').style.display = 'none';
}
