/**
 * 开发者：李哲民
 */

let resultData = null;

function goBack() {
    window.location.href = '../../index.html';
}

function toggleSettings() {
    const modal = document.getElementById('settingsModal');
    if (modal.classList.contains('show')) {
        modal.classList.remove('show');
    } else {
        loadSettings();
        modal.classList.add('show');
    }
}

function loadSettings() {
    const settings = {
        apiUrl: localStorage.getItem('ai_structurer_apiUrl') || 'https://api.openai.com/v1/chat/completions',
        apiKey: localStorage.getItem('ai_structurer_apiKey') || '',
        apiModel: localStorage.getItem('ai_structurer_apiModel') || 'gpt-4o-mini'
    };
    
    document.getElementById('apiUrl').value = settings.apiUrl;
    document.getElementById('apiKey').value = settings.apiKey;
    document.getElementById('apiModel').value = settings.apiModel;
}

function saveSettings() {
    const apiUrl = document.getElementById('apiUrl').value.trim();
    const apiKey = document.getElementById('apiKey').value.trim();
    const apiModel = document.getElementById('apiModel').value.trim();
    
    if (!apiUrl || !apiKey || !apiModel) {
        alert('请填写完整的API设置');
        return;
    }
    
    localStorage.setItem('ai_structurer_apiUrl', apiUrl);
    localStorage.setItem('ai_structurer_apiKey', apiKey);
    localStorage.setItem('ai_structurer_apiModel', apiModel);
    
    alert('设置已保存');
    toggleSettings();
}

function loadExample() {
    const exampleText = `张三，男，28岁，毕业于清华大学计算机系，现就职于某科技公司，担任高级软件工程师。联系方式：zhangsan@example.com，电话：13800138000。工作经验5年，熟练掌握Python、Java、JavaScript等编程语言，擅长后端开发和系统架构设计。`;
    
    const exampleSchema = `{
  "name": "string",
  "gender": "string",
  "age": "number",
  "education": {
    "university": "string",
    "major": "string"
  },
  "work": {
    "company": "string",
    "position": "string",
    "years": "number"
  },
  "contact": {
    "email": "string",
    "phone": "string"
  },
  "skills": ["string"]
}`;
    
    document.getElementById('inputText').value = exampleText;
    document.getElementById('jsonSchema').value = exampleSchema;
}

async function startProcessing() {
    const inputText = document.getElementById('inputText').value.trim();
    const jsonSchema = document.getElementById('jsonSchema').value.trim();
    const mode = document.querySelector('input[name="mode"]:checked').value;
    
    if (!inputText) {
        alert('请输入需要结构化的文本');
        return;
    }
    
    if (!jsonSchema) {
        alert('请定义JSON格式');
        return;
    }
    
    const apiUrl = localStorage.getItem('ai_structurer_apiUrl');
    const apiKey = localStorage.getItem('ai_structurer_apiKey');
    const apiModel = localStorage.getItem('ai_structurer_apiModel');
    
    if (!apiUrl || !apiKey || !apiModel) {
        alert('请先在设置中配置API信息');
        toggleSettings();
        return;
    }
    
    let schemaObj;
    try {
        schemaObj = JSON.parse(jsonSchema);
    } catch (e) {
        alert('JSON格式定义不正确，请检查');
        return;
    }
    
    document.getElementById('mainSection').style.display = 'none';
    document.getElementById('processingSection').style.display = 'flex';
    
    try {
        let result;
        if (mode === 'native') {
            result = await processWithNativeMode(inputText, schemaObj, apiUrl, apiKey, apiModel);
        } else {
            result = await processWithPromptMode(inputText, schemaObj, apiUrl, apiKey, apiModel);
        }
        
        resultData = result;
        showResult();
    } catch (error) {
        alert('处理失败：' + error.message);
        reset();
    }
}

async function processWithNativeMode(inputText, schemaObj, apiUrl, apiKey, apiModel) {
    const prompt = `请将以下非结构化文本转换为JSON格式。

文本内容：
${inputText}

期望的JSON格式：
${JSON.stringify(schemaObj, null, 2)}

请严格按照给定的JSON格式返回结果，确保字段类型正确。`;

    const requestBody = {
        model: apiModel,
        messages: [
            {
                role: "system",
                content: "你是一个专业的数据结构化助手，擅长将非结构化文本转换为结构化的JSON数据。"
            },
            {
                role: "user",
                content: prompt
            }
        ],
        response_format: { type: "json_object" },
        temperature: 0.3
    };
    
    updateStatus('正在调用AI模型（原生JSON模式）...');
    
    const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify(requestBody)
    });
    
    if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error?.message || '调用API失败');
    }
    
    const data = await response.json();
    const content = data.choices[0].message.content;
    
    return JSON.parse(content);
}

async function processWithPromptMode(inputText, schemaObj, apiUrl, apiKey, apiModel) {
    const prompt = `请将以下非结构化文本转换为JSON格式。

文本内容：
${inputText}

期望的JSON格式：
${JSON.stringify(schemaObj, null, 2)}

重要要求：
1. 严格按照给定的JSON格式返回结果
2. 确保字段类型正确（string、number、array、object等）
3. 如果文本中没有某个字段的信息，可以使用null或合理的默认值
4. 只返回JSON数据，不要包含任何其他说明文字
5. 确保返回的JSON格式正确，可以被解析`;

    const requestBody = {
        model: apiModel,
        messages: [
            {
                role: "system",
                content: "你是一个专业的数据结构化助手。你必须严格按照用户提供的JSON格式返回结果，不要添加任何额外的说明或文字，只返回纯JSON数据。"
            },
            {
                role: "user",
                content: prompt
            }
        ],
        temperature: 0.3
    };
    
    updateStatus('正在调用AI模型（提示词模式）...');
    
    const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify(requestBody)
    });
    
    if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error?.message || '调用API失败');
    }
    
    const data = await response.json();
    let content = data.choices[0].message.content;
    
    updateStatus('正在处理返回结果...');
    
    content = content.trim();
    if (content.startsWith('```json')) {
        content = content.replace(/^```json\n/, '').replace(/\n```$/, '');
    } else if (content.startsWith('```')) {
        content = content.replace(/^```\n/, '').replace(/\n```$/, '');
    }
    
    let jsonResult;
    try {
        jsonResult = JSON.parse(content);
    } catch (e) {
        const jsonMatch = content.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
            jsonResult = JSON.parse(jsonMatch[0]);
        } else {
            throw new Error('无法解析AI返回的JSON数据');
        }
    }
    
    jsonResult = enforceSchema(jsonResult, schemaObj);
    
    return jsonResult;
}

function enforceSchema(data, schema) {
    if (typeof schema !== 'object' || schema === null) {
        return data;
    }
    
    if (Array.isArray(schema)) {
        if (!Array.isArray(data)) {
            return [];
        }
        return data.map(item => enforceSchema(item, schema[0]));
    }
    
    const result = {};
    
    for (const key in schema) {
        const schemaValue = schema[key];
        const dataValue = data[key];
        
        if (typeof schemaValue === 'string') {
            switch (schemaValue) {
                case 'string':
                    result[key] = dataValue != null ? String(dataValue) : '';
                    break;
                case 'number':
                    result[key] = dataValue != null ? Number(dataValue) : 0;
                    break;
                case 'boolean':
                    result[key] = dataValue != null ? Boolean(dataValue) : false;
                    break;
                default:
                    result[key] = dataValue != null ? dataValue : null;
            }
        } else if (Array.isArray(schemaValue)) {
            if (Array.isArray(dataValue)) {
                result[key] = dataValue.map(item => enforceSchema(item, schemaValue[0]));
            } else {
                result[key] = [];
            }
        } else if (typeof schemaValue === 'object') {
            result[key] = enforceSchema(dataValue || {}, schemaValue);
        }
    }
    
    return result;
}

function updateStatus(text) {
    document.getElementById('statusText').textContent = text;
}

function showResult() {
    document.getElementById('processingSection').style.display = 'none';
    document.getElementById('resultSection').style.display = 'flex';
    
    const resultJson = document.getElementById('resultJson');
    resultJson.textContent = JSON.stringify(resultData, null, 2);
}

function copyResult() {
    const resultText = JSON.stringify(resultData, null, 2);
    navigator.clipboard.writeText(resultText).then(() => {
        const btn = document.querySelector('.copy-btn');
        const originalText = btn.textContent;
        btn.textContent = '✓ 已复制';
        setTimeout(() => {
            btn.textContent = originalText;
        }, 2000);
    }).catch(err => {
        alert('复制失败：' + err.message);
    });
}

function downloadResult() {
    const resultText = JSON.stringify(resultData, null, 2);
    const blob = new Blob([resultText], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'structured_data_' + new Date().toISOString().slice(0, 19).replace(/:/g, '-') + '.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

function reset() {
    resultData = null;
    document.getElementById('mainSection').style.display = 'block';
    document.getElementById('processingSection').style.display = 'none';
    document.getElementById('resultSection').style.display = 'none';
}

window.addEventListener('click', (e) => {
    const modal = document.getElementById('settingsModal');
    if (e.target === modal && modal.classList.contains('show')) {
        toggleSettings();
    }
});

document.addEventListener('DOMContentLoaded', () => {
    const modal = document.getElementById('settingsModal');
    if (modal) {
        modal.classList.remove('show');
    }
});
