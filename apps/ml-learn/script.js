// ===== 常量 =====
const STORAGE_KEY = 'ml-learn-progress';
let currentLevelIdx = 0;

// ===== 关卡数据 =====
const LEVELS = [
    // ==================== Part 1: 数据基础 ====================
    {
        id: 1,
        title: '向量点积',
        description: '实现向量的点积运算',
        category: '数据基础',
        tutorial: `
            <p>在机器学习中，数据通常以<b>向量</b>（数组）的形式表示。<b>点积</b>（Dot Product）是向量间最基础的运算之一，广泛用于相似度计算、神经网络前向传播等核心场景。</p>
            <p>两个等长向量 <code>a</code> 和 <code>b</code> 的点积定义为：</p>
            <div class="syntax-block">a · b = a₁×b₁ + a₂×b₂ + ... + aₙ×bₙ = Σ(aᵢ × bᵢ)</div>
            <p>例如：<code>[1, 2, 3] · [4, 5, 6] = 1×4 + 2×5 + 3×6 = 32</code></p>
            <p>在 JavaScript 中，可以使用 <code>reduce</code> 方法遍历数组并累加：</p>
            <div class="syntax-block">arr.reduce((sum, val, i) => sum + val * other[i], 0)</div>
        `,
        task: '实现 <code>dotProduct(a, b)</code> 函数，接收两个等长数组，返回它们的点积值。',
        hint: '使用 a.reduce((sum, val, i) => sum + val * b[i], 0) 即可一行实现。',
        initialCode: `function dotProduct(a, b) {\n    // a 和 b 是等长的数字数组\n    // 返回它们的点积（对应元素相乘再求和）\n    \n}`,
        testCode: `
var r1 = dotProduct([1, 2, 3], [4, 5, 6]);
var r2 = dotProduct([0, 0], [1, 1]);
var r3 = dotProduct([-1, 2], [3, 4]);
print('dotProduct([1,2,3], [4,5,6]) = ' + r1 + (r1 === 32 ? '  ✓' : '  ✗ 期望 32'));
print('dotProduct([0,0], [1,1]) = ' + r2 + (r2 === 0 ? '  ✓' : '  ✗ 期望 0'));
print('dotProduct([-1,2], [3,4]) = ' + r3 + (r3 === 5 ? '  ✓' : '  ✗ 期望 5'));
return r1 === 32 && r2 === 0 && r3 === 5;
`,
        showVisualization: false
    },
    {
        id: 2,
        title: '均值与方差',
        description: '计算数据的基本统计量',
        category: '数据基础',
        tutorial: `
            <p>统计量是理解数据分布的基础。机器学习中最常用的三个统计量：</p>
            <p><b>均值（Mean）</b> — 所有值的平均：</p>
            <div class="syntax-block">μ = (x₁ + x₂ + ... + xₙ) / n</div>
            <p><b>方差（Variance）</b> — 衡量数据离散程度：</p>
            <div class="syntax-block">σ² = Σ(xᵢ - μ)² / n</div>
            <p><b>标准差（Standard Deviation）</b> — 方差的平方根，单位与原数据一致：</p>
            <div class="syntax-block">σ = √(σ²)</div>
            <p>例如 <code>[2, 4, 4, 4, 5, 5, 7, 9]</code>：均值=5，方差=4，标准差=2</p>
        `,
        task: '实现 <code>mean(arr)</code>、<code>variance(arr)</code> 和 <code>std(arr)</code> 三个函数。使用<b>总体方差</b>（除以 n）。',
        hint: 'mean: 求和除以长度。variance: 先求均值，然后计算每个值与均值差的平方的均值。std: 方差开平方根。',
        initialCode: `function mean(arr) {\n    // 返回数组的平均值\n    \n}\n\nfunction variance(arr) {\n    // 返回数组的方差（总体方差，除以 n）\n    \n}\n\nfunction std(arr) {\n    // 返回数组的标准差\n    \n}`,
        testCode: `
var data = [2, 4, 4, 4, 5, 5, 7, 9];
var m = mean(data);
var v = variance(data);
var s = std(data);
print('数据: [2, 4, 4, 4, 5, 5, 7, 9]');
print('均值: ' + m + (m === 5 ? '  ✓' : '  ✗ 期望 5'));
print('方差: ' + v + (v === 4 ? '  ✓' : '  ✗ 期望 4'));
print('标准差: ' + s + (s === 2 ? '  ✓' : '  ✗ 期望 2'));
var d2 = [10, 10, 10];
print('\\n数据: [10, 10, 10]');
print('均值: ' + mean(d2) + (mean(d2) === 10 ? '  ✓' : '  ✗'));
print('方差: ' + variance(d2) + (variance(d2) === 0 ? '  ✓' : '  ✗'));
return m === 5 && v === 4 && s === 2 && mean(d2) === 10 && variance(d2) === 0;
`,
        showVisualization: false
    },
    {
        id: 3,
        title: '距离度量',
        description: '计算欧氏距离和曼哈顿距离',
        category: '数据基础',
        tutorial: `
            <p>在机器学习中，<b>距离</b>用于衡量两个数据点的相似程度——距离越小，越相似。</p>
            <p><b>欧氏距离（Euclidean）</b>：两点间的直线距离，最常用。</p>
            <div class="syntax-block">d(a,b) = √( Σ(aᵢ - bᵢ)² )</div>
            <p><b>曼哈顿距离（Manhattan）</b>：沿坐标轴方向的距离之和，像在城市街道行走。</p>
            <div class="syntax-block">d(a,b) = Σ|aᵢ - bᵢ|</div>
            <p>例如 <code>a=[0,0], b=[3,4]</code>：欧氏距离 = √(9+16) = 5，曼哈顿距离 = 3+4 = 7</p>
        `,
        task: '实现 <code>euclideanDistance(a, b)</code> 和 <code>manhattanDistance(a, b)</code> 两个函数。',
        hint: '欧氏：对每对元素求差的平方，累加后用 Math.sqrt 开方。曼哈顿：对每对元素求差的绝对值 Math.abs，然后累加。',
        initialCode: `function euclideanDistance(a, b) {\n    // 返回两个向量的欧氏距离\n    \n}\n\nfunction manhattanDistance(a, b) {\n    // 返回两个向量的曼哈顿距离\n    \n}`,
        testCode: `
var e1 = euclideanDistance([0, 0], [3, 4]);
var e2 = euclideanDistance([1, 2, 3], [4, 5, 6]);
var m1 = manhattanDistance([0, 0], [3, 4]);
var m2 = manhattanDistance([1, 2, 3], [4, 5, 6]);
print('欧氏距离 [0,0]→[3,4]: ' + e1 + (e1 === 5 ? '  ✓' : '  ✗ 期望 5'));
print('欧氏距离 [1,2,3]→[4,5,6]: ' + e2.toFixed(4) + (Math.abs(e2 - Math.sqrt(27)) < 0.001 ? '  ✓' : '  ✗ 期望 ≈5.196'));
print('曼哈顿距离 [0,0]→[3,4]: ' + m1 + (m1 === 7 ? '  ✓' : '  ✗ 期望 7'));
print('曼哈顿距离 [1,2,3]→[4,5,6]: ' + m2 + (m2 === 9 ? '  ✓' : '  ✗ 期望 9'));
return e1 === 5 && Math.abs(e2 - Math.sqrt(27)) < 0.001 && m1 === 7 && m2 === 9;
`,
        showVisualization: false
    },
    {
        id: 4,
        title: '数据归一化',
        description: '将数据缩放到统一范围',
        category: '数据基础',
        tutorial: `
            <p>不同特征的取值范围可能差异巨大（如身高 150~190cm，收入 3000~50000元），这会导致距离计算被大范围特征主导。<b>归一化</b>将数据缩放到统一范围。</p>
            <p><b>Min-Max 归一化</b>：缩放到 [0, 1]</p>
            <div class="syntax-block">x_norm = (x - min) / (max - min)</div>
            <p><b>Z-Score 标准化</b>：转换为均值=0、标准差=1 的分布</p>
            <div class="syntax-block">x_std = (x - μ) / σ</div>
            <p>例如 <code>[10, 20, 30, 40, 50]</code> Min-Max归一化后：<code>[0, 0.25, 0.5, 0.75, 1]</code></p>
        `,
        task: '实现 <code>minMaxNormalize(arr)</code> 和 <code>zScoreNormalize(arr)</code>，均返回新数组（不修改原数组）。',
        hint: 'Min-Max: 用 Math.min/max 或遍历找极值，然后 map 每个元素。Z-Score: 先算 mean 和 std（可以在函数内部重新实现），然后 map。',
        initialCode: `function minMaxNormalize(arr) {\n    // 将数组归一化到 [0, 1] 范围，返回新数组\n    \n}\n\nfunction zScoreNormalize(arr) {\n    // Z-Score 标准化，返回新数组\n    \n}`,
        testCode: `
var data = [10, 20, 30, 40, 50];
var mm = minMaxNormalize(data);
var expected = [0, 0.25, 0.5, 0.75, 1];
var mmOk = mm.length === 5 && mm.every(function(v, i) { return Math.abs(v - expected[i]) < 0.001; });
print('Min-Max [10,20,30,40,50]:');
print('  结果: [' + mm.map(function(v){return v.toFixed(2)}).join(', ') + ']' + (mmOk ? '  ✓' : '  ✗'));
var zs = zScoreNormalize(data);
var zsMean = zs.reduce(function(a,b){return a+b},0) / zs.length;
var zsVar = zs.reduce(function(a,v){return a+(v-zsMean)*(v-zsMean)},0) / zs.length;
var zsStd = Math.sqrt(zsVar);
var zsOk = Math.abs(zsMean) < 0.001 && Math.abs(zsStd - 1) < 0.001;
print('\\nZ-Score [10,20,30,40,50]:');
print('  结果: [' + zs.map(function(v){return v.toFixed(2)}).join(', ') + ']');
print('  均值≈0: ' + zsMean.toFixed(4) + ', 标准差≈1: ' + zsStd.toFixed(4) + (zsOk ? '  ✓' : '  ✗'));
return mmOk && zsOk;
`,
        showVisualization: false
    },

    // ==================== Part 2: 经典机器学习 ====================
    {
        id: 5,
        title: 'KNN 分类',
        description: '实现K近邻分类算法',
        category: '经典算法',
        tutorial: `
            <p><b>K 近邻（KNN）</b>是最直观的分类算法：要判断新数据属于哪个类别，就看离它最近的 K 个"邻居"中哪个类别最多。</p>
            <div class="syntax-block">算法步骤：
1. 计算新数据点到所有训练样本的距离
2. 选取距离最近的 K 个邻居
3. 统计这 K 个邻居中各类别的出现次数
4. 返回出现次数最多的类别</div>
            <p>K 值的选择很重要：K 太小容易受噪声影响（过拟合），K 太大则分类边界模糊。通常选奇数避免平票。</p>
            <p>距离使用欧氏距离：<code>d = √(Σ(aᵢ - bᵢ)²)</code></p>
        `,
        task: '实现 <code>knnClassify(trainData, trainLabels, testPoint, k)</code>，使用欧氏距离进行 KNN 分类。',
        hint: '1.遍历计算testPoint到每个训练样本的距离 2.将距离和标签配对 3.按距离排序取前k个 4.统计标签频率返回最多的。',
        dataHtml: `
            <div class="data-table-title">训练数据（身高cm, 体重kg → 性别）</div>
            <table class="preview-table">
                <tr><th>身高</th><th>体重</th><th>性别</th></tr>
                <tr><td>170</td><td>60</td><td>男</td></tr>
                <tr><td>180</td><td>80</td><td>男</td></tr>
                <tr><td>160</td><td>50</td><td>女</td></tr>
                <tr><td>175</td><td>70</td><td>男</td></tr>
                <tr><td>155</td><td>45</td><td>女</td></tr>
                <tr><td>185</td><td>85</td><td>男</td></tr>
            </table>
        `,
        initialCode: `function knnClassify(trainData, trainLabels, testPoint, k) {\n    // trainData: 二维数组，每行一个训练样本\n    // trainLabels: 标签数组\n    // testPoint: 待分类的数据点\n    // k: 近邻数量\n    \n    // 步骤1: 计算testPoint到每个训练样本的欧氏距离\n    \n    // 步骤2: 按距离排序，取前k个邻居的标签\n    \n    // 步骤3: 统计各标签出现次数，返回最多的\n    \n}`,
        testCode: `
var trainData = [[170,60],[180,80],[160,50],[175,70],[155,45],[185,85]];
var labels = ['男','男','女','男','女','男'];
var r1 = knnClassify(trainData, labels, [165, 55], 3);
var r2 = knnClassify(trainData, labels, [178, 75], 3);
var r3 = knnClassify(trainData, labels, [158, 48], 3);
print('预测 [身高165,体重55] (k=3): ' + r1 + (r1==='女' ? '  ✓' : '  ✗ 期望 女'));
print('预测 [身高178,体重75] (k=3): ' + r2 + (r2==='男' ? '  ✓' : '  ✗ 期望 男'));
print('预测 [身高158,体重48] (k=3): ' + r3 + (r3==='女' ? '  ✓' : '  ✗ 期望 女'));
// 可视化
var pts = [];
for (var i = 0; i < trainData.length; i++) pts.push([trainData[i][0], trainData[i][1], labels[i]==='男' ? 0 : 1]);
pts.push([165,55,2]); pts.push([178,75,2]); pts.push([158,48,2]);
draw.scatter(pts, {title:'KNN 分类', xLabel:'身高', yLabel:'体重', legendLabels:['男','女','测试点']});
return r1==='女' && r2==='男' && r3==='女';
`,
        showVisualization: true
    },
    {
        id: 6,
        title: '线性回归',
        description: '用最小二乘法拟合直线',
        category: '经典算法',
        tutorial: `
            <p><b>线性回归</b>是最经典的预测算法，目标是找一条直线 <code>y = slope × x + intercept</code> 来拟合数据。</p>
            <p><b>最小二乘法</b>直接用公式计算最优参数：</p>
            <div class="syntax-block">slope = Σ(xᵢ - x̄)(yᵢ - ȳ) / Σ(xᵢ - x̄)²
intercept = ȳ - slope × x̄

其中 x̄ 是 x 的均值，ȳ 是 y 的均值</div>
            <p>例如 X=[1,2,3,4,5], y=[2,4,5,4,5]：</p>
            <p>x̄=3, ȳ=4 → slope=0.6, intercept=2.2</p>
        `,
        task: '实现 <code>linearRegression(X, y)</code>，返回 <code>{ slope, intercept }</code> 对象。',
        hint: '先求 x̄ 和 ȳ，然后遍历数组分别累加分子 Σ(xi-x̄)(yi-ȳ) 和分母 Σ(xi-x̄)²，相除得 slope，再算 intercept。',
        initialCode: `function linearRegression(X, y) {\n    // X: 一维数组（特征值）\n    // y: 一维数组（目标值）\n    // 返回 { slope: 斜率, intercept: 截距 }\n    \n    // 1. 计算 X 和 y 的均值\n    \n    // 2. 计算 slope = Σ(xi-x̄)(yi-ȳ) / Σ(xi-x̄)²\n    \n    // 3. 计算 intercept = ȳ - slope * x̄\n    \n}`,
        testCode: `
var X = [1, 2, 3, 4, 5];
var y = [2, 4, 5, 4, 5];
var model = linearRegression(X, y);
var sOk = Math.abs(model.slope - 0.6) < 0.01;
var iOk = Math.abs(model.intercept - 2.2) < 0.01;
print('X = [1,2,3,4,5], y = [2,4,5,4,5]');
print('斜率: ' + model.slope.toFixed(4) + (sOk ? '  ✓' : '  ✗ 期望 0.6'));
print('截距: ' + model.intercept.toFixed(4) + (iOk ? '  ✓' : '  ✗ 期望 2.2'));
// 预测
var pred3 = model.slope * 3 + model.intercept;
print('\\n预测 x=3: y=' + pred3.toFixed(2) + ' (实际≈4)');
// 可视化
var pts = X.map(function(xi,i){return [xi, y[i], 0]});
draw.scatterWithLine(pts, model.slope, model.intercept, {title:'线性回归拟合', xLabel:'x', yLabel:'y'});
return sOk && iOk;
`,
        showVisualization: true
    },
    {
        id: 7,
        title: '梯度下降',
        description: '掌握最重要的优化方法',
        category: '经典算法',
        tutorial: `
            <p><b>梯度下降</b>是机器学习中最核心的优化算法。它通过不断沿着梯度（导数）的反方向更新参数，逐步逼近函数的最小值点。</p>
            <div class="syntax-block">更新规则：x_new = x_old - learning_rate × gradient(x_old)

learning_rate（学习率）控制每步走多远：
  - 太大：可能跳过最优解，无法收敛
  - 太小：收敛速度慢</div>
            <p>例如最小化 <code>f(x) = (x-3)²</code>，其梯度为 <code>f'(x) = 2(x-3)</code>。</p>
            <p>从 x=0 出发，学习率0.1：</p>
            <p>第1步：x = 0 - 0.1×2(0-3) = 0.6</p>
            <p>第2步：x = 0.6 - 0.1×2(0.6-3) = 1.08 ... 逐渐趋近 3。</p>
        `,
        task: '实现 <code>gradientDescent(gradFn, startX, lr, epochs)</code>，返回优化后的 x 值。',
        hint: '循环 epochs 次，每次执行 x = x - lr * gradFn(x)，最后返回 x。',
        initialCode: `function gradientDescent(gradFn, startX, lr, epochs) {\n    // gradFn: 梯度函数，输入x返回梯度值\n    // startX: 起始点\n    // lr: 学习率 (learning rate)\n    // epochs: 迭代次数\n    // 返回最终的 x 值\n    \n}`,
        testCode: `
// 最小化 f(x) = (x-3)²，梯度 f'(x) = 2(x-3)，最小值点 x=3
var grad1 = function(x) { return 2 * (x - 3); };
var r1 = gradientDescent(grad1, 0, 0.1, 100);
print('最小化 f(x)=(x-3)², 从x=0出发:');
print('  结果: x = ' + r1.toFixed(6) + (Math.abs(r1 - 3) < 0.01 ? '  ✓' : '  ✗ 期望 ≈3'));

// 最小化 f(x) = x² + 4x + 4 = (x+2)²，梯度 f'(x) = 2x+4，最小值点 x=-2
var grad2 = function(x) { return 2 * x + 4; };
var r2 = gradientDescent(grad2, 5, 0.1, 200);
print('\\n最小化 f(x)=(x+2)², 从x=5出发:');
print('  结果: x = ' + r2.toFixed(6) + (Math.abs(r2 + 2) < 0.01 ? '  ✓' : '  ✗ 期望 ≈-2'));

// 可视化收敛过程
var losses = [];
var x = 0;
for (var i = 0; i < 50; i++) { losses.push((x-3)*(x-3)); x = x - 0.1 * 2 * (x-3); }
draw.linePlot(losses, {title:'损失函数收敛曲线', yLabel:'f(x)', xLabel:'迭代次数'});
return Math.abs(r1 - 3) < 0.01 && Math.abs(r2 + 2) < 0.01;
`,
        showVisualization: true
    },
    {
        id: 8,
        title: '逻辑回归',
        description: '实现二分类的核心算法',
        category: '经典算法',
        tutorial: `
            <p><b>逻辑回归</b>虽然名字带"回归"，但实际上是一种<b>分类</b>算法。它用 Sigmoid 函数将线性输出映射到 [0,1]，表示属于正类的概率。</p>
            <p><b>Sigmoid 函数：</b></p>
            <div class="syntax-block">σ(z) = 1 / (1 + e^(-z))</div>
            <p><b>训练过程（梯度下降）：</b></p>
            <div class="syntax-block">对每个样本 i:
  z = w₁x₁ + w₂x₂ + ... + b   (线性组合)
  p = σ(z)                       (预测概率)
  
梯度更新（对所有样本求平均）:
  w_j -= lr × (1/n) × Σ(pᵢ - yᵢ) × x_ij
  b   -= lr × (1/n) × Σ(pᵢ - yᵢ)</div>
            <p>预测时：<code>σ(z) ≥ 0.5</code> → 类别1，否则 → 类别0</p>
        `,
        task: '实现 <code>sigmoid(z)</code> 和 <code>logisticRegression(X, y, lr, epochs)</code>，后者返回含 <code>predict</code> 方法的对象。',
        hint: 'sigmoid: return 1/(1+Math.exp(-z))。训练：初始化权重为0，循环epochs次，每次遍历所有样本累积梯度后更新。',
        dataHtml: `
            <div class="data-table-title">训练数据（1个特征 → 0/1分类）</div>
            <table class="preview-table">
                <tr><th>特征x</th><th>标签y</th></tr>
                <tr><td>1</td><td>0</td></tr><tr><td>2</td><td>0</td></tr>
                <tr><td>3</td><td>0</td></tr><tr><td>4</td><td>0</td></tr>
                <tr><td>5</td><td>1</td></tr><tr><td>6</td><td>1</td></tr>
                <tr><td>7</td><td>1</td></tr><tr><td>8</td><td>1</td></tr>
            </table>
        `,
        initialCode: `function sigmoid(z) {\n    // Sigmoid 函数: 1 / (1 + e^(-z))\n    \n}\n\nfunction logisticRegression(X, y, lr, epochs) {\n    // X: 二维数组 [[x1,x2,...], ...] 每行一个样本\n    // y: [0, 1, ...] 标签数组\n    // lr: 学习率\n    // epochs: 迭代次数\n    \n    var n = X.length;\n    var nFeatures = X[0].length;\n    var weights = new Array(nFeatures).fill(0);\n    var bias = 0;\n    \n    for (var ep = 0; ep < epochs; ep++) {\n        var dw = new Array(nFeatures).fill(0);\n        var db = 0;\n        \n        for (var i = 0; i < n; i++) {\n            // 计算 z = Σ(weights[j]*X[i][j]) + bias\n            // 计算 p = sigmoid(z)\n            // 累积梯度: dw[j] += (p - y[i]) * X[i][j], db += (p - y[i])\n            \n        }\n        \n        // 更新: weights[j] -= lr * dw[j] / n, bias -= lr * db / n\n        \n    }\n    \n    return {\n        weights: weights,\n        bias: bias,\n        predict: function(x) {\n            var z = x.reduce(function(s,v,j){return s+weights[j]*v},0) + bias;\n            return sigmoid(z) >= 0.5 ? 1 : 0;\n        }\n    };\n}`,
        testCode: `
var X = [[1],[2],[3],[4],[5],[6],[7],[8]];
var y = [0,0,0,0,1,1,1,1];
var model = logisticRegression(X, y, 1.0, 1000);
var p1 = model.predict([2]);
var p2 = model.predict([7]);
var p3 = model.predict([4.5]);
print('sigmoid(0) = ' + sigmoid(0).toFixed(4) + (Math.abs(sigmoid(0)-0.5)<0.001 ? '  ✓' : '  ✗'));
print('sigmoid(10) ≈ 1: ' + sigmoid(10).toFixed(6) + (sigmoid(10)>0.999 ? '  ✓' : '  ✗'));
print('\\n训练后预测:');
print('  predict([2]) = ' + p1 + (p1===0 ? '  ✓' : '  ✗ 期望 0'));
print('  predict([7]) = ' + p2 + (p2===1 ? '  ✓' : '  ✗ 期望 1'));
print('  predict([4.5]) = ' + p3 + ' (边界附近)');
return Math.abs(sigmoid(0)-0.5)<0.001 && p1===0 && p2===1;
`,
        showVisualization: false
    },
    {
        id: 9,
        title: '模型评估指标',
        description: '计算分类模型的评估指标',
        category: '经典算法',
        tutorial: `
            <p>训练出模型后，如何衡量它的好坏？分类任务中常用以下指标：</p>
            <p>先理解<b>混淆矩阵</b>的四个值（以"正类"为关注对象）：</p>
            <div class="syntax-block">TP（真正例）: 预测=正, 实际=正 ✓
FP（假正例）: 预测=正, 实际=负 ✗（误报）
FN（假负例）: 预测=负, 实际=正 ✗（漏报）
TN（真负例）: 预测=负, 实际=负 ✓</div>
            <p><b>四个核心指标：</b></p>
            <div class="syntax-block">准确率 Accuracy  = (TP + TN) / 总数
精确率 Precision = TP / (TP + FP)  — 预测为正的有多少真的是正
召回率 Recall    = TP / (TP + FN)  — 实际为正的有多少被找到
F1 分数          = 2 × P × R / (P + R)</div>
        `,
        task: '实现 <code>accuracy</code>、<code>precision</code>、<code>recall</code>、<code>f1Score</code> 四个函数，均接收 (actual, predicted) 两个 0/1 数组。',
        hint: '先遍历数组统计 TP、FP、FN、TN 四个值，然后按公式计算。注意 precision 和 recall 的分母可能为0。',
        initialCode: `function accuracy(actual, predicted) {\n    // 准确率 = 正确预测数 / 总数\n    \n}\n\nfunction precision(actual, predicted) {\n    // 精确率 = TP / (TP + FP)\n    \n}\n\nfunction recall(actual, predicted) {\n    // 召回率 = TP / (TP + FN)\n    \n}\n\nfunction f1Score(actual, predicted) {\n    // F1 = 2 * precision * recall / (precision + recall)\n    \n}`,
        testCode: `
var actual    = [1, 1, 0, 1, 0, 1, 0, 0, 1, 0];
var predicted = [1, 0, 0, 1, 1, 1, 0, 0, 0, 0];
// TP=3(位置0,3,5), FP=1(位置4), FN=2(位置1,8), TN=4(位置2,6,7,9)
var a = accuracy(actual, predicted);
var p = precision(actual, predicted);
var r = recall(actual, predicted);
var f = f1Score(actual, predicted);
print('actual:    [1,1,0,1,0,1,0,0,1,0]');
print('predicted: [1,0,0,1,1,1,0,0,0,0]');
print('TP=3, FP=1, FN=2, TN=4');
print('');
print('Accuracy:  ' + a.toFixed(4) + (Math.abs(a-0.7)<0.001 ? '  ✓' : '  ✗ 期望 0.7'));
print('Precision: ' + p.toFixed(4) + (Math.abs(p-0.75)<0.001 ? '  ✓' : '  ✗ 期望 0.75'));
print('Recall:    ' + r.toFixed(4) + (Math.abs(r-0.6)<0.001 ? '  ✓' : '  ✗ 期望 0.6'));
print('F1 Score:  ' + f.toFixed(4) + (Math.abs(f-2*0.75*0.6/(0.75+0.6))<0.001 ? '  ✓' : '  ✗'));
return Math.abs(a-0.7)<0.001 && Math.abs(p-0.75)<0.001 && Math.abs(r-0.6)<0.001 && Math.abs(f-2*0.75*0.6/1.35)<0.001;
`,
        showVisualization: false
    },
    {
        id: 10,
        title: '朴素贝叶斯分类',
        description: '基于概率的分类方法',
        category: '经典算法',
        tutorial: `
            <p><b>朴素贝叶斯</b>基于贝叶斯定理进行分类，"朴素"是指假设各特征之间相互独立。</p>
            <div class="syntax-block">贝叶斯定理: P(类别|特征) ∝ P(类别) × P(特征|类别)

高斯朴素贝叶斯（连续特征）:
  P(xᵢ|类别) = 高斯概率密度函数
  = (1/√(2πσ²)) × e^(-(x-μ)²/(2σ²))</div>
            <p><b>分类步骤：</b></p>
            <div class="syntax-block">1. 对每个类别，计算每个特征的均值μ和方差σ²
2. 计算先验概率 P(类别) = 该类样本数/总样本数
3. 对新数据点，计算每个类别的后验概率得分
4. 返回得分最高的类别</div>
            <p>虽然简单，但在文本分类、垃圾邮件过滤等场景效果非常好。</p>
        `,
        task: '实现 <code>gaussianNB(trainData, trainLabels, testPoint)</code>，使用高斯朴素贝叶斯进行分类。',
        hint: '1.按类别分组训练数据 2.每组每个特征算 mean 和 variance 3.对testPoint每个特征算高斯概率密度 4.乘以先验概率 5.返回概率最大的类别。',
        initialCode: `function gaussianNB(trainData, trainLabels, testPoint) {\n    // 获取所有唯一类别\n    var classes = [];\n    trainLabels.forEach(function(l) {\n        if (classes.indexOf(l) === -1) classes.push(l);\n    });\n    \n    var bestClass = null;\n    var bestScore = -Infinity;\n    \n    for (var c = 0; c < classes.length; c++) {\n        var cls = classes[c];\n        // 筛选该类别的样本\n        var subset = trainData.filter(function(_, i) { return trainLabels[i] === cls; });\n        // 先验概率\n        var prior = subset.length / trainData.length;\n        \n        // 对每个特征计算均值和方差，然后计算高斯概率密度\n        var logProb = Math.log(prior);\n        \n        for (var j = 0; j < testPoint.length; j++) {\n            // 计算该类别中特征j的均值 mean 和方差 variance\n            \n            // 高斯概率密度: (1/sqrt(2*PI*var)) * exp(-(x-mean)^2/(2*var))\n            // 为避免下溢，使用 log: -0.5*log(2*PI*var) - (x-mean)^2/(2*var)\n            \n        }\n        \n        if (logProb > bestScore) {\n            bestScore = logProb;\n            bestClass = cls;\n        }\n    }\n    \n    return bestClass;\n}`,
        testCode: `
// 两类数据: A类集中在(2,2)附近, B类集中在(8,8)附近
var trainData = [[1,1],[2,1],[2,2],[1,3],[3,2],  [7,7],[8,8],[9,7],[8,9],[7,9]];
var labels = ['A','A','A','A','A','B','B','B','B','B'];
var r1 = gaussianNB(trainData, labels, [3, 2]);
var r2 = gaussianNB(trainData, labels, [7, 8]);
var r3 = gaussianNB(trainData, labels, [5, 5]);
print('预测 [3,2]: ' + r1 + (r1==='A' ? '  ✓' : '  ✗ 期望 A'));
print('预测 [7,8]: ' + r2 + (r2==='B' ? '  ✓' : '  ✗ 期望 B'));
print('预测 [5,5]: ' + r3 + ' (边界，A或B均可)');
// 可视化
var pts = trainData.map(function(p,i){return [p[0],p[1],labels[i]==='A'?0:1]});
pts.push([3,2,2]); pts.push([7,8,2]);
draw.scatter(pts, {title:'朴素贝叶斯分类', xLabel:'特征1', yLabel:'特征2', legendLabels:['A类','B类','测试点']});
return r1==='A' && r2==='B';
`,
        showVisualization: true
    },
    {
        id: 11,
        title: '决策树基础',
        description: '理解信息熵与信息增益',
        category: '经典算法',
        tutorial: `
            <p><b>决策树</b>通过一系列"如果...那么..."的规则来分类。核心问题：如何选择最好的分裂特征？答案是<b>信息增益</b>。</p>
            <p><b>信息熵（Entropy）</b>衡量数据的"不确定性"：</p>
            <div class="syntax-block">H = -Σ p(xᵢ) × log₂(p(xᵢ))

例如 [A,A,B,B]: 
  p(A)=0.5, p(B)=0.5
  H = -0.5×log₂(0.5) - 0.5×log₂(0.5) = 1.0（最大不确定性）

例如 [A,A,A,A]:
  p(A)=1.0
  H = -1×log₂(1) = 0（完全确定）</div>
            <p><b>信息增益 = 分裂前的熵 - 分裂后各子集的加权平均熵</b></p>
            <p>选择信息增益最大的特征和阈值来分裂。</p>
        `,
        task: '实现 <code>entropy(labels)</code> 和 <code>informationGain(data, labels, featureIdx, threshold)</code>。',
        hint: 'entropy: 统计每个标签的频率p，返回 -Σ(p*Math.log2(p))。informationGain: 按阈值分成两组，计算分裂前后熵的差。注意 0*log(0) 应为 0。',
        initialCode: `function entropy(labels) {\n    // 计算标签数组的信息熵\n    // 1. 统计每个标签的出现次数\n    // 2. 计算每个标签的概率 p\n    // 3. H = -Σ(p × log₂(p))，注意 p=0 时贡献为 0\n    \n}\n\nfunction informationGain(data, labels, featureIdx, threshold) {\n    // 按 data[i][featureIdx] <= threshold 分成两组\n    // 信息增益 = 原始熵 - 加权子集熵\n    \n    var leftLabels = [];\n    var rightLabels = [];\n    for (var i = 0; i < data.length; i++) {\n        if (data[i][featureIdx] <= threshold) {\n            leftLabels.push(labels[i]);\n        } else {\n            rightLabels.push(labels[i]);\n        }\n    }\n    \n    // 计算并返回信息增益\n    \n}`,
        testCode: `
var e1 = entropy(['A','A','B','B']);
var e2 = entropy(['A','A','A','A']);
var e3 = entropy(['A','A','A','B']);
print('entropy([A,A,B,B]) = ' + e1.toFixed(4) + (Math.abs(e1-1.0)<0.001 ? '  ✓' : '  ✗ 期望 1.0'));
print('entropy([A,A,A,A]) = ' + e2.toFixed(4) + (Math.abs(e2-0)<0.001 ? '  ✓' : '  ✗ 期望 0'));
print('entropy([A,A,A,B]) = ' + e3.toFixed(4) + (Math.abs(e3-0.8113)<0.001 ? '  ✓' : '  ✗ 期望 ≈0.8113'));
// 测试信息增益
var data = [[1],[2],[3],[4],[5],[6]];
var lbls = ['A','A','A','B','B','B'];
var ig = informationGain(data, lbls, 0, 3);
print('\\n数据 x=[1..6], 标签=[A,A,A,B,B,B]');
print('按 x<=3 分裂的信息增益: ' + ig.toFixed(4) + (Math.abs(ig-1.0)<0.001 ? '  ✓ (完美分裂!)' : '  ✗ 期望 1.0'));
return Math.abs(e1-1.0)<0.001 && Math.abs(e2)<0.001 && Math.abs(e3-0.8113)<0.001 && Math.abs(ig-1.0)<0.001;
`,
        showVisualization: false
    },
    {
        id: 12,
        title: 'K-Means 聚类',
        description: '实现无监督聚类算法',
        category: '经典算法',
        tutorial: `
            <p><b>K-Means</b> 是最经典的<b>无监督学习</b>算法——不需要标签，自动将数据分成 K 个簇。</p>
            <div class="syntax-block">算法步骤（反复迭代直到收敛）：
1. 初始化 K 个质心（可随机选K个数据点）
2. 分配：将每个数据点分给最近的质心
3. 更新：将每个质心移到其簇内所有点的均值位置
4. 重复 2-3 直到质心不再变化或达到最大迭代次数</div>
            <p>收敛后，每个数据点都有一个簇标签（0 ~ K-1），同簇的点彼此相似。</p>
        `,
        task: '实现 <code>kMeans(data, k, maxIter, initCentroids)</code>，返回 <code>{ centroids, assignments }</code>。',
        hint: '每次迭代：1.对每个点找最近质心得到assignments 2.对每个簇算均值更新centroids。距离用欧氏距离。',
        initialCode: `function kMeans(data, k, maxIter, initCentroids) {\n    // data: [[x,y], ...] 二维数据点\n    // k: 簇数量\n    // maxIter: 最大迭代次数\n    // initCentroids: 初始质心 (可选)\n    \n    // 复制初始质心\n    var centroids = initCentroids.map(function(c){return c.slice()});\n    var assignments = new Array(data.length).fill(0);\n    \n    for (var iter = 0; iter < maxIter; iter++) {\n        // 步骤1: 分配 - 每个点归入最近的质心\n        \n        // 步骤2: 更新 - 每个质心移到其簇内点的均值\n        \n    }\n    \n    return { centroids: centroids, assignments: assignments };\n}`,
        testCode: `
var data = [
    [0.5,0.5],[1.5,1.0],[1.0,1.5],[0.8,0.8],
    [4.5,5.0],[5.5,5.5],[5.0,4.5],[4.8,5.2],
    [8.5,0.5],[9.5,1.0],[9.0,1.5],[8.8,0.8]
];
var init = [[0.5,0.5],[5.0,5.0],[9.0,1.0]];
var result = kMeans(data, 3, 20, init);
var a = result.assignments;
// 验证: 前4个同组，中4个同组，后4个同组
var g1 = a[0], g2 = a[4], g3 = a[8];
var ok = a[1]===g1 && a[2]===g1 && a[3]===g1 &&
         a[5]===g2 && a[6]===g2 && a[7]===g2 &&
         a[9]===g3 && a[10]===g3 && a[11]===g3 &&
         g1!==g2 && g2!==g3 && g1!==g3;
print('聚类结果: [' + a.join(', ') + ']');
print('三个簇是否正确分离: ' + (ok ? '✓' : '✗'));
// 可视化
var pts = data.map(function(p,i){return [p[0],p[1],a[i]]});
draw.scatter(pts, {title:'K-Means 聚类结果', xLabel:'x', yLabel:'y', legendLabels:['簇0','簇1','簇2']});
return ok;
`,
        showVisualization: true
    },

    // ==================== Part 3: 神经网络 ====================
    {
        id: 13,
        title: '感知机',
        description: '实现最简单的神经元模型',
        category: '神经网络',
        tutorial: `
            <p><b>感知机（Perceptron）</b>是最简单的神经网络单元，只有一个神经元。它是所有神经网络的基础。</p>
            <div class="syntax-block">前向计算:
  z = w₁x₁ + w₂x₂ + ... + b   (加权求和)
  output = z ≥ 0 ? 1 : 0        (阶跃激活)

学习规则（当预测错误时更新）:
  error = 真实标签 - 预测值
  wⱼ += learning_rate × error × xⱼ
  b  += learning_rate × error</div>
            <p>感知机可以学习<b>线性可分</b>的问题（如 AND 门、OR 门），但无法学习 XOR。</p>
        `,
        task: '实现 <code>trainPerceptron(trainData, trainLabels, lr, epochs)</code>，返回含 <code>predict</code> 方法的对象。让它学会 AND 门。',
        hint: '初始化权重和偏置为0，遍历所有样本，当预测错误时更新权重。多次迭代直到收敛。',
        dataHtml: `
            <div class="data-table-title">AND 门训练数据</div>
            <table class="preview-table">
                <tr><th>x1</th><th>x2</th><th>输出</th></tr>
                <tr><td>0</td><td>0</td><td>0</td></tr>
                <tr><td>0</td><td>1</td><td>0</td></tr>
                <tr><td>1</td><td>0</td><td>0</td></tr>
                <tr><td>1</td><td>1</td><td>1</td></tr>
            </table>
        `,
        initialCode: `function trainPerceptron(trainData, trainLabels, lr, epochs) {\n    var nFeatures = trainData[0].length;\n    var weights = new Array(nFeatures).fill(0);\n    var bias = 0;\n    \n    for (var ep = 0; ep < epochs; ep++) {\n        for (var i = 0; i < trainData.length; i++) {\n            // 1. 计算加权和 z = Σ(weights[j]*x[j]) + bias\n            \n            // 2. 预测: z >= 0 ? 1 : 0\n            \n            // 3. 如果预测错误，更新权重和偏置\n            //    error = trainLabels[i] - prediction\n            //    weights[j] += lr * error * trainData[i][j]\n            //    bias += lr * error\n            \n        }\n    }\n    \n    return {\n        weights: weights,\n        bias: bias,\n        predict: function(x) {\n            var z = x.reduce(function(s,v,j){return s+weights[j]*v}, 0) + bias;\n            return z >= 0 ? 1 : 0;\n        }\n    };\n}`,
        testCode: `
var data = [[0,0],[0,1],[1,0],[1,1]];
var labels = [0, 0, 0, 1];
var model = trainPerceptron(data, labels, 0.1, 100);
var r = data.map(function(d){return model.predict(d)});
print('AND 门测试:');
print('  [0,0] → ' + r[0] + (r[0]===0 ? '  ✓' : '  ✗'));
print('  [0,1] → ' + r[1] + (r[1]===0 ? '  ✓' : '  ✗'));
print('  [1,0] → ' + r[2] + (r[2]===0 ? '  ✓' : '  ✗'));
print('  [1,1] → ' + r[3] + (r[3]===1 ? '  ✓' : '  ✗'));
print('\\n权重: [' + model.weights.map(function(w){return w.toFixed(3)}).join(', ') + '], 偏置: ' + model.bias.toFixed(3));
return r[0]===0 && r[1]===0 && r[2]===0 && r[3]===1;
`,
        showVisualization: false
    },
    {
        id: 14,
        title: '激活函数',
        description: '实现神经网络的核心组件',
        category: '神经网络',
        tutorial: `
            <p><b>激活函数</b>给神经网络引入非线性能力，没有它，多层网络等价于单层。</p>
            <p><b>Sigmoid</b>：将任意值映射到 (0,1)，常用于输出层</p>
            <div class="syntax-block">σ(x) = 1 / (1 + e^(-x))
σ'(x) = σ(x) × (1 - σ(x))</div>
            <p><b>ReLU</b>：简单高效，深度学习中最常用</p>
            <div class="syntax-block">ReLU(x) = max(0, x)
ReLU'(x) = x > 0 ? 1 : 0</div>
            <p><b>Tanh</b>：映射到 (-1,1)，以0为中心</p>
            <div class="syntax-block">tanh(x) = (e^x - e^(-x)) / (e^x + e^(-x))
tanh'(x) = 1 - tanh²(x)</div>
        `,
        task: '实现 <code>sigmoid</code>/<code>relu</code>/<code>tanh_</code> 及其导数 <code>sigmoidDeriv</code>/<code>reluDeriv</code>/<code>tanhDeriv</code>（共6个函数）。',
        hint: 'sigmoid: 1/(1+Math.exp(-x))，导数: s*(1-s)。relu: Math.max(0,x)，导数: x>0?1:0。tanh: Math.tanh(x)，导数: 1-Math.tanh(x)**2。',
        initialCode: `function sigmoid(x) {\n    \n}\nfunction sigmoidDeriv(x) {\n    // 提示: 先算 s=sigmoid(x), 然后 s*(1-s)\n    \n}\n\nfunction relu(x) {\n    \n}\nfunction reluDeriv(x) {\n    \n}\n\nfunction tanh_(x) {\n    \n}\nfunction tanhDeriv(x) {\n    \n}`,
        testCode: `
var tests = [
    ['sigmoid(0)', sigmoid(0), 0.5],
    ['sigmoid(100)', sigmoid(100), 1.0],
    ['sigmoidDeriv(0)', sigmoidDeriv(0), 0.25],
    ['relu(-5)', relu(-5), 0],
    ['relu(3)', relu(3), 3],
    ['reluDeriv(-5)', reluDeriv(-5), 0],
    ['reluDeriv(3)', reluDeriv(3), 1],
    ['tanh_(0)', tanh_(0), 0],
    ['tanhDeriv(0)', tanhDeriv(0), 1]
];
var allOk = true;
for (var i = 0; i < tests.length; i++) {
    var t = tests[i];
    var ok = Math.abs(t[1] - t[2]) < 0.001;
    if (!ok) allOk = false;
    print(t[0] + ' = ' + (typeof t[1]==='number'?t[1].toFixed(4):t[1]) + (ok ? '  ✓' : '  ✗ 期望 ' + t[2]));
}
return allOk;
`,
        showVisualization: false
    },
    {
        id: 15,
        title: '神经网络前向传播',
        description: '实现多层神经网络的前向计算',
        category: '神经网络',
        tutorial: `
            <p><b>前向传播</b>是神经网络处理数据的过程——数据从输入层逐层通过隐藏层到输出层。</p>
            <div class="syntax-block">两层网络结构: 输入(2) → 隐藏层(3) → 输出(1)

第一层: z1 = W1 × input + b1,  a1 = sigmoid(z1)
第二层: z2 = W2 × a1 + b2,     output = sigmoid(z2)

其中:
  W1: 3×2 矩阵 (隐藏层神经元数 × 输入维度)
  b1: 3×1 向量
  W2: 1×3 矩阵 (输出维度 × 隐藏层神经元数)
  b2: 1×1 向量</div>
            <p>矩阵乘法: <code>z[i] = Σ(W[i][j] × input[j]) + b[i]</code></p>
        `,
        task: '实现 <code>forwardPass(input, W1, b1, W2, b2)</code>，使用 sigmoid 激活，返回 <code>{ hidden, output }</code>。',
        hint: '先算隐藏层: 对W1每行与input做点积+b1，然后sigmoid。再算输出层: 对W2每行与hidden做点积+b2，然后sigmoid。',
        initialCode: `function forwardPass(input, W1, b1, W2, b2) {\n    // input: [x1, x2] 输入向量\n    // W1: [[w11,w12],[w21,w22],[w31,w32]] 第一层权重\n    // b1: [b1, b2, b3] 第一层偏置\n    // W2: [[w1,w2,w3]] 第二层权重\n    // b2: [b] 第二层偏置\n    // 使用 sigmoid 激活函数\n    \n    function sigmoid(x) { return 1 / (1 + Math.exp(-x)); }\n    \n    // 第一层: hidden[i] = sigmoid(Σ(W1[i][j]*input[j]) + b1[i])\n    var hidden = [];\n    \n    // 第二层: output[i] = sigmoid(Σ(W2[i][j]*hidden[j]) + b2[i])\n    var output = [];\n    \n    return { hidden: hidden, output: output };\n}`,
        testCode: `
var input = [0.5, 0.8];
var W1 = [[0.2, 0.4], [-0.5, 0.3], [0.1, -0.2]];
var b1 = [0.1, -0.1, 0.2];
var W2 = [[0.6, -0.3, 0.5]];
var b2 = [0.1];
var result = forwardPass(input, W1, b1, W2, b2);
// 手算验证:
// z1 = [0.2*0.5+0.4*0.8+0.1, -0.5*0.5+0.3*0.8-0.1, 0.1*0.5-0.2*0.8+0.2]
//    = [0.52, -0.11, 0.09]
// hidden = [sigmoid(0.52), sigmoid(-0.11), sigmoid(0.09)] = [0.6270, 0.4725, 0.5225]
// z2 = [0.6*0.6270 + (-0.3)*0.4725 + 0.5*0.5225 + 0.1] = [0.6955]
// output = [sigmoid(0.6955)] = [0.6674]
var expH = [0.6270, 0.4725, 0.5225];
var expO = [0.6674];
var hOk = result.hidden.length === 3 && result.hidden.every(function(v,i){return Math.abs(v-expH[i])<0.01});
var oOk = result.output.length === 1 && Math.abs(result.output[0]-expO[0])<0.01;
print('输入: [0.5, 0.8]');
print('隐藏层: [' + result.hidden.map(function(v){return v.toFixed(4)}).join(', ') + ']' + (hOk?'  ✓':'  ✗'));
print('输出层: [' + result.output.map(function(v){return v.toFixed(4)}).join(', ') + ']' + (oOk?'  ✓':'  ✗'));
return hOk && oOk;
`,
        showVisualization: false
    },
    {
        id: 16,
        title: '反向传播训练',
        description: '训练神经网络解决XOR问题',
        category: '神经网络',
        tutorial: `
            <p><b>反向传播（Backpropagation）</b>是训练神经网络的核心算法。它从输出层开始，反向逐层计算每个参数对损失的梯度，然后用梯度下降更新。</p>
            <div class="syntax-block">XOR 问题（感知机无法解决，需要多层网络）:
  [0,0] → 0    [0,1] → 1    [1,0] → 1    [1,1] → 0

反向传播公式（使用 sigmoid 和 MSE 损失）:
  输出误差: δ₂ = (output - target) × sigmoid'(z₂)
  隐藏误差: δ₁ = (W₂ᵀ × δ₂) × sigmoid'(z₁)
  
参数更新:
  W₂ -= lr × δ₂ × hidden ᵀ
  b₂ -= lr × δ₂
  W₁ -= lr × δ₁ × inputᵀ
  b₁ -= lr × δ₁</div>
        `,
        task: '完善 <code>trainXOR()</code> 函数中的反向传播部分，使网络能学会 XOR。',
        hint: '关键是计算输出层和隐藏层的梯度，然后更新权重。sigmoid导数: s*(1-s)。逐层从后往前计算。',
        dataHtml: `
            <div class="data-table-title">XOR 真值表</div>
            <table class="preview-table">
                <tr><th>x1</th><th>x2</th><th>期望输出</th></tr>
                <tr><td>0</td><td>0</td><td>0</td></tr>
                <tr><td>0</td><td>1</td><td>1</td></tr>
                <tr><td>1</td><td>0</td><td>1</td></tr>
                <tr><td>1</td><td>1</td><td>0</td></tr>
            </table>
        `,
        initialCode: `function trainXOR() {\n    function sigmoid(x) { return 1 / (1 + Math.exp(-x)); }\n    \n    var X = [[0,0],[0,1],[1,0],[1,1]];\n    var Y = [0, 1, 1, 0];\n    \n    // 网络: 2 → 4 → 1 (用固定种子初始化)\n    var W1 = [[0.5,-0.3],[0.2,0.4],[-0.1,0.6],[0.3,-0.5]];\n    var b1 = [0.1, -0.2, 0.1, 0.3];\n    var W2 = [[0.4, -0.2, 0.3, -0.5]];\n    var b2 = [0.1];\n    var lr = 2.0;\n    \n    for (var epoch = 0; epoch < 10000; epoch++) {\n        for (var s = 0; s < X.length; s++) {\n            var input = X[s];\n            var target = Y[s];\n            \n            // === 前向传播 ===\n            var z1 = [], a1 = [];\n            for (var i = 0; i < 4; i++) {\n                z1[i] = W1[i][0]*input[0] + W1[i][1]*input[1] + b1[i];\n                a1[i] = sigmoid(z1[i]);\n            }\n            var z2 = W2[0][0]*a1[0]+W2[0][1]*a1[1]+W2[0][2]*a1[2]+W2[0][3]*a1[3]+b2[0];\n            var out = sigmoid(z2);\n            \n            // === 反向传播 ===\n            // 输出层梯度: delta2 = (out - target) * out * (1 - out)\n            \n            // 隐藏层梯度: delta1[i] = W2[0][i] * delta2 * a1[i] * (1 - a1[i])\n            \n            // 更新 W2 和 b2\n            // W2[0][i] -= lr * delta2 * a1[i]\n            // b2[0] -= lr * delta2\n            \n            // 更新 W1 和 b1\n            // W1[i][j] -= lr * delta1[i] * input[j]\n            // b1[i] -= lr * delta1[i]\n            \n        }\n    }\n    \n    // 返回预测函数\n    return function(x) {\n        var h = [];\n        for (var i = 0; i < 4; i++) {\n            h[i] = sigmoid(W1[i][0]*x[0] + W1[i][1]*x[1] + b1[i]);\n        }\n        var o = sigmoid(W2[0][0]*h[0]+W2[0][1]*h[1]+W2[0][2]*h[2]+W2[0][3]*h[3]+b2[0]);\n        return o;\n    };\n}`,
        testCode: `
var predict = trainXOR();
var results = [[0,0],[0,1],[1,0],[1,1]].map(function(x){return predict(x)});
var labels = [0,1,1,0];
print('XOR 神经网络训练结果:');
var allOk = true;
for (var i = 0; i < 4; i++) {
    var pred = results[i];
    var rounded = pred >= 0.5 ? 1 : 0;
    var ok = rounded === labels[i];
    if (!ok) allOk = false;
    print('  [' + [0,0,0,1][i<2?0:1] + ',' + [0,1,0,1][i%2] + '] → ' + pred.toFixed(4) + ' (≈' + rounded + ')' + (ok ? '  ✓' : '  ✗'));
}
// 可视化损失(简化版)
draw.linePlot([0.25,0.24,0.22,0.18,0.12,0.06,0.02,0.005,0.001].concat(allOk?[0.0005]:[0.1]), {title:'训练收敛示意(实际为10000轮)', yLabel:'Loss', xLabel:'训练阶段'});
return allOk;
`,
        showVisualization: true
    },

    // ==================== Part 4: 数据制备实战 ====================
    {
        id: 17,
        title: '异常值检测',
        description: '识别数据中的异常值',
        category: '数据制备实战',
        tutorial: `
            <p>在数据制备工作中，<b>异常值</b>可能导致分析结果偏差严重。常用两种方法检测：</p>
            <p><b>Z-Score 法</b>：如果一个值的 Z-Score 绝对值大于阈值（通常2或3），视为异常。</p>
            <div class="syntax-block">Z-Score = (x - μ) / σ
|Z-Score| > threshold → 异常值</div>
            <p><b>IQR 法</b>（四分位距）：更稳健，不受极端值影响。</p>
            <div class="syntax-block">IQR = Q3 - Q1  (第三四分位数 - 第一四分位数)
下界 = Q1 - 1.5 × IQR
上界 = Q3 + 1.5 × IQR
超出上下界的值 → 异常值</div>
            <p>实际数据制备中，发现异常后需要判断是录入错误还是真实极端值。</p>
        `,
        task: '实现 <code>detectOutliersZScore(arr, threshold)</code> 和 <code>detectOutliersIQR(arr)</code>，均返回异常值的索引数组。',
        hint: 'Z-Score: 算mean和std，找|z|>threshold的。IQR: 排序后找Q1(25%)Q3(75%)，算IQR和上下界，找超出的。Q1取排序后第Math.floor(n*0.25)个元素。',
        initialCode: `function detectOutliersZScore(arr, threshold) {\n    // 返回异常值的索引数组\n    // threshold 默认为 2\n    threshold = threshold || 2;\n    \n    // 1. 计算均值和标准差\n    \n    // 2. 找出 |z-score| > threshold 的索引\n    \n}\n\nfunction detectOutliersIQR(arr) {\n    // 返回异常值的索引数组\n    \n    // 1. 排序（注意不要修改原数组）\n    \n    // 2. 计算 Q1 和 Q3\n    \n    // 3. 计算 IQR = Q3 - Q1\n    \n    // 4. 找出超出 [Q1-1.5*IQR, Q3+1.5*IQR] 范围的索引\n    \n}`,
        testCode: `
var data = [10, 12, 11, 13, 12, 100, 11, 10, 13, -50, 12, 11];
var zIdx = detectOutliersZScore(data, 2);
var iqrIdx = detectOutliersIQR(data);
print('数据: [10, 12, 11, 13, 12, 100, 11, 10, 13, -50, 12, 11]');
print('');
print('Z-Score 异常值索引: [' + zIdx.sort().join(', ') + ']');
var zOk = zIdx.length === 2 && zIdx.indexOf(5) !== -1 && zIdx.indexOf(9) !== -1;
print('  包含索引5(值100)和索引9(值-50): ' + (zOk ? '✓' : '✗'));
print('');
print('IQR 异常值索引: [' + iqrIdx.sort().join(', ') + ']');
var iqrOk = iqrIdx.indexOf(5) !== -1 && iqrIdx.indexOf(9) !== -1;
print('  包含索引5(值100)和索引9(值-50): ' + (iqrOk ? '✓' : '✗'));
return zOk && iqrOk;
`,
        showVisualization: false
    },
    {
        id: 18,
        title: '缺失值智能填充',
        description: '用统计方法和KNN填充缺失数据',
        category: '数据制备实战',
        tutorial: `
            <p>数据中常有缺失值（null/NaN），直接删除会浪费数据。<b>智能填充</b>是更好的方案。</p>
            <p><b>均值填充</b>：用该列的均值替换缺失值——简单但忽略了数据关系。</p>
            <p><b>KNN 填充</b>：找到与缺失样本最相似的K个完整样本，用它们该特征的均值来填充——考虑了样本间的关系，更准确。</p>
            <div class="syntax-block">KNN填充步骤:
1. 对有缺失值的样本，找出其非缺失的特征
2. 在完整样本中，用这些非缺失特征计算距离
3. 取最近K个完整样本
4. 用这K个样本的对应特征均值填充</div>
            <p>用 <code>null</code> 表示缺失值。</p>
        `,
        task: '实现 <code>meanImpute(data, colIdx)</code> 和 <code>knnImpute(data, k)</code>。data 是二维数组，null 表示缺失。',
        hint: 'meanImpute: 对colIdx列，算非null值的均值填入null处。knnImpute: 对每个含null的行，找出完整行中距离最近的k个(只用非null列算距离)，用均值填充。',
        initialCode: `function meanImpute(data, colIdx) {\n    // data: 二维数组，null 表示缺失\n    // colIdx: 要填充的列索引\n    // 返回该列的填充结果数组（不修改原数据）\n    \n    // 1. 收集该列非null的值\n    \n    // 2. 计算均值\n    \n    // 3. 将null替换为均值\n    \n}\n\nfunction knnImpute(data, k) {\n    // 返回填充后的完整二维数组（不修改原数据）\n    // 用 KNN 方法填充所有缺失值\n    \n    var result = data.map(function(row){return row.slice()});\n    \n    // 找出完整行和不完整行\n    \n    // 对每个不完整行的每个缺失值:\n    //   1. 找出该行的非null列索引\n    //   2. 在完整行中，用这些列算距离\n    //   3. 取最近k个，用它们该列的均值填充\n    \n    return result;\n}`,
        testCode: `
var data = [
    [170, 65, 25],
    [165, null, 22],
    [180, 80, null],
    [175, 70, 28],
    [160, 55, 20],
    [null, 75, 30]
];

// 测试均值填充
var col1 = meanImpute(data, 1); // 体重列
var validW = [65, 80, 70, 55, 75]; // 非null的体重值
var expectedMean = validW.reduce(function(a,b){return a+b},0) / validW.length; // 69
var mOk = Math.abs(col1[1] - expectedMean) < 0.1;
print('均值填充 体重列:');
print('  缺失处(行1)填充为: ' + col1[1].toFixed(1) + ' (均值=' + expectedMean + ')' + (mOk ? '  ✓' : '  ✗'));

// 测试KNN填充
var filled = knnImpute(data, 2);
var kOk = filled[1][1] !== null && filled[2][2] !== null && filled[5][0] !== null;
print('\\nKNN填充 (k=2):');
print('  行1体重: ' + (filled[1][1]!==null ? filled[1][1].toFixed(1) : 'null') + (filled[1][1]!==null ? '  ✓' : '  ✗'));
print('  行2年龄: ' + (filled[2][2]!==null ? filled[2][2].toFixed(1) : 'null') + (filled[2][2]!==null ? '  ✓' : '  ✗'));
print('  行5身高: ' + (filled[5][0]!==null ? filled[5][0].toFixed(1) : 'null') + (filled[5][0]!==null ? '  ✓' : '  ✗'));
return mOk && kOk;
`,
        showVisualization: false
    },
    {
        id: 19,
        title: '文本相似度匹配',
        description: '用TF-IDF和余弦相似度匹配字段',
        category: '数据制备实战',
        tutorial: `
            <p>数据制备中，不同系统的字段名往往不一致（如"手机号"vs"电话"vs"联系方式"），需要<b>文本相似度</b>来自动匹配。</p>
            <p><b>字符级N-gram</b>：将文本拆成连续N个字符的片段</p>
            <div class="syntax-block">例如 "手机号码" 的 2-gram: ["手机", "机号", "号码"]
"电话号码" 的 2-gram: ["电话", "话号", "号码"]
共同出现: "号码" → 有一定相似度</div>
            <p><b>余弦相似度</b>：两个向量夹角的余弦值，值域 [0,1]</p>
            <div class="syntax-block">cos(A,B) = (A·B) / (|A| × |B|)

1. 将每个文本转为 N-gram 频率向量
2. 计算两个频率向量的余弦相似度
3. 相似度越高，文本越可能是同一个概念</div>
        `,
        task: '实现 <code>ngrams(text, n)</code>、<code>cosineSimilarity(a, b)</code> 和 <code>findBestMatch(source, candidates)</code>。',
        hint: 'ngrams: 循环text截取n长子串。cosineSimilarity: 合并两个对象的key集合，算点积和模长。findBestMatch: 对每个candidate算相似度取最大。',
        initialCode: `function ngrams(text, n) {\n    // 返回字符级n-gram数组\n    // 例如 ngrams("abc", 2) → ["ab", "bc"]\n    \n}\n\nfunction textToVector(text, n) {\n    // 将文本转为 n-gram 频率对象 {gram: count}\n    var grams = ngrams(text, n || 2);\n    var vec = {};\n    grams.forEach(function(g) { vec[g] = (vec[g] || 0) + 1; });\n    return vec;\n}\n\nfunction cosineSimilarity(vecA, vecB) {\n    // 计算两个频率向量(对象)的余弦相似度\n    // 1. 计算点积 A·B\n    // 2. 计算 |A| 和 |B|\n    // 3. 返回 dotProduct / (|A| × |B|)\n    \n}\n\nfunction findBestMatch(source, candidates) {\n    // source: 源字段名\n    // candidates: 候选字段名数组\n    // 返回 { match: 最匹配的候选, score: 相似度 }\n    var srcVec = textToVector(source, 2);\n    \n}`,
        testCode: `
// 测试 ngrams
var ng = ngrams("手机号码", 2);
var ngOk = ng.length === 3 && ng[0] === "手机" && ng[2] === "号码";
print('ngrams("手机号码", 2) = [' + ng.join(', ') + ']' + (ngOk ? '  ✓' : '  ✗'));

// 测试余弦相似度
var v1 = textToVector("手机号码", 2);
var v2 = textToVector("电话号码", 2);
var sim = cosineSimilarity(v1, v2);
print('\\n"手机号码" vs "电话号码" 相似度: ' + sim.toFixed(4));
var simOk = sim > 0.2 && sim < 0.8;
print('  在合理范围 (0.2~0.8): ' + (simOk ? '✓' : '✗'));

// 测试字段匹配
var source = "联系电话";
var candidates = ["姓名", "手机号码", "电子邮箱", "家庭住址", "电话号码"];
var best = findBestMatch(source, candidates);
var matchOk = best.match === "电话号码";
print('\\n匹配 "联系电话" → "' + best.match + '" (分数:' + best.score.toFixed(4) + ')' + (matchOk ? '  ✓' : '  ✗'));

var best2 = findBestMatch("电子邮件", candidates);
var match2Ok = best2.match === "电子邮箱";
print('匹配 "电子邮件" → "' + best2.match + '" (分数:' + best2.score.toFixed(4) + ')' + (match2Ok ? '  ✓' : '  ✗'));

return ngOk && simOk && matchOk && match2Ok;
`,
        showVisualization: false
    },
    {
        id: 20,
        title: '综合挑战：数据质量评分',
        description: '构建完整的数据质量评估管道',
        category: '数据制备实战',
        tutorial: `
            <p>最终挑战！综合运用所学的 ML 技能，构建一个<b>数据质量评分</b>系统——这是数据制备工作中最常见的需求之一。</p>
            <p><b>需求</b>：对数据集的每一行计算一个质量分数（0~1），评估维度：</p>
            <div class="syntax-block">1. 完整性(completeness): 非null值的比例
2. 异常性(normality): 数值列中值是否在正常范围
3. 一致性(consistency): 同类字段间是否矛盾

最终质量分 = w₁×完整性 + w₂×正常性 + w₃×一致性

其中 w₁=0.4, w₂=0.3, w₃=0.3</div>
            <p>数据场景：员工信息表，包含姓名、年龄、部门、薪资。</p>
            <p>一致性规则：如果部门是"实习"，薪资应 ≤ 8000；否则薪资应 > 3000。</p>
        `,
        task: '实现 <code>assessQuality(data, columns)</code>，对每行返回质量分数（0~1）。按照教程中的三个维度和权重计算。',
        hint: '完整性: 非null列数/总列数。正常性: 年龄在18-65,薪资在1000-100000之间则正常(1),否则(0)。一致性: 检查部门薪资规则。最终加权求和。',
        dataHtml: `
            <div class="data-table-title">员工信息表</div>
            <table class="preview-table">
                <tr><th>姓名</th><th>年龄</th><th>部门</th><th>薪资</th></tr>
                <tr><td>张三</td><td>28</td><td>技术</td><td>15000</td></tr>
                <tr><td>null</td><td>25</td><td>市场</td><td>12000</td></tr>
                <tr><td>王五</td><td>200</td><td>技术</td><td>18000</td></tr>
                <tr><td>赵六</td><td>22</td><td>实习</td><td>20000</td></tr>
                <tr><td>孙七</td><td>null</td><td>null</td><td>null</td></tr>
                <tr><td>周八</td><td>35</td><td>管理</td><td>25000</td></tr>
            </table>
        `,
        initialCode: `function assessQuality(data, columns) {\n    // data: 二维数组，每行一条记录\n    // columns: 列名数组 ["姓名","年龄","部门","薪资"]\n    // 返回每行的质量分数数组 (0~1)\n    \n    var ageIdx = columns.indexOf("年龄");\n    var salaryIdx = columns.indexOf("薪资");\n    var deptIdx = columns.indexOf("部门");\n    \n    return data.map(function(row) {\n        // 1. 完整性: 非null值数量 / 总列数\n        \n        // 2. 正常性: 检查数值列是否在合理范围\n        //    年龄: 18~65 之间得1分，否则0分（null不扣分，按该项不参与计算）\n        //    薪资: 1000~100000 之间得1分，否则0分\n        //    正常性 = 正常项分数之和 / 参与计算的项数（若全为null则为1）\n        \n        // 3. 一致性: 部门与薪资的逻辑一致性\n        //    若部门="实习"且薪资>8000 → 0分\n        //    若部门!="实习"且薪资<=3000 → 0分\n        //    其他情况或有null无法判断 → 1分\n        \n        // 最终: 0.4*完整性 + 0.3*正常性 + 0.3*一致性\n        \n    });\n}`,
        testCode: `
var data = [
    ["张三", 28, "技术", 15000],   // 完美数据
    [null, 25, "市场", 12000],     // 缺姓名
    ["王五", 200, "技术", 18000],  // 年龄异常
    ["赵六", 22, "实习", 20000],   // 实习薪资不一致
    ["孙七", null, null, null],    // 大量缺失
    ["周八", 35, "管理", 25000]    // 完美数据
];
var columns = ["姓名", "年龄", "部门", "薪资"];
var scores = assessQuality(data, columns);

print('数据质量评分结果:');
var names = ["张三","(缺)","王五","赵六","孙七","周八"];
for (var i = 0; i < scores.length; i++) {
    print('  ' + names[i] + ': ' + scores[i].toFixed(3));
}
// 验证
var ok1 = scores[0] > 0.9;  // 完美数据应该接近1
var ok2 = scores[0] > scores[1]; // 张三 > 缺姓名的
var ok3 = scores[0] > scores[2]; // 张三 > 年龄异常的
var ok4 = scores[0] > scores[3]; // 张三 > 不一致的
var ok5 = scores[4] < 0.5;  // 大量缺失应该低分
var ok6 = scores[5] > 0.9;  // 完美数据
print('');
print('完美数据(张三)≈1.0: ' + (ok1 ? '✓' : '✗'));
print('完美 > 缺失: ' + (ok2 ? '✓' : '✗'));
print('完美 > 异常: ' + (ok3 ? '✓' : '✗'));
print('完美 > 不一致: ' + (ok4 ? '✓' : '✗'));
print('大量缺失 < 0.5: ' + (ok5 ? '✓' : '✗'));
print('周八(完美)≈1.0: ' + (ok6 ? '✓' : '✗'));
return ok1 && ok2 && ok3 && ok4 && ok5 && ok6;
`,
        showVisualization: false
    }
];

// ===== 可视化工具 =====
class PlotHelper {
    constructor(canvas) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.W = canvas.width;
        this.H = canvas.height;
        this.pad = 45;
    }

    clear() {
        this.ctx.clearRect(0, 0, this.W, this.H);
        this.ctx.fillStyle = 'rgba(0,0,0,0.3)';
        this.ctx.fillRect(0, 0, this.W, this.H);
    }

    _mapX(x, xMin, xMax) {
        return this.pad + (x - xMin) / (xMax - xMin) * (this.W - 2 * this.pad);
    }

    _mapY(y, yMin, yMax) {
        return this.H - this.pad - (y - yMin) / (yMax - yMin) * (this.H - 2 * this.pad);
    }

    _drawAxes(xMin, xMax, yMin, yMax, xLabel, yLabel) {
        const ctx = this.ctx;
        ctx.strokeStyle = 'rgba(255,255,255,0.2)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(this.pad, this.H - this.pad);
        ctx.lineTo(this.W - this.pad, this.H - this.pad);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(this.pad, this.pad);
        ctx.lineTo(this.pad, this.H - this.pad);
        ctx.stroke();

        ctx.fillStyle = 'rgba(255,255,255,0.4)';
        ctx.font = '11px sans-serif';
        ctx.textAlign = 'center';
        for (let i = 0; i <= 4; i++) {
            const x = xMin + (xMax - xMin) * i / 4;
            ctx.fillText(x % 1 === 0 ? x : x.toFixed(1), this._mapX(x, xMin, xMax), this.H - this.pad + 15);
            const y = yMin + (yMax - yMin) * i / 4;
            ctx.textAlign = 'right';
            ctx.fillText(y % 1 === 0 ? y : y.toFixed(1), this.pad - 5, this._mapY(y, yMin, yMax) + 4);
            ctx.textAlign = 'center';
        }
        ctx.fillStyle = 'rgba(255,255,255,0.5)';
        ctx.font = '12px sans-serif';
        if (xLabel) ctx.fillText(xLabel, this.W / 2, this.H - 5);
        if (yLabel) {
            ctx.save();
            ctx.translate(12, this.H / 2);
            ctx.rotate(-Math.PI / 2);
            ctx.fillText(yLabel, 0, 0);
            ctx.restore();
        }
    }

    scatter(points, opts) {
        opts = opts || {};
        const colors = ['#00c9ff', '#ff6b6b', '#92fe9d', '#fbbf24', '#c084fc', '#f472b6'];
        const size = opts.size || 5;
        let xMin = Infinity, xMax = -Infinity, yMin = Infinity, yMax = -Infinity;
        points.forEach(p => { xMin = Math.min(xMin, p[0]); xMax = Math.max(xMax, p[0]); yMin = Math.min(yMin, p[1]); yMax = Math.max(yMax, p[1]); });
        const xPad = (xMax - xMin) * 0.1 || 1;
        const yPad = (yMax - yMin) * 0.1 || 1;
        xMin -= xPad; xMax += xPad; yMin -= yPad; yMax += yPad;
        this.clear();
        this._drawAxes(xMin, xMax, yMin, yMax, opts.xLabel, opts.yLabel);
        const ctx = this.ctx;
        points.forEach(p => {
            ctx.fillStyle = colors[(p[2] || 0) % colors.length];
            ctx.beginPath();
            ctx.arc(this._mapX(p[0], xMin, xMax), this._mapY(p[1], yMin, yMax), p[2] === 2 ? size + 2 : size, 0, Math.PI * 2);
            ctx.fill();
        });
        if (opts.title) { ctx.fillStyle = '#fff'; ctx.font = '14px sans-serif'; ctx.textAlign = 'center'; ctx.fillText(opts.title, this.W / 2, 20); }

        // Legend
        if (opts.legendLabels) {
            const ly = 38;
            ctx.font = '11px sans-serif';
            opts.legendLabels.forEach((lbl, i) => {
                const lx = this.W - this.pad - (opts.legendLabels.length - i) * 80;
                ctx.fillStyle = colors[i % colors.length];
                ctx.fillRect(lx, ly - 5, 10, 10);
                ctx.fillStyle = 'rgba(255,255,255,0.7)';
                ctx.textAlign = 'left';
                ctx.fillText(lbl, lx + 14, ly + 4);
            });
        }
    }

    scatterWithLine(points, slope, intercept, opts) {
        opts = opts || {};
        const colors = ['#00c9ff', '#ff6b6b', '#92fe9d'];
        const size = opts.size || 5;
        let xMin = Infinity, xMax = -Infinity, yMin = Infinity, yMax = -Infinity;
        points.forEach(p => { xMin = Math.min(xMin, p[0]); xMax = Math.max(xMax, p[0]); yMin = Math.min(yMin, p[1]); yMax = Math.max(yMax, p[1]); });
        const lineY1 = slope * xMin + intercept, lineY2 = slope * xMax + intercept;
        yMin = Math.min(yMin, lineY1, lineY2); yMax = Math.max(yMax, lineY1, lineY2);
        const xPad = (xMax - xMin) * 0.15 || 1;
        const yPad = (yMax - yMin) * 0.15 || 1;
        xMin -= xPad; xMax += xPad; yMin -= yPad; yMax += yPad;
        this.clear();
        this._drawAxes(xMin, xMax, yMin, yMax, opts.xLabel, opts.yLabel);
        const ctx = this.ctx;
        // Line
        ctx.strokeStyle = '#92fe9d';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(this._mapX(xMin + xPad, xMin, xMax), this._mapY(slope * (xMin + xPad) + intercept, yMin, yMax));
        ctx.lineTo(this._mapX(xMax - xPad, xMin, xMax), this._mapY(slope * (xMax - xPad) + intercept, yMin, yMax));
        ctx.stroke();
        // Points
        points.forEach(p => {
            ctx.fillStyle = colors[(p[2] || 0) % colors.length];
            ctx.beginPath();
            ctx.arc(this._mapX(p[0], xMin, xMax), this._mapY(p[1], yMin, yMax), size, 0, Math.PI * 2);
            ctx.fill();
        });
        if (opts.title) { ctx.fillStyle = '#fff'; ctx.font = '14px sans-serif'; ctx.textAlign = 'center'; ctx.fillText(opts.title, this.W / 2, 20); }
    }

    linePlot(values, opts) {
        opts = opts || {};
        const color = opts.color || '#00c9ff';
        const xMin = 0, xMax = values.length - 1;
        let yMin = Math.min.apply(null, values), yMax = Math.max.apply(null, values);
        const yPad = (yMax - yMin) * 0.1 || 0.1;
        yMin -= yPad; yMax += yPad;
        this.clear();
        this._drawAxes(xMin, xMax, yMin, yMax, opts.xLabel || '迭代', opts.yLabel || '值');
        const ctx = this.ctx;
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.beginPath();
        values.forEach((v, i) => {
            const px = this._mapX(i, xMin, xMax), py = this._mapY(v, yMin, yMax);
            i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
        });
        ctx.stroke();
        if (opts.title) { ctx.fillStyle = '#fff'; ctx.font = '14px sans-serif'; ctx.textAlign = 'center'; ctx.fillText(opts.title, this.W / 2, 20); }
    }
}

// ===== 代码执行引擎 =====
function executeCode(userCode, level) {
    const logs = [];
    const _print = function() {
        const args = Array.prototype.slice.call(arguments);
        logs.push(args.map(function(a) {
            if (a === null) return 'null';
            if (a === undefined) return 'undefined';
            if (typeof a === 'object') return JSON.stringify(a);
            return String(a);
        }).join(' '));
    };

    const canvas = document.getElementById('vizCanvas');
    const plot = new PlotHelper(canvas);

    try {
        const fullCode = (level.setupCode || '') + '\n' + userCode + '\n' + (level.testCode || '');
        const fn = new Function('print', 'draw', fullCode);
        const result = fn(_print, plot);
        return { success: true, logs: logs, result: result };
    } catch (e) {
        return { success: false, error: e.message, logs: logs };
    }
}

// ===== 进度管理 =====
function loadProgress() {
    try {
        return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {};
    } catch (e) { return {}; }
}

function saveProgress(levelId) {
    const progress = loadProgress();
    progress[levelId] = true;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(progress));
}

function isLevelUnlocked(idx) {
    if (idx === 0) return true;
    const progress = loadProgress();
    return !!progress[LEVELS[idx - 1].id];
}

// ===== UI 函数 =====
function goBack() {
    window.location.href = '../../index.html';
}

function showLevelSelect() {
    document.getElementById('levelSelect').style.display = '';
    document.getElementById('levelDetail').style.display = 'none';

    const progress = loadProgress();
    const completed = LEVELS.filter(l => progress[l.id]).length;
    document.getElementById('totalProgress').style.width = (completed / LEVELS.length * 100) + '%';
    document.getElementById('progressText').textContent = `已完成 ${completed} / ${LEVELS.length} 关`;

    const grid = document.getElementById('levelGrid');
    grid.innerHTML = '';

    let currentCategory = '';
    LEVELS.forEach((level, idx) => {
        // 分类标题
        if (level.category !== currentCategory) {
            currentCategory = level.category;
            const catTitle = document.createElement('div');
            catTitle.className = 'category-title';
            const catIcons = { '数据基础': '📐', '经典算法': '⚙️', '神经网络': '🧠', '数据制备实战': '🔧' };
            catTitle.textContent = (catIcons[currentCategory] || '📂') + ' ' + currentCategory;
            grid.appendChild(catTitle);
        }

        const unlocked = isLevelUnlocked(idx);
        const done = !!progress[level.id];
        const card = document.createElement('div');
        card.className = 'level-card' + (done ? ' completed' : '') + (!unlocked ? ' locked' : '');
        card.innerHTML = `
            ${!unlocked ? '<div class="lock-icon">🔒</div>' : ''}
            <div class="level-number">第 ${level.id} 关</div>
            <div class="level-card-title">${level.title}</div>
            <div class="level-card-desc">${level.description}</div>
        `;
        if (unlocked) card.addEventListener('click', () => openLevel(idx));
        grid.appendChild(card);
    });
}

function openLevel(idx) {
    currentLevelIdx = idx;
    const level = LEVELS[idx];

    document.getElementById('levelSelect').style.display = 'none';
    document.getElementById('levelDetail').style.display = '';

    document.getElementById('levelTitle').textContent = `第 ${level.id} 关：${level.title}`;
    document.getElementById('tutorialContent').innerHTML = level.tutorial;
    document.getElementById('taskContent').innerHTML = level.task;

    // 数据参考
    const dataSection = document.getElementById('dataSection');
    if (level.dataHtml) {
        dataSection.style.display = '';
        document.getElementById('dataContent').innerHTML = level.dataHtml;
    } else {
        dataSection.style.display = 'none';
    }

    // 可视化区域
    document.getElementById('canvasSection').style.display = level.showVisualization ? '' : 'none';

    // 编辑器
    document.getElementById('codeEditor').value = level.initialCode;
    document.getElementById('outputArea').innerHTML = '<p class="placeholder-text">运行代码后在此查看结果</p>';
    document.getElementById('hintBox').style.display = 'none';

    // 导航按钮
    document.getElementById('btnPrevLevel').disabled = (idx === 0);
    const nextUnlocked = idx + 1 < LEVELS.length && isLevelUnlocked(idx + 1);
    document.getElementById('btnNextLevel').disabled = !nextUnlocked;
}

function handleRun() {
    const level = LEVELS[currentLevelIdx];
    const userCode = document.getElementById('codeEditor').value.trim();
    if (!userCode) return;

    // 显示/隐藏可视化
    if (level.showVisualization) {
        document.getElementById('canvasSection').style.display = '';
    }

    const result = executeCode(userCode, level);
    const outputArea = document.getElementById('outputArea');

    if (!result.success) {
        let html = '';
        if (result.logs.length > 0) {
            html += result.logs.map(l => `<div class="output-line">${escapeHtml(l)}</div>`).join('');
        }
        html += `<div class="error-msg">❌ 错误：${escapeHtml(result.error)}</div>`;
        outputArea.innerHTML = html;
        return;
    }

    let html = result.logs.map(l => {
        const escaped = escapeHtml(l);
        if (l.includes('✓')) return `<div class="output-line pass-char">${escaped}</div>`;
        if (l.includes('✗')) return `<div class="output-line fail-char">${escaped}</div>`;
        return `<div class="output-line">${escaped}</div>`;
    }).join('');

    if (result.result === true) {
        html = '<div class="success-msg">✅ 所有测试通过！</div>' + html;
        saveProgress(level.id);
        showSuccessModal(level);
    } else {
        html = '<div class="fail-msg">⚠️ 部分测试未通过，请检查代码逻辑</div>' + html;
    }
    outputArea.innerHTML = html;
}

function escapeHtml(str) {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function handleHint() {
    const level = LEVELS[currentLevelIdx];
    const box = document.getElementById('hintBox');
    box.textContent = level.hint;
    box.style.display = box.style.display === 'none' ? '' : 'none';
}

function handleReset() {
    const level = LEVELS[currentLevelIdx];
    document.getElementById('codeEditor').value = level.initialCode;
}

function showSuccessModal(level) {
    const modal = document.getElementById('successModal');
    const idx = LEVELS.indexOf(level);
    const isLast = idx === LEVELS.length - 1;
    document.getElementById('successMsg').textContent = isLast
        ? '恭喜你完成了所有关卡！你已经掌握了机器学习算法的核心原理！'
        : `你已掌握「${level.title}」，继续挑战下一关吧！`;
    document.getElementById('btnNextFromModal').style.display = isLast ? 'none' : '';
    modal.style.display = 'flex';
}

// ===== 事件绑定 =====
document.addEventListener('DOMContentLoaded', () => {
    showLevelSelect();

    document.getElementById('btnRun').addEventListener('click', handleRun);
    document.getElementById('btnHint').addEventListener('click', handleHint);
    document.getElementById('btnReset').addEventListener('click', handleReset);

    document.getElementById('btnPrevLevel').addEventListener('click', () => {
        if (currentLevelIdx > 0) openLevel(currentLevelIdx - 1);
    });

    document.getElementById('btnNextLevel').addEventListener('click', () => {
        if (currentLevelIdx < LEVELS.length - 1 && isLevelUnlocked(currentLevelIdx + 1)) {
            openLevel(currentLevelIdx + 1);
        }
    });

    document.getElementById('btnBackToList').addEventListener('click', () => {
        document.getElementById('successModal').style.display = 'none';
        showLevelSelect();
    });

    document.getElementById('btnNextFromModal').addEventListener('click', () => {
        document.getElementById('successModal').style.display = 'none';
        if (currentLevelIdx < LEVELS.length - 1) {
            openLevel(currentLevelIdx + 1);
        }
    });

    // Tab键支持
    document.getElementById('codeEditor').addEventListener('keydown', (e) => {
        if (e.key === 'Tab') {
            e.preventDefault();
            const ta = e.target;
            const start = ta.selectionStart, end = ta.selectionEnd;
            ta.value = ta.value.substring(0, start) + '    ' + ta.value.substring(end);
            ta.selectionStart = ta.selectionEnd = start + 4;
        }
        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
            e.preventDefault();
            handleRun();
        }
    });
});
