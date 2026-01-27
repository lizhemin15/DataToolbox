let uploadedData = null;
let resultData = null;

function goBack() {
    window.location.href = '../../index.html';
}

function downloadSample() {
    const sampleData = [
        ['目标名录', '待匹配名录'],
        ['北京大学', '北大'],
        ['清华大学', '清华'],
        ['中国人民大学', '人大'],
        ['复旦大学', '复旦'],
        ['上海交通大学', '上交'],
        ['浙江大学', '浙大'],
        ['南京大学', '南大'],
        ['中国科学技术大学', '中科大'],
        ['武汉大学', '武大'],
        ['华中科技大学', '华科'],
        ['西安交通大学', '西交'],
        ['同济大学', '同济'],
        ['哈尔滨工业大学', '哈工大'],
        ['北京师范大学', '北师大'],
        ['东南大学', '东大']
    ];
    
    const ws = XLSX.utils.aoa_to_sheet(sampleData);
    
    ws['!cols'] = [
        { wch: 20 },
        { wch: 20 }
    ];
    
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '示例数据');
    
    XLSX.writeFile(wb, '字段匹配示例文件.xlsx');
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
            
            const col1 = jsonData.slice(1).map(row => row[0] || '').filter(v => v !== '');
            const col2 = jsonData.slice(1).map(row => row[1] || '').filter(v => v !== '');
            
            if (col1.length === 0 || col2.length === 0) {
                alert('请确保文件包含两列数据');
                return;
            }
            
            uploadedData = {
                fileName: fileName,
                targetList: col1,
                matchList: col2,
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
    const fileInfo = document.getElementById('fileInfo');
    fileInfo.innerHTML = `
        <strong>文件名：</strong>${uploadedData.fileName}<br>
        <strong>目标名录：</strong>${uploadedData.targetList.length} 条<br>
        <strong>待匹配名录：</strong>${uploadedData.matchList.length} 条
    `;
}

function startMatching() {
    const topN = parseInt(document.getElementById('topN').value);
    
    if (topN < 1 || topN > 10) {
        alert('匹配数量应在 1-10 之间');
        return;
    }
    
    document.getElementById('uploadSection').style.display = 'none';
    document.getElementById('processingSection').style.display = 'block';
    
    setTimeout(() => {
        performMatching(topN);
    }, 100);
}

function performMatching(topN) {
    const { targetList, matchList, rawData } = uploadedData;
    const results = [];
    const totalItems = matchList.length;
    
    matchList.forEach((matchItem, index) => {
        const similarities = targetList.map(targetItem => ({
            value: targetItem,
            score: calculateSimilarity(matchItem, targetItem)
        }));
        
        similarities.sort((a, b) => b.score - a.score);
        const topMatches = similarities.slice(0, topN);
        
        results.push({
            matchItem: matchItem,
            matches: topMatches
        });
        
        const progress = ((index + 1) / totalItems * 100).toFixed(0);
        updateProgress(progress);
    });
    
    resultData = {
        topN: topN,
        results: results,
        targetList: targetList,
        matchList: matchList,
        rawData: rawData
    };
    
    setTimeout(() => {
        showResults();
    }, 500);
}

function calculateSimilarity(str1, str2) {
    if (!str1 || !str2) return 0;
    
    str1 = String(str1).toLowerCase().trim();
    str2 = String(str2).toLowerCase().trim();
    
    if (str1 === str2) return 1.0;
    
    const lev = levenshteinSimilarity(str1, str2);
    const jaro = jaroWinklerSimilarity(str1, str2);
    const ngram = ngramSimilarity(str1, str2, 2);
    const token = tokenSimilarity(str1, str2);
    
    return (lev * 0.25 + jaro * 0.25 + ngram * 0.25 + token * 0.25);
}

function levenshteinDistance(str1, str2) {
    const m = str1.length;
    const n = str2.length;
    const dp = Array(m + 1).fill(null).map(() => Array(n + 1).fill(0));
    
    for (let i = 0; i <= m; i++) dp[i][0] = i;
    for (let j = 0; j <= n; j++) dp[0][j] = j;
    
    for (let i = 1; i <= m; i++) {
        for (let j = 1; j <= n; j++) {
            if (str1[i - 1] === str2[j - 1]) {
                dp[i][j] = dp[i - 1][j - 1];
            } else {
                dp[i][j] = Math.min(
                    dp[i - 1][j] + 1,
                    dp[i][j - 1] + 1,
                    dp[i - 1][j - 1] + 1
                );
            }
        }
    }
    
    return dp[m][n];
}

function levenshteinSimilarity(str1, str2) {
    const maxLen = Math.max(str1.length, str2.length);
    if (maxLen === 0) return 1.0;
    const distance = levenshteinDistance(str1, str2);
    return 1 - (distance / maxLen);
}

function jaroWinklerSimilarity(s1, s2) {
    if (s1 === s2) return 1.0;
    
    const len1 = s1.length;
    const len2 = s2.length;
    
    if (len1 === 0 || len2 === 0) return 0.0;
    
    const matchDistance = Math.floor(Math.max(len1, len2) / 2) - 1;
    const s1Matches = new Array(len1).fill(false);
    const s2Matches = new Array(len2).fill(false);
    
    let matches = 0;
    let transpositions = 0;
    
    for (let i = 0; i < len1; i++) {
        const start = Math.max(0, i - matchDistance);
        const end = Math.min(i + matchDistance + 1, len2);
        
        for (let j = start; j < end; j++) {
            if (s2Matches[j] || s1[i] !== s2[j]) continue;
            s1Matches[i] = true;
            s2Matches[j] = true;
            matches++;
            break;
        }
    }
    
    if (matches === 0) return 0.0;
    
    let k = 0;
    for (let i = 0; i < len1; i++) {
        if (!s1Matches[i]) continue;
        while (!s2Matches[k]) k++;
        if (s1[i] !== s2[k]) transpositions++;
        k++;
    }
    
    const jaro = (matches / len1 + matches / len2 + (matches - transpositions / 2) / matches) / 3;
    
    let prefix = 0;
    for (let i = 0; i < Math.min(len1, len2); i++) {
        if (s1[i] === s2[i]) {
            prefix++;
        } else {
            break;
        }
        if (prefix === 4) break;
    }
    
    return jaro + prefix * 0.1 * (1 - jaro);
}

function ngramSimilarity(str1, str2, n = 2) {
    const ngrams1 = getNgrams(str1, n);
    const ngrams2 = getNgrams(str2, n);
    
    if (ngrams1.length === 0 && ngrams2.length === 0) return 1.0;
    if (ngrams1.length === 0 || ngrams2.length === 0) return 0.0;
    
    const set1 = new Set(ngrams1);
    const set2 = new Set(ngrams2);
    
    const intersection = new Set([...set1].filter(x => set2.has(x)));
    const union = new Set([...set1, ...set2]);
    
    return intersection.size / union.size;
}

function getNgrams(str, n) {
    const ngrams = [];
    for (let i = 0; i <= str.length - n; i++) {
        ngrams.push(str.substring(i, i + n));
    }
    return ngrams;
}

function tokenSimilarity(str1, str2) {
    const tokens1 = tokenize(str1);
    const tokens2 = tokenize(str2);
    
    if (tokens1.length === 0 && tokens2.length === 0) return 1.0;
    if (tokens1.length === 0 || tokens2.length === 0) return 0.0;
    
    const set1 = new Set(tokens1);
    const set2 = new Set(tokens2);
    
    const intersection = new Set([...set1].filter(x => set2.has(x)));
    const union = new Set([...set1, ...set2]);
    
    return intersection.size / union.size;
}

function tokenize(str) {
    return str.split(/[\s\-_.,;:()（）、，。；：！？]+/).filter(t => t.length > 0);
}

function updateProgress(percent) {
    document.getElementById('progressFill').style.width = percent + '%';
    document.getElementById('progressText').textContent = percent + '%';
}

function showResults() {
    document.getElementById('processingSection').style.display = 'none';
    document.getElementById('resultSection').style.display = 'block';
    
    const preview = document.getElementById('resultPreview');
    const { results, topN } = resultData;
    
    let headers = '<tr><th>待匹配项</th>';
    for (let i = 1; i <= topN; i++) {
        headers += `<th>匹配${i}</th>`;
    }
    for (let i = 1; i <= topN; i++) {
        headers += `<th>相似度${i}</th>`;
    }
    headers += '</tr>';
    
    let rows = '';
    const previewLimit = Math.min(results.length, 10);
    
    for (let i = 0; i < previewLimit; i++) {
        const result = results[i];
        rows += '<tr>';
        rows += `<td>${result.matchItem}</td>`;
        
        for (let j = 0; j < topN; j++) {
            const match = result.matches[j] || { value: '', score: 0 };
            rows += `<td>${match.value}</td>`;
        }
        
        for (let j = 0; j < topN; j++) {
            const match = result.matches[j] || { value: '', score: 0 };
            rows += `<td>${(match.score * 100).toFixed(2)}%</td>`;
        }
        
        rows += '</tr>';
    }
    
    if (results.length > previewLimit) {
        rows += `<tr><td colspan="${1 + topN * 2}" style="text-align: center; color: rgba(255,255,255,0.6);">仅显示前 ${previewLimit} 条，完整结果请下载</td></tr>`;
    }
    
    preview.innerHTML = `<table class="preview-table">${headers}${rows}</table>`;
}

function downloadResult() {
    const { results, topN, rawData } = resultData;
    
    const headers = ['目标名录', '待匹配名录'];
    for (let i = 1; i <= topN; i++) {
        headers.push(`匹配${i}`);
    }
    for (let i = 1; i <= topN; i++) {
        headers.push(`相似度${i}`);
    }
    
    const outputData = [headers];
    const maxRows = Math.max(uploadedData.targetList.length, uploadedData.matchList.length);
    
    for (let i = 0; i < maxRows; i++) {
        const row = [];
        row.push(uploadedData.targetList[i] || '');
        row.push(uploadedData.matchList[i] || '');
        
        if (i < results.length) {
            const result = results[i];
            for (let j = 0; j < topN; j++) {
                const match = result.matches[j] || { value: '', score: 0 };
                row.push(match.value);
            }
            for (let j = 0; j < topN; j++) {
                const match = result.matches[j] || { value: '', score: 0 };
                row.push((match.score * 100).toFixed(2) + '%');
            }
        } else {
            for (let j = 0; j < topN * 2; j++) {
                row.push('');
            }
        }
        
        outputData.push(row);
    }
    
    const ws = XLSX.utils.aoa_to_sheet(outputData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '匹配结果');
    
    const fileName = '字段匹配结果_' + new Date().toISOString().slice(0, 19).replace(/:/g, '-') + '.xlsx';
    XLSX.writeFile(wb, fileName);
}

function reset() {
    uploadedData = null;
    resultData = null;
    document.getElementById('fileInput').value = '';
    document.getElementById('topN').value = '3';
    document.getElementById('configSection').style.display = 'none';
    document.getElementById('uploadSection').style.display = 'block';
    document.getElementById('resultSection').style.display = 'none';
}
