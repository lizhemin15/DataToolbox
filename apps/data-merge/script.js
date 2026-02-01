/**
 * 开发者：李哲民
 */

let uploadedFiles = [];
let resultData = null;

function goBack() {
    window.location.href = '../../index.html';
}

document.addEventListener('DOMContentLoaded', () => {
    const uploadArea = document.getElementById('uploadArea');
    const fileInput = document.getElementById('fileInput');
    
    uploadArea.addEventListener('click', (e) => {
        if (e.target.closest('.upload-btn')) return;
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
        const files = Array.from(e.dataTransfer.files);
        handleFiles(files);
    });
    
    fileInput.addEventListener('change', (e) => {
        const files = Array.from(e.target.files);
        handleFiles(files);
    });
});

function handleFiles(files) {
    if (files.length === 0) return;
    
    const validFiles = files.filter(file => {
        const ext = file.name.split('.').pop().toLowerCase();
        return ['xlsx', 'xls', 'csv'].includes(ext);
    });
    
    if (validFiles.length === 0) {
        alert('请上传 .xlsx, .xls 或 .csv 格式的文件');
        return;
    }
    
    if (validFiles.length < 2) {
        alert('请至少上传2个文件进行合并');
        return;
    }
    
    uploadedFiles = [];
    let loaded = 0;
    
    validFiles.forEach((file, index) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const data = new Uint8Array(e.target.result);
                const workbook = XLSX.read(data, { type: 'array' });
                const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
                const jsonData = XLSX.utils.sheet_to_json(firstSheet, { header: 1, defval: '' });
                
                uploadedFiles.push({
                    name: file.name,
                    data: jsonData,
                    rowCount: jsonData.length
                });
                
                loaded++;
                if (loaded === validFiles.length) {
                    showConfig();
                }
            } catch (error) {
                alert(`文件 ${file.name} 解析失败：${error.message}`);
            }
        };
        reader.readAsArrayBuffer(file);
    });
}

function showConfig() {
    document.getElementById('filesList').style.display = 'block';
    document.getElementById('configSection').style.display = 'block';
    
    const filesListContent = document.getElementById('filesListContent');
    filesListContent.innerHTML = uploadedFiles.map((file, index) => `
        <div class="file-item">
            <span class="file-name">${file.name}</span>
            <span class="file-rows">${file.rowCount} 行</span>
        </div>
    `).join('');
    
    const totalRows = uploadedFiles.reduce((sum, file) => sum + file.rowCount, 0);
    
    const fileInfo = document.getElementById('fileInfo');
    fileInfo.innerHTML = `
        <strong>文件数：</strong>${uploadedFiles.length} 个<br>
        <strong>总行数：</strong>${totalRows} 行
    `;
}

function startMerge() {
    const mergeMode = document.querySelector('input[name="mergeMode"]:checked').value;
    const options = {
        includeHeaders: document.getElementById('includeHeaders').checked,
        skipEmptyRows: document.getElementById('skipEmptyRows').checked,
        addSourceColumn: document.getElementById('addSourceColumn').checked
    };
    
    document.getElementById('uploadSection').style.display = 'none';
    document.getElementById('processingSection').style.display = 'block';
    
    setTimeout(() => {
        performMerge(mergeMode, options);
    }, 100);
}

function performMerge(mergeMode, options) {
    if (mergeMode === 'vertical') {
        mergeVertically(options);
    } else {
        mergeAsSheets(options);
    }
}

function mergeVertically(options) {
    let mergedData = [];
    let headers = null;
    
    uploadedFiles.forEach((file, fileIndex) => {
        let fileData = file.data.slice();
        
        if (options.skipEmptyRows) {
            fileData = fileData.filter(row => row.some(cell => cell !== null && cell !== undefined && cell !== ''));
        }
        
        if (fileData.length === 0) return;
        
        if (fileIndex === 0 && options.includeHeaders) {
            headers = fileData[0];
            if (options.addSourceColumn) {
                headers.push('来源文件');
            }
            mergedData.push(headers);
            fileData = fileData.slice(1);
        } else if (options.includeHeaders) {
            fileData = fileData.slice(1);
        }
        
        fileData.forEach(row => {
            if (options.addSourceColumn) {
                row.push(file.name);
            }
            mergedData.push(row);
        });
    });
    
    resultData = {
        mode: 'single',
        data: mergedData,
        fileCount: uploadedFiles.length,
        totalRows: mergedData.length - (options.includeHeaders ? 1 : 0)
    };
    
    setTimeout(() => {
        showResults();
    }, 500);
}

function mergeAsSheets(options) {
    const sheets = [];
    
    uploadedFiles.forEach((file, index) => {
        let fileData = file.data.slice();
        
        if (options.skipEmptyRows) {
            fileData = fileData.filter(row => row.some(cell => cell !== null && cell !== undefined && cell !== ''));
        }
        
        sheets.push({
            name: file.name.replace(/\.[^/.]+$/, '').substring(0, 31),
            data: fileData
        });
    });
    
    const totalRows = sheets.reduce((sum, sheet) => sum + sheet.data.length, 0);
    
    resultData = {
        mode: 'sheets',
        sheets: sheets,
        fileCount: uploadedFiles.length,
        totalRows: totalRows
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
            <div class="stat-label">文件数</div>
            <div class="stat-value">${resultData.fileCount}</div>
        </div>
        <div class="stat-item">
            <div class="stat-label">总行数</div>
            <div class="stat-value">${resultData.totalRows}</div>
        </div>
        <div class="stat-item">
            <div class="stat-label">合并方式</div>
            <div class="stat-value">${resultData.mode === 'single' ? '纵向合并' : '多Sheet'}</div>
        </div>
    `;
    
    const preview = document.getElementById('resultPreview');
    
    if (resultData.mode === 'single') {
        let headers = '<tr>';
        if (resultData.data.length > 0) {
            resultData.data[0].forEach(header => {
                headers += `<th>${header}</th>`;
            });
        }
        headers += '</tr>';
        
        let rows = '';
        const previewLimit = Math.min(resultData.data.length, 21);
        const startIndex = resultData.data[0] && resultData.data[0].length > 0 ? 1 : 0;
        
        for (let i = startIndex; i < previewLimit; i++) {
            const row = resultData.data[i];
            rows += '<tr>';
            row.forEach(cell => {
                rows += `<td>${cell}</td>`;
            });
            rows += '</tr>';
        }
        
        if (resultData.data.length > previewLimit) {
            const colCount = resultData.data[0].length;
            rows += `<tr><td colspan="${colCount}" style="text-align: center; color: rgba(255,255,255,0.6);">仅显示前 ${previewLimit - startIndex} 行，完整结果请下载</td></tr>`;
        }
        
        preview.innerHTML = `<table class="preview-table">${headers}${rows}</table>`;
    } else {
        let content = '<div class="sheets-preview">';
        resultData.sheets.forEach((sheet, index) => {
            content += `<div class="sheet-item">
                <div class="sheet-name">Sheet ${index + 1}: ${sheet.name}</div>
                <div class="sheet-info">${sheet.data.length} 行</div>
            </div>`;
        });
        content += '</div>';
        preview.innerHTML = content;
    }
}

function downloadResult() {
    const wb = XLSX.utils.book_new();
    
    if (resultData.mode === 'single') {
        const ws = XLSX.utils.aoa_to_sheet(resultData.data);
        XLSX.utils.book_append_sheet(wb, ws, '合并结果');
    } else {
        resultData.sheets.forEach(sheet => {
            const ws = XLSX.utils.aoa_to_sheet(sheet.data);
            XLSX.utils.book_append_sheet(wb, ws, sheet.name);
        });
    }
    
    const fileName = '合并结果_' + new Date().toISOString().slice(0, 19).replace(/:/g, '-') + '.xlsx';
    XLSX.writeFile(wb, fileName);
}

function reset() {
    uploadedFiles = [];
    resultData = null;
    document.getElementById('fileInput').value = '';
    document.getElementById('filesList').style.display = 'none';
    document.getElementById('configSection').style.display = 'none';
    document.getElementById('uploadSection').style.display = 'block';
    document.getElementById('resultSection').style.display = 'none';
}
