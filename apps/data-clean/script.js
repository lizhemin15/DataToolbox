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
        ['姓名', '  部门  ', '邮箱', '', '备注'],
        ['  张三  ', '技术部', 'zhangsan@example.com', '', '优秀员工'],
        ['', '', '', '', ''],
        ['李四', '市场部  ', '  lisi@example.com  ', '', ''],
        ['  王五', '财务部', 'wangwu@example.com', '', '新入职'],
        ['  张三  ', '技术部', 'zhangsan@example.com', '', '优秀员工'],
        ['', '', '', '', ''],
        ['赵六  ', '人事部  ', 'zhaoliu@example.com', '', ''],
        ['', '', '', '', '']
    ];
    
    const ws = XLSX.utils.aoa_to_sheet(sampleData);
    ws['!cols'] = [
        { wch: 12 },
        { wch: 12 },
        { wch: 25 },
        { wch: 10 },
        { wch: 15 }
    ];
    
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '示例数据');
    
    XLSX.writeFile(wb, '数据清洗示例文件.xlsx');
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
            
            uploadedData = {
                fileName: fileName,
                data: jsonData,
                originalRowCount: jsonData.length,
                originalColCount: jsonData.length > 0 ? Math.max(...jsonData.map(row => row.length)) : 0
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
    
    const fileInfo = document.getElementById('fileInfo');
    fileInfo.innerHTML = `
        <strong>文件名：</strong>${uploadedData.fileName}<br>
        <strong>原始行数：</strong>${uploadedData.originalRowCount} 行<br>
        <strong>原始列数：</strong>${uploadedData.originalColCount} 列
    `;
}

function startClean() {
    const options = {
        removeEmptyRows: document.getElementById('removeEmptyRows').checked,
        removeEmptyColumns: document.getElementById('removeEmptyColumns').checked,
        trimSpaces: document.getElementById('trimSpaces').checked,
        removeExtraSpaces: document.getElementById('removeExtraSpaces').checked,
        removeDuplicates: document.getElementById('removeDuplicates').checked,
        normalizeLineBreaks: document.getElementById('normalizeLineBreaks').checked,
        emptyCheck: document.querySelector('input[name="emptyCheck"]:checked').value
    };
    
    document.getElementById('uploadSection').style.display = 'none';
    document.getElementById('processingSection').style.display = 'block';
    
    setTimeout(() => {
        performClean(options);
    }, 100);
}

function performClean(options) {
    let data = JSON.parse(JSON.stringify(uploadedData.data));
    const stats = {
        originalRows: data.length,
        originalCols: data.length > 0 ? Math.max(...data.map(row => row.length)) : 0,
        removedRows: 0,
        removedCols: 0,
        cellsCleaned: 0
    };
    
    if (options.trimSpaces || options.removeExtraSpaces || options.normalizeLineBreaks) {
        data = data.map(row => {
            return row.map(cell => {
                if (typeof cell === 'string') {
                    let cleaned = cell;
                    
                    if (options.normalizeLineBreaks) {
                        cleaned = cleaned.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
                    }
                    
                    if (options.trimSpaces) {
                        cleaned = cleaned.trim();
                    }
                    
                    if (options.removeExtraSpaces) {
                        cleaned = cleaned.replace(/\s+/g, ' ');
                    }
                    
                    if (cleaned !== cell) {
                        stats.cellsCleaned++;
                    }
                    
                    return cleaned;
                }
                return cell;
            });
        });
    }
    
    if (options.removeEmptyRows) {
        const originalLength = data.length;
        data = data.filter(row => {
            return row.some(cell => {
                if (cell === null || cell === undefined) return false;
                const str = String(cell);
                if (options.emptyCheck === 'loose') {
                    return str.trim() !== '';
                }
                return str !== '';
            });
        });
        stats.removedRows = originalLength - data.length;
    }
    
    if (options.removeEmptyColumns && data.length > 0) {
        const maxCols = Math.max(...data.map(row => row.length));
        const emptyColumns = [];
        
        for (let colIndex = 0; colIndex < maxCols; colIndex++) {
            const isEmpty = data.every(row => {
                const cell = row[colIndex];
                if (cell === null || cell === undefined) return true;
                const str = String(cell);
                if (options.emptyCheck === 'loose') {
                    return str.trim() === '';
                }
                return str === '';
            });
            
            if (isEmpty) {
                emptyColumns.push(colIndex);
            }
        }
        
        if (emptyColumns.length > 0) {
            data = data.map(row => {
                return row.filter((cell, index) => !emptyColumns.includes(index));
            });
            stats.removedCols = emptyColumns.length;
        }
    }
    
    if (options.removeDuplicates) {
        const originalLength = data.length;
        const seen = new Set();
        data = data.filter(row => {
            const key = JSON.stringify(row);
            if (seen.has(key)) {
                return false;
            }
            seen.add(key);
            return true;
        });
        stats.removedRows += originalLength - data.length;
    }
    
    resultData = {
        data: data,
        stats: {
            ...stats,
            finalRows: data.length,
            finalCols: data.length > 0 ? Math.max(...data.map(row => row.length)) : 0
        }
    };
    
    setTimeout(() => {
        showResults();
    }, 500);
}

function showResults() {
    document.getElementById('processingSection').style.display = 'none';
    document.getElementById('resultSection').style.display = 'block';
    
    const { stats } = resultData;
    const statsEl = document.getElementById('resultStats');
    statsEl.innerHTML = `
        <div class="stat-item">
            <div class="stat-label">原始行数</div>
            <div class="stat-value">${stats.originalRows}</div>
        </div>
        <div class="stat-item">
            <div class="stat-label">清洗后行数</div>
            <div class="stat-value">${stats.finalRows}</div>
        </div>
        <div class="stat-item">
            <div class="stat-label">删除行数</div>
            <div class="stat-value">${stats.removedRows}</div>
        </div>
        <div class="stat-item">
            <div class="stat-label">删除列数</div>
            <div class="stat-value">${stats.removedCols}</div>
        </div>
        <div class="stat-item">
            <div class="stat-label">清洗单元格</div>
            <div class="stat-value">${stats.cellsCleaned}</div>
        </div>
    `;
    
    const preview = document.getElementById('resultPreview');
    
    if (resultData.data.length === 0) {
        preview.innerHTML = '<p style="text-align: center; color: rgba(255,255,255,0.7);">清洗后数据为空</p>';
        return;
    }
    
    let headers = '<tr>';
    if (resultData.data.length > 0 && resultData.data[0]) {
        resultData.data[0].forEach((header, index) => {
            headers += `<th>列 ${index + 1}</th>`;
        });
    }
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
        const colCount = resultData.data[0].length;
        rows += `<tr><td colspan="${colCount}" style="text-align: center; color: rgba(255,255,255,0.6);">仅显示前 ${previewLimit} 行，完整结果请下载</td></tr>`;
    }
    
    preview.innerHTML = `<table class="preview-table">${headers}${rows}</table>`;
}

function downloadResult() {
    const ws = XLSX.utils.aoa_to_sheet(resultData.data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '清洗结果');
    
    const fileName = '清洗结果_' + new Date().toISOString().slice(0, 19).replace(/:/g, '-') + '.xlsx';
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
