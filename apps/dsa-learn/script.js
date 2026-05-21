// ===== 关卡数据 =====
const LEVELS = [
    // ===== 第一阶段：数组基础 =====
    {
        id: 1,
        title: '认识数组',
        description: '学习创建和使用数组',
        tutorial: `
            <p><code>数组（Array）</code>是最基础的数据结构，用于按顺序存储一组数据。</p>
            <p>在 JavaScript 中，使用方括号 <code>[]</code> 创建数组：</p>
            <div class="syntax-block">let arr = [1, 2, 3, 4, 5];
let names = ['张三', '李四', '王五'];</div>
            <p>数组的索引从 <code>0</code> 开始，通过 <code>arr[index]</code> 访问元素：</p>
            <div class="visual-box">索引:   0    1    2    3    4
      ┌────┬────┬────┬────┬────┐
数组: │  1 │  2 │  3 │  4 │  5 │
      └────┴────┴────┴────┴────┘</div>
        `,
        task: '编写函数 <code>createArray()</code>，返回包含 1 到 5 的数组 <code>[1, 2, 3, 4, 5]</code>。',
        template: `function createArray() {\n    // 创建并返回包含 1, 2, 3, 4, 5 的数组\n}`,
        hint: '直接 return [1, 2, 3, 4, 5]; 即可。',
        answer: `function createArray() {\n    return [1, 2, 3, 4, 5];\n}`,
        validate(code) {
            return testFunction(code, 'createArray', [
                { input: [], expected: [1, 2, 3, 4, 5] }
            ]);
        }
    },
    {
        id: 2,
        title: '数组的读写',
        description: '学习如何访问和修改数组元素',
        tutorial: `
            <p>通过索引访问数组元素，索引从 <code>0</code> 开始：</p>
            <div class="syntax-block">let arr = [10, 20, 30];
arr[0]  // 10（第一个元素）
arr[2]  // 30（第三个元素）
arr.length  // 3（数组长度）</div>
            <p>修改元素只需给对应索引赋值：</p>
            <div class="syntax-block">arr[0] = 99;  // 数组变为 [99, 20, 30]</div>
            <p>获取最后一个元素：<code>arr[arr.length - 1]</code></p>
        `,
        task: '编写 <code>getFirst(arr)</code> 返回第一个元素，<code>getLast(arr)</code> 返回最后一个元素，<code>setFirst(arr, val)</code> 将第一个元素设为 val 并返回修改后的数组。',
        template: `function getFirst(arr) {\n    // 返回数组第一个元素\n}\n\nfunction getLast(arr) {\n    // 返回数组最后一个元素\n}\n\nfunction setFirst(arr, val) {\n    // 将第一个元素设为 val，返回修改后的数组\n}`,
        hint: 'getFirst 用 arr[0]，getLast 用 arr[arr.length - 1]，setFirst 先赋值再 return arr。',
        answer: `function getFirst(arr) {\n    return arr[0];\n}\n\nfunction getLast(arr) {\n    return arr[arr.length - 1];\n}\n\nfunction setFirst(arr, val) {\n    arr[0] = val;\n    return arr;\n}`,
        validate(code) {
            const checks = [];
            try {
                const fns = new Function(code + '\nreturn { getFirst, getLast, setFirst };')();
                let r;
                r = fns.getFirst([10, 20, 30]);
                checks.push({ pass: r === 10, msg: r === 10 ? 'getFirst([10,20,30]) = 10 ✓' : 'getFirst([10,20,30]) 期望 10，得到 ' + JSON.stringify(r) });
                r = fns.getLast([10, 20, 30]);
                checks.push({ pass: r === 30, msg: r === 30 ? 'getLast([10,20,30]) = 30 ✓' : 'getLast([10,20,30]) 期望 30，得到 ' + JSON.stringify(r) });
                r = fns.setFirst([1, 2, 3], 99);
                const p = deepEqual(r, [99, 2, 3]);
                checks.push({ pass: p, msg: p ? 'setFirst([1,2,3], 99) = [99,2,3] ✓' : 'setFirst([1,2,3], 99) 期望 [99,2,3]，得到 ' + JSON.stringify(r) });
            } catch (e) {
                checks.push({ pass: false, msg: '代码执行出错: ' + e.message });
            }
            return checks;
        }
    },
    {
        id: 3,
        title: '数组常用方法',
        description: '掌握 push/pop/shift/unshift',
        tutorial: `
            <p>JavaScript 数组提供了多种内置方法来增删元素：</p>
            <div class="syntax-block">arr.push(6)      // 末尾添加 → [1,2,3,6]
arr.pop()        // 末尾删除 → [1,2,3]，返回 6
arr.unshift(0)   // 开头添加 → [0,1,2,3]
arr.shift()      // 开头删除 → [1,2,3]，返回 0</div>
            <div class="visual-box">unshift → [□, □, □, □, □] ← push
 shift ← [□, □, □, □, □] → pop</div>
            <p><code>push/pop</code> 操作末尾，<code>unshift/shift</code> 操作开头。</p>
        `,
        task: '编写 <code>arrayOps(arr)</code>：在末尾添加 <code>6</code>，删除第一个元素，再在开头添加 <code>0</code>，返回结果数组。',
        template: `function arrayOps(arr) {\n    // 1. 在末尾添加 6\n    // 2. 删除第一个元素\n    // 3. 在开头添加 0\n    // 4. 返回修改后的数组\n}`,
        hint: '依次调用 arr.push(6)、arr.shift()、arr.unshift(0)，最后 return arr。',
        answer: `function arrayOps(arr) {\n    arr.push(6);\n    arr.shift();\n    arr.unshift(0);\n    return arr;\n}`,
        validate(code) {
            return testFunction(code, 'arrayOps', [
                { input: [[1, 2, 3, 4, 5]], expected: [0, 2, 3, 4, 5, 6] },
                { input: [[10, 20]], expected: [0, 20, 6] }
            ]);
        }
    },
    {
        id: 4,
        title: '数组遍历与求和',
        description: '学习遍历数组并计算总和',
        tutorial: `
            <p>遍历数组最常用的方式是 <code>for</code> 循环：</p>
            <div class="syntax-block">let sum = 0;
for (let i = 0; i < arr.length; i++) {
    sum += arr[i];
}</div>
            <p>也可以用 <code>for...of</code> 更简洁地遍历：</p>
            <div class="syntax-block">let sum = 0;
for (const num of arr) {
    sum += num;
}</div>
            <p>或者使用 <code>reduce</code> 方法：</p>
            <div class="syntax-block">const sum = arr.reduce((acc, cur) => acc + cur, 0);</div>
        `,
        task: '编写 <code>sum(arr)</code>，返回数组所有元素的总和。空数组返回 0。',
        template: `function sum(arr) {\n    // 遍历数组，计算并返回所有元素的和\n}`,
        hint: '用 for 循环累加每个元素，或使用 reduce。',
        answer: `function sum(arr) {\n    let total = 0;\n    for (const num of arr) {\n        total += num;\n    }\n    return total;\n}`,
        validate(code) {
            return testFunction(code, 'sum', [
                { input: [[1, 2, 3, 4, 5]], expected: 15 },
                { input: [[10, 20, 30]], expected: 60 },
                { input: [[]], expected: 0 },
                { input: [[-1, 1]], expected: 0 }
            ]);
        }
    },
    {
        id: 5,
        title: '数组过滤与映射',
        description: '掌握 filter 和 map 方法',
        tutorial: `
            <p><code>filter</code> 用于筛选满足条件的元素，返回新数组：</p>
            <div class="syntax-block">const evens = [1,2,3,4,5,6].filter(x => x % 2 === 0);
// evens = [2, 4, 6]</div>
            <p><code>map</code> 用于对每个元素做变换，返回新数组：</p>
            <div class="syntax-block">const doubled = [1,2,3].map(x => x * 2);
// doubled = [2, 4, 6]</div>
            <p>两者可以链式调用：</p>
            <div class="syntax-block">const result = arr.filter(条件).map(变换);</div>
        `,
        task: '编写 <code>evenDoubled(arr)</code>：筛选出偶数，再将每个偶数乘以 2，返回结果数组。',
        template: `function evenDoubled(arr) {\n    // 1. 筛选出偶数\n    // 2. 每个偶数乘以 2\n    // 3. 返回结果数组\n}`,
        hint: '使用 arr.filter(x => x % 2 === 0).map(x => x * 2)。',
        answer: `function evenDoubled(arr) {\n    return arr.filter(x => x % 2 === 0).map(x => x * 2);\n}`,
        validate(code) {
            return testFunction(code, 'evenDoubled', [
                { input: [[1, 2, 3, 4, 5, 6]], expected: [4, 8, 12] },
                { input: [[1, 3, 5]], expected: [] },
                { input: [[2, 4]], expected: [4, 8] },
                { input: [[]], expected: [] }
            ]);
        }
    },
    // ===== 第二阶段：栈 =====
    {
        id: 6,
        title: '实现栈',
        description: '用数组实现栈的基本操作',
        tutorial: `
            <p><code>栈（Stack）</code>是一种后进先出（LIFO）的数据结构，就像一叠盘子——最后放上去的最先被拿走。</p>
            <div class="visual-box">    push ↓   ↑ pop
    ┌──────────┐
    │    3     │ ← 栈顶 (top)
    ├──────────┤
    │    2     │
    ├──────────┤
    │    1     │ ← 栈底 (bottom)
    └──────────┘</div>
            <p>栈的核心操作：</p>
            <ul style="margin:8px 0 8px 20px;line-height:2;">
                <li><code>push(el)</code> — 入栈，在栈顶添加元素</li>
                <li><code>pop()</code> — 出栈，移除并返回栈顶元素</li>
                <li><code>peek()</code> — 查看栈顶元素（不移除）</li>
                <li><code>isEmpty()</code> — 判断栈是否为空</li>
                <li><code>size()</code> — 返回栈中元素个数</li>
            </ul>
        `,
        task: '完成 <code>Stack</code> 类的所有方法，使用数组作为内部存储。',
        template: `class Stack {\n    constructor() {\n        // 初始化存储结构\n    }\n\n    push(element) {\n        // 入栈\n    }\n\n    pop() {\n        // 出栈：移除并返回栈顶元素\n    }\n\n    peek() {\n        // 返回栈顶元素（不移除）\n    }\n\n    isEmpty() {\n        // 返回栈是否为空\n    }\n\n    size() {\n        // 返回元素个数\n    }\n}`,
        hint: '用 this.items = [] 存储，push 用数组的 push，pop 用数组的 pop，peek 返回 items[items.length-1]。',
        answer: `class Stack {\n    constructor() {\n        this.items = [];\n    }\n    push(element) {\n        this.items.push(element);\n    }\n    pop() {\n        return this.items.pop();\n    }\n    peek() {\n        return this.items[this.items.length - 1];\n    }\n    isEmpty() {\n        return this.items.length === 0;\n    }\n    size() {\n        return this.items.length;\n    }\n}`,
        validate(code) {
            const checks = [];
            try {
                const Stack = new Function(code + '\nreturn Stack;')();
                const s = new Stack();
                checks.push({ pass: s.isEmpty() === true, msg: s.isEmpty() === true ? '新栈 isEmpty() = true ✓' : 'isEmpty() 应为 true' });
                s.push(1); s.push(2); s.push(3);
                checks.push({ pass: s.size() === 3, msg: s.size() === 3 ? 'push 3个元素后 size() = 3 ✓' : 'size() 期望 3，得到 ' + s.size() });
                checks.push({ pass: s.peek() === 3, msg: s.peek() === 3 ? 'peek() = 3 ✓' : 'peek() 期望 3，得到 ' + s.peek() });
                const popped = s.pop();
                checks.push({ pass: popped === 3, msg: popped === 3 ? 'pop() = 3 ✓' : 'pop() 期望 3，得到 ' + popped });
                checks.push({ pass: s.size() === 2, msg: s.size() === 2 ? 'pop后 size() = 2 ✓' : 'pop后 size() 期望 2，得到 ' + s.size() });
                checks.push({ pass: s.isEmpty() === false, msg: s.isEmpty() === false ? 'isEmpty() = false ✓' : 'isEmpty() 应为 false' });
            } catch (e) {
                checks.push({ pass: false, msg: '代码执行出错: ' + e.message });
            }
            return checks;
        }
    },
    {
        id: 7,
        title: '括号匹配',
        description: '经典栈应用——判断括号是否有效',
        tutorial: `
            <p>括号匹配是栈最经典的应用。遇到左括号入栈，遇到右括号时检查栈顶是否匹配。</p>
            <p>算法思路：</p>
            <div class="syntax-block">1. 遍历字符串的每个字符
2. 如果是左括号 ( [ {，入栈
3. 如果是右括号 ) ] }：
   - 栈为空 → 无效
   - 栈顶不匹配 → 无效
   - 匹配 → 出栈
4. 遍历结束，栈为空则有效</div>
            <div class="visual-box">输入: "{[()]}"
步骤: { → [{ → [{( → [{ → [ → 空 → 有效 ✓

输入: "{[}]"
步骤: { → [{ → 遇到}，栈顶是[ → 不匹配 ✗</div>
        `,
        task: '编写 <code>isValid(s)</code>，判断由 <code>()[]{}</code> 组成的字符串中括号是否有效匹配，返回布尔值。',
        template: `function isValid(s) {\n    // 使用栈判断括号是否有效匹配\n    // 支持三种括号：() [] {}\n}`,
        hint: '用数组当栈，建立右括号到左括号的映射 {")"："(",...}，遍历时左括号入栈，右括号检查栈顶。',
        answer: `function isValid(s) {\n    const stack = [];\n    const map = { ')': '(', ']': '[', '}': '{' };\n    for (const ch of s) {\n        if (ch === '(' || ch === '[' || ch === '{') {\n            stack.push(ch);\n        } else {\n            if (stack.length === 0 || stack.pop() !== map[ch]) return false;\n        }\n    }\n    return stack.length === 0;\n}`,
        validate(code) {
            return testFunction(code, 'isValid', [
                { input: ['()'], expected: true },
                { input: ['()[]{}'], expected: true },
                { input: ['{[]}'], expected: true },
                { input: ['(]'], expected: false },
                { input: ['([)]'], expected: false },
                { input: [''], expected: true },
                { input: ['{'], expected: false }
            ]);
        }
    },
    {
        id: 8,
        title: '进制转换',
        description: '使用栈实现十进制转二进制',
        tutorial: `
            <p>将十进制转二进制的方法是反复除以 2，取余数，余数的<strong>逆序</strong>就是二进制结果。栈的后进先出特性正好实现逆序。</p>
            <div class="syntax-block">算法：
1. 将数字反复除以 2
2. 每次将余数（0或1）入栈
3. 将数字更新为商（向下取整）
4. 重复直到数字为 0
5. 依次出栈，拼接成字符串</div>
            <div class="visual-box">10 ÷ 2 = 5 余 0  →  栈: [0]
 5 ÷ 2 = 2 余 1  →  栈: [0,1]
 2 ÷ 2 = 1 余 0  →  栈: [0,1,0]
 1 ÷ 2 = 0 余 1  →  栈: [0,1,0,1]
出栈拼接: "1010"</div>
        `,
        task: '编写 <code>decToBin(num)</code>，使用栈将十进制正整数转换为二进制字符串。<code>num=0</code> 时返回 <code>"0"</code>。',
        template: `function decToBin(num) {\n    // 使用栈将十进制转为二进制字符串\n    // num 为非负整数\n}`,
        hint: '特殊处理 num===0 返回 "0"，然后循环 num>0 时 push(num%2)，num=Math.floor(num/2)，最后反向拼接。',
        answer: `function decToBin(num) {\n    if (num === 0) return "0";\n    const stack = [];\n    while (num > 0) {\n        stack.push(num % 2);\n        num = Math.floor(num / 2);\n    }\n    let result = '';\n    while (stack.length > 0) {\n        result += stack.pop();\n    }\n    return result;\n}`,
        validate(code) {
            return testFunction(code, 'decToBin', [
                { input: [10], expected: '1010' },
                { input: [0], expected: '0' },
                { input: [1], expected: '1' },
                { input: [233], expected: '11101001' },
                { input: [255], expected: '11111111' }
            ]);
        }
    },
    // ===== 第三阶段：队列 =====
    {
        id: 9,
        title: '实现队列',
        description: '用数组实现先进先出队列',
        tutorial: `
            <p><code>队列（Queue）</code>是一种先进先出（FIFO）的数据结构，就像排队——先来的先服务。</p>
            <div class="visual-box">enqueue →  ┌───┬───┬───┬───┐  → dequeue
           │ 4 │ 3 │ 2 │ 1 │
           └───┴───┴───┴───┘
           队尾              队首</div>
            <p>核心操作：</p>
            <ul style="margin:8px 0 8px 20px;line-height:2;">
                <li><code>enqueue(el)</code> — 入队，在队尾添加</li>
                <li><code>dequeue()</code> — 出队，移除并返回队首</li>
                <li><code>front()</code> — 查看队首元素</li>
                <li><code>isEmpty()</code> — 判断是否为空</li>
                <li><code>size()</code> — 返回长度</li>
            </ul>
        `,
        task: '完成 <code>Queue</code> 类的所有方法。',
        template: `class Queue {\n    constructor() {\n        // 初始化存储结构\n    }\n\n    enqueue(element) {\n        // 入队：在队尾添加元素\n    }\n\n    dequeue() {\n        // 出队：移除并返回队首元素\n    }\n\n    front() {\n        // 返回队首元素（不移除）\n    }\n\n    isEmpty() {\n        // 返回队列是否为空\n    }\n\n    size() {\n        // 返回元素个数\n    }\n}`,
        hint: '用 this.items = [] 存储，enqueue 用 push，dequeue 用 shift，front 返回 items[0]。',
        answer: `class Queue {\n    constructor() {\n        this.items = [];\n    }\n    enqueue(element) {\n        this.items.push(element);\n    }\n    dequeue() {\n        return this.items.shift();\n    }\n    front() {\n        return this.items[0];\n    }\n    isEmpty() {\n        return this.items.length === 0;\n    }\n    size() {\n        return this.items.length;\n    }\n}`,
        validate(code) {
            const checks = [];
            try {
                const Queue = new Function(code + '\nreturn Queue;')();
                const q = new Queue();
                checks.push({ pass: q.isEmpty() === true, msg: q.isEmpty() === true ? '新队列 isEmpty() = true ✓' : 'isEmpty() 应为 true' });
                q.enqueue('A'); q.enqueue('B'); q.enqueue('C');
                checks.push({ pass: q.size() === 3, msg: q.size() === 3 ? 'enqueue 3个元素后 size() = 3 ✓' : 'size() 期望 3，得到 ' + q.size() });
                checks.push({ pass: q.front() === 'A', msg: q.front() === 'A' ? 'front() = "A" ✓' : 'front() 期望 "A"，得到 ' + JSON.stringify(q.front()) });
                const d = q.dequeue();
                checks.push({ pass: d === 'A', msg: d === 'A' ? 'dequeue() = "A"（先进先出）✓' : 'dequeue() 期望 "A"，得到 ' + JSON.stringify(d) });
                checks.push({ pass: q.front() === 'B', msg: q.front() === 'B' ? 'dequeue后 front() = "B" ✓' : 'front() 期望 "B"，得到 ' + JSON.stringify(q.front()) });
                checks.push({ pass: q.size() === 2, msg: q.size() === 2 ? 'dequeue后 size() = 2 ✓' : 'size() 期望 2，得到 ' + q.size() });
            } catch (e) {
                checks.push({ pass: false, msg: '代码执行出错: ' + e.message });
            }
            return checks;
        }
    },
    {
        id: 10,
        title: '双端队列',
        description: '实现两端都能操作的队列',
        tutorial: `
            <p><code>双端队列（Deque）</code>允许在两端添加和删除元素，是栈和队列的结合体。</p>
            <div class="visual-box">addFront →  ┌───┬───┬───┬───┐  ← addBack
removeFront ← │ 1 │ 2 │ 3 │ 4 │ → removeBack
              └───┴───┴───┴───┘</div>
            <p>核心操作：</p>
            <ul style="margin:8px 0 8px 20px;line-height:2;">
                <li><code>addFront(el)</code> / <code>addBack(el)</code> — 两端添加</li>
                <li><code>removeFront()</code> / <code>removeBack()</code> — 两端删除</li>
                <li><code>peekFront()</code> / <code>peekBack()</code> — 两端查看</li>
            </ul>
        `,
        task: '完成 <code>Deque</code> 类的所有方法。',
        template: `class Deque {\n    constructor() {\n        // 初始化\n    }\n\n    addFront(element) {\n        // 在队首添加\n    }\n\n    addBack(element) {\n        // 在队尾添加\n    }\n\n    removeFront() {\n        // 移除并返回队首元素\n    }\n\n    removeBack() {\n        // 移除并返回队尾元素\n    }\n\n    peekFront() {\n        // 查看队首\n    }\n\n    peekBack() {\n        // 查看队尾\n    }\n\n    isEmpty() {\n        // 是否为空\n    }\n\n    size() {\n        // 元素个数\n    }\n}`,
        hint: 'addFront 用 unshift，addBack 用 push，removeFront 用 shift，removeBack 用 pop。',
        answer: `class Deque {\n    constructor() {\n        this.items = [];\n    }\n    addFront(element) {\n        this.items.unshift(element);\n    }\n    addBack(element) {\n        this.items.push(element);\n    }\n    removeFront() {\n        return this.items.shift();\n    }\n    removeBack() {\n        return this.items.pop();\n    }\n    peekFront() {\n        return this.items[0];\n    }\n    peekBack() {\n        return this.items[this.items.length - 1];\n    }\n    isEmpty() {\n        return this.items.length === 0;\n    }\n    size() {\n        return this.items.length;\n    }\n}`,
        validate(code) {
            const checks = [];
            try {
                const Deque = new Function(code + '\nreturn Deque;')();
                const d = new Deque();
                d.addBack(1); d.addBack(2); d.addFront(0);
                checks.push({ pass: d.size() === 3, msg: d.size() === 3 ? 'addBack(1), addBack(2), addFront(0) 后 size() = 3 ✓' : 'size() 期望 3' });
                checks.push({ pass: d.peekFront() === 0, msg: d.peekFront() === 0 ? 'peekFront() = 0 ✓' : 'peekFront() 期望 0' });
                checks.push({ pass: d.peekBack() === 2, msg: d.peekBack() === 2 ? 'peekBack() = 2 ✓' : 'peekBack() 期望 2' });
                const rf = d.removeFront();
                checks.push({ pass: rf === 0, msg: rf === 0 ? 'removeFront() = 0 ✓' : 'removeFront() 期望 0' });
                const rb = d.removeBack();
                checks.push({ pass: rb === 2, msg: rb === 2 ? 'removeBack() = 2 ✓' : 'removeBack() 期望 2' });
                checks.push({ pass: d.size() === 1 && d.peekFront() === 1, msg: d.size() === 1 ? '剩余 size() = 1, peekFront() = 1 ✓' : '剩余状态不正确' });
            } catch (e) {
                checks.push({ pass: false, msg: '代码执行出错: ' + e.message });
            }
            return checks;
        }
    },
    {
        id: 11,
        title: '回文检测',
        description: '利用双端队列思想检测回文',
        tutorial: `
            <p><code>回文</code>是正读和反读都一样的字符串，如 <code>"racecar"</code>、<code>"abcba"</code>。</p>
            <p>使用双端队列思想：将字符串放入双端队列，同时从两端取字符比较。</p>
            <div class="syntax-block">算法：
1. 将字符串每个字符放入双端队列
2. 当队列长度 > 1 时：
   - 取出队首和队尾
   - 如果不相等，不是回文
3. 遍历完毕仍然匹配，是回文</div>
            <div class="visual-box">"racecar"
比较: r == r ✓ → a == a ✓ → c == c ✓ → 剩 e → 回文 ✓</div>
        `,
        task: '编写 <code>isPalindrome(str)</code>，判断字符串是否为回文，返回布尔值。只考虑小写字母，不需要处理空格和大小写。',
        template: `function isPalindrome(str) {\n    // 判断字符串是否为回文\n}`,
        hint: '可以用双指针法：头尾向中间靠拢比较，也可以用 str === str.split("").reverse().join("")。',
        answer: `function isPalindrome(str) {\n    let left = 0, right = str.length - 1;\n    while (left < right) {\n        if (str[left] !== str[right]) return false;\n        left++;\n        right--;\n    }\n    return true;\n}`,
        validate(code) {
            return testFunction(code, 'isPalindrome', [
                { input: ['racecar'], expected: true },
                { input: ['hello'], expected: false },
                { input: ['abcba'], expected: true },
                { input: ['ab'], expected: false },
                { input: ['a'], expected: true },
                { input: [''], expected: true }
            ]);
        }
    },
    // ===== 第四阶段：链表 =====
    {
        id: 12,
        title: '链表基础',
        description: '创建节点和链表结构',
        tutorial: `
            <p><code>链表（Linked List）</code>是一种链式存储的数据结构，每个节点包含数据和指向下一个节点的指针。</p>
            <div class="visual-box">head
 ↓
[1|→] → [2|→] → [3|→] → null</div>
            <p>与数组不同，链表的元素在内存中不必连续，插入删除效率高（O(1)），但访问需要遍历（O(n)）。</p>
            <div class="syntax-block">class Node {
    constructor(data) {
        this.data = data;  // 节点数据
        this.next = null;  // 指向下一个节点
    }
}</div>
        `,
        task: '实现 <code>Node</code> 类和 <code>LinkedList</code> 类。LinkedList 需要 <code>append(data)</code> 在末尾添加节点，<code>toArray()</code> 将链表转为数组。',
        template: `class Node {\n    constructor(data) {\n        // 初始化节点\n    }\n}\n\nclass LinkedList {\n    constructor() {\n        // 初始化链表\n    }\n\n    append(data) {\n        // 在末尾添加新节点\n    }\n\n    toArray() {\n        // 将链表转为数组返回\n    }\n}`,
        hint: 'Node 有 data 和 next。LinkedList 有 head。append 时如果 head 为空则直接设置，否则遍历到末尾再添加。toArray 从 head 遍历收集数据。',
        answer: `class Node {\n    constructor(data) {\n        this.data = data;\n        this.next = null;\n    }\n}\n\nclass LinkedList {\n    constructor() {\n        this.head = null;\n    }\n\n    append(data) {\n        const node = new Node(data);\n        if (!this.head) {\n            this.head = node;\n        } else {\n            let current = this.head;\n            while (current.next) current = current.next;\n            current.next = node;\n        }\n    }\n\n    toArray() {\n        const result = [];\n        let current = this.head;\n        while (current) {\n            result.push(current.data);\n            current = current.next;\n        }\n        return result;\n    }\n}`,
        validate(code) {
            const checks = [];
            try {
                const exports = new Function(code + '\nreturn { Node, LinkedList };')();
                const list = new exports.LinkedList();
                checks.push({ pass: deepEqual(list.toArray(), []), msg: deepEqual(list.toArray(), []) ? '空链表 toArray() = [] ✓' : 'toArray() 期望 []' });
                list.append(1); list.append(2); list.append(3);
                checks.push({ pass: deepEqual(list.toArray(), [1, 2, 3]), msg: deepEqual(list.toArray(), [1, 2, 3]) ? 'append(1,2,3) 后 toArray() = [1,2,3] ✓' : 'toArray() 期望 [1,2,3]，得到 ' + JSON.stringify(list.toArray()) });
                checks.push({ pass: list.head && list.head.data === 1, msg: list.head && list.head.data === 1 ? 'head.data = 1 ✓' : 'head.data 期望 1' });
                checks.push({ pass: list.head && list.head.next && list.head.next.data === 2, msg: list.head && list.head.next && list.head.next.data === 2 ? 'head.next.data = 2 ✓' : 'head.next.data 期望 2' });
            } catch (e) {
                checks.push({ pass: false, msg: '代码执行出错: ' + e.message });
            }
            return checks;
        }
    },
    {
        id: 13,
        title: '链表插入与查询',
        description: '实现头部插入、获取长度和按索引访问',
        tutorial: `
            <p>链表的更多操作：</p>
            <div class="syntax-block">prepend(data) — 在头部插入节点
  新节点.next = head
  head = 新节点

getSize() — 遍历计数
get(index) — 遍历到第 index 个节点</div>
            <div class="visual-box">prepend(0):
  Before: [1|→] → [2|→] → null
  After:  [0|→] → [1|→] → [2|→] → null
          ↑ 新head</div>
        `,
        task: '基于给定的基础代码，实现 <code>prepend(data)</code>、<code>getSize()</code>、<code>get(index)</code>（返回该索引处数据，无效索引返回 -1）。',
        template: `class Node {\n    constructor(data) {\n        this.data = data;\n        this.next = null;\n    }\n}\n\nclass LinkedList {\n    constructor() {\n        this.head = null;\n    }\n\n    append(data) {\n        const node = new Node(data);\n        if (!this.head) { this.head = node; }\n        else {\n            let cur = this.head;\n            while (cur.next) cur = cur.next;\n            cur.next = node;\n        }\n    }\n\n    prepend(data) {\n        // 在头部插入新节点\n    }\n\n    getSize() {\n        // 返回链表长度\n    }\n\n    get(index) {\n        // 返回第 index 个节点的数据，索引无效返回 -1\n    }\n\n    toArray() {\n        const r = []; let c = this.head;\n        while (c) { r.push(c.data); c = c.next; }\n        return r;\n    }\n}`,
        hint: 'prepend: 新节点的 next 指向当前 head，然后更新 head。getSize: 遍历计数。get: 遍历 index 次，注意边界检查。',
        answer: `class Node {\n    constructor(data) {\n        this.data = data;\n        this.next = null;\n    }\n}\n\nclass LinkedList {\n    constructor() {\n        this.head = null;\n    }\n    append(data) {\n        const node = new Node(data);\n        if (!this.head) { this.head = node; }\n        else {\n            let cur = this.head;\n            while (cur.next) cur = cur.next;\n            cur.next = node;\n        }\n    }\n    prepend(data) {\n        const node = new Node(data);\n        node.next = this.head;\n        this.head = node;\n    }\n    getSize() {\n        let count = 0, cur = this.head;\n        while (cur) { count++; cur = cur.next; }\n        return count;\n    }\n    get(index) {\n        if (index < 0) return -1;\n        let cur = this.head, i = 0;\n        while (cur) {\n            if (i === index) return cur.data;\n            cur = cur.next; i++;\n        }\n        return -1;\n    }\n    toArray() {\n        const r = []; let c = this.head;\n        while (c) { r.push(c.data); c = c.next; }\n        return r;\n    }\n}`,
        validate(code) {
            const checks = [];
            try {
                const exports = new Function(code + '\nreturn { LinkedList };')();
                const list = new exports.LinkedList();
                list.append(1); list.append(2); list.append(3);
                list.prepend(0);
                const arr = list.toArray();
                checks.push({ pass: deepEqual(arr, [0, 1, 2, 3]), msg: deepEqual(arr, [0, 1, 2, 3]) ? 'prepend(0) 后链表为 [0,1,2,3] ✓' : 'prepend 后期望 [0,1,2,3]，得到 ' + JSON.stringify(arr) });
                checks.push({ pass: list.getSize() === 4, msg: list.getSize() === 4 ? 'getSize() = 4 ✓' : 'getSize() 期望 4，得到 ' + list.getSize() });
                checks.push({ pass: list.get(0) === 0, msg: list.get(0) === 0 ? 'get(0) = 0 ✓' : 'get(0) 期望 0' });
                checks.push({ pass: list.get(2) === 2, msg: list.get(2) === 2 ? 'get(2) = 2 ✓' : 'get(2) 期望 2' });
                checks.push({ pass: list.get(10) === -1, msg: list.get(10) === -1 ? 'get(10) = -1（越界）✓' : 'get(10) 越界应返回 -1' });
                checks.push({ pass: list.get(-1) === -1, msg: list.get(-1) === -1 ? 'get(-1) = -1（无效索引）✓' : 'get(-1) 应返回 -1' });
            } catch (e) {
                checks.push({ pass: false, msg: '代码执行出错: ' + e.message });
            }
            return checks;
        }
    },
    {
        id: 14,
        title: '链表删除',
        description: '实现按索引删除节点',
        tutorial: `
            <p>删除链表中的节点需要找到目标节点的<strong>前一个节点</strong>，修改其 next 指针跳过目标节点。</p>
            <div class="syntax-block">removeAt(index):
1. 如果 index = 0，直接 head = head.next
2. 否则遍历到第 index-1 个节点(prev)
3. prev.next = prev.next.next</div>
            <div class="visual-box">删除 index=1:
Before: [A|→] → [B|→] → [C|→] → null
         prev     目标

After:  [A|→] ————————→ [C|→] → null
               跳过B</div>
        `,
        task: '基于给定代码，实现 <code>removeAt(index)</code> 方法，删除指定索引的节点并返回被删除的数据，索引无效返回 <code>-1</code>。',
        template: `class Node {\n    constructor(data) {\n        this.data = data;\n        this.next = null;\n    }\n}\n\nclass LinkedList {\n    constructor() {\n        this.head = null;\n    }\n    append(data) {\n        const node = new Node(data);\n        if (!this.head) { this.head = node; }\n        else {\n            let cur = this.head;\n            while (cur.next) cur = cur.next;\n            cur.next = node;\n        }\n    }\n\n    removeAt(index) {\n        // 删除第 index 个节点，返回被删除的数据\n        // 索引无效返回 -1\n    }\n\n    toArray() {\n        const r = []; let c = this.head;\n        while (c) { r.push(c.data); c = c.next; }\n        return r;\n    }\n}`,
        hint: 'index=0 时特殊处理 head。否则遍历到 index-1 位置（prev），保存 prev.next 的数据，然后 prev.next = prev.next.next。',
        answer: `class Node {\n    constructor(data) {\n        this.data = data;\n        this.next = null;\n    }\n}\n\nclass LinkedList {\n    constructor() {\n        this.head = null;\n    }\n    append(data) {\n        const node = new Node(data);\n        if (!this.head) { this.head = node; }\n        else {\n            let cur = this.head;\n            while (cur.next) cur = cur.next;\n            cur.next = node;\n        }\n    }\n    removeAt(index) {\n        if (index < 0 || !this.head) return -1;\n        if (index === 0) {\n            const data = this.head.data;\n            this.head = this.head.next;\n            return data;\n        }\n        let prev = this.head, i = 0;\n        while (prev.next && i < index - 1) {\n            prev = prev.next; i++;\n        }\n        if (!prev.next) return -1;\n        const data = prev.next.data;\n        prev.next = prev.next.next;\n        return data;\n    }\n    toArray() {\n        const r = []; let c = this.head;\n        while (c) { r.push(c.data); c = c.next; }\n        return r;\n    }\n}`,
        validate(code) {
            const checks = [];
            try {
                const exports = new Function(code + '\nreturn { LinkedList };')();
                const list = new exports.LinkedList();
                list.append('A'); list.append('B'); list.append('C'); list.append('D');
                const r1 = list.removeAt(0);
                checks.push({ pass: r1 === 'A', msg: r1 === 'A' ? 'removeAt(0) 返回 "A" ✓' : 'removeAt(0) 期望 "A"，得到 ' + JSON.stringify(r1) });
                checks.push({ pass: deepEqual(list.toArray(), ['B', 'C', 'D']), msg: deepEqual(list.toArray(), ['B', 'C', 'D']) ? '删除后链表 [B,C,D] ✓' : '期望 [B,C,D]，得到 ' + JSON.stringify(list.toArray()) });
                const r2 = list.removeAt(1);
                checks.push({ pass: r2 === 'C', msg: r2 === 'C' ? 'removeAt(1) 返回 "C" ✓' : 'removeAt(1) 期望 "C"' });
                checks.push({ pass: deepEqual(list.toArray(), ['B', 'D']), msg: deepEqual(list.toArray(), ['B', 'D']) ? '删除后链表 [B,D] ✓' : '期望 [B,D]' });
                const r3 = list.removeAt(10);
                checks.push({ pass: r3 === -1, msg: r3 === -1 ? 'removeAt(10) 越界返回 -1 ✓' : '越界应返回 -1' });
            } catch (e) {
                checks.push({ pass: false, msg: '代码执行出错: ' + e.message });
            }
            return checks;
        }
    },
    {
        id: 15,
        title: '链表反转',
        description: '经典算法——反转单链表',
        tutorial: `
            <p>反转链表是最经典的链表算法题之一。核心思想是逐个翻转指针方向。</p>
            <div class="syntax-block">算法（迭代法）：
1. 用三个指针：prev=null, current=head, next
2. 循环：
   next = current.next    // 保存下一个
   current.next = prev    // 反转指向
   prev = current         // prev 前进
   current = next         // current 前进
3. 返回 prev（新的头节点）</div>
            <div class="visual-box">原始: 1 → 2 → 3 → null

步骤1: null ← 1   2 → 3 → null
步骤2: null ← 1 ← 2   3 → null
步骤3: null ← 1 ← 2 ← 3

结果: 3 → 2 → 1 → null</div>
        `,
        task: '编写 <code>reverseList(head)</code>，接收链表头节点，返回反转后的新头节点。节点有 <code>data</code> 和 <code>next</code> 属性。',
        template: `function reverseList(head) {\n    // 反转链表，返回新的头节点\n    // 节点结构：{ data: 值, next: 下一个节点或null }\n}`,
        hint: '用 prev=null, current=head 两个指针，循环中先保存 next=current.next，再 current.next=prev，然后移动 prev 和 current。',
        answer: `function reverseList(head) {\n    let prev = null, current = head;\n    while (current) {\n        const next = current.next;\n        current.next = prev;\n        prev = current;\n        current = next;\n    }\n    return prev;\n}`,
        validate(code) {
            const checks = [];
            try {
                const reverseList = new Function(code + '\nreturn reverseList;')();
                function makeList(arr) {
                    let head = null;
                    for (let i = arr.length - 1; i >= 0; i--) {
                        head = { data: arr[i], next: head };
                    }
                    return head;
                }
                function listToArr(head) {
                    const r = []; let c = head;
                    while (c) { r.push(c.data); c = c.next; }
                    return r;
                }
                let r = listToArr(reverseList(makeList([1, 2, 3, 4, 5])));
                checks.push({ pass: deepEqual(r, [5, 4, 3, 2, 1]), msg: deepEqual(r, [5, 4, 3, 2, 1]) ? '反转 [1,2,3,4,5] → [5,4,3,2,1] ✓' : '期望 [5,4,3,2,1]，得到 ' + JSON.stringify(r) });
                r = listToArr(reverseList(makeList([1])));
                checks.push({ pass: deepEqual(r, [1]), msg: deepEqual(r, [1]) ? '反转 [1] → [1] ✓' : '期望 [1]' });
                r = reverseList(null);
                checks.push({ pass: r === null, msg: r === null ? '反转 null → null ✓' : '期望 null' });
                r = listToArr(reverseList(makeList([1, 2])));
                checks.push({ pass: deepEqual(r, [2, 1]), msg: deepEqual(r, [2, 1]) ? '反转 [1,2] → [2,1] ✓' : '期望 [2,1]' });
            } catch (e) {
                checks.push({ pass: false, msg: '代码执行出错: ' + e.message });
            }
            return checks;
        }
    },
    // ===== 第五阶段：递归 =====
    {
        id: 16,
        title: '递归基础',
        description: '理解递归——函数调用自身',
        tutorial: `
            <p><code>递归</code>是函数调用自身来解决问题的编程技巧。每个递归都需要：</p>
            <ul style="margin:8px 0 8px 20px;line-height:2;">
                <li><strong>基准条件</strong>（Base Case）— 停止递归的条件</li>
                <li><strong>递归条件</strong>（Recursive Case）— 缩小问题规模并调用自身</li>
            </ul>
            <div class="syntax-block">// 阶乘：n! = n × (n-1)!，0! = 1
function factorial(n) {
    if (n === 0) return 1;       // 基准条件
    return n * factorial(n - 1); // 递归条件
}</div>
            <div class="visual-box">factorial(4)
= 4 * factorial(3)
= 4 * 3 * factorial(2)
= 4 * 3 * 2 * factorial(1)
= 4 * 3 * 2 * 1 * factorial(0)
= 4 * 3 * 2 * 1 * 1
= 24</div>
        `,
        task: '编写 <code>factorial(n)</code> 用递归计算阶乘，<code>sumTo(n)</code> 用递归计算 1+2+...+n。',
        template: `function factorial(n) {\n    // 递归计算 n!（n的阶乘）\n    // 0! = 1\n}\n\nfunction sumTo(n) {\n    // 递归计算 1 + 2 + ... + n\n    // sumTo(0) = 0\n}`,
        hint: 'factorial: 基准 n===0 返回 1，递归 n*factorial(n-1)。sumTo: 基准 n===0 返回 0，递归 n+sumTo(n-1)。',
        answer: `function factorial(n) {\n    if (n === 0) return 1;\n    return n * factorial(n - 1);\n}\n\nfunction sumTo(n) {\n    if (n === 0) return 0;\n    return n + sumTo(n - 1);\n}`,
        validate(code) {
            const checks = [];
            try {
                const fns = new Function(code + '\nreturn { factorial, sumTo };')();
                let r;
                r = fns.factorial(5);
                checks.push({ pass: r === 120, msg: r === 120 ? 'factorial(5) = 120 ✓' : 'factorial(5) 期望 120，得到 ' + r });
                r = fns.factorial(0);
                checks.push({ pass: r === 1, msg: r === 1 ? 'factorial(0) = 1 ✓' : 'factorial(0) 期望 1，得到 ' + r });
                r = fns.factorial(1);
                checks.push({ pass: r === 1, msg: r === 1 ? 'factorial(1) = 1 ✓' : 'factorial(1) 期望 1，得到 ' + r });
                r = fns.sumTo(10);
                checks.push({ pass: r === 55, msg: r === 55 ? 'sumTo(10) = 55 ✓' : 'sumTo(10) 期望 55，得到 ' + r });
                r = fns.sumTo(0);
                checks.push({ pass: r === 0, msg: r === 0 ? 'sumTo(0) = 0 ✓' : 'sumTo(0) 期望 0，得到 ' + r });
                r = fns.sumTo(100);
                checks.push({ pass: r === 5050, msg: r === 5050 ? 'sumTo(100) = 5050 ✓' : 'sumTo(100) 期望 5050，得到 ' + r });
            } catch (e) {
                checks.push({ pass: false, msg: '代码执行出错: ' + e.message });
            }
            return checks;
        }
    },
    {
        id: 17,
        title: '斐波那契数列',
        description: '递归优化——记忆化搜索',
        tutorial: `
            <p><code>斐波那契数列</code>：0, 1, 1, 2, 3, 5, 8, 13, 21, ...每一项是前两项之和。</p>
            <div class="syntax-block">F(0) = 0, F(1) = 1
F(n) = F(n-1) + F(n-2)</div>
            <p>朴素递归会导致大量重复计算，时间复杂度 O(2^n)。使用<code>记忆化</code>可以优化到 O(n)：</p>
            <div class="syntax-block">// 记忆化：用对象/数组缓存已计算结果
const memo = {};
function fib(n) {
    if (n <= 1) return n;
    if (memo[n]) return memo[n];
    memo[n] = fib(n-1) + fib(n-2);
    return memo[n];
}</div>
            <div class="visual-box">朴素递归 fib(5) 计算次数: 15次
记忆化   fib(5) 计算次数: 9次
朴素递归 fib(30) → 几秒钟
记忆化   fib(30) → 瞬间完成</div>
        `,
        task: '编写 <code>fibonacci(n)</code>，返回第 n 个斐波那契数。要求使用记忆化优化，能计算 <code>n=40</code>。',
        template: `function fibonacci(n) {\n    // 返回第 n 个斐波那契数\n    // F(0)=0, F(1)=1, F(n)=F(n-1)+F(n-2)\n    // 请使用记忆化优化\n}`,
        hint: '在函数外定义 memo 对象，或在函数内用闭包。每次递归前检查 memo 是否已有缓存。',
        answer: `function fibonacci(n) {\n    const memo = {};\n    function fib(n) {\n        if (n <= 1) return n;\n        if (memo[n] !== undefined) return memo[n];\n        memo[n] = fib(n - 1) + fib(n - 2);\n        return memo[n];\n    }\n    return fib(n);\n}`,
        validate(code) {
            return testFunction(code, 'fibonacci', [
                { input: [0], expected: 0 },
                { input: [1], expected: 1 },
                { input: [10], expected: 55 },
                { input: [20], expected: 6765 },
                { input: [30], expected: 832040 },
                { input: [40], expected: 102334155 }
            ]);
        }
    },
    // ===== 第六阶段：排序算法 =====
    {
        id: 18,
        title: '冒泡排序',
        description: '最基础的排序算法',
        tutorial: `
            <p><code>冒泡排序</code>反复比较相邻元素，如果顺序错误就交换，像气泡一样将最大值"浮"到末尾。</p>
            <div class="syntax-block">算法：
for i = 0 to n-2:
    for j = 0 to n-2-i:
        如果 arr[j] > arr[j+1]:
            交换 arr[j] 和 arr[j+1]</div>
            <div class="visual-box">初始: [5, 3, 8, 4, 2]

第1轮: 3,5,4,2,[8]  ← 8浮到末尾
第2轮: 3,4,2,[5,8]  ← 5浮到倒数第二
第3轮: 3,2,[4,5,8]
第4轮: [2,3,4,5,8]  ← 完成！</div>
            <p>时间复杂度：O(n²)，空间复杂度：O(1)</p>
        `,
        task: '编写 <code>bubbleSort(arr)</code>，使用冒泡排序将数组升序排列，返回排序后的数组。',
        template: `function bubbleSort(arr) {\n    // 实现冒泡排序（升序）\n    // 返回排序后的数组\n}`,
        hint: '两层循环，外层控制轮数，内层比较相邻元素。交换可用 [arr[j], arr[j+1]] = [arr[j+1], arr[j]]。',
        answer: `function bubbleSort(arr) {\n    const n = arr.length;\n    for (let i = 0; i < n - 1; i++) {\n        for (let j = 0; j < n - 1 - i; j++) {\n            if (arr[j] > arr[j + 1]) {\n                [arr[j], arr[j + 1]] = [arr[j + 1], arr[j]];\n            }\n        }\n    }\n    return arr;\n}`,
        validate(code) {
            return testFunction(code, 'bubbleSort', [
                { input: [[5, 3, 8, 4, 2]], expected: [2, 3, 4, 5, 8] },
                { input: [[1]], expected: [1] },
                { input: [[3, 1]], expected: [1, 3] },
                { input: [[5, 4, 3, 2, 1]], expected: [1, 2, 3, 4, 5] },
                { input: [[1, 2, 3]], expected: [1, 2, 3] }
            ]);
        }
    },
    {
        id: 19,
        title: '选择排序',
        description: '每次选择最小值放到前面',
        tutorial: `
            <p><code>选择排序</code>每次从未排序区域找到最小元素，放到已排序区域的末尾。</p>
            <div class="syntax-block">算法：
for i = 0 to n-2:
    minIdx = i
    for j = i+1 to n-1:
        如果 arr[j] < arr[minIdx]:
            minIdx = j
    交换 arr[i] 和 arr[minIdx]</div>
            <div class="visual-box">初始: [64, 25, 12, 22, 11]

找到最小11: [11, 25, 12, 22, 64]
找到最小12: [11, 12, 25, 22, 64]
找到最小22: [11, 12, 22, 25, 64]
找到最小25: [11, 12, 22, 25, 64] ← 完成</div>
            <p>时间复杂度：O(n²)，空间复杂度：O(1)</p>
        `,
        task: '编写 <code>selectionSort(arr)</code>，使用选择排序将数组升序排列。',
        template: `function selectionSort(arr) {\n    // 实现选择排序（升序）\n    // 返回排序后的数组\n}`,
        hint: '外层循环 i 从 0 开始，内层循环找 i 之后最小值的索引 minIdx，最后交换 arr[i] 和 arr[minIdx]。',
        answer: `function selectionSort(arr) {\n    const n = arr.length;\n    for (let i = 0; i < n - 1; i++) {\n        let minIdx = i;\n        for (let j = i + 1; j < n; j++) {\n            if (arr[j] < arr[minIdx]) minIdx = j;\n        }\n        if (minIdx !== i) {\n            [arr[i], arr[minIdx]] = [arr[minIdx], arr[i]];\n        }\n    }\n    return arr;\n}`,
        validate(code) {
            return testFunction(code, 'selectionSort', [
                { input: [[64, 25, 12, 22, 11]], expected: [11, 12, 22, 25, 64] },
                { input: [[1]], expected: [1] },
                { input: [[5, 3, 8, 4, 2]], expected: [2, 3, 4, 5, 8] },
                { input: [[1, 2, 3]], expected: [1, 2, 3] }
            ]);
        }
    },
    {
        id: 20,
        title: '插入排序',
        description: '像整理扑克牌一样排序',
        tutorial: `
            <p><code>插入排序</code>就像整理扑克牌——从第二张开始，每张牌插入到前面已排好的位置。</p>
            <div class="syntax-block">算法：
for i = 1 to n-1:
    key = arr[i]
    j = i - 1
    while j >= 0 且 arr[j] > key:
        arr[j+1] = arr[j]  // 向右移动
        j--
    arr[j+1] = key  // 插入到正确位置</div>
            <div class="visual-box">初始: [5, 2, 4, 6, 1]

插入2: [2, 5, 4, 6, 1]
插入4: [2, 4, 5, 6, 1]
插入6: [2, 4, 5, 6, 1]（无需移动）
插入1: [1, 2, 4, 5, 6] ← 完成</div>
            <p>时间复杂度：O(n²)，对近乎有序的数组接近 O(n)</p>
        `,
        task: '编写 <code>insertionSort(arr)</code>，使用插入排序将数组升序排列。',
        template: `function insertionSort(arr) {\n    // 实现插入排序（升序）\n    // 返回排序后的数组\n}`,
        hint: '从 i=1 开始，保存 key=arr[i]，内层 while 将比 key 大的元素右移，最后将 key 放到空位。',
        answer: `function insertionSort(arr) {\n    for (let i = 1; i < arr.length; i++) {\n        const key = arr[i];\n        let j = i - 1;\n        while (j >= 0 && arr[j] > key) {\n            arr[j + 1] = arr[j];\n            j--;\n        }\n        arr[j + 1] = key;\n    }\n    return arr;\n}`,
        validate(code) {
            return testFunction(code, 'insertionSort', [
                { input: [[5, 2, 4, 6, 1]], expected: [1, 2, 4, 5, 6] },
                { input: [[1]], expected: [1] },
                { input: [[3, 1, 2]], expected: [1, 2, 3] },
                { input: [[5, 4, 3, 2, 1]], expected: [1, 2, 3, 4, 5] }
            ]);
        }
    },
    {
        id: 21,
        title: '快速排序',
        description: '分治思想的高效排序',
        tutorial: `
            <p><code>快速排序</code>是最常用的排序算法之一，采用分治策略：</p>
            <div class="syntax-block">算法：
1. 选择一个"基准"（pivot），通常选第一个元素
2. 将数组分为两部分：
   - 小于 pivot 的放左边
   - 大于 pivot 的放右边
3. 递归排序左右两部分
4. 合并：左 + [pivot] + 右</div>
            <div class="visual-box">初始: [6, 3, 8, 2, 9, 1]
pivot = 6

左边(小于6): [3, 2, 1]
右边(大于6): [8, 9]

递归排序: [1,2,3] + [6] + [8,9]
结果: [1, 2, 3, 6, 8, 9]</div>
            <p>平均时间复杂度：O(n log n)</p>
        `,
        task: '编写 <code>quickSort(arr)</code>，使用快速排序将数组升序排列，返回新的排序数组。',
        template: `function quickSort(arr) {\n    // 实现快速排序（升序）\n    // 提示：选择第一个元素为 pivot\n    // 分成小于和大于 pivot 的两部分\n    // 递归排序后合并\n}`,
        hint: '基准条件：arr.length <= 1 直接返回。选 pivot=arr[0]，用 filter 分成 left(小于pivot) 和 right(大于等于pivot)，递归后拼接。',
        answer: `function quickSort(arr) {\n    if (arr.length <= 1) return arr;\n    const pivot = arr[0];\n    const left = arr.slice(1).filter(x => x <= pivot);\n    const right = arr.slice(1).filter(x => x > pivot);\n    return [...quickSort(left), pivot, ...quickSort(right)];\n}`,
        validate(code) {
            return testFunction(code, 'quickSort', [
                { input: [[6, 3, 8, 2, 9, 1]], expected: [1, 2, 3, 6, 8, 9] },
                { input: [[1]], expected: [1] },
                { input: [[]], expected: [] },
                { input: [[5, 3, 8, 4, 2]], expected: [2, 3, 4, 5, 8] },
                { input: [[3, 3, 1, 1, 2]], expected: [1, 1, 2, 3, 3] }
            ]);
        }
    },
    {
        id: 22,
        title: '归并排序',
        description: '分治合并的稳定排序',
        tutorial: `
            <p><code>归并排序</code>也是分治算法：先分成两半分别排序，再合并两个有序数组。</p>
            <div class="syntax-block">mergeSort(arr):
  if arr.length <= 1: return arr
  mid = arr.length / 2
  left = mergeSort(arr 的前半)
  right = mergeSort(arr 的后半)
  return merge(left, right)

merge(a, b): 合并两个有序数组</div>
            <div class="visual-box">    [38, 27, 43, 3]
       /            \\
  [38, 27]       [43, 3]
   /    \\         /    \\
 [38]  [27]    [43]   [3]
   \\    /         \\    /
  [27, 38]       [3, 43]
       \\            /
    [3, 27, 38, 43]</div>
            <p>时间复杂度：O(n log n)，稳定排序</p>
        `,
        task: '编写 <code>mergeSort(arr)</code>，使用归并排序将数组升序排列。需要一个辅助函数 <code>merge(a, b)</code> 合并两个有序数组。',
        template: `function merge(a, b) {\n    // 合并两个有序数组，返回合并后的有序数组\n}\n\nfunction mergeSort(arr) {\n    // 归并排序：分成两半，递归排序，合并\n}`,
        hint: 'merge: 用两个指针 i,j 分别遍历 a,b，每次取较小的放入结果。mergeSort: 基准是长度<=1，否则从中间切分递归。',
        answer: `function merge(a, b) {\n    const result = [];\n    let i = 0, j = 0;\n    while (i < a.length && j < b.length) {\n        if (a[i] <= b[j]) result.push(a[i++]);\n        else result.push(b[j++]);\n    }\n    return result.concat(a.slice(i)).concat(b.slice(j));\n}\n\nfunction mergeSort(arr) {\n    if (arr.length <= 1) return arr;\n    const mid = Math.floor(arr.length / 2);\n    const left = mergeSort(arr.slice(0, mid));\n    const right = mergeSort(arr.slice(mid));\n    return merge(left, right);\n}`,
        validate(code) {
            return testFunction(code, 'mergeSort', [
                { input: [[38, 27, 43, 3]], expected: [3, 27, 38, 43] },
                { input: [[1]], expected: [1] },
                { input: [[]], expected: [] },
                { input: [[5, 3, 8, 4, 2]], expected: [2, 3, 4, 5, 8] },
                { input: [[3, 1, 3, 1, 2]], expected: [1, 1, 2, 3, 3] }
            ]);
        }
    },
    // ===== 第七阶段：搜索算法 =====
    {
        id: 23,
        title: '线性搜索',
        description: '逐个查找目标元素',
        tutorial: `
            <p><code>线性搜索</code>是最简单的搜索算法——从头到尾逐个比较，找到目标就返回索引。</p>
            <div class="syntax-block">function linearSearch(arr, target) {
    for (let i = 0; i < arr.length; i++) {
        if (arr[i] === target) return i;
    }
    return -1;  // 未找到
}</div>
            <div class="visual-box">在 [4, 2, 7, 1, 9] 中找 7：

[4] → 不是  [2] → 不是  [7] → 找到！索引=2

时间复杂度: O(n)</div>
        `,
        task: '编写 <code>linearSearch(arr, target)</code>，返回目标值在数组中的索引，未找到返回 -1。',
        template: `function linearSearch(arr, target) {\n    // 遍历数组查找 target\n    // 找到返回索引，未找到返回 -1\n}`,
        hint: '用 for 循环遍历数组，if (arr[i] === target) return i，循环结束后 return -1。',
        answer: `function linearSearch(arr, target) {\n    for (let i = 0; i < arr.length; i++) {\n        if (arr[i] === target) return i;\n    }\n    return -1;\n}`,
        validate(code) {
            return testFunction(code, 'linearSearch', [
                { input: [[4, 2, 7, 1, 9], 7], expected: 2 },
                { input: [[4, 2, 7, 1, 9], 5], expected: -1 },
                { input: [[1, 2, 3, 4, 5], 1], expected: 0 },
                { input: [[1, 2, 3, 4, 5], 5], expected: 4 },
                { input: [[], 1], expected: -1 }
            ]);
        }
    },
    {
        id: 24,
        title: '二分搜索',
        description: '在有序数组中高效查找',
        tutorial: `
            <p><code>二分搜索</code>适用于<strong>已排序</strong>的数组，每次将搜索范围缩小一半。</p>
            <div class="syntax-block">算法：
left = 0, right = arr.length - 1
while left <= right:
    mid = Math.floor((left + right) / 2)
    如果 arr[mid] === target → 找到
    如果 arr[mid] < target  → left = mid + 1
    如果 arr[mid] > target  → right = mid - 1
循环结束未找到 → return -1</div>
            <div class="visual-box">在 [1, 3, 5, 7, 9, 11] 中找 7:

left=0 right=5 mid=2 → arr[2]=5 < 7 → left=3
left=3 right=5 mid=4 → arr[4]=9 > 7 → right=3
left=3 right=3 mid=3 → arr[3]=7 = 7 → 找到！

时间复杂度: O(log n)</div>
        `,
        task: '编写 <code>binarySearch(arr, target)</code>，在有序数组中二分查找，返回索引，未找到返回 -1。',
        template: `function binarySearch(arr, target) {\n    // 二分搜索（数组已升序排列）\n    // 找到返回索引，未找到返回 -1\n}`,
        hint: '定义 left=0, right=arr.length-1，循环中计算 mid，比较 arr[mid] 与 target 来缩小范围。',
        answer: `function binarySearch(arr, target) {\n    let left = 0, right = arr.length - 1;\n    while (left <= right) {\n        const mid = Math.floor((left + right) / 2);\n        if (arr[mid] === target) return mid;\n        if (arr[mid] < target) left = mid + 1;\n        else right = mid - 1;\n    }\n    return -1;\n}`,
        validate(code) {
            return testFunction(code, 'binarySearch', [
                { input: [[1, 3, 5, 7, 9, 11], 7], expected: 3 },
                { input: [[1, 3, 5, 7, 9, 11], 1], expected: 0 },
                { input: [[1, 3, 5, 7, 9, 11], 11], expected: 5 },
                { input: [[1, 3, 5, 7, 9, 11], 6], expected: -1 },
                { input: [[2, 4, 6, 8, 10], 10], expected: 4 },
                { input: [[], 1], expected: -1 }
            ]);
        }
    },
    // ===== 第八阶段：哈希表 =====
    {
        id: 25,
        title: '实现哈希表',
        description: '键值对的快速存取',
        tutorial: `
            <p><code>哈希表（Hash Table）</code>通过哈希函数将 key 映射到数组索引，实现 O(1) 的存取。</p>
            <div class="syntax-block">哈希函数示例（djb2）：
function hash(key, size) {
    let h = 5381;
    for (const ch of key) {
        h = (h * 33 + ch.charCodeAt(0)) % size;
    }
    return h;
}</div>
            <div class="visual-box">key "name" → hash → 索引 3
key "age"  → hash → 索引 7

数组:
[0]        [3]           [7]
 null  ...  "name":"Tom"  "age":25</div>
            <p>冲突处理（链地址法）：相同索引处用数组/链表存多个键值对。</p>
        `,
        task: '实现 <code>HashTable</code> 类，支持 <code>set(key, value)</code>、<code>get(key)</code>、<code>has(key)</code>、<code>delete(key)</code>。',
        template: `class HashTable {\n    constructor(size = 37) {\n        this.table = new Array(size);\n        this.size = size;\n    }\n\n    _hash(key) {\n        // 哈希函数：将 key 转换为数组索引\n    }\n\n    set(key, value) {\n        // 设置键值对（相同 key 则更新）\n    }\n\n    get(key) {\n        // 获取 key 对应的值，不存在返回 undefined\n    }\n\n    has(key) {\n        // 判断 key 是否存在\n    }\n\n    delete(key) {\n        // 删除 key，返回是否成功\n    }\n}`,
        hint: '_hash: 遍历 key 的字符累加 charCodeAt 再对 size 取余。set/get/has: 在 table[hash] 位置用数组存 [key, value] 对，遍历查找。',
        answer: `class HashTable {\n    constructor(size = 37) {\n        this.table = new Array(size);\n        this.size = size;\n    }\n    _hash(key) {\n        let h = 5381;\n        for (const ch of String(key)) {\n            h = (h * 33 + ch.charCodeAt(0)) % this.size;\n        }\n        return h;\n    }\n    set(key, value) {\n        const idx = this._hash(key);\n        if (!this.table[idx]) this.table[idx] = [];\n        const bucket = this.table[idx];\n        for (const pair of bucket) {\n            if (pair[0] === key) { pair[1] = value; return; }\n        }\n        bucket.push([key, value]);\n    }\n    get(key) {\n        const idx = this._hash(key);\n        const bucket = this.table[idx];\n        if (!bucket) return undefined;\n        for (const pair of bucket) {\n            if (pair[0] === key) return pair[1];\n        }\n        return undefined;\n    }\n    has(key) {\n        return this.get(key) !== undefined;\n    }\n    delete(key) {\n        const idx = this._hash(key);\n        const bucket = this.table[idx];\n        if (!bucket) return false;\n        for (let i = 0; i < bucket.length; i++) {\n            if (bucket[i][0] === key) { bucket.splice(i, 1); return true; }\n        }\n        return false;\n    }\n}`,
        validate(code) {
            const checks = [];
            try {
                const HashTable = new Function(code + '\nreturn HashTable;')();
                const ht = new HashTable();
                ht.set('name', 'Tom');
                ht.set('age', 25);
                checks.push({ pass: ht.get('name') === 'Tom', msg: ht.get('name') === 'Tom' ? 'set/get("name") = "Tom" ✓' : 'get("name") 期望 "Tom"' });
                checks.push({ pass: ht.get('age') === 25, msg: ht.get('age') === 25 ? 'set/get("age") = 25 ✓' : 'get("age") 期望 25' });
                checks.push({ pass: ht.has('name') === true, msg: ht.has('name') === true ? 'has("name") = true ✓' : 'has("name") 应为 true' });
                checks.push({ pass: ht.get('xxx') === undefined, msg: ht.get('xxx') === undefined ? 'get("xxx") = undefined ✓' : 'get 不存在的key应返回 undefined' });
                ht.set('name', 'Jerry');
                checks.push({ pass: ht.get('name') === 'Jerry', msg: ht.get('name') === 'Jerry' ? '更新 set("name","Jerry"), get = "Jerry" ✓' : '更新后 get 期望 "Jerry"' });
                const del = ht.delete('age');
                checks.push({ pass: del === true && ht.get('age') === undefined, msg: del === true && ht.get('age') === undefined ? 'delete("age") 成功 ✓' : 'delete 后 get 应为 undefined' });
            } catch (e) {
                checks.push({ pass: false, msg: '代码执行出错: ' + e.message });
            }
            return checks;
        }
    },
    {
        id: 26,
        title: '两数之和',
        description: '用哈希表优化经典算法题',
        tutorial: `
            <p><code>两数之和</code>：给定数组和目标值，找出和为目标值的两个数的索引。</p>
            <p>暴力法需要 O(n²)，使用哈希表可以优化到 O(n)：</p>
            <div class="syntax-block">思路：
遍历数组，对于每个数 nums[i]：
  complement = target - nums[i]
  如果 complement 在哈希表中 → 找到答案
  否则将 nums[i] 存入哈希表</div>
            <div class="visual-box">nums = [2, 7, 11, 15], target = 9

i=0: need 9-2=7, map={} → 存入 {2:0}
i=1: need 9-7=2, map={2:0} → 找到！
返回 [0, 1]</div>
        `,
        task: '编写 <code>twoSum(nums, target)</code>，返回和为 target 的两个数的索引数组 <code>[i, j]</code>（i < j）。保证有且仅有一个解。',
        template: `function twoSum(nums, target) {\n    // 使用哈希表（对象或Map）找出和为 target 的两个数的索引\n    // 返回 [index1, index2]\n}`,
        hint: '用一个对象 map 存已遍历的 {值: 索引}，每次检查 target-nums[i] 是否在 map 中。',
        answer: `function twoSum(nums, target) {\n    const map = {};\n    for (let i = 0; i < nums.length; i++) {\n        const complement = target - nums[i];\n        if (map[complement] !== undefined) {\n            return [map[complement], i];\n        }\n        map[nums[i]] = i;\n    }\n    return [];\n}`,
        validate(code) {
            return testFunction(code, 'twoSum', [
                { input: [[2, 7, 11, 15], 9], expected: [0, 1] },
                { input: [[3, 2, 4], 6], expected: [1, 2] },
                { input: [[1, 5, 3, 7], 8], expected: [1, 2] },
                { input: [[1, 2, 3, 4, 5], 9], expected: [3, 4] }
            ]);
        }
    },
    // ===== 第九阶段：树 =====
    {
        id: 27,
        title: '二叉搜索树 — 构建',
        description: '实现BST的节点和插入',
        tutorial: `
            <p><code>二叉搜索树（BST）</code>是一种特殊的二叉树：左子节点 < 父节点 < 右子节点。</p>
            <div class="visual-box">        8
       / \\
      3   10
     / \\    \\
    1   6    14
       / \\   /
      4   7 13</div>
            <p>插入规则：从根开始比较，小的往左，大的往右，直到找到空位置。</p>
            <div class="syntax-block">insert(val):
  if 树空 → 创建根节点
  否则从根开始：
    val < node.val → 去左子树
    val > node.val → 去右子树
    找到空位 → 创建新节点</div>
        `,
        task: '实现 <code>TreeNode</code> 类和 <code>BST</code> 类的 <code>insert(val)</code> 方法。已提供 <code>inorder()</code> 辅助方法用于验证。',
        template: `class TreeNode {\n    constructor(val) {\n        // 初始化：val, left, right\n    }\n}\n\nclass BST {\n    constructor() {\n        this.root = null;\n    }\n\n    insert(val) {\n        // 向BST中插入值\n    }\n\n    // 辅助：中序遍历返回有序数组\n    inorder() {\n        const result = [];\n        function traverse(node) {\n            if (node) {\n                traverse(node.left);\n                result.push(node.val);\n                traverse(node.right);\n            }\n        }\n        traverse(this.root);\n        return result;\n    }\n}`,
        hint: 'TreeNode 有 val, left=null, right=null。insert 用递归或循环：val < 当前节点往左走，val > 往右走，遇到 null 则放置。',
        answer: `class TreeNode {\n    constructor(val) {\n        this.val = val;\n        this.left = null;\n        this.right = null;\n    }\n}\n\nclass BST {\n    constructor() {\n        this.root = null;\n    }\n    insert(val) {\n        const node = new TreeNode(val);\n        if (!this.root) { this.root = node; return; }\n        let current = this.root;\n        while (true) {\n            if (val < current.val) {\n                if (!current.left) { current.left = node; return; }\n                current = current.left;\n            } else {\n                if (!current.right) { current.right = node; return; }\n                current = current.right;\n            }\n        }\n    }\n    inorder() {\n        const result = [];\n        function traverse(node) {\n            if (node) {\n                traverse(node.left);\n                result.push(node.val);\n                traverse(node.right);\n            }\n        }\n        traverse(this.root);\n        return result;\n    }\n}`,
        validate(code) {
            const checks = [];
            try {
                const BST = new Function(code + '\nreturn BST;')();
                const tree = new BST();
                tree.insert(8); tree.insert(3); tree.insert(10); tree.insert(1); tree.insert(6);
                const r1 = tree.inorder();
                checks.push({ pass: deepEqual(r1, [1, 3, 6, 8, 10]), msg: deepEqual(r1, [1, 3, 6, 8, 10]) ? '插入 8,3,10,1,6 后中序遍历 [1,3,6,8,10] ✓' : '中序期望 [1,3,6,8,10]，得到 ' + JSON.stringify(r1) });
                checks.push({ pass: tree.root && tree.root.val === 8, msg: tree.root && tree.root.val === 8 ? 'root.val = 8 ✓' : 'root.val 期望 8' });
                checks.push({ pass: tree.root && tree.root.left && tree.root.left.val === 3, msg: tree.root && tree.root.left && tree.root.left.val === 3 ? 'root.left.val = 3 ✓' : 'root.left.val 期望 3' });
                checks.push({ pass: tree.root && tree.root.right && tree.root.right.val === 10, msg: tree.root && tree.root.right && tree.root.right.val === 10 ? 'root.right.val = 10 ✓' : 'root.right.val 期望 10' });
                tree.insert(14);
                const r2 = tree.inorder();
                checks.push({ pass: deepEqual(r2, [1, 3, 6, 8, 10, 14]), msg: deepEqual(r2, [1, 3, 6, 8, 10, 14]) ? '再插入14后 [1,3,6,8,10,14] ✓' : '期望 [1,3,6,8,10,14]' });
            } catch (e) {
                checks.push({ pass: false, msg: '代码执行出错: ' + e.message });
            }
            return checks;
        }
    },
    {
        id: 28,
        title: '二叉搜索树 — 搜索',
        description: '在BST中高效查找值',
        tutorial: `
            <p>BST的搜索利用其有序性质，每次比较可排除一半节点：</p>
            <div class="syntax-block">search(val):
  从根开始：
    val === node.val → 找到，返回 true
    val < node.val  → 搜索左子树
    val > node.val  → 搜索右子树
    node 为 null    → 未找到，返回 false</div>
            <div class="visual-box">在BST中搜索 6:
        8          8 > 6 → 往左
       / \\
      3   10       3 < 6 → 往右
     / \\
    1   6          6 = 6 → 找到 ✓</div>
            <p>时间复杂度：平均 O(log n)</p>
        `,
        task: '基于给定的BST代码，添加 <code>search(val)</code> 方法，找到返回 <code>true</code>，未找到返回 <code>false</code>。',
        template: `class TreeNode {\n    constructor(val) {\n        this.val = val;\n        this.left = null;\n        this.right = null;\n    }\n}\n\nclass BST {\n    constructor() {\n        this.root = null;\n    }\n    insert(val) {\n        const node = new TreeNode(val);\n        if (!this.root) { this.root = node; return; }\n        let cur = this.root;\n        while (true) {\n            if (val < cur.val) {\n                if (!cur.left) { cur.left = node; return; }\n                cur = cur.left;\n            } else {\n                if (!cur.right) { cur.right = node; return; }\n                cur = cur.right;\n            }\n        }\n    }\n\n    search(val) {\n        // 在BST中搜索值，找到返回 true，否则 false\n    }\n}`,
        hint: '从 this.root 开始循环，val < node.val 往左，val > node.val 往右，val === node.val 返回 true，node 为 null 返回 false。',
        answer: `class TreeNode {\n    constructor(val) {\n        this.val = val;\n        this.left = null;\n        this.right = null;\n    }\n}\n\nclass BST {\n    constructor() {\n        this.root = null;\n    }\n    insert(val) {\n        const node = new TreeNode(val);\n        if (!this.root) { this.root = node; return; }\n        let cur = this.root;\n        while (true) {\n            if (val < cur.val) {\n                if (!cur.left) { cur.left = node; return; }\n                cur = cur.left;\n            } else {\n                if (!cur.right) { cur.right = node; return; }\n                cur = cur.right;\n            }\n        }\n    }\n    search(val) {\n        let cur = this.root;\n        while (cur) {\n            if (val === cur.val) return true;\n            if (val < cur.val) cur = cur.left;\n            else cur = cur.right;\n        }\n        return false;\n    }\n}`,
        validate(code) {
            const checks = [];
            try {
                const BST = new Function(code + '\nreturn BST;')();
                const tree = new BST();
                [8, 3, 10, 1, 6, 14].forEach(v => tree.insert(v));
                checks.push({ pass: tree.search(6) === true, msg: tree.search(6) === true ? 'search(6) = true ✓' : 'search(6) 应为 true' });
                checks.push({ pass: tree.search(8) === true, msg: tree.search(8) === true ? 'search(8) = true（根节点）✓' : 'search(8) 应为 true' });
                checks.push({ pass: tree.search(14) === true, msg: tree.search(14) === true ? 'search(14) = true ✓' : 'search(14) 应为 true' });
                checks.push({ pass: tree.search(5) === false, msg: tree.search(5) === false ? 'search(5) = false ✓' : 'search(5) 应为 false' });
                checks.push({ pass: tree.search(0) === false, msg: tree.search(0) === false ? 'search(0) = false ✓' : 'search(0) 应为 false' });
                const empty = new BST();
                checks.push({ pass: empty.search(1) === false, msg: empty.search(1) === false ? '空树 search(1) = false ✓' : '空树搜索应返回 false' });
            } catch (e) {
                checks.push({ pass: false, msg: '代码执行出错: ' + e.message });
            }
            return checks;
        }
    },
    {
        id: 29,
        title: '树的遍历',
        description: '前序、中序、后序遍历',
        tutorial: `
            <p>二叉树有三种深度优先遍历方式，区别在于<strong>访问根节点的时机</strong>：</p>
            <div class="syntax-block">前序（Pre-order）: 根 → 左 → 右
中序（In-order）:  左 → 根 → 右
后序（Post-order）: 左 → 右 → 根</div>
            <div class="visual-box">        1
       / \\
      2   3
     / \\
    4   5

前序: [1, 2, 4, 5, 3]  根→左→右
中序: [4, 2, 5, 1, 3]  左→根→右
后序: [4, 5, 2, 3, 1]  左→右→根</div>
        `,
        task: '编写 <code>preorder(root)</code>、<code>inorder(root)</code>、<code>postorder(root)</code> 三个函数，返回遍历结果数组。节点有 <code>val</code>、<code>left</code>、<code>right</code> 属性。',
        template: `function preorder(root) {\n    // 前序遍历：根 → 左 → 右\n    // 返回遍历结果数组\n}\n\nfunction inorder(root) {\n    // 中序遍历：左 → 根 → 右\n}\n\nfunction postorder(root) {\n    // 后序遍历：左 → 右 → 根\n}`,
        hint: '每个函数内定义结果数组和递归辅助函数。前序：先 push(val) 再递归左右。中序：先递归左，push，再递归右。后序：先递归左右，再 push。',
        answer: `function preorder(root) {\n    const result = [];\n    function traverse(node) {\n        if (!node) return;\n        result.push(node.val);\n        traverse(node.left);\n        traverse(node.right);\n    }\n    traverse(root);\n    return result;\n}\n\nfunction inorder(root) {\n    const result = [];\n    function traverse(node) {\n        if (!node) return;\n        traverse(node.left);\n        result.push(node.val);\n        traverse(node.right);\n    }\n    traverse(root);\n    return result;\n}\n\nfunction postorder(root) {\n    const result = [];\n    function traverse(node) {\n        if (!node) return;\n        traverse(node.left);\n        traverse(node.right);\n        result.push(node.val);\n    }\n    traverse(root);\n    return result;\n}`,
        validate(code) {
            const checks = [];
            try {
                const fns = new Function(code + '\nreturn { preorder, inorder, postorder };')();
                // 构建测试树:    1
                //              / \
                //             2   3
                //            / \
                //           4   5
                const tree = { val: 1, left: { val: 2, left: { val: 4, left: null, right: null }, right: { val: 5, left: null, right: null } }, right: { val: 3, left: null, right: null } };
                let r = fns.preorder(tree);
                checks.push({ pass: deepEqual(r, [1, 2, 4, 5, 3]), msg: deepEqual(r, [1, 2, 4, 5, 3]) ? '前序遍历 [1,2,4,5,3] ✓' : '前序期望 [1,2,4,5,3]，得到 ' + JSON.stringify(r) });
                r = fns.inorder(tree);
                checks.push({ pass: deepEqual(r, [4, 2, 5, 1, 3]), msg: deepEqual(r, [4, 2, 5, 1, 3]) ? '中序遍历 [4,2,5,1,3] ✓' : '中序期望 [4,2,5,1,3]，得到 ' + JSON.stringify(r) });
                r = fns.postorder(tree);
                checks.push({ pass: deepEqual(r, [4, 5, 2, 3, 1]), msg: deepEqual(r, [4, 5, 2, 3, 1]) ? '后序遍历 [4,5,2,3,1] ✓' : '后序期望 [4,5,2,3,1]，得到 ' + JSON.stringify(r) });
                r = fns.preorder(null);
                checks.push({ pass: deepEqual(r, []), msg: deepEqual(r, []) ? '空树遍历返回 [] ✓' : '空树应返回 []' });
            } catch (e) {
                checks.push({ pass: false, msg: '代码执行出错: ' + e.message });
            }
            return checks;
        }
    },
    {
        id: 30,
        title: '层序遍历',
        description: '用队列实现广度优先遍历',
        tutorial: `
            <p><code>层序遍历（BFS）</code>逐层访问树的节点，使用<strong>队列</strong>辅助实现。</p>
            <div class="syntax-block">算法：
1. 将根节点放入队列
2. 当队列不为空时：
   - 记录当前层的节点数 levelSize
   - 循环 levelSize 次：
     出队一个节点，记录其值
     将其左右子节点入队
   - 将当前层的值存入结果</div>
            <div class="visual-box">        3
       / \\
      9   20
         / \\
        15   7

第1层: [3]
第2层: [9, 20]
第3层: [15, 7]

结果: [[3], [9, 20], [15, 7]]</div>
        `,
        task: '编写 <code>levelOrder(root)</code>，返回层序遍历的二维数组，每层一个子数组。空树返回 <code>[]</code>。',
        template: `function levelOrder(root) {\n    // 层序遍历（BFS）\n    // 返回二维数组，每层一个子数组\n    // 空树返回 []\n}`,
        hint: '用数组当队列，shift出队push入队。外层while队列非空，内层for循环处理当前层（queue.length 即为当前层节点数）。',
        answer: `function levelOrder(root) {\n    if (!root) return [];\n    const result = [];\n    const queue = [root];\n    while (queue.length > 0) {\n        const levelSize = queue.length;\n        const level = [];\n        for (let i = 0; i < levelSize; i++) {\n            const node = queue.shift();\n            level.push(node.val);\n            if (node.left) queue.push(node.left);\n            if (node.right) queue.push(node.right);\n        }\n        result.push(level);\n    }\n    return result;\n}`,
        validate(code) {
            const checks = [];
            try {
                const levelOrder = new Function(code + '\nreturn levelOrder;')();
                // 树:    3
                //       / \
                //      9   20
                //         / \
                //        15   7
                const tree = { val: 3, left: { val: 9, left: null, right: null }, right: { val: 20, left: { val: 15, left: null, right: null }, right: { val: 7, left: null, right: null } } };
                let r = levelOrder(tree);
                checks.push({ pass: deepEqual(r, [[3], [9, 20], [15, 7]]), msg: deepEqual(r, [[3], [9, 20], [15, 7]]) ? '层序遍历 [[3],[9,20],[15,7]] ✓' : '期望 [[3],[9,20],[15,7]]，得到 ' + JSON.stringify(r) });
                r = levelOrder(null);
                checks.push({ pass: deepEqual(r, []), msg: deepEqual(r, []) ? '空树返回 [] ✓' : '空树应返回 []' });
                // 单节点
                r = levelOrder({ val: 1, left: null, right: null });
                checks.push({ pass: deepEqual(r, [[1]]), msg: deepEqual(r, [[1]]) ? '单节点 [[1]] ✓' : '单节点期望 [[1]]' });
                // 完全二叉树
                const tree2 = { val: 1, left: { val: 2, left: { val: 4, left: null, right: null }, right: { val: 5, left: null, right: null } }, right: { val: 3, left: { val: 6, left: null, right: null }, right: { val: 7, left: null, right: null } } };
                r = levelOrder(tree2);
                checks.push({ pass: deepEqual(r, [[1], [2, 3], [4, 5, 6, 7]]), msg: deepEqual(r, [[1], [2, 3], [4, 5, 6, 7]]) ? '完全二叉树 [[1],[2,3],[4,5,6,7]] ✓' : '期望 [[1],[2,3],[4,5,6,7]]' });
            } catch (e) {
                checks.push({ pass: false, msg: '代码执行出错: ' + e.message });
            }
            return checks;
        }
    },
    // ===== 第十一阶段：图 =====
    {
        id: 31,
        title: '图的表示',
        description: '用邻接表构建图结构',
        tutorial: `
            <p><code>图（Graph）</code>由节点（顶点）和边组成，用于表示多对多关系。常用<strong>邻接表</strong>存储。</p>
            <div class="visual-box">    A --- B
    |     |
    C --- D --- E

邻接表：
A: [B, C]
B: [A, D]
C: [A, D]
D: [B, C, E]
E: [D]</div>
            <div class="syntax-block">class Graph {
    constructor() {
        this.adjacencyList = {};
    }
    addVertex(v) { ... }
    addEdge(v1, v2) { ... }  // 无向图：双向添加
}</div>
        `,
        task: '实现 <code>Graph</code> 类：<code>addVertex(v)</code> 添加顶点，<code>addEdge(v1,v2)</code> 添加无向边，<code>getNeighbors(v)</code> 返回邻居数组。',
        template: `class Graph {\n    constructor() {\n        this.adjacencyList = {};\n    }\n\n    addVertex(v) {\n        // 添加顶点（如果不存在）\n    }\n\n    addEdge(v1, v2) {\n        // 添加无向边（两个方向都要加）\n    }\n\n    getNeighbors(v) {\n        // 返回顶点 v 的邻居数组\n    }\n}`,
        hint: 'addVertex: if (!this.adjacencyList[v]) this.adjacencyList[v] = []; addEdge: 分别 push 对方到各自的列表。',
        answer: `class Graph {\n    constructor() {\n        this.adjacencyList = {};\n    }\n    addVertex(v) {\n        if (!this.adjacencyList[v]) this.adjacencyList[v] = [];\n    }\n    addEdge(v1, v2) {\n        if (!this.adjacencyList[v1]) this.addVertex(v1);\n        if (!this.adjacencyList[v2]) this.addVertex(v2);\n        this.adjacencyList[v1].push(v2);\n        this.adjacencyList[v2].push(v1);\n    }\n    getNeighbors(v) {\n        return this.adjacencyList[v] || [];\n    }\n}`,
        validate(code) {
            const checks = [];
            try {
                const Graph = new Function(code + '\nreturn Graph;')();
                const g = new Graph();
                g.addVertex('A'); g.addVertex('B'); g.addVertex('C');
                g.addEdge('A', 'B'); g.addEdge('A', 'C'); g.addEdge('B', 'C');
                const na = g.getNeighbors('A').sort();
                checks.push({ pass: deepEqual(na, ['B', 'C']), msg: deepEqual(na, ['B', 'C']) ? 'A 的邻居为 [B, C] ✓' : 'A 的邻居期望 [B,C]，得到 ' + JSON.stringify(na) });
                const nb = g.getNeighbors('B').sort();
                checks.push({ pass: deepEqual(nb, ['A', 'C']), msg: deepEqual(nb, ['A', 'C']) ? 'B 的邻居为 [A, C]（无向图）✓' : 'B 的邻居期望 [A,C]' });
                checks.push({ pass: deepEqual(g.getNeighbors('X'), []), msg: deepEqual(g.getNeighbors('X'), []) ? '不存在的顶点返回 [] ✓' : '不存在的顶点应返回 []' });
                g.addEdge('C', 'D');
                checks.push({ pass: g.getNeighbors('D').includes('C'), msg: g.getNeighbors('D').includes('C') ? 'addEdge 自动创建新顶点 D ✓' : 'addEdge 应能自动创建顶点' });
            } catch (e) {
                checks.push({ pass: false, msg: '代码执行出错: ' + e.message });
            }
            return checks;
        }
    },
    {
        id: 32,
        title: '广度优先搜索 BFS',
        description: '图的层层扩展遍历',
        tutorial: `
            <p><code>BFS</code> 从起点开始，先访问所有直接邻居，再访问邻居的邻居，像水波扩散。使用<strong>队列</strong>辅助。</p>
            <div class="syntax-block">BFS(graph, start):
  visited = Set()
  queue = [start]
  visited.add(start)
  result = []
  while queue 不为空:
    vertex = queue.shift()
    result.push(vertex)
    for neighbor of graph[vertex]:
      if neighbor 未访问:
        visited.add(neighbor)
        queue.push(neighbor)</div>
            <div class="visual-box">    A --- B
    |     |
    C --- D --- E

BFS from A:
第1层: A
第2层: B, C（A的邻居）
第3层: D（B/C的邻居）
第4层: E（D的邻居）
结果: [A, B, C, D, E]</div>
        `,
        task: '编写 <code>bfs(graph, start)</code>，graph 是邻接表对象，返回 BFS 遍历顺序的数组。',
        template: `function bfs(graph, start) {\n    // 广度优先搜索\n    // graph: { A: ['B','C'], B: ['A','D'], ... }\n    // 返回遍历顺序数组\n}`,
        hint: '用 Set 记录已访问，数组当队列 shift 出队 push 入队。',
        answer: `function bfs(graph, start) {\n    const visited = new Set();\n    const queue = [start];\n    const result = [];\n    visited.add(start);\n    while (queue.length > 0) {\n        const vertex = queue.shift();\n        result.push(vertex);\n        for (const neighbor of (graph[vertex] || [])) {\n            if (!visited.has(neighbor)) {\n                visited.add(neighbor);\n                queue.push(neighbor);\n            }\n        }\n    }\n    return result;\n}`,
        validate(code) {
            const checks = [];
            try {
                const bfs = new Function(code + '\nreturn bfs;')();
                const g = { A: ['B', 'C'], B: ['A', 'D'], C: ['A', 'D'], D: ['B', 'C', 'E'], E: ['D'] };
                const r = bfs(g, 'A');
                checks.push({ pass: r[0] === 'A', msg: r[0] === 'A' ? '从 A 开始 ✓' : '应从 A 开始' });
                checks.push({ pass: r.length === 5, msg: r.length === 5 ? '遍历了所有5个节点 ✓' : '应遍历5个节点，实际 ' + r.length });
                const setR = new Set(r);
                checks.push({ pass: setR.size === 5 && ['A','B','C','D','E'].every(v => setR.has(v)), msg: setR.size === 5 ? '包含所有节点 A-E ✓' : '缺少某些节点' });
                const idxB = r.indexOf('B'), idxD = r.indexOf('D');
                checks.push({ pass: idxB < idxD, msg: idxB < idxD ? 'B 在 D 之前被访问（层次正确）✓' : 'BFS 层次顺序不正确' });
                const r2 = bfs({ X: ['Y'], Y: ['X'] }, 'X');
                checks.push({ pass: deepEqual(r2, ['X', 'Y']), msg: deepEqual(r2, ['X', 'Y']) ? '两节点图 [X,Y] ✓' : '两节点图期望 [X,Y]' });
            } catch (e) {
                checks.push({ pass: false, msg: '代码执行出错: ' + e.message });
            }
            return checks;
        }
    },
    {
        id: 33,
        title: '深度优先搜索 DFS',
        description: '图的纵深探索遍历',
        tutorial: `
            <p><code>DFS</code> 从起点开始，沿一条路径走到底，再回溯探索其他路径。使用<strong>栈</strong>或<strong>递归</strong>实现。</p>
            <div class="syntax-block">DFS(graph, start):
  visited = Set()
  result = []
  function dfs(vertex):
    visited.add(vertex)
    result.push(vertex)
    for neighbor of graph[vertex]:
      if neighbor 未访问:
        dfs(neighbor)
  dfs(start)
  return result</div>
            <div class="visual-box">    A --- B
    |     |
    C --- D --- E

DFS from A (递归):
A → B → D → C → (已访问A,跳过) → E
结果: [A, B, D, C, E]</div>
        `,
        task: '编写 <code>dfs(graph, start)</code>，使用递归实现深度优先搜索，返回遍历顺序数组。',
        template: `function dfs(graph, start) {\n    // 深度优先搜索（递归）\n    // graph: { A: ['B','C'], B: ['A','D'], ... }\n    // 返回遍历顺序数组\n}`,
        hint: '定义 visited Set 和 result 数组，写一个内部递归函数，先标记访问并 push，再对未访问的邻居递归。',
        answer: `function dfs(graph, start) {\n    const visited = new Set();\n    const result = [];\n    function traverse(vertex) {\n        visited.add(vertex);\n        result.push(vertex);\n        for (const neighbor of (graph[vertex] || [])) {\n            if (!visited.has(neighbor)) {\n                traverse(neighbor);\n            }\n        }\n    }\n    traverse(start);\n    return result;\n}`,
        validate(code) {
            const checks = [];
            try {
                const dfs = new Function(code + '\nreturn dfs;')();
                const g = { A: ['B', 'C'], B: ['A', 'D'], C: ['A', 'D'], D: ['B', 'C', 'E'], E: ['D'] };
                const r = dfs(g, 'A');
                checks.push({ pass: r[0] === 'A', msg: r[0] === 'A' ? '从 A 开始 ✓' : '应从 A 开始' });
                checks.push({ pass: r.length === 5, msg: r.length === 5 ? '遍历了所有5个节点 ✓' : '应遍历5个节点' });
                const setR = new Set(r);
                checks.push({ pass: setR.size === 5, msg: setR.size === 5 ? '每个节点只访问一次 ✓' : '存在重复访问' });
                // DFS 特征：第二个节点应该是A的第一个邻居B，然后应该是B的邻居D（深入）
                checks.push({ pass: r[1] === 'B' || r[1] === 'C', msg: (r[1] === 'B' || r[1] === 'C') ? '第二个是 A 的邻居（深度优先）✓' : 'DFS 顺序不正确' });
                const r2 = dfs({ X: [] }, 'X');
                checks.push({ pass: deepEqual(r2, ['X']), msg: deepEqual(r2, ['X']) ? '孤立节点 [X] ✓' : '孤立节点期望 [X]' });
            } catch (e) {
                checks.push({ pass: false, msg: '代码执行出错: ' + e.message });
            }
            return checks;
        }
    },
    // ===== 第十二阶段：经典算法问题 =====
    {
        id: 34,
        title: '爬楼梯',
        description: '动态规划入门经典',
        tutorial: `
            <p>经典DP问题：每次可以爬 1 或 2 个台阶，爬到第 n 阶有多少种走法？</p>
            <div class="syntax-block">分析：
到第 n 阶 = 从第 n-1 阶爬1步 + 从第 n-2 阶爬2步
dp[n] = dp[n-1] + dp[n-2]

base case: dp[1] = 1, dp[2] = 2</div>
            <div class="visual-box">n=1: [1]                     → 1种
n=2: [1+1], [2]              → 2种
n=3: [1+1+1],[1+2],[2+1]     → 3种
n=4: [1+1+1+1],[1+1+2],
     [1+2+1],[2+1+1],[2+2]   → 5种

规律: 1, 2, 3, 5, 8, 13...（斐波那契！）</div>
        `,
        task: '编写 <code>climbStairs(n)</code>，返回爬到第 n 阶的方法数。',
        template: `function climbStairs(n) {\n    // 每次可以爬 1 或 2 个台阶\n    // 返回爬到第 n 阶的方法数\n}`,
        hint: '用两个变量 a=1, b=2 交替计算，类似斐波那契。或者用 dp 数组，dp[i] = dp[i-1] + dp[i-2]。',
        answer: `function climbStairs(n) {\n    if (n <= 2) return n;\n    let a = 1, b = 2;\n    for (let i = 3; i <= n; i++) {\n        [a, b] = [b, a + b];\n    }\n    return b;\n}`,
        validate(code) {
            return testFunction(code, 'climbStairs', [
                { input: [1], expected: 1 },
                { input: [2], expected: 2 },
                { input: [3], expected: 3 },
                { input: [4], expected: 5 },
                { input: [5], expected: 8 },
                { input: [10], expected: 89 }
            ]);
        }
    },
    {
        id: 35,
        title: '最大子数组和',
        description: 'Kadane 算法——动态规划经典',
        tutorial: `
            <p>给定整数数组，找到和最大的连续子数组。这是 <code>Kadane 算法</code>的经典应用。</p>
            <div class="syntax-block">核心思想：
遍历数组，维护两个变量：
  currentMax = 以当前元素结尾的最大子数组和
  globalMax  = 全局最大子数组和

currentMax = max(nums[i], currentMax + nums[i])
globalMax  = max(globalMax, currentMax)</div>
            <div class="visual-box">nums = [-2, 1, -3, 4, -1, 2, 1, -5, 4]

curMax:  -2  1  -2  4   3  5  6   1  4
gMax:    -2  1   1  4   4  5  6   6  6

最大子数组: [4, -1, 2, 1]，和 = 6</div>
        `,
        task: '编写 <code>maxSubArray(nums)</code>，返回最大连续子数组的和。',
        template: `function maxSubArray(nums) {\n    // 找到和最大的连续子数组，返回其和\n}`,
        hint: '初始化 currentMax = globalMax = nums[0]，从 i=1 遍历，currentMax = Math.max(nums[i], currentMax + nums[i])。',
        answer: `function maxSubArray(nums) {\n    let currentMax = nums[0];\n    let globalMax = nums[0];\n    for (let i = 1; i < nums.length; i++) {\n        currentMax = Math.max(nums[i], currentMax + nums[i]);\n        globalMax = Math.max(globalMax, currentMax);\n    }\n    return globalMax;\n}`,
        validate(code) {
            return testFunction(code, 'maxSubArray', [
                { input: [[-2, 1, -3, 4, -1, 2, 1, -5, 4]], expected: 6 },
                { input: [[1]], expected: 1 },
                { input: [[-1]], expected: -1 },
                { input: [[5, 4, -1, 7, 8]], expected: 23 },
                { input: [[-2, -1, -3]], expected: -1 }
            ]);
        }
    },
    {
        id: 36,
        title: '买卖股票最佳时机',
        description: '贪心/DP——一次交易的最大利润',
        tutorial: `
            <p>给定股票每日价格数组，只能买一次卖一次，求最大利润。</p>
            <div class="syntax-block">贪心思路：
遍历价格，记录到目前为止的最低价 minPrice
每天计算 当前价 - minPrice 得到潜在利润
更新最大利润 maxProfit</div>
            <div class="visual-box">prices = [7, 1, 5, 3, 6, 4]

day0: price=7, min=7, profit=0
day1: price=1, min=1, profit=0
day2: price=5, min=1, profit=4  ← 5-1
day3: price=3, min=1, profit=4
day4: price=6, min=1, profit=5  ← 6-1 最大！
day5: price=4, min=1, profit=5

第1天买入(1)，第4天卖出(6)，利润=5</div>
        `,
        task: '编写 <code>maxProfit(prices)</code>，返回一次买卖的最大利润。无法获利则返回 0。',
        template: `function maxProfit(prices) {\n    // 一次买卖的最大利润\n    // 不能获利时返回 0\n}`,
        hint: '维护 minPrice（初始 Infinity）和 maxProfit（初始 0），遍历时更新两者。',
        answer: `function maxProfit(prices) {\n    let minPrice = Infinity;\n    let maxProfit = 0;\n    for (const price of prices) {\n        minPrice = Math.min(minPrice, price);\n        maxProfit = Math.max(maxProfit, price - minPrice);\n    }\n    return maxProfit;\n}`,
        validate(code) {
            return testFunction(code, 'maxProfit', [
                { input: [[7, 1, 5, 3, 6, 4]], expected: 5 },
                { input: [[7, 6, 4, 3, 1]], expected: 0 },
                { input: [[1, 2]], expected: 1 },
                { input: [[2, 4, 1]], expected: 2 },
                { input: [[3, 3, 3]], expected: 0 }
            ]);
        }
    },
    // ===== 第十三阶段：滑动窗口与双指针 =====
    {
        id: 37,
        title: '最长无重复子串',
        description: '滑动窗口经典题',
        tutorial: `
            <p>给定字符串，找到不含重复字符的最长子串长度。使用<strong>滑动窗口</strong>技巧。</p>
            <div class="syntax-block">滑动窗口思路：
维护窗口 [left, right]：
  right 右移扩展窗口
  如果新字符在窗口中已存在：
    left 右移缩小窗口直到无重复
  更新最大长度</div>
            <div class="visual-box">"abcabcbb"

[a]bcabcbb        → len=1
[ab]cabcbb        → len=2
[abc]abcbb        → len=3
a[bca]bcbb        → 遇到a重复，left跳到b
ab[cab]cbb        → len=3
abc[abc]bb        → len=3
abca[bcb]b        → 遇到b重复
abcab[cb]b        → len=2
abcabc[b]b        → 遇到b重复

最长 = 3 ("abc")</div>
        `,
        task: '编写 <code>lengthOfLongestSubstring(s)</code>，返回最长无重复字符子串的长度。',
        template: `function lengthOfLongestSubstring(s) {\n    // 滑动窗口找最长无重复子串\n    // 返回长度\n}`,
        hint: '用 Set 或 Map 记录窗口内字符。right 遍历，如果 s[right] 在 set 中则 while 循环删除 s[left] 并 left++。',
        answer: `function lengthOfLongestSubstring(s) {\n    const set = new Set();\n    let left = 0, maxLen = 0;\n    for (let right = 0; right < s.length; right++) {\n        while (set.has(s[right])) {\n            set.delete(s[left]);\n            left++;\n        }\n        set.add(s[right]);\n        maxLen = Math.max(maxLen, right - left + 1);\n    }\n    return maxLen;\n}`,
        validate(code) {
            return testFunction(code, 'lengthOfLongestSubstring', [
                { input: ['abcabcbb'], expected: 3 },
                { input: ['bbbbb'], expected: 1 },
                { input: ['pwwkew'], expected: 3 },
                { input: [''], expected: 0 },
                { input: ['abcdef'], expected: 6 },
                { input: ['dvdf'], expected: 3 }
            ]);
        }
    },
    {
        id: 38,
        title: '盛水最多的容器',
        description: '双指针——面积最大化',
        tutorial: `
            <p>给定数组 height，每个值代表一条竖线的高度。找两条线和x轴围成的容器，使其盛水最多。</p>
            <div class="syntax-block">双指针思路：
左指针 left=0，右指针 right=n-1
面积 = min(height[left], height[right]) × (right-left)
每次移动较短那条线的指针（贪心）</div>
            <div class="visual-box">height = [1,8,6,2,5,4,8,3,7]

    8           8
    |     6     |     7
    |     |  5  |     |
    |     |  |  4     |
    |     |  |  |  3  |
    |     |  2  |  |  |
    1     |  |  |  |  |
    |     |  |  |  |  |
    L →                 ← R

最大面积 = min(8,7) × 7 = 49</div>
        `,
        task: '编写 <code>maxArea(height)</code>，返回最大盛水面积。',
        template: `function maxArea(height) {\n    // 双指针法求最大面积\n}`,
        hint: 'left=0, right=len-1，循环中算面积并更新最大值，谁矮移动谁。',
        answer: `function maxArea(height) {\n    let left = 0, right = height.length - 1;\n    let max = 0;\n    while (left < right) {\n        const area = Math.min(height[left], height[right]) * (right - left);\n        max = Math.max(max, area);\n        if (height[left] < height[right]) left++;\n        else right--;\n    }\n    return max;\n}`,
        validate(code) {
            return testFunction(code, 'maxArea', [
                { input: [[1, 8, 6, 2, 5, 4, 8, 3, 7]], expected: 49 },
                { input: [[1, 1]], expected: 1 },
                { input: [[4, 3, 2, 1, 4]], expected: 16 },
                { input: [[1, 2, 1]], expected: 2 }
            ]);
        }
    },
    {
        id: 39,
        title: '三数之和',
        description: '排序 + 双指针的巧妙组合',
        tutorial: `
            <p>找出数组中所有和为 0 的三元组，不能重复。</p>
            <div class="syntax-block">算法：
1. 数组排序
2. 遍历 i=0 到 n-3:
   跳过重复的 nums[i]
   left = i+1, right = n-1
   while left < right:
     sum = nums[i] + nums[left] + nums[right]
     sum === 0 → 记录，跳过重复，left++ right--
     sum < 0   → left++
     sum > 0   → right--</div>
            <div class="visual-box">nums = [-1, 0, 1, 2, -1, -4]
排序: [-4, -1, -1, 0, 1, 2]

i=0(-4): left=1,right=5 → 和太小
i=1(-1): left=2,right=5
  -1+(-1)+2=0 ✓ → [-1,-1,2]
  -1+0+1=0 ✓   → [-1,0,1]

结果: [[-1,-1,2], [-1,0,1]]</div>
        `,
        task: '编写 <code>threeSum(nums)</code>，返回所有和为0的三元组数组，结果不含重复。每个三元组内的数升序排列。',
        template: `function threeSum(nums) {\n    // 找出所有和为 0 的不重复三元组\n    // 返回二维数组\n}`,
        hint: '先排序，外层遍历固定一个数，内层用双指针找另外两个。注意跳过重复值。',
        answer: `function threeSum(nums) {\n    nums.sort((a, b) => a - b);\n    const result = [];\n    for (let i = 0; i < nums.length - 2; i++) {\n        if (i > 0 && nums[i] === nums[i - 1]) continue;\n        let left = i + 1, right = nums.length - 1;\n        while (left < right) {\n            const sum = nums[i] + nums[left] + nums[right];\n            if (sum === 0) {\n                result.push([nums[i], nums[left], nums[right]]);\n                while (left < right && nums[left] === nums[left + 1]) left++;\n                while (left < right && nums[right] === nums[right - 1]) right--;\n                left++; right--;\n            } else if (sum < 0) left++;\n            else right--;\n        }\n    }\n    return result;\n}`,
        validate(code) {
            const checks = [];
            try {
                const threeSum = new Function(code + '\nreturn threeSum;')();
                let r = threeSum([-1, 0, 1, 2, -1, -4]);
                const sorted = r.map(t => [...t].sort((a, b) => a - b)).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
                checks.push({ pass: deepEqual(sorted, [[-1, -1, 2], [-1, 0, 1]]), msg: deepEqual(sorted, [[-1, -1, 2], [-1, 0, 1]]) ? '[-1,0,1,2,-1,-4] → [[-1,-1,2],[-1,0,1]] ✓' : '期望 [[-1,-1,2],[-1,0,1]]，得到 ' + JSON.stringify(sorted) });
                r = threeSum([0, 0, 0]);
                checks.push({ pass: deepEqual(r, [[0, 0, 0]]), msg: deepEqual(r, [[0, 0, 0]]) ? '[0,0,0] → [[0,0,0]] ✓' : '期望 [[0,0,0]]' });
                r = threeSum([1, 2, 3]);
                checks.push({ pass: deepEqual(r, []), msg: deepEqual(r, []) ? '无解返回 [] ✓' : '无解应返回 []' });
                r = threeSum([0, 0, 0, 0]);
                checks.push({ pass: r.length === 1, msg: r.length === 1 ? '不含重复三元组 ✓' : '结果不应有重复' });
            } catch (e) {
                checks.push({ pass: false, msg: '代码执行出错: ' + e.message });
            }
            return checks;
        }
    },
    // ===== 第十四阶段：实战挑战 =====
    {
        id: 40,
        title: '有效的字母异位词',
        description: '哈希计数的巧妙应用',
        tutorial: `
            <p><code>字母异位词</code>是指两个字符串包含完全相同的字母，只是顺序不同。如 "listen" 和 "silent"。</p>
            <div class="syntax-block">思路：用哈希表统计字符频次
1. 统计字符串 s 中每个字符出现次数 (+1)
2. 遍历字符串 t，每个字符次数 (-1)
3. 如果所有计数都为 0，则是异位词</div>
            <div class="visual-box">"anagram" vs "nagaram"

统计 s: {a:3, n:1, g:1, r:1, m:1}
减去 t: {a:0, n:0, g:0, r:0, m:0}
全为 0 → 是异位词 ✓</div>
        `,
        task: '编写 <code>isAnagram(s, t)</code>，判断 t 是否是 s 的字母异位词。',
        template: `function isAnagram(s, t) {\n    // 判断 t 是否是 s 的字母异位词\n}`,
        hint: '长度不同直接 false。用对象计数：遍历 s 加1，遍历 t 减1，检查所有值是否为0。',
        answer: `function isAnagram(s, t) {\n    if (s.length !== t.length) return false;\n    const count = {};\n    for (const c of s) count[c] = (count[c] || 0) + 1;\n    for (const c of t) {\n        if (!count[c]) return false;\n        count[c]--;\n    }\n    return true;\n}`,
        validate(code) {
            return testFunction(code, 'isAnagram', [
                { input: ['anagram', 'nagaram'], expected: true },
                { input: ['rat', 'car'], expected: false },
                { input: ['listen', 'silent'], expected: true },
                { input: ['a', 'a'], expected: true },
                { input: ['ab', 'a'], expected: false },
                { input: ['', ''], expected: true }
            ]);
        }
    },
    {
        id: 41,
        title: '合并两个有序数组',
        description: '双指针归并技巧',
        tutorial: `
            <p>给定两个升序数组，将它们合并为一个升序数组。</p>
            <div class="syntax-block">双指针归并：
i 指向 arr1, j 指向 arr2
每次取较小的放入结果
直到一方耗尽，将另一方剩余追加</div>
            <div class="visual-box">arr1 = [1, 3, 5, 7]
arr2 = [2, 4, 6, 8]

i→1  j→2 → 取1  result=[1]
i→3  j→2 → 取2  result=[1,2]
i→3  j→4 → 取3  result=[1,2,3]
i→5  j→4 → 取4  result=[1,2,3,4]
...
result = [1,2,3,4,5,6,7,8]</div>
        `,
        task: '编写 <code>mergeSorted(arr1, arr2)</code>，合并两个有序数组为一个新的有序数组。',
        template: `function mergeSorted(arr1, arr2) {\n    // 合并两个升序数组为一个升序数组\n}`,
        hint: '双指针 i=0, j=0，比较 arr1[i] 和 arr2[j]，取小的 push。循环后把剩余的 concat。',
        answer: `function mergeSorted(arr1, arr2) {\n    const result = [];\n    let i = 0, j = 0;\n    while (i < arr1.length && j < arr2.length) {\n        if (arr1[i] <= arr2[j]) result.push(arr1[i++]);\n        else result.push(arr2[j++]);\n    }\n    return result.concat(arr1.slice(i)).concat(arr2.slice(j));\n}`,
        validate(code) {
            return testFunction(code, 'mergeSorted', [
                { input: [[1, 3, 5], [2, 4, 6]], expected: [1, 2, 3, 4, 5, 6] },
                { input: [[], [1, 2, 3]], expected: [1, 2, 3] },
                { input: [[1], []], expected: [1] },
                { input: [[1, 1], [1, 1]], expected: [1, 1, 1, 1] },
                { input: [[1, 5, 9], [2, 3, 7, 10]], expected: [1, 2, 3, 5, 7, 9, 10] }
            ]);
        }
    },
    {
        id: 42,
        title: '岛屿数量',
        description: 'DFS 的二维网格应用',
        tutorial: `
            <p>给定二维网格，<code>1</code> 表示陆地，<code>0</code> 表示水。被水包围的连通陆地块是一个岛屿。求岛屿数量。</p>
            <div class="syntax-block">思路：
遍历网格，遇到 '1' 时：
  岛屿数 +1
  DFS 将整个连通陆地块标记为 '0'（沉岛）
  防止重复计数</div>
            <div class="visual-box">1 1 0 0 0
1 1 0 0 0
0 0 1 0 0
0 0 0 1 1

岛屿1: 左上 1-1-1-1（4格相连）
岛屿2: 中间的 1（独立）
岛屿3: 右下 1-1（相连）

答案: 3个岛屿</div>
        `,
        task: '编写 <code>numIslands(grid)</code>，grid 为二维字符数组（"1"陆地/"0"水），返回岛屿数量。',
        template: `function numIslands(grid) {\n    // 计算二维网格中的岛屿数量\n    // grid[i][j] 为 '1'(陆地) 或 '0'(水)\n}`,
        hint: '两层循环遍历，遇到 "1" 就 count++ 并调用 DFS 将连通的 "1" 全改为 "0"。DFS 检查上下左右四个方向。',
        answer: `function numIslands(grid) {\n    if (!grid.length) return 0;\n    let count = 0;\n    const rows = grid.length, cols = grid[0].length;\n    function dfs(r, c) {\n        if (r < 0 || r >= rows || c < 0 || c >= cols || grid[r][c] === '0') return;\n        grid[r][c] = '0';\n        dfs(r + 1, c); dfs(r - 1, c); dfs(r, c + 1); dfs(r, c - 1);\n    }\n    for (let r = 0; r < rows; r++) {\n        for (let c = 0; c < cols; c++) {\n            if (grid[r][c] === '1') {\n                count++;\n                dfs(r, c);\n            }\n        }\n    }\n    return count;\n}`,
        validate(code) {
            const checks = [];
            try {
                const numIslands = new Function(code + '\nreturn numIslands;')();
                let r = numIslands([['1','1','0','0','0'],['1','1','0','0','0'],['0','0','1','0','0'],['0','0','0','1','1']]);
                checks.push({ pass: r === 3, msg: r === 3 ? '4×5网格 → 3个岛屿 ✓' : '期望 3，得到 ' + r });
                r = numIslands([['1','1','1'],['0','1','0'],['1','1','1']]);
                checks.push({ pass: r === 1, msg: r === 1 ? '全连通 → 1个岛屿 ✓' : '期望 1，得到 ' + r });
                r = numIslands([['0','0'],['0','0']]);
                checks.push({ pass: r === 0, msg: r === 0 ? '全是水 → 0个岛屿 ✓' : '期望 0' });
                r = numIslands([['1','0','1'],['0','0','0'],['1','0','1']]);
                checks.push({ pass: r === 4, msg: r === 4 ? '四角各一个 → 4个岛屿 ✓' : '期望 4，得到 ' + r });
            } catch (e) {
                checks.push({ pass: false, msg: '代码执行出错: ' + e.message });
            }
            return checks;
        }
    },
    {
        id: 43,
        title: '零钱兑换',
        description: '动态规划——最优子结构',
        tutorial: `
            <p>给定不同面额的硬币和目标金额，求凑出目标金额所需的<strong>最少硬币数</strong>。</p>
            <div class="syntax-block">DP 定义：
dp[i] = 凑出金额 i 的最少硬币数
dp[0] = 0（金额0不需要硬币）

转移方程：
对每个硬币面额 coin：
  dp[i] = min(dp[i], dp[i - coin] + 1)</div>
            <div class="visual-box">coins = [1, 2, 5], amount = 11

dp[0]=0
dp[1]=1  (1)
dp[2]=1  (2)
dp[3]=2  (2+1)
dp[4]=2  (2+2)
dp[5]=1  (5)
...
dp[11]=3 (5+5+1)

最少 3 枚硬币</div>
        `,
        task: '编写 <code>coinChange(coins, amount)</code>，返回最少硬币数。无法凑出返回 -1。',
        template: `function coinChange(coins, amount) {\n    // 动态规划求最少硬币数\n    // 无法凑出返回 -1\n}`,
        hint: '建立 dp 数组长度 amount+1，初始值 Infinity，dp[0]=0。双层循环：外层遍历金额，内层遍历硬币。',
        answer: `function coinChange(coins, amount) {\n    const dp = new Array(amount + 1).fill(Infinity);\n    dp[0] = 0;\n    for (let i = 1; i <= amount; i++) {\n        for (const coin of coins) {\n            if (i >= coin && dp[i - coin] !== Infinity) {\n                dp[i] = Math.min(dp[i], dp[i - coin] + 1);\n            }\n        }\n    }\n    return dp[amount] === Infinity ? -1 : dp[amount];\n}`,
        validate(code) {
            return testFunction(code, 'coinChange', [
                { input: [[1, 2, 5], 11], expected: 3 },
                { input: [[2], 3], expected: -1 },
                { input: [[1], 0], expected: 0 },
                { input: [[1, 5, 10, 25], 30], expected: 2 },
                { input: [[186, 419, 83, 408], 6249], expected: 20 }
            ]);
        }
    },
    {
        id: 44,
        title: '接雨水',
        description: '双指针的终极挑战',
        tutorial: `
            <p>经典难题：给定柱状图（非负整数数组），计算下雨后能接多少水。</p>
            <div class="syntax-block">关键观察：
每个位置能接的水 = min(左边最高, 右边最高) - 当前高度

双指针优化：
left=0, right=n-1
leftMax=0, rightMax=0
谁小移动谁，计算该位置的水量</div>
            <div class="visual-box">height = [0,1,0,2,1,0,1,3,2,1,2,1]

         3
    2    █ 2   2
  1 █ 1 █ █ 1 █ 1
█ █ █ █ █ █ █ █ █

水:    ■ ■ ■ ■ ■
    ■   ■     ■

总共接水量 = 6</div>
        `,
        task: '编写 <code>trap(height)</code>，计算能接的雨水量。',
        template: `function trap(height) {\n    // 双指针法计算接雨水量\n}`,
        hint: 'left=0, right=n-1, leftMax=0, rightMax=0。如果 height[left] < height[right]，处理左边（更新leftMax，算水量），否则处理右边。',
        answer: `function trap(height) {\n    let left = 0, right = height.length - 1;\n    let leftMax = 0, rightMax = 0, water = 0;\n    while (left < right) {\n        if (height[left] < height[right]) {\n            if (height[left] >= leftMax) leftMax = height[left];\n            else water += leftMax - height[left];\n            left++;\n        } else {\n            if (height[right] >= rightMax) rightMax = height[right];\n            else water += rightMax - height[right];\n            right--;\n        }\n    }\n    return water;\n}`,
        validate(code) {
            return testFunction(code, 'trap', [
                { input: [[0, 1, 0, 2, 1, 0, 1, 3, 2, 1, 2, 1]], expected: 6 },
                { input: [[4, 2, 0, 3, 2, 5]], expected: 9 },
                { input: [[1, 0, 1]], expected: 1 },
                { input: [[3, 0, 0, 2, 0, 4]], expected: 10 },
                { input: [[]], expected: 0 }
            ]);
        }
    },
    {
        id: 45,
        title: 'LRU 缓存',
        description: '设计题——数据结构综合运用',
        tutorial: `
            <p>设计一个 <code>LRU（最近最少使用）缓存</code>，支持 O(1) 的 get 和 put 操作。</p>
            <div class="syntax-block">LRU 缓存规则：
- get(key): 返回值，不存在返回 -1
- put(key, value): 插入/更新键值对
- 超出容量时，淘汰最久未使用的键

JS 巧妙实现：Map 保持插入顺序！
- get 时先删后插 → 移到最新
- put 时超容量删 map.keys().next().value（最老的）</div>
            <div class="visual-box">capacity = 2

put(1,1) → {1:1}
put(2,2) → {1:1, 2:2}
get(1)   → 返回1, {2:2, 1:1}（1移到最新）
put(3,3) → 淘汰2, {1:1, 3:3}
get(2)   → -1（已被淘汰）
put(4,4) → 淘汰1, {3:3, 4:4}
get(1)   → -1
get(3)   → 返回3
get(4)   → 返回4</div>
        `,
        task: '实现 <code>LRUCache</code> 类：<code>constructor(capacity)</code>、<code>get(key)</code>、<code>put(key, value)</code>。使用 <code>Map</code> 实现。',
        template: `class LRUCache {\n    constructor(capacity) {\n        // 初始化容量和存储\n    }\n\n    get(key) {\n        // 获取值，不存在返回 -1\n        // 访问后要更新为"最近使用"\n    }\n\n    put(key, value) {\n        // 插入/更新键值对\n        // 超容量时淘汰最久未使用的\n    }\n}`,
        hint: '用 Map 存储。get: 如果 has(key) 则 delete 再 set（移到末尾），否则返回-1。put: 先 delete(key)，如果 size>=capacity 则 delete(map.keys().next().value)，最后 set。',
        answer: `class LRUCache {\n    constructor(capacity) {\n        this.capacity = capacity;\n        this.map = new Map();\n    }\n    get(key) {\n        if (!this.map.has(key)) return -1;\n        const val = this.map.get(key);\n        this.map.delete(key);\n        this.map.set(key, val);\n        return val;\n    }\n    put(key, value) {\n        this.map.delete(key);\n        if (this.map.size >= this.capacity) {\n            this.map.delete(this.map.keys().next().value);\n        }\n        this.map.set(key, value);\n    }\n}`,
        validate(code) {
            const checks = [];
            try {
                const LRUCache = new Function(code + '\nreturn LRUCache;')();
                const cache = new LRUCache(2);
                cache.put(1, 1); cache.put(2, 2);
                let r = cache.get(1);
                checks.push({ pass: r === 1, msg: r === 1 ? 'get(1) = 1 ✓' : 'get(1) 期望 1，得到 ' + r });
                cache.put(3, 3);
                r = cache.get(2);
                checks.push({ pass: r === -1, msg: r === -1 ? 'put(3,3)后 get(2) = -1（被淘汰）✓' : 'get(2) 应为 -1（2应被淘汰）' });
                r = cache.get(3);
                checks.push({ pass: r === 3, msg: r === 3 ? 'get(3) = 3 ✓' : 'get(3) 期望 3' });
                cache.put(4, 4);
                r = cache.get(1);
                checks.push({ pass: r === -1, msg: r === -1 ? 'put(4,4)后 get(1) = -1（被淘汰）✓' : 'get(1) 应为 -1' });
                r = cache.get(3);
                checks.push({ pass: r === 3, msg: r === 3 ? 'get(3) = 3 ✓' : 'get(3) 期望 3' });
                r = cache.get(4);
                checks.push({ pass: r === 4, msg: r === 4 ? 'get(4) = 4 ✓' : 'get(4) 期望 4' });
                // 测试更新已有key
                const cache2 = new LRUCache(2);
                cache2.put(1, 1); cache2.put(2, 2); cache2.put(1, 10);
                checks.push({ pass: cache2.get(1) === 10, msg: cache2.get(1) === 10 ? 'put更新已有key: get(1)=10 ✓' : 'put更新后应返回新值' });
            } catch (e) {
                checks.push({ pass: false, msg: '代码执行出错: ' + e.message });
            }
            return checks;
        }
    }
];

// ===== 工具函数 =====
function deepEqual(a, b) {
    if (a === b) return true;
    if (a === null || b === null || typeof a !== typeof b) return false;
    if (Array.isArray(a) && Array.isArray(b)) {
        if (a.length !== b.length) return false;
        return a.every((v, i) => deepEqual(v, b[i]));
    }
    if (typeof a === 'object') {
        const keysA = Object.keys(a), keysB = Object.keys(b);
        if (keysA.length !== keysB.length) return false;
        return keysA.every(k => deepEqual(a[k], b[k]));
    }
    return false;
}

function testFunction(code, funcName, tests) {
    const checks = [];
    try {
        const fn = new Function(code + '\nreturn ' + funcName + ';')();
        if (typeof fn !== 'function') {
            checks.push({ pass: false, msg: '未找到函数 ' + funcName });
            return checks;
        }
        for (const t of tests) {
            try {
                const result = fn(...t.input.map(v => Array.isArray(v) ? [...v] : v));
                const pass = deepEqual(result, t.expected);
                const inputStr = t.input.map(v => JSON.stringify(v)).join(', ');
                checks.push({
                    pass,
                    msg: pass
                        ? funcName + '(' + inputStr + ') ✓'
                        : funcName + '(' + inputStr + ') 期望 ' + JSON.stringify(t.expected) + '，得到 ' + JSON.stringify(result)
                });
            } catch (e) {
                const inputStr = t.input.map(v => JSON.stringify(v)).join(', ');
                checks.push({ pass: false, msg: funcName + '(' + inputStr + ') 出错: ' + e.message });
            }
        }
    } catch (e) {
        checks.push({ pass: false, msg: '代码语法错误: ' + e.message });
    }
    return checks;
}

// ===== 进度管理 =====
const STORAGE_KEY = 'dsa_learn_progress';

function getProgress() {
    try {
        return JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];
    } catch {
        return [];
    }
}

function saveProgress(levelId) {
    const progress = getProgress();
    if (!progress.includes(levelId)) {
        progress.push(levelId);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(progress));
    }
}

function isLevelCompleted(levelId) {
    return getProgress().includes(levelId);
}

function isLevelUnlocked(idx) {
    if (idx === 0) return true;
    return isLevelCompleted(LEVELS[idx - 1].id);
}

function getCompletedCount() {
    const progress = getProgress();
    return LEVELS.filter(l => progress.includes(l.id)).length;
}

// ===== 页面控制 =====
let currentLevelIdx = -1;

function goBack() {
    if (currentLevelIdx >= 0) {
        showLevelSelect();
    } else {
        window.location.href = '../../index.html';
    }
}

function showLevelSelect() {
    currentLevelIdx = -1;
    document.getElementById('levelSelect').style.display = '';
    document.getElementById('levelDetail').style.display = 'none';
    renderLevelGrid();
}

function renderLevelGrid() {
    const grid = document.getElementById('levelGrid');
    const completed = getCompletedCount();

    document.getElementById('totalProgress').style.width = (completed / LEVELS.length * 100) + '%';
    document.getElementById('progressText').textContent = '已完成 ' + completed + ' / ' + LEVELS.length + ' 关';

    grid.innerHTML = LEVELS.map((level, idx) => {
        const done = isLevelCompleted(level.id);
        const unlocked = isLevelUnlocked(idx);
        let cls = 'level-card';
        if (done) cls += ' completed';
        if (!unlocked) cls += ' locked';
        return '<div class="' + cls + '" data-idx="' + idx + '">' +
            (!unlocked ? '<div class="lock-icon">🔒</div>' : '') +
            '<div class="level-number">第 ' + level.id + ' 关</div>' +
            '<div class="level-card-title">' + level.title + '</div>' +
            '<div class="level-card-desc">' + level.description + '</div>' +
            '</div>';
    }).join('');

    grid.querySelectorAll('.level-card:not(.locked)').forEach(card => {
        card.addEventListener('click', () => {
            openLevel(parseInt(card.dataset.idx));
        });
    });
}

function openLevel(idx) {
    currentLevelIdx = idx;
    const level = LEVELS[idx];

    document.getElementById('levelSelect').style.display = 'none';
    document.getElementById('levelDetail').style.display = '';

    document.getElementById('levelTitle').textContent = '第 ' + level.id + ' 关：' + level.title;
    document.getElementById('tutorialContent').innerHTML = level.tutorial;
    document.getElementById('taskContent').innerHTML = level.task;

    document.getElementById('codeEditor').value = level.template;
    document.getElementById('resultArea').innerHTML = '<p class="placeholder-text">编写代码后点击运行查看结果</p>';
    document.getElementById('hintBox').style.display = 'none';
    document.getElementById('expectedSection').style.display = 'none';

    document.getElementById('btnPrevLevel').disabled = (idx === 0);
    const nextUnlocked = idx + 1 < LEVELS.length && isLevelUnlocked(idx + 1);
    document.getElementById('btnNextLevel').disabled = !nextUnlocked;
}

function handleRun() {
    const level = LEVELS[currentLevelIdx];
    const code = document.getElementById('codeEditor').value.trim();
    if (!code) return;

    const resultArea = document.getElementById('resultArea');
    const checks = level.validate(code);
    const allPass = checks.every(c => c.pass);

    let html = '<ul class="check-list">';
    checks.forEach(c => {
        const cls = c.pass ? 'pass' : 'fail';
        const icon = c.pass ? '✅' : '❌';
        html += '<li class="' + cls + '"><span class="check-icon">' + icon + '</span>' + escapeHtml(c.msg) + '</li>';
    });
    html += '</ul>';

    if (allPass) {
        resultArea.innerHTML = '<div class="success-msg">✅ 所有测试通过！</div>' + html;
        document.getElementById('expectedSection').style.display = 'none';
        saveProgress(level.id);
        showSuccessModal(level);
    } else {
        const passCount = checks.filter(c => c.pass).length;
        resultArea.innerHTML = '<div class="fail-msg">⚠️ 通过 ' + passCount + '/' + checks.length + ' 项测试，请继续调试。</div>' + html;
        const expectedSection = document.getElementById('expectedSection');
        expectedSection.style.display = '';
        document.getElementById('expectedArea').innerHTML = '<div class="answer-block">' + escapeHtml(level.answer) + '</div>';
    }
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function showSuccessModal(level) {
    const modal = document.getElementById('successModal');
    const idx = LEVELS.indexOf(level);
    const isLast = idx === LEVELS.length - 1;

    document.getElementById('successMsg').textContent = isLast
        ? '你已完成所有关卡，数据结构与算法基础已掌握！'
        : '你已掌握「' + level.title + '」，继续挑战下一关吧！';

    document.getElementById('btnNextFromModal').style.display = isLast ? 'none' : '';
    modal.style.display = 'flex';
}

function handleHint() {
    const level = LEVELS[currentLevelIdx];
    const box = document.getElementById('hintBox');
    box.textContent = level.hint;
    box.style.display = box.style.display === 'none' ? '' : 'none';
}

// ===== 事件绑定 =====
document.addEventListener('DOMContentLoaded', () => {
    showLevelSelect();

    document.getElementById('btnRun').addEventListener('click', handleRun);
    document.getElementById('btnHint').addEventListener('click', handleHint);

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

    // Ctrl+Enter 运行
    document.getElementById('codeEditor').addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
            e.preventDefault();
            handleRun();
        }
        // Tab 缩进支持
        if (e.key === 'Tab') {
            e.preventDefault();
            const editor = e.target;
            const start = editor.selectionStart;
            const end = editor.selectionEnd;
            editor.value = editor.value.substring(0, start) + '    ' + editor.value.substring(end);
            editor.selectionStart = editor.selectionEnd = start + 4;
        }
    });
});
