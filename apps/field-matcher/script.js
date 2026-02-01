/**
 * 开发者：李哲民
 */

let uploadedData = null;
let resultData = null;

function goBack() {
    window.location.href = '../../index.html';
}

function toggleAlgorithmInfo() {
    const info = document.getElementById('algorithmInfo');
    if (info.style.display === 'none') {
        info.style.display = 'block';
    } else {
        info.style.display = 'none';
    }
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
    const threshold = parseInt(document.getElementById('threshold').value) / 100;
    
    if (topN < 1 || topN > 10) {
        alert('匹配数量应在 1-10 之间');
        return;
    }
    
    const algorithms = {
        levenshtein: document.getElementById('useLevenshtein').checked,
        jaroWinkler: document.getElementById('useJaroWinkler').checked,
        ngram: document.getElementById('useNgram').checked,
        token: document.getElementById('useToken').checked,
        cosine: document.getElementById('useCosine').checked,
        lcs: document.getElementById('useLCS').checked,
        pinyin: document.getElementById('usePinyin').checked
    };
    
    const anySelected = Object.values(algorithms).some(v => v);
    if (!anySelected) {
        alert('请至少选择一种匹配算法');
        return;
    }
    
    const options = {
        caseSensitive: document.getElementById('caseSensitive').checked,
        ignoreSpaces: document.getElementById('ignoreSpaces').checked
    };
    
    document.getElementById('uploadSection').style.display = 'none';
    document.getElementById('processingSection').style.display = 'block';
    
    setTimeout(() => {
        performMatching(topN, threshold, algorithms, options);
    }, 100);
}

function performMatching(topN, threshold, algorithms, options) {
    const { targetList, matchList, rawData } = uploadedData;
    const results = [];
    const totalItems = matchList.length;
    
    matchList.forEach((matchItem, index) => {
        const similarities = targetList.map(targetItem => ({
            value: targetItem,
            score: calculateSimilarity(matchItem, targetItem, algorithms, options)
        }));
        
        similarities.sort((a, b) => b.score - a.score);
        let topMatches = similarities.slice(0, topN);
        
        if (threshold > 0) {
            topMatches = topMatches.filter(m => m.score >= threshold);
        }
        
        results.push({
            matchItem: matchItem,
            matches: topMatches
        });
        
        const progress = ((index + 1) / totalItems * 100).toFixed(0);
        updateProgress(progress);
    });
    
    resultData = {
        topN: topN,
        threshold: threshold,
        algorithms: algorithms,
        options: options,
        results: results,
        targetList: targetList,
        matchList: matchList,
        rawData: rawData
    };
    
    setTimeout(() => {
        showResults();
    }, 500);
}

function calculateSimilarity(str1, str2, algorithms, options) {
    if (!str1 || !str2) return 0;
    
    str1 = String(str1).trim();
    str2 = String(str2).trim();
    
    if (options.ignoreSpaces) {
        str1 = str1.replace(/\s+/g, '');
        str2 = str2.replace(/\s+/g, '');
    }
    
    if (!options.caseSensitive) {
        str1 = str1.toLowerCase();
        str2 = str2.toLowerCase();
    }
    
    if (str1 === str2) return 1.0;
    
    const scores = [];
    let totalWeight = 0;
    
    if (algorithms.levenshtein) {
        scores.push(levenshteinSimilarity(str1, str2));
        totalWeight += 1;
    }
    
    if (algorithms.jaroWinkler) {
        scores.push(jaroWinklerSimilarity(str1, str2));
        totalWeight += 1;
    }
    
    if (algorithms.ngram) {
        scores.push(ngramSimilarity(str1, str2, 2));
        totalWeight += 1;
    }
    
    if (algorithms.token) {
        scores.push(tokenSimilarity(str1, str2));
        totalWeight += 1;
    }
    
    if (algorithms.cosine) {
        scores.push(cosineSimilarity(str1, str2));
        totalWeight += 1;
    }
    
    if (algorithms.lcs) {
        scores.push(lcsSimilarity(str1, str2));
        totalWeight += 1;
    }
    
    if (algorithms.pinyin) {
        scores.push(pinyinSimilarity(str1, str2));
        totalWeight += 1;
    }
    
    if (totalWeight === 0) return 0;
    
    return scores.reduce((sum, score) => sum + score, 0) / totalWeight;
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

function cosineSimilarity(str1, str2) {
    const vec1 = getCharFrequency(str1);
    const vec2 = getCharFrequency(str2);
    
    const allChars = new Set([...Object.keys(vec1), ...Object.keys(vec2)]);
    
    if (allChars.size === 0) return 1.0;
    
    let dotProduct = 0;
    let mag1 = 0;
    let mag2 = 0;
    
    for (const char of allChars) {
        const v1 = vec1[char] || 0;
        const v2 = vec2[char] || 0;
        dotProduct += v1 * v2;
        mag1 += v1 * v1;
        mag2 += v2 * v2;
    }
    
    if (mag1 === 0 || mag2 === 0) return 0.0;
    
    return dotProduct / (Math.sqrt(mag1) * Math.sqrt(mag2));
}

function getCharFrequency(str) {
    const freq = {};
    for (const char of str) {
        freq[char] = (freq[char] || 0) + 1;
    }
    return freq;
}

function lcsSimilarity(str1, str2) {
    const lcsLength = longestCommonSubsequence(str1, str2);
    const maxLen = Math.max(str1.length, str2.length);
    
    if (maxLen === 0) return 1.0;
    return lcsLength / maxLen;
}

function longestCommonSubsequence(str1, str2) {
    const m = str1.length;
    const n = str2.length;
    const dp = Array(m + 1).fill(null).map(() => Array(n + 1).fill(0));
    
    for (let i = 1; i <= m; i++) {
        for (let j = 1; j <= n; j++) {
            if (str1[i - 1] === str2[j - 1]) {
                dp[i][j] = dp[i - 1][j - 1] + 1;
            } else {
                dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
            }
        }
    }
    
    return dp[m][n];
}

function pinyinSimilarity(str1, str2) {
    const pinyin1 = chineseToPinyin(str1);
    const pinyin2 = chineseToPinyin(str2);
    
    if (pinyin1 === pinyin2) return 1.0;
    
    const levSim = levenshteinSimilarity(pinyin1, pinyin2);
    const ngramSim = ngramSimilarity(pinyin1, pinyin2, 2);
    
    return (levSim * 0.6 + ngramSim * 0.4);
}

function chineseToPinyin(str) {
    const pinyinMap = {
        '北': 'bei', '京': 'jing', '大': 'da', '学': 'xue',
        '清': 'qing', '华': 'hua', '中': 'zhong', '国': 'guo',
        '人': 'ren', '民': 'min', '复': 'fu', '旦': 'dan',
        '上': 'shang', '海': 'hai', '交': 'jiao', '通': 'tong',
        '浙': 'zhe', '江': 'jiang', '南': 'nan', '科': 'ke',
        '技': 'ji', '术': 'shu', '武': 'wu', '汉': 'han',
        '华': 'hua', '中': 'zhong', '西': 'xi', '安': 'an',
        '同': 'tong', '济': 'ji', '哈': 'ha', '尔': 'er',
        '滨': 'bin', '工': 'gong', '业': 'ye', '师': 'shi',
        '范': 'fan', '东': 'dong', '山': 'shan', '天': 'tian',
        '津': 'jin', '四': 'si', '川': 'chuan', '重': 'chong',
        '庆': 'qing', '湖': 'hu', '广': 'guang', '州': 'zhou',
        '深': 'shen', '圳': 'zhen', '杭': 'hang', '苏': 'su',
        '宁': 'ning', '成': 'cheng', '都': 'du', '厦': 'xia',
        '门': 'men', '福': 'fu', '建': 'jian', '理': 'li',
        '工': 'gong', '农': 'nong', '医': 'yi', '药': 'yao',
        '军': 'jun', '事': 'shi', '政': 'zheng', '法': 'fa',
        '财': 'cai', '经': 'jing', '贸': 'mao', '易': 'yi',
        '语': 'yu', '言': 'yan', '外': 'wai', '教': 'jiao',
        '育': 'yu', '体': 'ti', '音': 'yin', '乐': 'yue',
        '美': 'mei', '林': 'lin', '农': 'nong', '矿': 'kuang',
        '石': 'shi', '油': 'you', '电': 'dian', '力': 'li',
        '航': 'hang', '空': 'kong', '邮': 'you', '电': 'dian',
        '铁': 'tie', '道': 'dao', '运': 'yun', '输': 'shu'
    };
    
    let result = '';
    for (const char of str) {
        if (pinyinMap[char]) {
            result += pinyinMap[char];
        } else if (/[a-zA-Z0-9]/.test(char)) {
            result += char.toLowerCase();
        }
    }
    
    return result || str.toLowerCase();
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
