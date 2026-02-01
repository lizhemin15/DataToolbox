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
        ['产品名称', '类别', '价格', '库存'],
        ['苹果', '水果', '5.99', '100'],
        ['香蕉', '水果', '3.99', '150'],
        ['笔记本电脑', '电子产品', '4999', '50'],
        ['鼠标', '电子产品', '99', '200'],
        ['橙子', '水果', '4.99', '120'],
        ['键盘', '电子产品', '199', '150'],
        ['牛奶', '饮料', '12.99', '80'],
        ['可乐', '饮料', '3.99', '300'],
        ['西瓜', '水果', '15.99', '60'],
        ['耳机', '电子产品', '299', '100']
    ];
    
    const ws = XLSX.utils.aoa_to_sheet(sampleData);
    ws['!cols'] = [
        { wch: 15 },
        { wch: 12 },
        { wch: 10 },
        { wch: 10 }
    ];
    
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '示例数据');
    
    XLSX.writeFile(wb, '数据拆分示例文件.xlsx');
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
    
    const splitColumn = document.getElementById('splitColumn');
    splitColumn.innerHTML = '';
    uploadedData.headers.forEach((header, index) => {
        const option = document.createElement('option');
        option.value = index;
        option.textContent = header || `列 ${index + 1}`;
        splitColumn.appendChild(option);
    });
    
    const fileInfo = document.getElementById('fileInfo');
    fileInfo.innerHTML = `
        <strong>文件名：</strong>${uploadedData.fileName}<br>
        <strong>总行数：</strong>${uploadedData.data.length} 行<br>
        <strong>总列数：</strong>${uploadedData.headers.length} 列
    `;
}

function startSplit() {
    const splitColumnIndex = parseInt(document.getElementById('splitColumn').value);
    const options = {
        includeHeaders: document.getElementById('includeHeaders').checked,
        removeEmptyValues: document.getElementById('removeEmptyValues').checked,
        sortSheets: document.getElementById('sortSheets').checked
    };
    
    if (isNaN(splitColumnIndex)) {
        alert('请选择拆分依据列');
        return;
    }
    
    document.getElementById('uploadSection').style.display = 'none';
    document.getElementById('processingSection').style.display = 'block';
    
    setTimeout(() => {
        performSplit(splitColumnIndex, options);
    }, 100);
}

function performSplit(splitColumnIndex, options) {
    const { data, headers } = uploadedData;
    const groups = new Map();
    
    data.forEach(row => {
        let key = row[splitColumnIndex];
        
        if (key === null || key === undefined) {
            key = '';
        } else {
            key = String(key).trim();
        }
        
        if (options.removeEmptyValues && key === '') {
            return;
        }
        
        if (!groups.has(key)) {
            groups.set(key, []);
        }
        
        groups.get(key).push(row);
    });
    
    let sheets = [];
    groups.forEach((rows, groupName) => {
        const sheetName = groupName || '(空值)';
        const sheetData = options.includeHeaders ? [headers, ...rows] : rows;
        
        sheets.push({
            name: sanitizeSheetName(sheetName),
            data: sheetData,
            rowCount: rows.length
        });
    });
    
    if (options.sortSheets) {
        sheets.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
    }
    
    resultData = {
        sheets: sheets,
        splitColumn: headers[splitColumnIndex],
        totalSheets: sheets.length,
        totalRows: data.length
    };
    
    setTimeout(() => {
        showResults();
    }, 500);
}

function sanitizeSheetName(name) {
    name = String(name).replace(/[\[\]\\\/\?\*:]/g, '_');
    
    if (name.length > 31) {
        name = name.substring(0, 31);
    }
    
    return name || 'Sheet';
}

function showResults() {
    document.getElementById('processingSection').style.display = 'none';
    document.getElementById('resultSection').style.display = 'block';
    
    const stats = document.getElementById('resultStats');
    stats.innerHTML = `
        <div class="stat-item">
            <div class="stat-label">原始行数</div>
            <div class="stat-value">${resultData.totalRows}</div>
        </div>
        <div class="stat-item">
            <div class="stat-label">拆分Sheet数</div>
            <div class="stat-value">${resultData.totalSheets}</div>
        </div>
        <div class="stat-item">
            <div class="stat-label">拆分列</div>
            <div class="stat-value">${resultData.splitColumn}</div>
        </div>
    `;
    
    const preview = document.getElementById('resultPreview');
    let content = '<div class="sheets-preview">';
    
    resultData.sheets.forEach((sheet, index) => {
        content += `
            <div class="sheet-item">
                <div class="sheet-header">
                    <div class="sheet-name">Sheet ${index + 1}: ${sheet.name}</div>
                    <div class="sheet-rows">${sheet.rowCount} 行</div>
                </div>
            </div>
        `;
    });
    
    content += '</div>';
    preview.innerHTML = content;
}

function downloadResult() {
    const wb = XLSX.utils.book_new();
    
    resultData.sheets.forEach(sheet => {
        const ws = XLSX.utils.aoa_to_sheet(sheet.data);
        XLSX.utils.book_append_sheet(wb, ws, sheet.name);
    });
    
    const fileName = '拆分结果_' + new Date().toISOString().slice(0, 19).replace(/:/g, '-') + '.xlsx';
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
