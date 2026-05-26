import PizZip from 'pizzip';
import Docxtemplater from 'docxtemplater';
import * as fs from 'fs';

const content = fs.readFileSync('/tmp/test-template.docx');
const zip = new PizZip(content);
const doc = new Docxtemplater(zip, { paragraphLoop: true, linebreaks: true });

// 测试场景1: 简单文本（无换行）
const data1 = { title: "这是加粗文字测试" };
doc.setData(data1);
doc.render();
const xml1 = doc.getZip().file('word/document.xml').asText();
console.log("=== 场景1: 简单文本（无换行）===");
const p1Regex = /<w:p[^>]*>[\s\S]*?<\/w:p>/g;
let match1;
while ((match1 = p1Regex.exec(xml1)) !== null) {
    if (match1[0].includes('这是加粗文字测试')) {
        console.log(match1[0]);
        console.log("---");
    }
}

// 测试场景2: 含换行的文本
const zip2 = new PizZip(content);
const doc2 = new Docxtemplater(zip2, { paragraphLoop: true, linebreaks: true });
const data2 = { title: "第一行\n第二行\n第三行" };
doc2.setData(data2);
doc2.render();
const xml2 = doc2.getZip().file('word/document.xml').asText();
console.log("\n=== 场景2: 含换行的文本 ===");
const p2Regex = /<w:p[^>]*>[\s\S]*?<\/w:p>/g;
let match2;
while ((match2 = p2Regex.exec(xml2)) !== null) {
    if (match2[0].includes('第一行') || match2[0].includes('第二行') || match2[0].includes('第三行')) {
        console.log(match2[0]);
        console.log("---");
    }
}

// 测试场景3: 预处理后纯文本+换行（模拟 **加粗标题** -> 加粗标题）
const zip3 = new PizZip(content);
const doc3 = new Docxtemplater(zip3, { paragraphLoop: true, linebreaks: true });
const data3 = { title: "加粗标题\n普通行" };
doc3.setData(data3);
doc3.render();
const xml3 = doc3.getZip().file('word/document.xml').asText();
console.log("\n=== 场景3: 预处理后纯文本+换行 ===");
const p3Regex = /<w:p[^>]*>[\s\S]*?<\/w:p>/g;
let match3;
while ((match3 = p3Regex.exec(xml3)) !== null) {
    if (match3[0].includes('加粗标题') || match3[0].includes('普通行')) {
        console.log(match3[0]);
        console.log("---");
    }
}

// 测试场景4: 模拟完整的 processFormatData 流程
// 输入: "**加粗标题**\n普通行"
// processFormatData 处理后: data={title:"加粗标题\n普通行"}, formatMap={title:{text:"加粗标题\n普通行", lines:[{text:"加粗标题",bold:[[0,4]]},{text:"普通行",bold:[]}],...}}
// docxtemplater 替换后，"加粗标题" 和 "普通行" 分别在不同段落
// applyDocxFormatting 需要匹配 "加粗标题" -> lineFormat {text:"加粗标题", bold:[[0,4]]}
console.log("\n=== 场景4: 完整流程模拟 ===");
console.log("formatMap lines:");
console.log("  line 0: text='加粗标题', bold=[[0,4]]");
console.log("  line 1: text='普通行', bold=[]");
console.log("\nlineMatchIndex keys: '加粗标题', '普通行'");
console.log("docxtemplater 生成的 XML 中，'加粗标题' 在一个 <w:r> 中，'普通行' 在另一个 <w:r> 中");
console.log("findMatchedFormat('加粗标题') 应该匹配到 lineFormat {text:'加粗标题', bold:[[0,4]]}");
console.log("findMatchedFormat('普通行') 应该匹配到 lineFormat {text:'普通行', bold:[]}");
