// 全局变量
let currentFiles = {
    image: [],
    document: [],
    media: []
};

let ffmpegLoaded = false;
let ffmpeg = null;

// 初始化 PDF.js
if (typeof pdfjsLib !== 'undefined') {
    pdfjsLib.GlobalWorkerOptions.workerSrc = '../../lib/pdf.worker.min.js';
}

// 初始化
document.addEventListener('DOMContentLoaded', function() {
    initTabs();
    initImageConverter();
    initDocumentConverter();
    initMediaConverter();
});

// 标签页切换
function initTabs() {
    const tabBtns = document.querySelectorAll('.tab-btn');
    const tabContents = document.querySelectorAll('.tab-content');

    tabBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const tabName = btn.dataset.tab;
            
            tabBtns.forEach(b => b.classList.remove('active'));
            tabContents.forEach(c => c.classList.remove('active'));
            
            btn.classList.add('active');
            document.getElementById(`${tabName}-tab`).classList.add('active');

            // 隐藏进度和结果
            document.getElementById('progress-section').style.display = 'none';
            document.getElementById('results-section').style.display = 'none';
        });
    });
}

// ========== 图片转换 ==========
function initImageConverter() {
    const uploadArea = document.getElementById('image-upload-area');
    const fileInput = document.getElementById('image-input');
    const convertBtn = document.getElementById('image-convert-btn');
    const qualityInput = document.getElementById('image-quality');
    const qualityValue = document.getElementById('quality-value');

    uploadArea.addEventListener('click', () => fileInput.click());
    uploadArea.addEventListener('dragover', handleDragOver);
    uploadArea.addEventListener('dragleave', handleDragLeave);
    uploadArea.addEventListener('drop', (e) => handleDrop(e, 'image'));

    fileInput.addEventListener('change', (e) => handleFileSelect(e.target.files, 'image'));
    convertBtn.addEventListener('click', convertImages);
    
    qualityInput.addEventListener('input', (e) => {
        qualityValue.textContent = e.target.value;
    });
}

function convertImages() {
    const files = currentFiles.image;
    if (files.length === 0) return;

    const format = document.getElementById('image-format').value;
    const quality = parseInt(document.getElementById('image-quality').value) / 100;

    showProgress();
    const results = [];
    let processed = 0;

    files.forEach((file, index) => {
        const reader = new FileReader();
        reader.onload = function(e) {
            const img = new Image();
            img.onload = function() {
                const canvas = document.createElement('canvas');
                canvas.width = img.width;
                canvas.height = img.height;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0);

                canvas.toBlob((blob) => {
                    const fileName = file.name.replace(/\.[^/.]+$/, '') + '.' + format;
                    results.push({
                        name: fileName,
                        blob: blob,
                        size: blob.size
                    });

                    processed++;
                    updateProgress(processed, files.length);

                    if (processed === files.length) {
                        showResults(results);
                    }
                }, `image/${format === 'jpg' ? 'jpeg' : format}`, quality);
            };
            img.src = e.target.result;
        };
        reader.readAsDataURL(file);
    });
}

// ========== 文档转换 ==========
function initDocumentConverter() {
    const uploadArea = document.getElementById('doc-upload-area');
    const fileInput = document.getElementById('doc-input');
    const convertBtn = document.getElementById('doc-convert-btn');

    uploadArea.addEventListener('click', () => fileInput.click());
    uploadArea.addEventListener('dragover', handleDragOver);
    uploadArea.addEventListener('dragleave', handleDragLeave);
    uploadArea.addEventListener('drop', (e) => handleDrop(e, 'document'));

    fileInput.addEventListener('change', (e) => handleFileSelect(e.target.files, 'document'));
    convertBtn.addEventListener('click', convertDocuments);
}

async function convertDocuments() {
    const files = currentFiles.document;
    if (files.length === 0) return;

    const targetFormat = document.getElementById('doc-format').value;
    showProgress();

    const results = [];
    
    for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const result = await convertDocument(file, targetFormat);
        results.push(result);
        updateProgress(i + 1, files.length);
    }

    showResults(results);
}

async function convertDocument(file, targetFormat) {
    const fileName = file.name;
    const extension = fileName.split('.').pop().toLowerCase();

    let data = null;

    // 读取原文件
    if (extension === 'xlsx' || extension === 'xls') {
        data = await readExcel(file);
    } else if (extension === 'csv') {
        data = await readCSV(file);
    } else if (extension === 'json') {
        data = await readJSON(file);
    } else if (extension === 'txt') {
        data = await readTXT(file);
    } else if (extension === 'pdf') {
        data = await readPDF(file);
    } else if (extension === 'docx' || extension === 'doc') {
        data = await readWord(file);
    }

    // 转换为目标格式
    let blob = null;
    let newFileName = fileName.replace(/\.[^/.]+$/, '') + '.' + targetFormat;

    if (targetFormat === 'xlsx') {
        blob = createExcel(data);
    } else if (targetFormat === 'csv') {
        blob = createCSV(data);
    } else if (targetFormat === 'json') {
        blob = createJSON(data);
    } else if (targetFormat === 'txt') {
        blob = createTXT(data);
    } else if (targetFormat === 'pdf') {
        blob = await createPDF(data);
    } else if (targetFormat === 'docx') {
        blob = await createWord(data);
    }

    return {
        name: newFileName,
        blob: blob,
        size: blob.size
    };
}

// 读取文件函数
function readExcel(file) {
    return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = function(e) {
            const data = new Uint8Array(e.target.result);
            const workbook = XLSX.read(data, { type: 'array' });
            const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
            const jsonData = XLSX.utils.sheet_to_json(firstSheet, { header: 1 });
            resolve(jsonData);
        };
        reader.readAsArrayBuffer(file);
    });
}

function readCSV(file) {
    return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = function(e) {
            const result = Papa.parse(e.target.result);
            resolve(result.data);
        };
        reader.readAsText(file);
    });
}

function readJSON(file) {
    return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = function(e) {
            const jsonData = JSON.parse(e.target.result);
            // 转换为二维数组
            if (Array.isArray(jsonData)) {
                if (jsonData.length > 0 && typeof jsonData[0] === 'object') {
                    const headers = Object.keys(jsonData[0]);
                    const rows = [headers];
                    jsonData.forEach(obj => {
                        rows.push(headers.map(h => obj[h]));
                    });
                    resolve(rows);
                } else {
                    resolve([jsonData]);
                }
            } else {
                resolve([[JSON.stringify(jsonData)]]);
            }
        };
        reader.readAsText(file);
    });
}

function readTXT(file) {
    return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = function(e) {
            const lines = e.target.result.split('\n');
            resolve(lines.map(line => [line]));
        };
        reader.readAsText(file);
    });
}

async function readPDF(file) {
    return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = async function(e) {
            try {
                if (typeof pdfjsLib === 'undefined') {
                    resolve([['PDF读取功能需要PDF.js库']]);
                    return;
                }
                
                const pdf = await pdfjsLib.getDocument({ data: e.target.result }).promise;
                const textLines = [];
                
                for (let i = 1; i <= Math.min(pdf.numPages, 10); i++) {
                    const page = await pdf.getPage(i);
                    const textContent = await page.getTextContent();
                    const pageText = textContent.items.map(item => item.str).join(' ');
                    
                    if (pageText.trim()) {
                        textLines.push([`第${i}页: ${pageText.substring(0, 100)}...`]);
                    }
                }
                
                if (textLines.length === 0) {
                    textLines.push(['PDF中未找到可提取的文本']);
                }
                
                if (pdf.numPages > 10) {
                    textLines.push([`... (共 ${pdf.numPages} 页，仅显示前10页)`]);
                }
                
                resolve(textLines);
            } catch (error) {
                resolve([['PDF读取失败'], [error.message]]);
            }
        };
        reader.readAsArrayBuffer(file);
    });
}

async function readWord(file) {
    return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = async function(e) {
            try {
                if (typeof mammoth === 'undefined') {
                    resolve([['Word读取功能需要Mammoth.js库']]);
                    return;
                }
                
                const result = await mammoth.extractRawText({ arrayBuffer: e.target.result });
                const text = result.value;
                
                if (!text.trim()) {
                    resolve([['Word文档中未找到文本']]);
                    return;
                }
                
                // 将文本按行分割
                const lines = text.split('\n').filter(line => line.trim());
                const data = lines.slice(0, 100).map(line => [line.trim()]);
                
                if (lines.length > 100) {
                    data.push([`... (共 ${lines.length} 行，仅显示前100行)`]);
                }
                
                resolve(data);
            } catch (error) {
                resolve([['Word读取失败'], [error.message]]);
            }
        };
        reader.readAsArrayBuffer(file);
    });
}

// 创建文件函数
function createExcel(data) {
    const ws = XLSX.utils.aoa_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
    const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    return new Blob([wbout], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

function createCSV(data) {
    const csv = Papa.unparse(data);
    return new Blob([csv], { type: 'text/csv;charset=utf-8;' });
}

function createJSON(data) {
    let jsonData;
    if (data.length > 0 && data[0].length > 0) {
        const headers = data[0];
        jsonData = data.slice(1).map(row => {
            const obj = {};
            headers.forEach((header, index) => {
                obj[header] = row[index];
            });
            return obj;
        });
    } else {
        jsonData = data;
    }
    const jsonStr = JSON.stringify(jsonData, null, 2);
    return new Blob([jsonStr], { type: 'application/json;charset=utf-8;' });
}

function createTXT(data) {
    const text = data.map(row => row.join('\t')).join('\n');
    return new Blob([text], { type: 'text/plain;charset=utf-8;' });
}

async function createPDF(data) {
    const pdfDoc = await PDFLib.PDFDocument.create();
    let page = pdfDoc.addPage([595, 842]); // A4尺寸
    const { width, height } = page.getSize();
    
    const fontSize = 12;
    const lineHeight = 20;
    let y = height - 50;
    
    const font = await pdfDoc.embedFont(PDFLib.StandardFonts.Helvetica);
    
    // 添加标题
    page.drawText('Data Export', {
        x: 50,
        y: y,
        size: 18,
        font: font,
    });
    
    y -= 40;
    
    // 添加数据（表格形式）
    for (let i = 0; i < Math.min(data.length, 30); i++) {
        const row = data[i];
        const text = row.join(' | ');
        
        if (y < 50) {
            page = pdfDoc.addPage([595, 842]);
            y = height - 50;
        }
        
        page.drawText(text.substring(0, 80), {
            x: 50,
            y: y,
            size: fontSize,
            font: font,
        });
        
        y -= lineHeight;
    }
    
    if (data.length > 30) {
        y -= 10;
        page.drawText(`... (共 ${data.length} 行数据)`, {
            x: 50,
            y: y,
            size: 10,
            font: font,
        });
    }
    
    const pdfBytes = await pdfDoc.save();
    return new Blob([pdfBytes], { type: 'application/pdf' });
}

async function createWord(data) {
    const doc = new docx.Document({
        sections: [{
            properties: {},
            children: [
                new docx.Paragraph({
                    text: "数据导出",
                    heading: docx.HeadingLevel.HEADING_1,
                }),
                new docx.Paragraph({
                    text: "",
                }),
                // 创建表格
                new docx.Table({
                    rows: data.slice(0, 100).map((row, rowIndex) => {
                        return new docx.TableRow({
                            children: row.map(cell => {
                                return new docx.TableCell({
                                    children: [
                                        new docx.Paragraph({
                                            text: String(cell || ''),
                                        })
                                    ],
                                    width: {
                                        size: Math.floor(9000 / row.length),
                                        type: docx.WidthType.DXA,
                                    },
                                });
                            }),
                        });
                    }),
                }),
            ],
        }],
    });
    
    const blob = await docx.Packer.toBlob(doc);
    return blob;
}

// ========== 音视频转换 ==========
function initMediaConverter() {
    const uploadArea = document.getElementById('media-upload-area');
    const fileInput = document.getElementById('media-input');
    const convertBtn = document.getElementById('media-convert-btn');

    uploadArea.addEventListener('click', () => fileInput.click());
    uploadArea.addEventListener('dragover', handleDragOver);
    uploadArea.addEventListener('dragleave', handleDragLeave);
    uploadArea.addEventListener('drop', (e) => handleDrop(e, 'media'));

    fileInput.addEventListener('change', (e) => handleFileSelect(e.target.files, 'media'));
    convertBtn.addEventListener('click', convertMedia);
}

async function convertMedia() {
    alert('音视频转换功能需要使用 FFmpeg.wasm 库（约30MB），由于完全离线运行的限制，此功能需要预先下载完整的 FFmpeg Core 文件。\n\n如需使用此功能，建议使用在线版本或手动下载 FFmpeg Core 文件到 lib 文件夹。\n\n当前版本暂不支持音视频转换，但支持：\n- 图片格式转换\n- 文档格式转换（Excel, CSV, JSON, TXT）');
}

// ========== 通用函数 ==========
function handleDragOver(e) {
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.classList.add('dragover');
}

function handleDragLeave(e) {
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.classList.remove('dragover');
}

function handleDrop(e, type) {
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.classList.remove('dragover');
    
    const files = Array.from(e.dataTransfer.files);
    handleFileSelect(files, type);
}

function handleFileSelect(files, type) {
    if (files.length === 0) return;

    currentFiles[type] = Array.from(files);
    displayFileList(type);
    
    document.getElementById(`${type === 'document' ? 'doc' : type}-upload-area`).style.display = 'none';
    document.getElementById(`${type === 'document' ? 'doc' : type}-options`).style.display = 'block';
}

function displayFileList(type) {
    const listId = type === 'document' ? 'doc-file-list' : `${type}-file-list`;
    const fileList = document.getElementById(listId);
    fileList.innerHTML = '';

    currentFiles[type].forEach((file, index) => {
        const fileItem = document.createElement('div');
        fileItem.className = 'file-item';
        fileItem.innerHTML = `
            <span class="file-name">📄 ${file.name}</span>
            <span class="file-size">${formatFileSize(file.size)}</span>
            <button class="remove-file" onclick="removeFile('${type}', ${index})">删除</button>
        `;
        fileList.appendChild(fileItem);
    });
}

function removeFile(type, index) {
    currentFiles[type].splice(index, 1);
    
    if (currentFiles[type].length === 0) {
        const prefix = type === 'document' ? 'doc' : type;
        document.getElementById(`${prefix}-upload-area`).style.display = 'block';
        document.getElementById(`${prefix}-options`).style.display = 'none';
    } else {
        displayFileList(type);
    }
}

function showProgress() {
    document.getElementById('progress-section').style.display = 'block';
    document.getElementById('results-section').style.display = 'none';
    updateProgress(0, 100);
}

function updateProgress(current, total) {
    const percent = Math.round((current / total) * 100);
    document.getElementById('progress-fill').style.width = percent + '%';
    document.getElementById('progress-percent').textContent = percent + '%';
    document.getElementById('progress-text').textContent = `处理中 (${current}/${total})`;
}

function showResults(results) {
    document.getElementById('progress-section').style.display = 'none';
    document.getElementById('results-section').style.display = 'block';
    
    const resultsList = document.getElementById('results-list');
    resultsList.innerHTML = '';

    results.forEach((result, index) => {
        const resultItem = document.createElement('div');
        resultItem.className = 'result-item';
        resultItem.innerHTML = `
            <div class="result-info">
                <div class="result-name">✅ ${result.name}</div>
                <div class="result-size">${formatFileSize(result.size)}</div>
            </div>
            <button class="download-btn" onclick="downloadFile(${index})">下载</button>
        `;
        resultsList.appendChild(resultItem);
    });

    // 添加全部下载按钮
    if (results.length > 1) {
        const downloadAllBtn = document.createElement('button');
        downloadAllBtn.className = 'download-all-btn';
        downloadAllBtn.textContent = '下载全部';
        downloadAllBtn.onclick = downloadAll;
        resultsList.appendChild(downloadAllBtn);
    }

    // 保存结果供下载使用
    window.conversionResults = results;
}

function downloadFile(index) {
    const result = window.conversionResults[index];
    const url = URL.createObjectURL(result.blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = result.name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

async function downloadAll() {
    const zip = new JSZip();
    const results = window.conversionResults;

    for (let i = 0; i < results.length; i++) {
        zip.file(results[i].name, results[i].blob);
    }

    const content = await zip.generateAsync({ type: 'blob' });
    const url = URL.createObjectURL(content);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'converted_files.zip';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

function formatFileSize(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
}

// 返回主页
function goBack() {
    window.location.href = '../../index.html';
}
